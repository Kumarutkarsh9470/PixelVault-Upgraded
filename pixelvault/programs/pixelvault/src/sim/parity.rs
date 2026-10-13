//! The parity harness: proves the Unity client and the program simulate a race
//! identically.
//!
//! This side exports the circuits, the input traces and a rolling checksum of
//! the car taken every few steps. The client replays the same traces and
//! compares, so a divergence is reported at the step it first appears rather
//! than as a mismatched finish time.
//!
//! Run the whole thing with `python tools/run-parity.py`.

use std::fmt::Write as _;

use super::car::{Car, Input};
use super::testing::{centreline, checkpoints, drive, heading_of, to_fx, Bot};
use super::track::{BoostPad, Sample, Track};
use super::{encode_trace, MAX_STEPS};

/// Steps between checksums. Small enough to pinpoint a divergence, few enough
/// that the exported file stays small.
pub const CHECKSUM_EVERY: u32 = 32;

const SPACING: f64 = 2.0;
const WALL_OFFSET: f64 = 10.0;

const NEON_HARBOR: &[(f64, f64)] = &[
    (0.0, 0.0), (0.0, 120.0), (20.0, 160.0), (60.0, 175.0), (110.0, 165.0), (140.0, 130.0),
    (150.0, 90.0), (175.0, 60.0), (180.0, 20.0), (160.0, -20.0), (120.0, -40.0), (70.0, -45.0),
    (30.0, -30.0),
];

const DUNE_RUSH: &[(f64, f64)] = &[
    (0.0, 0.0), (0.0, 100.0), (-25.0, 150.0), (-10.0, 200.0), (40.0, 225.0), (100.0, 215.0),
    (140.0, 175.0), (130.0, 125.0), (95.0, 100.0), (110.0, 55.0), (100.0, 5.0), (60.0, -35.0),
    (20.0, -35.0),
];

/// A circuit built for the harness, owning its geometry.
pub struct BuiltTrack {
    pub id: String,
    pub samples: Vec<Sample>,
    pub checkpoints: Vec<u16>,
    pub pads: Vec<BoostPad>,
    pub laps: u8,
    pub start_sample: u16,
    pub start_heading: u32,
}

impl BuiltTrack {
    pub fn build(id: &str, controls: &[(f64, f64)], laps: u8) -> Self {
        let samples = centreline(controls, SPACING);
        let count = samples.len();
        let start_sample = (count - 4) as u16;
        let pads = [(count / 5, -2.8), (count / 2, 2.8), (count * 4 / 5, -2.8)]
            .iter()
            .map(|(sample, lateral)| BoostPad {
                lateral: to_fx(*lateral),
                sample: *sample as u16,
                _padding: [0; 2],
            })
            .collect();
        Self {
            id: id.to_string(),
            start_heading: heading_of(&samples[start_sample as usize]),
            checkpoints: checkpoints(count, 55.0, count as f64 * SPACING),
            pads,
            laps,
            start_sample,
            samples,
        }
    }

    pub fn view(&self) -> Track<'_> {
        Track {
            samples: &self.samples,
            spacing: to_fx(SPACING),
            wall_offset: to_fx(WALL_OFFSET),
            checkpoints: &self.checkpoints,
            boost_pads: &self.pads,
            laps: self.laps,
            start_sample: self.start_sample,
            start_heading: self.start_heading,
        }
    }
}

/// Rolling checksum of the car, so a divergence can be located exactly.
pub fn mix(hash: u64, value: i64) -> u64 {
    (hash ^ value as u64).wrapping_mul(1099511628211)
}

pub fn hash_step(hash: u64, car: &Car) -> u64 {
    let mut hash = mix(hash, car.x as i64);
    hash = mix(hash, car.z as i64);
    hash = mix(hash, car.vx as i64);
    hash = mix(hash, car.vz as i64);
    hash = mix(hash, car.heading as i64);
    hash = mix(hash, car.steer as i64);
    hash = mix(hash, car.drift_charge as i64);
    hash = mix(hash, car.boost_steps as i64);
    hash = mix(hash, car.drifting as i64);
    hash = mix(hash, car.progress as i64);
    hash = mix(hash, car.sample as i64);
    mix(hash, car.crossings as i64)
}

pub const SEED: u64 = 14695981039346656037;

/// Replays a trace, collecting a checksum every `CHECKSUM_EVERY` steps.
pub fn run_with_checksums(track: &Track, inputs: &[Input]) -> (Vec<u64>, Car, u32) {
    let crossings_needed = track.checkpoints.len() as u16 * track.laps as u16 + 1;
    let mut car = Car::spawn(track);
    let mut hash = SEED;
    let mut checksums = Vec::new();
    let mut finished = 0u32;
    for (index, input) in inputs.iter().enumerate() {
        car.step(track, *input);
        hash = hash_step(hash, &car);
        let step = index as u32 + 1;
        if step % CHECKSUM_EVERY == 0 {
            checksums.push(hash);
        }
        if finished == 0 && car.crossings >= crossings_needed {
            finished = step;
        }
    }
    checksums.push(hash);
    (checksums, car, finished)
}

/// Deterministic pseudo-random inputs: a player mashing thumbs, which exercises
/// reversing, wall scrapes and repeated drifts far harder than a clean lap.
pub struct Mash {
    state: u64,
}

impl Mash {
    pub fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next(&mut self) -> u64 {
        // xorshift64*, so the harness generates the same cases every run.
        self.state ^= self.state >> 12;
        self.state ^= self.state << 25;
        self.state ^= self.state >> 27;
        self.state.wrapping_mul(0x2545F4914F6CDD1D)
    }

