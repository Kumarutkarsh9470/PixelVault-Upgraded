//! Helpers for exercising the simulation off-chain: building a track from
//! control points, and a bot that drives it. The bot is how medal times are
//! calibrated, and how the parity test produces realistic traces.

use super::car::{Car, Input, STEPS_PER_SECOND};
use super::fixed::{abs, div, fx, mul, sqrt, Fx, ONE};
use super::track::{BoostPad, Sample, Track};
use super::trig::PER_DEGREE;

/// Builds evenly spaced centreline samples from a closed loop of control
/// points, the same centripetal Catmull-Rom the client draws.
pub fn centreline(controls: &[(f64, f64)], spacing: f64) -> Vec<Sample> {
    let n = controls.len();
    let mut dense: Vec<(f64, f64)> = Vec::new();
    for i in 0..n {
        let p0 = controls[(i + n - 1) % n];
        let p1 = controls[i];
        let p2 = controls[(i + 1) % n];
        let p3 = controls[(i + 2) % n];
        for s in 0..48 {
            dense.push(catmull_rom(p0, p1, p2, p3, s as f64 / 48.0));
        }
    }

    let total: f64 = (0..dense.len())
        .map(|i| distance(dense[i], dense[(i + 1) % dense.len()]))
        .sum();
    let count = ((total / spacing).round() as usize).max(16);
    let step = total / count as f64;

    let mut positions = Vec::with_capacity(count);
    let mut segment = 0usize;
    let mut walked = 0.0;
    for k in 0..count {
        let target = k as f64 * step;
        let mut length = distance(dense[segment], dense[(segment + 1) % dense.len()]);
        while walked + length < target && segment < dense.len() - 1 {
            walked += length;
            segment += 1;
            length = distance(dense[segment], dense[(segment + 1) % dense.len()]);
        }
        let t = if length > 0.0 { (target - walked) / length } else { 0.0 };
        let a = dense[segment];
        let b = dense[(segment + 1) % dense.len()];
        positions.push((a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t));
    }

    (0..count)
        .map(|k| {
            let previous = positions[(k + count - 1) % count];
            let next = positions[(k + 1) % count];
            let (dx, dz) = (next.0 - previous.0, next.1 - previous.1);
            let length = (dx * dx + dz * dz).sqrt().max(1e-9);
            Sample {
                x: to_fx(positions[k].0),
                z: to_fx(positions[k].1),
                fx: to_fx(dx / length),
                fz: to_fx(dz / length),
            }
        })
        .collect()
}

/// Checkpoints every ~55 m, at least eight of them, as the client lays them out.
pub fn checkpoints(count: usize, spacing_m: f64, lap_m: f64) -> Vec<u16> {
    let wanted = ((lap_m / spacing_m).round() as usize).max(8);
    (0..wanted).map(|i| (i * count / wanted) as u16).collect()
}

pub fn heading_of(sample: &Sample) -> u32 {
    let degrees = (sample.fx as f64).atan2(sample.fz as f64).to_degrees();
    let units = (degrees * PER_DEGREE as f64) as i64;
    units as u32
}

/// A bot that follows the centreline: it aims at a point that moves further
/// ahead with speed, and brakes for the tightest bend it can see. `grip` is the
/// cornering force it believes it has, in m/s^2.
pub struct Bot {
    pub grip: Fx,
    pub drift: bool,
}

