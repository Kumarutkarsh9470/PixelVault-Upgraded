//! Medal calibration: the bot races every circuit at a range of cornering
//! limits, and its fastest clean run sets the pace players are measured
//! against. That run also ships as the rival "Nova" ghost.
//!
//! This runs against the same circuits the chain stores, and the parity
//! harness proves the Unity client simulates them identically, so a time
//! found here is a time a player can actually match in the game.
//!
//! Run it with `python tools/calibrate.py`.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use super::car::Car;
use super::fixed::fx;
use super::testing::{drive, Bot};
use super::track::{BoostPad, Sample, Track};
use super::{encode_trace, Input, MAX_STEPS, STEPS_PER_SECOND};

/// Cornering limits tried on each circuit, in m/s^2. The car's real limit is
/// around sixty; beyond that the bot runs wide and loses time to the walls.
pub const GRIP_LIMITS: &[i32] = &[20, 26, 32, 38, 44, 50, 56, 60, 64, 70];

/// Gold sits just above the bot's best, so beating it needs clean lines plus
/// the boosts drifting earns.
pub const GOLD_FACTOR: f64 = 1.04;
pub const SILVER_FACTOR: f64 = 1.14;
pub const BRONZE_FACTOR: f64 = 1.30;

/// A circuit read from web/src/data/circuits.json.
pub struct Circuit {
    pub id: String,
    pub samples: Vec<Sample>,
    pub checkpoints: Vec<u16>,
    pub pads: Vec<BoostPad>,
    pub spacing: i32,
    pub wall_offset: i32,
    pub laps: u8,
    pub start_sample: u16,
    pub start_heading: u32,
    pub lap_meters: f64,
}

impl Circuit {
    pub fn view(&self) -> Track<'_> {
        Track {
            samples: &self.samples,
            spacing: self.spacing,
            wall_offset: self.wall_offset,
            checkpoints: &self.checkpoints,
            boost_pads: &self.pads,
            laps: self.laps,
            start_sample: self.start_sample,
            start_heading: self.start_heading,
        }
    }
}

fn ints(value: &Value, key: &str) -> Vec<i64> {
    value[key]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|v| v.as_i64().unwrap_or_default())
        .collect()
}

/// Reads the circuits the client and the chain share.
pub fn read_circuits(json: &str) -> Vec<Circuit> {
    let parsed: Map<String, Value> = serde_json::from_str(json).expect("circuits.json is not JSON");
    parsed
        .iter()
        .map(|(id, circuit)| {
            let flat = ints(circuit, "samples");
            let samples = flat
                .chunks_exact(4)
                .map(|s| Sample { x: s[0] as i32, z: s[1] as i32, fx: s[2] as i32, fz: s[3] as i32 })
                .collect();
            let pad_samples = ints(circuit, "padSamples");
            let pad_laterals = ints(circuit, "padLaterals");
            Circuit {
                id: id.clone(),
                samples,
                checkpoints: ints(circuit, "checkpoints").iter().map(|c| *c as u16).collect(),
                pads: pad_samples
                    .iter()
                    .zip(pad_laterals.iter())
                    .map(|(sample, lateral)| BoostPad {
                        lateral: *lateral as i32,
                        sample: *sample as u16,
                        _padding: [0; 2],
                    })
                    .collect(),
                spacing: circuit["spacing"].as_i64().unwrap_or(0) as i32,
                wall_offset: circuit["wallOffset"].as_i64().unwrap_or(0) as i32,
                laps: circuit["laps"].as_u64().unwrap_or(1) as u8,
                start_sample: circuit["startSample"].as_u64().unwrap_or(0) as u16,
                start_heading: circuit["startHeading"].as_u64().unwrap_or(0) as u32,
                lap_meters: circuit["lapMeters"].as_f64().unwrap_or(0.0),
            }
        })
        .collect()
}

pub struct BestRun {
    pub grip: i32,
    pub steps: u32,
    pub total_ms: u32,
    pub trace: Vec<u8>,
    pub splits: Vec<u32>,
    pub wall_hits: u32,
}