    pub fn trace(&mut self, steps: usize) -> Vec<Input> {
        let mut inputs = Vec::with_capacity(steps);
        let mut current = Input::default();
        let mut hold = 0;
        for _ in 0..steps {
            if hold == 0 {
                let roll = self.next();
                current = Input {
                    steer: ((roll % 17) as i8) - 8,
                    brake: (roll >> 8) % 3 == 0,
                };
                hold = 1 + (roll >> 16) % 40;
            }
            hold -= 1;
            inputs.push(current);
        }
        inputs
    }
}

/// Every case the harness checks: real bot laps on two circuits, button
/// mashing, and the awkward inputs (idling, full lock, braking from the grid).
pub fn cases() -> Vec<(BuiltTrack, Vec<(String, Vec<Input>)>)> {
    let mut all = Vec::new();
    for (id, controls, laps) in [("neon-harbor", NEON_HARBOR, 2u8), ("dune-rush", DUNE_RUSH, 1u8)] {
        let track = BuiltTrack::build(id, controls, laps);
        let view = track.view();
        let mut traces: Vec<(String, Vec<Input>)> = Vec::new();

        for grip in [16.0, 24.0, 30.0, 38.0] {
            let bot = Bot { grip: to_fx(grip), drift: false };
            let (inputs, _) = drive(&view, &bot, MAX_STEPS);
            traces.push((format!("bot-grip-{grip}"), inputs));
        }
        let drifting_bot = Bot { grip: to_fx(30.0), drift: true };
        let (inputs, _) = drive(&view, &drifting_bot, MAX_STEPS);
        traces.push(("bot-drifting".to_string(), inputs));

        for seed in 1..=6u64 {
            let mut mash = Mash::new(seed * 7919 + id.len() as u64);
            traces.push((format!("mash-{seed}"), mash.trace(1500)));
        }

        traces.push((
            "idle".to_string(),
            vec![Input { steer: 0, brake: true }; 300],
        ));
        traces.push((
            "full-lock-left".to_string(),
            vec![Input { steer: -8, brake: false }; 900],
        ));
        traces.push((
            "drift-both-ways".to_string(),
            (0..1200)
                .map(|i| Input {
                    steer: if (i / 120) % 2 == 0 { 8 } else { -8 },
                    brake: i % 240 > 60,
                })
                .collect(),
        ));
        all.push((track, traces));
    }
    all
}

/// Writes the cases, the traces and the expected checksums as JSON the Unity
/// runner reads. Deliberately hand-rolled: the program has no JSON dependency.
pub fn export() -> String {
    let mut out = String::from("{\"checksumEvery\":");
    write!(out, "{CHECKSUM_EVERY},\"seed\":\"{SEED}\",\"tracks\":[").unwrap();

    for (index, (track, traces)) in cases().iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        let view = track.view();
        write!(
            out,
            "{{\"id\":\"{}\",\"laps\":{},\"spacing\":{},\"wallOffset\":{},\"startSample\":{},\"startHeading\":{},",
            track.id,
            track.laps,
            view.spacing,
            view.wall_offset,
            track.start_sample,
            track.start_heading
        )
        .unwrap();

        out.push_str("\"samples\":[");
        for (i, sample) in track.samples.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            write!(out, "{},{},{},{}", sample.x, sample.z, sample.fx, sample.fz).unwrap();
        }
        out.push_str("],\"checkpoints\":[");
        for (i, checkpoint) in track.checkpoints.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            write!(out, "{checkpoint}").unwrap();
        }
        out.push_str("],\"padSamples\":[");
        for (i, pad) in track.pads.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            write!(out, "{}", pad.sample).unwrap();
        }
        out.push_str("],\"padLaterals\":[");
        for (i, pad) in track.pads.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            write!(out, "{}", pad.lateral).unwrap();
        }
        out.push_str("],\"cases\":[");

        for (i, (name, inputs)) in traces.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            let (checksums, car, finished) = run_with_checksums(&view, inputs);
            let trace = encode_trace(inputs);
            write!(
                out,
                "{{\"name\":\"{name}\",\"steps\":{},\"finishedAt\":{finished},\"traceBytes\":{},\"trace\":[",
                inputs.len(),
                trace.len()
            )
            .unwrap();
            for (n, byte) in trace.iter().enumerate() {
                if n > 0 {
                    out.push(',');
                }
                write!(out, "{byte}").unwrap();
            }
            out.push_str("],\"checksums\":[");
            for (n, checksum) in checksums.iter().enumerate() {
                if n > 0 {
                    out.push(',');
                }
                write!(out, "\"{checksum}\"").unwrap();
            }
            write!(
                out,
                "],\"finalX\":{},\"finalZ\":{},\"finalHeading\":{},\"crossings\":{}}}",
                car.x, car.z, car.heading, car.crossings
            )
            .unwrap();
        }
        out.push_str("]}");
    }
    out.push_str("]}");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Writes the cases for the Unity side. Run by tools/run-parity.py.
    #[test]
    fn export_cases() {
        let json = export();
        let path = std::env::var("PIXELVAULT_PARITY_OUT")
            .unwrap_or_else(|_| "target/parity-cases.json".to_string());
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::write(&path, &json).expect("failed to write parity cases");
        println!("wrote {} bytes of parity cases to {path}", json.len());
    }

    /// The checksums are stable: the same trace always gives the same run.
    #[test]
    fn replays_are_repeatable() {
        let track = BuiltTrack::build("neon-harbor", NEON_HARBOR, 1);
        let view = track.view();
        let inputs = Mash::new(42).trace(600);
        let (first, _, _) = run_with_checksums(&view, &inputs);
        let (second, _, _) = run_with_checksums(&view, &inputs);
        assert_eq!(first, second);
        assert!(first.len() > 10, "expected checksums along the run");
    }
}
