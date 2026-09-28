//! Tests for on-chain run verification: the program replays a player's inputs
//! and derives the time itself.
//!
//! These also report the compute cost of a replay, which is what decides how
//! long a race the chain can verify in one transaction.

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    pixelvault::{
        instructions::track::{PadArg, TrackArgs},
        sim::{
            account::{Leaderboard, RunBuffer, TrackConfig},
            encode_trace,
            testing::{centreline, checkpoints, drive, heading_of, seconds, to_fx, Bot},
            track::{BoostPad, Sample},
            Track, MAX_STEPS,
        },
    },
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const TRACK_ID: u64 = 1;
const LAPS: u8 = 2;
const SPACING: f64 = 2.0;
const WALL_OFFSET: f64 = 10.0;
/// Samples per transaction: each is 16 bytes, and a transaction holds 1232.
const SAMPLES_PER_TX: usize = 60;
/// Trace bytes per transaction, leaving room for signatures and accounts.
const TRACE_BYTES_PER_TX: usize = 900;
/// Steps replayed per verification transaction.
const STEPS_PER_TX: u32 = 400;

const NEON_HARBOR: &[(f64, f64)] = &[
    (0.0, 0.0),
    (0.0, 120.0),
    (20.0, 160.0),
    (60.0, 175.0),
    (110.0, 165.0),
    (140.0, 130.0),
    (150.0, 90.0),
    (175.0, 60.0),
    (180.0, 20.0),
    (160.0, -20.0),
    (120.0, -40.0),
    (70.0, -45.0),
    (30.0, -30.0),
];

struct World {
    svm: LiteSVM,
    payer: Keypair,
    track: Pubkey,
    leaderboard: Pubkey,
    samples: Vec<Sample>,
    checkpoints: Vec<u16>,
    pads: Vec<BoostPad>,
    start_sample: u16,
    start_heading: u32,
}

impl World {
    fn view(&self) -> Track<'_> {
        Track {
            samples: &self.samples,
            spacing: to_fx(SPACING),
            wall_offset: to_fx(WALL_OFFSET),
            checkpoints: &self.checkpoints,
            boost_pads: &self.pads,
            laps: LAPS,
            start_sample: self.start_sample,
            start_heading: self.start_heading,
        }
    }
}

/// Raises the compute limit: replaying a race needs far more than the 200k
/// units an instruction gets by default. Tag 2 is SetComputeUnitLimit.
fn compute_budget(units: u32) -> Instruction {
    let mut data = vec![2u8];
    data.extend_from_slice(&units.to_le_bytes());
    Instruction {
        program_id: Pubkey::from_str_const("ComputeBudget111111111111111111111111111111"),
        accounts: vec![],
        data,
    }
}

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &pixelvault::id()).0
}

/// Sends a transaction and returns the compute units it burned.
fn send(svm: &mut LiteSVM, payer: &Keypair, ixs: &[Instruction]) -> Result<u64, String> {
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer])
        .map_err(|e| e.to_string())?;
    match svm.send_transaction(tx) {
        Ok(meta) => Ok(meta.compute_units_consumed),
        Err(e) => {
            let logs = e
                .meta
                .logs
                .iter()
                .filter(|l| l.contains("AnchorError") || l.contains("Error Message"))
                .cloned()
                .collect::<Vec<_>>()
                .join(" | ");
            Err(format!("{:?} {}", e.err, logs))
        }
    }
}

/// Registers Neon Harbor on-chain: create, write the centreline in chunks, freeze.
fn setup() -> World {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/pixelvault.so"
    ));
    svm.add_program(pixelvault::id(), bytes).unwrap();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();

    let samples = centreline(NEON_HARBOR, SPACING);
    let count = samples.len();
    let start_sample = (count - 4) as u16;
    let start_heading = heading_of(&samples[start_sample as usize]);
    let checkpoints = checkpoints(count, 55.0, count as f64 * SPACING);
    let pads = vec![
        BoostPad { lateral: to_fx(-2.8), sample: (count / 5) as u16, _padding: [0; 2] },
        BoostPad { lateral: to_fx(2.8), sample: (count / 2) as u16, _padding: [0; 2] },
        BoostPad { lateral: to_fx(-2.8), sample: (count * 4 / 5) as u16, _padding: [0; 2] },
    ];

    let track = pda(&[b"track", &TRACK_ID.to_le_bytes()]);
    let leaderboard = pda(&[b"board", &TRACK_ID.to_le_bytes()]);

    let init = Instruction {
        program_id: pixelvault::id(),
        accounts: pixelvault::accounts::InitTrack {
            authority: payer.pubkey(),
            track,
            leaderboard,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: pixelvault::instruction::InitTrack {
            track_id: TRACK_ID,
            args: TrackArgs {
                name: "Neon Harbor".to_string(),
                laps: LAPS,
                spacing: to_fx(SPACING),
                wall_offset: to_fx(WALL_OFFSET),
                start_sample,
                start_heading,
                sample_count: count as u16,
                checkpoints: checkpoints.clone(),
                pads: pads
                    .iter()
                    .map(|p| PadArg { sample: p.sample, lateral: p.lateral })
                    .collect(),
            },
        }
        .data(),
    };
    send(&mut svm, &payer, &[init]).expect("init_track failed");

    let mut written = 0usize;
    while written < count {
        let end = (written + SAMPLES_PER_TX).min(count);
        let mut data = Vec::with_capacity((end - written) * 16);
        for sample in &samples[written..end] {
            for value in [sample.x, sample.z, sample.fx, sample.fz] {
                data.extend_from_slice(&value.to_le_bytes());
            }
        }
        let write = Instruction {
            program_id: pixelvault::id(),
            accounts: pixelvault::accounts::EditTrack { authority: payer.pubkey(), track }
                .to_account_metas(None),
            data: pixelvault::instruction::WriteTrackSamples { offset: written as u16, data }.data(),
        };
        send(&mut svm, &payer, &[write]).expect("write_track_samples failed");
        written = end;
    }

    let freeze = Instruction {
        program_id: pixelvault::id(),
        accounts: pixelvault::accounts::EditTrack { authority: payer.pubkey(), track }
            .to_account_metas(None),
        data: pixelvault::instruction::FreezeTrack {}.data(),
    };
    send(&mut svm, &payer, &[freeze]).expect("freeze_track failed");

    World { svm, payer, track, leaderboard, samples, checkpoints, pads, start_sample, start_heading }
}