impl Bot {
    pub fn drive(&self, track: &Track, car: &Car) -> Input {
        let look = fx(8) + mul(car.speed(), super::fixed::pct(45));
        let ahead = (div(look, track.spacing) >> 16).max(1);
        let target = &track.samples[track.wrap(car.sample as i32 + ahead)];

        // Steer by the angle between where the car points and the aim point.
        let forward_x = super::trig::sin(car.heading);
        let forward_z = super::trig::cos(car.heading);
        let to_x = target.x - car.x;
        let to_z = target.z - car.z;
        let cross = mul(forward_x, to_z) - mul(forward_z, to_x);
        let dot = mul(forward_x, to_x) + mul(forward_z, to_z);
        let distance = sqrt(mul(to_x, to_x) + mul(to_z, to_z)).max(ONE);
        let sine = div(cross, distance);
        let mut steer = -(sine * 3 / ONE) * Input::STEER_SCALE;
        if dot < 0 {
            steer = if cross > 0 { -8 } else { 8 };
        }
        let steer = steer.clamp(-8, 8) as i8;

        // Slowest speed the coming bends allow, from their curvature.
        let speed = car.speed();
        let horizon = ((div(fx(20) + mul(speed, fx(1)), track.spacing)) >> 16).max(4);
        let mut safe = fx(62);
        let mut s = 2;
        while s < horizon {
            let a = &track.samples[track.wrap(car.sample as i32 + s)];
            let b = &track.samples[track.wrap(car.sample as i32 + s + 3)];
            let turn = abs(mul(a.fx, b.fz) - mul(a.fz, b.fx)); // |sin| of the angle between
            if turn > ONE / 200 {
                let radius = div(mul(track.spacing, fx(3)), turn);
                // Anything this open is a straight, and a radius large enough
                // to overflow the fixed-point range is certainly one.
                if radius > fx(600) {
                    s += 2;
                    continue;
                }
                let corner = sqrt(mul(self.grip, radius));
                let braking = sqrt(mul(corner, corner) + mul(fx(36), mul(track.spacing, fx(s))));
                if braking < safe {
                    safe = braking;
                }
            }
            s += 2;
        }

        let brake = speed > safe + fx(2);
        Input {
            steer,
            brake: brake && (self.drift || steer.abs() < 4),
        }
    }
}

/// Drives a whole run and returns the inputs, one per step.
pub fn drive(track: &Track, bot: &Bot, max_steps: u32) -> (Vec<Input>, Option<u32>) {
    let crossings_needed = track.checkpoints.len() as u16 * track.laps as u16 + 1;
    let mut car = Car::spawn(track);
    let mut inputs = Vec::new();
    for step in 1..=max_steps {
        let input = bot.drive(track, &car);
        car.step(track, input);
        inputs.push(input);
        if car.crossings >= crossings_needed {
            return (inputs, Some(step));
        }
    }
    (inputs, None)
}

pub fn to_fx(value: f64) -> Fx {
    (value * ONE as f64).round() as Fx
}

pub fn seconds(steps: u32) -> f64 {
    steps as f64 / STEPS_PER_SECOND as f64
}

pub fn pads(samples: &[(u16, f64)]) -> Vec<BoostPad> {
    samples
        .iter()
        .map(|(sample, lateral)| BoostPad {
            lateral: to_fx(*lateral),
            sample: *sample,
            _padding: [0; 2],
        })
        .collect()
}

fn catmull_rom(p0: (f64, f64), p1: (f64, f64), p2: (f64, f64), p3: (f64, f64), t: f64) -> (f64, f64) {
    let knot = |t: f64, a: (f64, f64), b: (f64, f64)| t + distance(a, b).sqrt().max(1e-4);
    let t0 = 0.0;
    let t1 = knot(t0, p0, p1);
    let t2 = knot(t1, p1, p2);
    let t3 = knot(t2, p2, p3);
    let u = t1 + (t2 - t1) * t;
    let blend = |a: (f64, f64), b: (f64, f64), ta: f64, tb: f64| {
        (
            (tb - u) / (tb - ta) * a.0 + (u - ta) / (tb - ta) * b.0,
            (tb - u) / (tb - ta) * a.1 + (u - ta) / (tb - ta) * b.1,
        )
    };
    let a1 = blend(p0, p1, t0, t1);
    let a2 = blend(p1, p2, t1, t2);
    let a3 = blend(p2, p3, t2, t3);
    let b1 = blend(a1, a2, t0, t2);
    let b2 = blend(a2, a3, t1, t3);
    blend(b1, b2, t1, t2)
}

fn distance(a: (f64, f64), b: (f64, f64)) -> f64 {
    ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt()
}
