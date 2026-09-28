//! On-chain storage for circuits and verified times.
//!
//! The centreline lives in a zero-copy account so verification reads it in
//! place: deserialising eight kilobytes on every run would cost more compute
//! than the race itself.

use anchor_lang::prelude::*;

use super::car::Car;
use super::fixed::Fx;
use super::track::{BoostPad, Sample, Track};

pub const MAX_SAMPLES: usize = 512;
pub const MAX_CHECKPOINTS: usize = 64;
pub const MAX_PADS: usize = 8;
pub const MAX_TRACK_NAME: usize = 32;
/// Times kept per circuit. Beyond this, a run still verifies but does not rank.
pub const LEADERBOARD_SIZE: usize = 16;
/// Longest trace the chain will hold. A two-lap run compresses to well under
/// a kilobyte; this leaves room for slower drivers and longer circuits.
pub const MAX_TRACE_BYTES: usize = 2048;

/// A circuit exactly as the simulation sees it. Once frozen the geometry can
/// never change, so every time on the leaderboard was set on the same track.
#[account(zero_copy)]
#[repr(C)]
pub struct TrackConfig {
    pub authority: Pubkey,
    pub track_id: u64,
    pub name: [u8; MAX_TRACK_NAME],
    /// Metres between centreline samples.
    pub spacing: Fx,
    /// Lateral distance from the centreline to the walls.
    pub wall_offset: Fx,
    pub start_heading: u32,
    pub start_sample: u16,
    pub sample_count: u16,
    pub checkpoint_count: u16,
    pub pad_count: u16,
    pub laps: u8,
    pub frozen: u8,
    pub bump: u8,
    /// Explicit padding so the layout has no implicit gaps and can be cast.
    pub _padding: [u8; 9],
    pub checkpoints: [u16; MAX_CHECKPOINTS],
    pub pads: [BoostPad; MAX_PADS],
    pub samples: [Sample; MAX_SAMPLES],
}

impl TrackConfig {
    /// Borrows the parts of the account the simulation needs.
    pub fn view(&self) -> Track<'_> {
        Track {
            samples: &self.samples[..self.sample_count as usize],
            spacing: self.spacing,
            wall_offset: self.wall_offset,
            checkpoints: &self.checkpoints[..self.checkpoint_count as usize],
            boost_pads: &self.pads[..self.pad_count as usize],
            laps: self.laps,
            start_sample: self.start_sample,
            start_heading: self.start_heading,
        }
    }
}

/// A run being verified: the trace, and how far through it the chain has got.
/// Replaying a race costs more compute than one transaction holds, so the car
/// is stored here between transactions.
#[account(zero_copy)]
#[repr(C)]
pub struct RunBuffer {
    pub player: Pubkey,
    pub track_id: u64,
    /// Where the car had reached at the end of the last transaction.
    pub x: Fx,
    pub z: Fx,
    pub vx: Fx,
    pub vz: Fx,
    pub heading: u32,
    pub steer: Fx,
    pub drift_charge: Fx,
    pub progress: i32,
    pub next_target: i32,
    /// Steps replayed so far, which becomes the finish time.
    pub steps: u32,
    pub boost_steps: u16,
    pub sample: u16,
    pub crossings: u16,
    /// Bytes of the trace consumed, and steps taken inside the current pair.
    pub cursor: u16,
    pub repeat_done: u8,
    pub drifting: u8,
    pub finished: u8,
    pub bump: u8,
    pub trace_len: u16,
    /// Bytes of the trace uploaded so far.
    pub written: u16,
    pub _padding: [u8; 8],
    pub trace: [u8; MAX_TRACE_BYTES],
}

impl RunBuffer {
    /// Clears the buffer for a fresh attempt and puts the car on the grid.
    pub fn reset(&mut self, player: Pubkey, track_id: u64, trace_len: u16, track: &TrackConfig, bump: u8) {
        let car = Car::spawn(&track.view());
        self.player = player;
        self.track_id = track_id;
        self.trace_len = trace_len;
        self.written = 0;
        self.cursor = 0;
        self.repeat_done = 0;
        self.steps = 0;
        self.finished = 0;
        self.bump = bump;
        self.save(&car);
    }

    pub fn car(&self) -> Car {
        Car {
            x: self.x,
            z: self.z,
            vx: self.vx,
            vz: self.vz,
            heading: self.heading,
            steer: self.steer,
            drift_charge: self.drift_charge,
            boost_steps: self.boost_steps,
            drifting: self.drifting == 1,
            progress: self.progress,
            next_target: self.next_target,
            sample: self.sample,
            crossings: self.crossings,
            impact: 0,
        }
    }

    pub fn save(&mut self, car: &Car) {
        self.x = car.x;
        self.z = car.z;
        self.vx = car.vx;
        self.vz = car.vz;
        self.heading = car.heading;
        self.steer = car.steer;
        self.drift_charge = car.drift_charge;
        self.boost_steps = car.boost_steps;
        self.drifting = car.drifting as u8;
        self.progress = car.progress;
        self.next_target = car.next_target;
        self.sample = car.sample;
        self.crossings = car.crossings;
    }
}

/// One verified time. The trace hash lets anyone fetch the inputs and replay
/// the run for themselves.
#[zero_copy]
#[repr(C)]
#[derive(Default)]
pub struct Entry {
    pub player: Pubkey,
    pub trace_hash: [u8; 32],
    pub total_ms: u32,
    pub steps: u32,
    pub set_at: i64,
}

/// The fastest verified times on a circuit, in order.
#[account(zero_copy)]
#[repr(C)]
pub struct Leaderboard {
    pub track_id: u64,
    pub entry_count: u16,
    pub bump: u8,
    pub _padding: [u8; 5],
    /// Runs verified on this circuit, ever.
    pub verified_runs: u64,
    pub entries: [Entry; LEADERBOARD_SIZE],
}

impl Leaderboard {
    /// Places a time in the table, keeping one entry per player, and returns
    /// its rank when it made the cut.
    pub fn record(&mut self, entry: Entry) -> Option<u16> {
        let filled = self.entry_count as usize;
        let existing = self.entries[..filled]
            .iter()
            .position(|e| e.player == entry.player);

        if let Some(index) = existing {
            if self.entries[index].total_ms <= entry.total_ms {
                return None;
            }
            self.entries.copy_within(index + 1..filled, index);
            self.entry_count -= 1;
        } else if filled == LEADERBOARD_SIZE
            && self.entries[LEADERBOARD_SIZE - 1].total_ms <= entry.total_ms
        {
            return None;
        }

        let filled = self.entry_count as usize;
        let rank = self.entries[..filled]
            .iter()
            .position(|e| e.total_ms > entry.total_ms)
            .unwrap_or(filled);
        let last = filled.min(LEADERBOARD_SIZE - 1);
        self.entries.copy_within(rank..last, rank + 1);
        self.entries[rank] = entry;
        if filled < LEADERBOARD_SIZE {
            self.entry_count += 1;
        }
        Some(rank as u16)
    }
}