/// Uploads a trace and replays it, one transaction at a time, exactly as the
/// client does. Returns the compute units each verification transaction spent.
fn verify(world: &mut World, player: &Keypair, trace: &[u8]) -> Result<Vec<u64>, String> {
    let run = pda(&[b"run", player.pubkey().as_ref(), &TRACK_ID.to_le_bytes()]);

    let open = Instruction {
        program_id: pixelvault::id(),
        accounts: pixelvault::accounts::OpenRun {
            payer: world.payer.pubkey(),
            player: player.pubkey(),
            track: world.track,
            run,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: pixelvault::instruction::OpenRun {
            track_id: TRACK_ID,
            trace_len: trace.len() as u16,
        }
        .data(),
    };
    send_signed(world, &[open], &[player])?;

    for (index, chunk) in trace.chunks(TRACE_BYTES_PER_TX).enumerate() {
        let write = Instruction {
            program_id: pixelvault::id(),
            accounts: pixelvault::accounts::WriteRun { player: player.pubkey(), run }
                .to_account_metas(None),
            data: pixelvault::instruction::WriteRun {
                offset: (index * TRACE_BYTES_PER_TX) as u16,
                data: chunk.to_vec(),
            }
            .data(),
        };
        send_signed(world, &[write], &[player])?;
    }

    let mut costs = Vec::new();
    for _ in 0..16 {
        let verify = Instruction {
            program_id: pixelvault::id(),
            accounts: pixelvault::accounts::VerifyRun {
                player: player.pubkey(),
                track: world.track,
                run,
                leaderboard: world.leaderboard,
            }
            .to_account_metas(None),
            data: pixelvault::instruction::VerifyRun { steps: STEPS_PER_TX }.data(),
        };
        costs.push(send_signed(world, &[compute_budget(1_400_000), verify], &[player])?);

        let account = world.svm.get_account(&run).unwrap();
        let buffer = bytemuck::from_bytes::<RunBuffer>(&account.data[8..]);
        if buffer.finished == 1 {
            return Ok(costs);
        }
    }
    Err("verification did not finish in sixteen transactions".to_string())
}

fn send_signed(world: &mut World, ixs: &[Instruction], extra: &[&Keypair]) -> Result<u64, String> {
    world.svm.expire_blockhash();
    let blockhash = world.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&world.payer.pubkey()), &blockhash);
    let mut signers: Vec<&Keypair> = vec![&world.payer];
    signers.extend_from_slice(extra);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers)
        .map_err(|e| e.to_string())?;
    match world.svm.send_transaction(tx) {
        Ok(meta) => Ok(meta.compute_units_consumed),
        Err(e) => {
            let logs = e
                .meta
                .logs
                .iter()
                .filter(|l| l.contains("Error") || l.contains("failed"))
                .cloned()
                .collect::<Vec<_>>()
                .join(" | ");
            Err(format!("{:?} {}", e.err, logs))
        }
    }
}

/// Drives a lap with the bot and returns the trace plus the time it set.
fn bot_run(world: &World, grip: f64) -> (Vec<u8>, u32) {
    let view = world.view();
    let bot = Bot { grip: to_fx(grip), drift: false };
    let (inputs, finish) = drive(&view, &bot, MAX_STEPS);
    (encode_trace(&inputs), finish.expect("the bot never finished"))
}

