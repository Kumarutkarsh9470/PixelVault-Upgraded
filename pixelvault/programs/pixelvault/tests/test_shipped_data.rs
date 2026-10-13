//! Checks the data players actually receive against the chain.
//!
//! The circuits in web/src/data/circuits.json are registered on-chain here,
//! and Nova's trace from web/src/data/rivals.json is replayed by the program.
//! The time it derives must match the time the game shows, or a rival ghost
//! would be advertising a lap the chain disagrees with.

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    pixelvault::{
        instructions::track::{PadArg, TrackArgs},
        sim::account::{Leaderboard, RunBuffer},
    },
    serde_json::Value,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const SAMPLES_PER_TX: usize = 60;
const TRACE_BYTES_PER_TX: usize = 900;
const STEPS_PER_TX: u32 = 400;

fn repo(path: &str) -> String {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("repository root");
    std::fs::read_to_string(root.join(path)).unwrap_or_else(|e| panic!("cannot read {path}: {e}"))
}

fn ints(value: &Value, key: &str) -> Vec<i64> {
    value[key]
        .as_array()
        .unwrap_or_else(|| panic!("{key} is not an array"))
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect()
}

/// Base64 as the game and the tools write it.
fn from_base64(text: &str) -> Vec<u8> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut bytes = Vec::with_capacity(text.len() / 4 * 3);
    let mut buffer = 0u32;
    let mut bits = 0;
    for c in text.bytes() {
        if c == b'=' {
            break;
        }
        let value = ALPHABET.iter().position(|a| *a == c).expect("not base64") as u32;
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push((buffer >> bits) as u8);
        }
    }
    bytes
}

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &pixelvault::id()).0
}

fn send(svm: &mut LiteSVM, payer: &Keypair, ixs: &[Instruction], extra: &[&Keypair]) -> Result<u64, String> {
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers)
        .map_err(|e| e.to_string())?;
    match svm.send_transaction(tx) {
        Ok(meta) => Ok(meta.compute_units_consumed),
        Err(e) => Err(format!("{:?} {:?}", e.err, e.meta.logs.last())),
    }
}

fn compute_budget(units: u32) -> Instruction {
    let mut data = vec![2u8];
    data.extend_from_slice(&units.to_le_bytes());
    Instruction {
        program_id: Pubkey::from_str_const("ComputeBudget111111111111111111111111111111"),
        accounts: vec![],
        data,
    }
}

/// Registers a circuit exactly as the deployment tool will: create, write the
/// centreline in chunks, freeze.
fn register(svm: &mut LiteSVM, payer: &Keypair, track_id: u64, id: &str, circuit: &Value) -> (Pubkey, Pubkey) {
    let track = pda(&[b"track", payer.pubkey().as_ref(), &track_id.to_le_bytes()]);
    let leaderboard = pda(&[b"board", payer.pubkey().as_ref(), &track_id.to_le_bytes()]);
    let samples = ints(circuit, "samples");
    let count = circuit["sampleCount"].as_u64().unwrap() as u16;
    let pad_samples = ints(circuit, "padSamples");
    let pad_laterals = ints(circuit, "padLaterals");

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
            track_id,
            args: TrackArgs {
                name: id.to_string(),
                laps: circuit["laps"].as_u64().unwrap() as u8,
                spacing: circuit["spacing"].as_i64().unwrap() as i32,
                wall_offset: circuit["wallOffset"].as_i64().unwrap() as i32,
                start_sample: circuit["startSample"].as_u64().unwrap() as u16,
                start_heading: circuit["startHeading"].as_u64().unwrap() as u32,
                sample_count: count,
                checkpoints: ints(circuit, "checkpoints").iter().map(|c| *c as u16).collect(),
                pads: pad_samples
                    .iter()
                    .zip(pad_laterals.iter())
                    .map(|(sample, lateral)| PadArg { sample: *sample as u16, lateral: *lateral as i32 })
                    .collect(),
            },
        }
        .data(),
    };
    send(svm, payer, &[init], &[]).expect("init_track failed");

    let mut written = 0usize;
    while written < count as usize {
        let end = (written + SAMPLES_PER_TX).min(count as usize);
        let mut data = Vec::with_capacity((end - written) * 16);
        for value in &samples[written * 4..end * 4] {
            data.extend_from_slice(&(*value as i32).to_le_bytes());
        }
        let write = Instruction {
            program_id: pixelvault::id(),
            accounts: pixelvault::accounts::EditTrack { authority: payer.pubkey(), track }
                .to_account_metas(None),
            data: pixelvault::instruction::WriteTrackSamples { offset: written as u16, data }.data(),
        };
        send(svm, payer, &[write], &[]).expect("write_track_samples failed");
        written = end;
    }

    let freeze = Instruction {
        program_id: pixelvault::id(),
        accounts: pixelvault::accounts::EditTrack { authority: payer.pubkey(), track }
            .to_account_metas(None),
        data: pixelvault::instruction::FreezeTrack {}.data(),
    };
    send(svm, payer, &[freeze], &[]).expect("freeze_track failed");
    (track, leaderboard)
}

