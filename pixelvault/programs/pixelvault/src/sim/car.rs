//! The car: one deterministic step of arcade handling.
//!
//! This is the canonical definition of how the game drives. `game/Assets/
//! Scripts/Sim/CarSim.cs` is a line-by-line port of it, and the parity test
//! feeds both the same traces to prove they still agree.

use super::fixed::{abs, clamp01, div, fx, length, move_towards, mul, num, pct, Fx, ONE};
use super::track::Sample;
use super::track::Track;
use super::trig::{cos, degrees_per_step, sin};

/// Simulation rate. One step is 1/60 s of race time.
pub const STEPS_PER_SECOND: i64 = 60;
/// Step length in seconds, as Q16.16.
pub const DT: Fx = (ONE as i64 / STEPS_PER_SECOND) as Fx;

// Handling, mirroring the feel tuned in the Unity prototype.
const MAX_SPEED: Fx = fx(50);
const BOOST_MAX_SPEED: Fx = fx(62);
const ACCELERATION: Fx = fx(20);
const BOOST_ACCELERATION: Fx = fx(36);
const BRAKE_DECELERATION: Fx = fx(30);
const ACCELERATION_TAPER: Fx = pct(65);
const DRIFT_SCRUB: Fx = fx(5);
const GRIP: Fx = fx(9);
const DRIFT_GRIP: Fx = num(1, 7);
const STEER_RATE: Fx = fx(7);
const LINEAR_DAMPING: Fx = pct(5);
const DRIFT_MIN_SPEED: Fx = fx(16);
const DRIFT_MIN_STEER: Fx = pct(40);
const DRIFT_CHARGE_SECONDS: Fx = num(1, 4);
const DRIFT_MIN_CHARGE: Fx = pct(35);
const DRIFT_BOOST_BASE: Fx = pct(50);
const DRIFT_BOOST_SPAN: Fx = num(1, 3);
const LOW_SPEED_REFERENCE: Fx = fx(6);
const IMPACT_REFERENCE: Fx = fx(22);
const IMPACT_SPEED_LOSS: Fx = pct(40);
const WALL_SCRAPE: Fx = pct(99) - pct(1) / 2; // 0.985
const BOOST_PAD_STEPS: u16 = 66; // 1.1 s
const BOOST_PAD_HALF_WIDTH: Fx = num(2, 3);
const BOOST_PAD_HALF_LENGTH: i32 = 2;

// Reciprocals of the constants the step divides by. Division costs far more
// than multiplication on-chain, and a race is a few thousand steps.
const INV_MAX_SPEED: Fx = ONE / 50;
const INV_BOOST_MAX_SPEED: Fx = ONE / 62;
const INV_LOW_SPEED_REFERENCE: Fx = ONE / 6;
const INV_IMPACT_REFERENCE: Fx = ONE / 22;
const BOOST_MAX_SPEED_SQUARED: Fx = mul_const(BOOST_MAX_SPEED, BOOST_MAX_SPEED);
const DRIFT_CHARGE_PER_STEP: Fx = mul_const(DT, ONE / 14 * 10);
const STEER_PER_STEP: Fx = mul_const(STEER_RATE, DT);
const DAMPING_PER_STEP: Fx = ONE - mul_const(LINEAR_DAMPING, DT);

/// `mul` again, usable in a constant.
const fn mul_const(a: Fx, b: Fx) -> Fx {
    (((a as i64) * (b as i64)) >> 16) as Fx
}

// Steering rates, in heading units turned per step (a whole turn is 2^32).
const LOW_SPEED_YAW: i32 = degrees_per_step(fx(125), STEPS_PER_SECOND);
const HIGH_SPEED_YAW: i32 = degrees_per_step(fx(46), STEPS_PER_SECOND);
const DRIFT_YAW: i32 = degrees_per_step(fx(92), STEPS_PER_SECOND);

/// One step of player input: `steer` is -8..=8 (a thumb on one side is full
/// lock; tilt steering uses the levels between), `brake` is both thumbs down.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Input {
    pub steer: i8,
    pub brake: bool,
}

impl Input {
    pub const STEER_SCALE: i32 = 8;

    /// Packs into the byte a trace stores: steer in the low five bits, biased
    /// so it is unsigned, and brake in bit five.
    pub fn pack(&self) -> u8 {
        let steer = (self.steer.clamp(-8, 8) + 8) as u8;
        steer | ((self.brake as u8) << 5)
    }

    pub fn unpack(byte: u8) -> Self {
        Self {
            steer: ((byte & 0x1f) as i8) - 8,
            brake: byte & 0x20 != 0,
        }
    }

