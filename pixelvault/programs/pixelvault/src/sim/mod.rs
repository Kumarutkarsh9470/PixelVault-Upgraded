//! The race simulation the chain runs.
//!
//! A player submits the inputs they pressed, not the time they claim. The
//! program replays those inputs through this simulation and derives the time
//! itself, so a leaderboard entry is something the chain has checked rather
//! than something a game server asserted.
//!
//! Everything here is integer maths, and the Unity client runs a port of it,
//! so a replay on-chain matches the run the player drove exactly.

pub mod account;
pub mod car;
pub mod fixed;
/// Off-chain helpers (track building, the calibration bot). Never compiled
/// into the program binary.
#[cfg(not(target_os = "solana"))]
pub mod testing;
#[cfg(test)]
mod tests;
pub mod sin_table;
pub mod track;
pub mod trig;

pub use car::{Car, Input, DT, STEPS_PER_SECOND};
pub use fixed::{Fx, ONE};
pub use track::{BoostPad, Sample, Track};

/// The longest run the chain will replay: four minutes.
pub const MAX_STEPS: u32 = (STEPS_PER_SECOND as u32) * 240;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SimError {
    /// The trace is not a sequence of (input, repeat) pairs, or repeats a zero
    /// number of times.
    MalformedTrace,
    TraceTooLong,
    /// The inputs never took the car past the finish line.
    NeverFinished,
    /// The car finished before the end of the trace: padding after the line.
    FinishedEarly,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RunOutcome {
    /// Simulation steps taken to cross the line for the last time.
    pub steps: u32,
    /// The same, in milliseconds, which is what leaderboards show.
    pub total_ms: u32,
    /// Where the car ended up, so the client can check its own replay.
    pub car: Car,
}

/// Runs a trace against a track. The trace is run-length encoded: pairs of
/// (packed input, repeat count), which is how a real run compresses to a few
/// hundred bytes.
pub fn simulate(track: &Track, trace: &[u8]) -> Result<RunOutcome, SimError> {
    if trace.is_empty() || trace.len() % 2 != 0 {
        return Err(SimError::MalformedTrace);
    }

    let crossings_needed = track.checkpoints.len() as u16 * track.laps as u16 + 1;
    let mut car = Car::spawn(track);
    let mut steps: u32 = 0;
    let mut finished_at: Option<u32> = None;

    for pair in trace.chunks_exact(2) {
        let input = Input::unpack(pair[0]);
        let repeat = pair[1];
        if repeat == 0 {
            return Err(SimError::MalformedTrace);
        }
        for _ in 0..repeat {
            if finished_at.is_some() {
                // Anything after the finish line is padding.
                return Err(SimError::FinishedEarly);
            }
            steps += 1;
            if steps > MAX_STEPS {
                return Err(SimError::TraceTooLong);
            }
            car.step(track, input);
            if car.crossings >= crossings_needed {
                finished_at = Some(steps);
            }
        }
    }

    let steps = finished_at.ok_or(SimError::NeverFinished)?;
    Ok(RunOutcome {
        steps,
        total_ms: ((steps as u64 * 1000) / STEPS_PER_SECOND as u64) as u32,
        car,
    })
}

/// Turns a per-step input list into the run-length encoded trace that is sent
/// on-chain. The client records runs this way.
pub fn encode_trace(inputs: &[Input]) -> Vec<u8> {
    let mut trace = Vec::with_capacity(inputs.len() / 8);
    for input in inputs {
        let byte = input.pack();
        let len = trace.len();
        if len >= 2 && trace[len - 2] == byte && trace[len - 1] < u8::MAX {
            trace[len - 1] += 1;
        } else {
            trace.push(byte);
            trace.push(1);
        }
    }
    trace
}

/// Expands a trace back into one input per step.
pub fn decode_trace(trace: &[u8]) -> Result<Vec<Input>, SimError> {
    if trace.len() % 2 != 0 {
        return Err(SimError::MalformedTrace);
    }
    let mut inputs = Vec::new();
    for pair in trace.chunks_exact(2) {
        if pair[1] == 0 {
            return Err(SimError::MalformedTrace);
        }
        let input = Input::unpack(pair[0]);
        for _ in 0..pair[1] {
            inputs.push(input);
        }
    }
    Ok(inputs)
}