/// Uploads a trace and replays it, as the client will.
fn verify(
    svm: &mut LiteSVM,
    payer: &Keypair,
    player: &Keypair,
    track_id: u64,
    track: Pubkey,
    leaderboard: Pubkey,
    trace: &[u8],
) -> (u64, usize) {
    let run = pda(&[b"run", player.pubkey().as_ref(), &track_id.to_le_bytes()]);
    let open = Instruction {
        program_id: pixelvault::id(),
        accounts: pixelvault::accounts::OpenRun {
            payer: payer.pubkey(),
            player: player.pubkey(),
            track,
            run,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: pixelvault::instruction::OpenRun { track_id, trace_len: trace.len() as u16 }.data(),
    };
    send(svm, payer, &[open], &[player]).expect("open_run failed");

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
        send(svm, payer, &[write], &[player]).expect("write_run failed");
    }

    let mut total = 0;
    let mut transactions = 0;
    for _ in 0..16 {
        let verify = Instruction {
            program_id: pixelvault::id(),
            accounts: pixelvault::accounts::VerifyRun {
                player: player.pubkey(),
                track,
                run,
                leaderboard,
            }
            .to_account_metas(None),
            data: pixelvault::instruction::VerifyRun { steps: STEPS_PER_TX }.data(),
        };
        total += send(svm, payer, &[compute_budget(1_400_000), verify], &[player]).expect("verify_run failed");
        transactions += 1;
        let account = svm.get_account(&run).unwrap();
        if bytemuck::from_bytes::<RunBuffer>(&account.data[8..]).finished == 1 {
            break;
        }
    }
    (total, transactions)
}

/// Every circuit and rival ghost the game ships is replayed by the program,
/// and the time it derives is the time the game advertises.
#[test]
fn the_chain_agrees_with_every_rival_time_the_game_ships() {
    let circuits: Value = serde_json::from_str(&repo("web/src/data/circuits.json")).unwrap();
    let rivals: Value = serde_json::from_str(&repo("web/src/data/rivals.json")).unwrap();

    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/pixelvault.so"));
    svm.add_program(pixelvault::id(), bytes).unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000_000).unwrap();

    let mut track_id = 1u64;
    for (id, circuit) in circuits.as_object().expect("circuits.json") {
        let rival = &rivals[id];
        assert!(!rival.is_null(), "{id} has no rival ghost");

        let (track, leaderboard) = register(&mut svm, &payer, track_id, id, circuit);
        let player = Keypair::new();
        svm.airdrop(&player.pubkey(), 1_000_000_000).unwrap();
        let trace = from_base64(rival["trace"].as_str().expect("rival trace"));

        let (units, transactions) = verify(&mut svm, &payer, &player, track_id, track, leaderboard, &trace);

        let account = svm.get_account(&leaderboard).unwrap();
        let board = bytemuck::from_bytes::<Leaderboard>(&account.data[8..]);
        let advertised = rival["totalMs"].as_u64().unwrap() as u32;
        assert_eq!(board.entry_count, 1, "{id}: the run did not make the board");
        assert_eq!(
            board.entries[0].total_ms, advertised,
            "{id}: the chain derived {} ms, the game advertises {advertised} ms",
            board.entries[0].total_ms
        );
        assert_eq!(board.entries[0].steps, rival["steps"].as_u64().unwrap() as u32);
        println!(
            "{id}: {} ms verified on-chain from {} trace bytes in {transactions} transactions, {units} compute units",
            board.entries[0].total_ms,
            trace.len()
        );
        track_id += 1;
    }
}