    #[inline(always)]
    fn steer_target(&self) -> Fx {
        (self.steer.clamp(-8, 8) as i32 * ONE) / Self::STEER_SCALE
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Car {
    pub x: Fx,
    pub z: Fx,
    pub vx: Fx,
    pub vz: Fx,
    /// Heading: a whole turn is 2^32, so it wraps by itself.
    pub heading: u32,
    pub steer: Fx,
    pub drift_charge: Fx,
    pub boost_steps: u16,
    pub drifting: bool,
    /// Centreline samples travelled since the start. Checkpoints are positions
    /// along this count, so they can only be taken in order.
    pub progress: i32,
    pub sample: u16,
    /// Checkpoint crossings so far, including the start line.
    pub crossings: u16,
    /// Progress at which the next checkpoint falls, cached because working it
    /// out costs a division and it only changes when one is crossed.
    pub next_target: i32,
    /// Strength of a wall hit this step, for the client's effects and sound.
    pub impact: Fx,
}

impl Car {
    pub fn spawn(track: &Track) -> Self {
        let sample = &track.samples[track.start_sample as usize];
        Self {
            x: sample.x,
            z: sample.z,
            heading: track.start_heading,
            sample: track.start_sample,
            next_target: track.checkpoint_progress(0, 0),
            ..Default::default()
        }
    }

    #[inline(always)]
    pub fn speed(&self) -> Fx {
        length(self.vx, self.vz)
    }

    #[inline(always)]
    pub fn boosting(&self) -> bool {
        self.boost_steps > 0
    }

    /// Advances the car by one step. Returns the checkpoint index if this step
    /// crossed the next one.
    pub fn step(&mut self, track: &Track, input: Input) -> Option<u16> {
        self.impact = 0;
        let forward_x = sin(self.heading);
        let forward_z = cos(self.heading);
        let right_x = forward_z;
        let right_z = -forward_x;

        let forward_speed = mul(self.vx, forward_x) + mul(self.vz, forward_z);
        let lateral_speed = mul(self.vx, right_x) + mul(self.vz, right_z);

        self.steer = move_towards(self.steer, input.steer_target(), STEER_PER_STEP);

        // A drift needs a committed steering angle and real speed. It scrubs
        // speed, turns harder, and charges a boost that fires on release.
        let was_drifting = self.drifting;
        self.drifting =
            input.brake && abs(self.steer) > DRIFT_MIN_STEER && forward_speed > DRIFT_MIN_SPEED;

        let mut ax = 0;
        let mut az = 0;
        if self.drifting {
            ax -= mul(forward_x, DRIFT_SCRUB);
            az -= mul(forward_z, DRIFT_SCRUB);
            self.drift_charge = clamp01(self.drift_charge + DRIFT_CHARGE_PER_STEP);
        } else if input.brake {
            // Never brake past a standstill within one step.
            let most = abs(forward_speed) * STEPS_PER_SECOND as i32;
            let decel = if most < BRAKE_DECELERATION { most } else { BRAKE_DECELERATION };
            let sign = if forward_speed >= 0 { ONE } else { -ONE };
            ax -= mul(mul(forward_x, sign), decel);
            az -= mul(mul(forward_z, sign), decel);
        } else {
            let boosting = self.boosting();
            let top = if boosting { BOOST_MAX_SPEED } else { MAX_SPEED };
            let rate = if boosting { BOOST_ACCELERATION } else { ACCELERATION };
            let inv_top = if boosting { INV_BOOST_MAX_SPEED } else { INV_MAX_SPEED };
            if forward_speed < top {
                // Strong off the line, tapering towards top speed.
                let taper = ONE - mul(clamp01(mul(forward_speed, inv_top)), ACCELERATION_TAPER);
                ax += mul(mul(forward_x, rate), taper);
                az += mul(mul(forward_z, rate), taper);
            }
        }

        if was_drifting && !self.drifting {
            if self.drift_charge >= DRIFT_MIN_CHARGE {
                let seconds = DRIFT_BOOST_BASE + mul(self.drift_charge, DRIFT_BOOST_SPAN);
                self.add_boost(((seconds as i64 * STEPS_PER_SECOND) >> 16) as u16);
            }
            self.drift_charge = 0;
        }

        // Steering bites less at speed, and barely at all when nearly stopped.
        let speed01 = clamp01(mul(abs(forward_speed), INV_MAX_SPEED));
        let crawl = clamp01(mul(abs(forward_speed), INV_LOW_SPEED_REFERENCE));
        let mut yaw = LOW_SPEED_YAW + (((HIGH_SPEED_YAW - LOW_SPEED_YAW) as i64 * speed01 as i64) >> 16) as i32;
        yaw = ((yaw as i64 * crawl as i64) >> 16) as i32;
        if self.drifting && yaw < DRIFT_YAW {
            yaw = DRIFT_YAW;
        }
        let mut turn = ((yaw as i64 * self.steer as i64) >> 16) as i32;
        if forward_speed < 0 {
            turn = -turn;
        }
        self.heading = self.heading.wrapping_add(turn as u32);

        // Tyres resist sliding sideways; a drift lets them go.
        let grip = if self.drifting { DRIFT_GRIP } else { GRIP };
        ax -= mul(mul(right_x, lateral_speed), grip);
        az -= mul(mul(right_z, lateral_speed), grip);

        self.vx = self.vx.wrapping_add(mul(ax, DT));
        self.vz = self.vz.wrapping_add(mul(az, DT));
        self.vx = mul(self.vx, DAMPING_PER_STEP);
        self.vz = mul(self.vz, DAMPING_PER_STEP);

        // Stacked boosts never exceed the boosted top speed.
        if mul(self.vx, self.vx) + mul(self.vz, self.vz) > BOOST_MAX_SPEED_SQUARED {
            let speed = length(self.vx, self.vz);
            self.vx = mul(div(self.vx, speed), BOOST_MAX_SPEED);
            self.vz = mul(div(self.vz, speed), BOOST_MAX_SPEED);
        }

        self.x = self.x.wrapping_add(mul(self.vx, DT));
        self.z = self.z.wrapping_add(mul(self.vz, DT));
        if self.boost_steps > 0 {
            self.boost_steps -= 1;
        }

        let sample = self.follow_track(track);
        let lateral = self.hit_walls(track, &sample);
        self.cross_boost_pads(track, lateral);
        self.cross_checkpoint(track)
    }

    pub fn add_boost(&mut self, steps: u16) {
        if steps > self.boost_steps {
            self.boost_steps = steps;
        }
    }

    /// Tracks the nearest centreline sample, searching only the few samples the
    /// car could have reached, and accumulates progress around the lap.
    fn follow_track(&mut self, track: &Track) -> Sample {
        let mut best = self.sample as i32;
        let mut best_distance = i64::MAX;
        // At the speed cap the car covers about half a sample per step, so a
        // short window either side is always enough.
        for offset in -1..=3 {
            let index = track.wrap(self.sample as i32 + offset);
            let sample = &track.samples[index];
            let dx = (self.x - sample.x) as i64;
            let dz = (self.z - sample.z) as i64;
            let distance = dx * dx + dz * dz;
            if distance < best_distance {
                best_distance = distance;
                best = index as i32;
            }
        }
        // The shortest signed step around the loop, so passing sample 0 counts
        // as progress forward rather than a lap backwards.
        let n = track.count();
        let mut delta = best - self.sample as i32;
        if delta > n / 2 {
            delta -= n;
        } else if delta < -n / 2 {
            delta += n;
        }
        self.progress += delta;
        self.sample = best as u16;
        track.samples[best as usize]
    }

    /// Walls are the edge of the circuit rather than colliders: the car is put
    /// back on the track and loses speed, hard on impact, slowly while scraping.
    fn hit_walls(&mut self, track: &Track, sample: &Sample) -> Fx {
        let (rx, rz) = sample.right();
        let lateral = mul(self.x - sample.x, rx) + mul(self.z - sample.z, rz);
        let over = abs(lateral) - track.wall_offset;
        if over <= 0 {
            return lateral;
        }

        let sign = if lateral > 0 { ONE } else { -ONE };
        let out_x = mul(rx, sign);
        let out_z = mul(rz, sign);
        self.x -= mul(out_x, over);
        self.z -= mul(out_z, over);

        let into_wall = mul(self.vx, out_x) + mul(self.vz, out_z);
        if into_wall > 0 {
            self.vx -= mul(out_x, into_wall);
            self.vz -= mul(out_z, into_wall);
            let strength = clamp01(mul(into_wall, INV_IMPACT_REFERENCE));
            let keep = ONE - mul(strength, IMPACT_SPEED_LOSS);
            self.vx = mul(self.vx, keep);
            self.vz = mul(self.vz, keep);
            self.drift_charge = 0;
            self.impact = strength;
        } else {
            self.vx = mul(self.vx, WALL_SCRAPE);
            self.vz = mul(self.vz, WALL_SCRAPE);
        }
        // The car now sits exactly on the wall.
        if lateral > 0 {
            track.wall_offset
        } else {
            -track.wall_offset
        }
    }

    fn cross_boost_pads(&mut self, track: &Track, lateral: Fx) {
        let n = track.count();
        for pad in track.boost_pads {
            let mut delta = pad.sample as i32 - self.sample as i32;
            if delta > n / 2 {
                delta -= n;
            } else if delta < -n / 2 {
                delta += n;
            }
            if delta.abs() > BOOST_PAD_HALF_LENGTH {
                continue;
            }
            if abs(lateral - pad.lateral) <= BOOST_PAD_HALF_WIDTH {
                self.add_boost(BOOST_PAD_STEPS);
            }
        }
    }

    /// Checkpoints sit at fixed distances along the progress count, so they can
    /// only be taken in order, and only once each.
    #[inline(always)]
    fn cross_checkpoint(&mut self, track: &Track) -> Option<u16> {
        if self.progress < self.next_target {
            return None;
        }
        let per_lap = track.checkpoints.len() as u16;
        let index = self.crossings % per_lap;
        self.crossings += 1;
        let next = self.crossings % per_lap;
        let lap = (self.crossings / per_lap) as i32;
        self.next_target = track.checkpoint_progress(next as usize, lap);
        Some(index)
    }
}