fn leaderboard(world: &World) -> Leaderboard {
    let account = world.svm.get_account(&world.leaderboard).unwrap();
    *bytemuck::from_bytes::<Leaderboard>(&account.data[8..])
}

#[test]
fn the_chain_replays_a_run_and_ranks_the_time_it_derives() {
    let mut world = setup();
    let player = Keypair::new();
    world.svm.airdrop(&player.pubkey(), 1_000_000_000).unwrap();

    let (trace, steps) = bot_run(&world, 30.0);
    let costs = verify(&mut world, &player, &trace).expect("verification failed");
    let total: u64 = costs.iter().sum();
    println!(
        "replayed {:.2} s ({steps} steps) from {} trace bytes in {} transactions, {total} compute units ({} per step)",
        seconds(steps),
        trace.len(),
        costs.len(),
        total / steps as u64,
    );

    let board = leaderboard(&world);
    assert_eq!(board.verified_runs, 1);
    assert_eq!(board.entry_count, 1);
    assert_eq!(board.entries[0].player, player.pubkey());
    // The time the chain derived, not one the client claimed.
    assert_eq!(board.entries[0].steps, steps);
    assert_eq!(board.entries[0].total_ms, (steps as u64 * 1000 / 60) as u32);

    let account = world.svm.get_account(&world.track).unwrap();
    let track = bytemuck::from_bytes::<TrackConfig>(&account.data[8..]);
    assert_eq!(track.sample_count as usize, world.samples.len());
    assert_eq!(track.frozen, 1);
}

#[test]
fn a_faster_run_takes_the_top_spot_and_a_slower_one_does_not() {
    let mut world = setup();
    let fast = Keypair::new();
    let slow = Keypair::new();
    for player in [&fast, &slow] {
        world.svm.airdrop(&player.pubkey(), 1_000_000_000).unwrap();
    }

    let (quick_trace, quick_steps) = bot_run(&world, 30.0);
    let (slow_trace, slow_steps) = bot_run(&world, 16.0);
    assert!(slow_steps > quick_steps, "the cautious bot should be slower");

    verify(&mut world, &slow, &slow_trace).expect("slow run failed");
    verify(&mut world, &fast, &quick_trace).expect("fast run failed");

    let board = leaderboard(&world);
    assert_eq!(board.entry_count, 2);
    assert_eq!(board.entries[0].player, fast.pubkey());
    assert_eq!(board.entries[1].player, slow.pubkey());
    assert!(board.entries[0].total_ms < board.entries[1].total_ms);
}

#[test]
fn inputs_that_never_reach_the_line_are_rejected() {
    let mut world = setup();
    let player = Keypair::new();
    world.svm.airdrop(&player.pubkey(), 1_000_000_000).unwrap();

    let (trace, _) = bot_run(&world, 30.0);
    let half = (trace.len() / 4) * 2;
    let error = verify(&mut world, &player, &trace[..half]).expect_err("should have failed");
    assert!(error.contains("6022"), "expected RunNeverFinished, got {error}");
    assert_eq!(leaderboard(&world).verified_runs, 0);
}

#[test]
fn padding_after_the_finish_line_is_rejected() {
    let mut world = setup();
    let player = Keypair::new();
    world.svm.airdrop(&player.pubkey(), 1_000_000_000).unwrap();

    // A slow run with its tail replaced by idling: the car crosses the line
    // and the trace carries on, which would hide the real time.
    let (trace, _) = bot_run(&world, 30.0);
    let mut padded = trace.clone();
    padded.extend_from_slice(&[0x08, 40]);
    let error = verify(&mut world, &player, &padded).expect_err("should have failed");
    assert!(error.contains("6023"), "expected RunFinishedEarly, got {error}");
}

#[test]
fn a_trace_that_was_not_fully_uploaded_cannot_be_verified() {
    let mut world = setup();
    let player = Keypair::new();
    world.svm.airdrop(&player.pubkey(), 1_000_000_000).unwrap();
    let run = pda(&[b"run", player.pubkey().as_ref(), &TRACK_ID.to_le_bytes()]);

    let open = Instruction {
        program_id: pixelvault::id(),
        accounts: pixelvault::accounts::OpenRun {
            payer: world.payer.pubkey(),
            player: player.pubkey(),
            track: world.track,
            run,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: pixelvault::instruction::OpenRun { track_id: TRACK_ID, trace_len: 64 }.data(),
    };
    send_signed(&mut world, &[open], &[&player]).expect("open_run failed");

    let verify_ix = Instruction {
        program_id: pixelvault::id(),
        accounts: pixelvault::accounts::VerifyRun {
            player: player.pubkey(),
            track: world.track,
            run,
            leaderboard: world.leaderboard,
        }
        .to_account_metas(None),
        data: pixelvault::instruction::VerifyRun { steps: 100 }.data(),
    };
    let error = send_signed(&mut world, &[verify_ix], &[&player]).expect_err("should have failed");
    assert!(error.contains("6026"), "expected TraceIncomplete, got {error}");
}