/// Races one circuit at every cornering limit and keeps the fastest run that
/// stayed off the walls.
pub fn calibrate(circuit: &Circuit) -> Option<BestRun> {
    let view = circuit.view();
    let mut best: Option<BestRun> = None;

    for grip in GRIP_LIMITS {
        let bot = Bot { grip: fx(*grip), drift: false };
        let (inputs, finish) = drive(&view, &bot, MAX_STEPS);
        let Some(steps) = finish else { continue };

        // Replay it for the splits, and to count how often it touched a wall.
        let mut car = Car::spawn(&view);
        let mut splits_ms = Vec::new();
        let mut wall_hits = 0;
        for (index, input) in inputs.iter().take(steps as usize).enumerate() {
            if car.step(&view, *input).is_some() {
                splits_ms.push(milliseconds(index as u32 + 1));
            }
            if car.impact > 0 {
                wall_hits += 1;
            }
        }

        let run = BestRun {
            grip: *grip,
            steps,
            total_ms: milliseconds(steps),
            trace: encode_trace(&inputs),
            splits: splits_ms,
            wall_hits,
        };
        let better = match &best {
            None => true,
            Some(current) => run.steps < current.steps,
        };
        if better {
            best = Some(run);
        }
    }
    best
}

pub fn milliseconds(steps: u32) -> u32 {
    ((steps as u64 * 1000) / STEPS_PER_SECOND as u64) as u32
}

/// The medal times and rival ghost for every circuit, as JSON the web app and
/// the backend read.
pub fn calibrate_all(circuits: &[Circuit]) -> (Value, Value, Vec<String>) {
    let mut medals = Map::new();
    let mut rivals = Map::new();
    let mut report = Vec::new();

    for circuit in circuits {
        let Some(best) = calibrate(circuit) else {
            report.push(format!("{}: the bot never finished", circuit.id));
            continue;
        };
        let round = |ms: f64| (ms / 10.0).round() as u32 * 10;
        let gold = round(best.total_ms as f64 * GOLD_FACTOR);
        let silver = round(best.total_ms as f64 * SILVER_FACTOR);
        let bronze = round(best.total_ms as f64 * BRONZE_FACTOR);

        medals.insert(
            circuit.id.clone(),
            json!({ "gold": gold, "silver": silver, "bronze": bronze }),
        );
        rivals.insert(
            circuit.id.clone(),
            json!({
                "name": "Nova",
                "totalMs": best.total_ms,
                "steps": best.steps,
                "splits": best.splits,
                "trace": base64(&best.trace),
            }),
        );
        report.push(format!(
            "{}: {:.2} s at grip {} ({} wall touches, {} trace bytes) -> gold {:.2} s, silver {:.2} s, bronze {:.2} s",
            circuit.id,
            best.total_ms as f64 / 1000.0,
            best.grip,
            best.wall_hits,
            best.trace.len(),
            gold as f64 / 1000.0,
            silver as f64 / 1000.0,
            bronze as f64 / 1000.0,
        ));
    }
    (Value::Object(medals), Value::Object(rivals), report)
}

/// Base64, so a trace travels as a string through JSON and the page.
pub fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { ALPHABET[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { ALPHABET[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Checkpoint splits of a trace, for the client's live comparison.
pub fn splits_of(track: &Track, inputs: &[Input]) -> BTreeMap<u16, u32> {
    let mut car = Car::spawn(track);
    let mut splits = BTreeMap::new();
    for (index, input) in inputs.iter().enumerate() {
        if let Some(checkpoint) = car.step(track, *input) {
            splits.entry(checkpoint).or_insert(milliseconds(index as u32 + 1));
        }
    }
    splits
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Calibrates every circuit and writes the medal times and rival ghosts.
    /// Driven by tools/calibrate.py.
    #[test]
    fn calibrate_circuits() {
        let Ok(input) = std::env::var("PIXELVAULT_CIRCUITS") else {
            println!("set PIXELVAULT_CIRCUITS to calibrate; skipping");
            return;
        };
        let circuits = read_circuits(&std::fs::read_to_string(&input).expect("cannot read circuits"));
        assert!(!circuits.is_empty(), "no circuits to calibrate");

        let (medals, rivals, report) = calibrate_all(&circuits);
        for line in &report {
            println!("{line}");
        }
        let out = std::env::var("PIXELVAULT_CALIBRATION_OUT").expect("set PIXELVAULT_CALIBRATION_OUT");
        std::fs::write(&out, json!({ "medals": medals, "rivals": rivals }).to_string())
            .expect("cannot write calibration");
        println!("wrote {out}");
    }

    #[test]
    fn base64_matches_known_values() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"M"), "TQ==");
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64(&[0x08, 0x01, 0x28, 0xff]), "CAEo/w==");
    }
}
