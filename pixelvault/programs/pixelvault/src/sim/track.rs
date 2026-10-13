//! The circuit as the simulation sees it: an evenly spaced centreline, the
//! walls either side of it, checkpoints, and boost pads.
//!
//! The client builds the same centreline from the track's control points; the
//! chain stores the resampled result so verification never has to spline.

use anchor_lang::prelude::*;

use super::fixed::{mul, Fx};

/// One centreline sample: position and unit forward direction. Laid out for
/// zero-copy: the chain stores these verbatim and the simulation reads them
/// straight out of the account.
#[zero_copy]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Sample {
    pub x: Fx,
    pub z: Fx,
    pub fx: Fx,
    pub fz: Fx,
}

impl Sample {
    /// Right of the direction of travel, as Unity's `Vector3.Cross(up, forward)`.
    #[inline(always)]
    pub fn right(&self) -> (Fx, Fx) {
        (self.fz, -self.fx)
    }
}

/// A boost pad: a stretch of centreline samples at a lateral offset. Field
/// order avoids padding, so the type can live in a zero-copy account.
#[zero_copy]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct BoostPad {
    pub lateral: Fx,
    pub sample: u16,
    pub _padding: [u8; 2],
}

pub struct Track<'a> {
    pub samples: &'a [Sample],
    /// Distance between samples, in metres.
    pub spacing: Fx,
    /// Lateral distance from the centreline to the walls.
    pub wall_offset: Fx,
    /// Centreline samples where checkpoints sit; index 0 is the start line.
    pub checkpoints: &'a [u16],
    pub boost_pads: &'a [BoostPad],
    pub laps: u8,
    /// Sample the car starts from, just behind the start line.
    pub start_sample: u16,
    /// Heading the car starts with, stored rather than derived so the client
    /// and the chain never disagree about the first step.
    pub start_heading: u32,
}

impl<'a> Track<'a> {
    #[inline(always)]
    pub fn count(&self) -> i32 {
        self.samples.len() as i32
    }

    /// Wraps an index that is at most one lap either side of the loop, without
    /// the cost of a division.
    #[inline(always)]
    pub fn wrap(&self, index: i32) -> usize {
        let n = self.count();
        let mut index = index;
        if index < 0 {
            index += n;
        } else if index >= n {
            index -= n;
        }
        index as usize
    }

    /// How far past the start each checkpoint sits, counted in samples, so a
    /// lap is `count()` and checkpoints must be taken in order.
    pub fn checkpoint_progress(&self, index: usize, lap: i32) -> i32 {
        let n = self.count();
        // Checkpoints and the start sample both lie inside one lap, so the
        // difference is at most one lap either way: no division needed.
        let mut from_start = self.checkpoints[index] as i32 - self.start_sample as i32;
        if from_start < 0 {
            from_start += n;
        }
        from_start + lap * n
    }

    /// Progress at which the race is over.
    pub fn finish_progress(&self) -> i32 {
        self.checkpoint_progress(0, self.laps as i32)
    }

    /// Lateral offset of a point from a centreline sample: positive is right of
    /// the direction of travel.
    #[inline(always)]
    pub fn lateral(&self, sample: &Sample, x: Fx, z: Fx) -> Fx {
        let (rx, rz) = sample.right();
        mul(x - sample.x, rx) + mul(z - sample.z, rz)
    }
}
