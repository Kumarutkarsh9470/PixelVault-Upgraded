//! Simulation tests: the physics behave, traces round-trip, and replaying a
//! trace reproduces the run exactly.

use super::testing::{centreline, checkpoints, drive, heading_of, pads, seconds, to_fx, Bot};
use super::*;

/// Neon Harbor's control points, as shipped in web/src/data/tracks.json.
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

pub struct TestTrack {
    pub samples: Vec<Sample>,
    pub checkpoints: Vec<u16>,
    pub pads: Vec<BoostPad>,
    pub start_heading: u32,
    pub start_sample: u16,
}

impl TestTrack {
    pub fn neon_harbor(laps: u8) -> (Self, u8) {
        let samples = centreline(NEON_HARBOR, 2.0);
        let count = samples.len();
        let lap_m = count as f64 * 2.0;
        let start_sample = (count - 4) as u16;
        (
            Self {
                start_heading: heading_of(&samples[start_sample as usize]),
                checkpoints: checkpoints(count, 55.0, lap_m),
                pads: pads(&[(count as u16 / 5, -2.8), (count as u16 / 2, 2.8), (count as u16 * 4 / 5, -2.8)]),
                samples,
                start_sample,
            },
            laps,
        )
    }

    /// The circuit with its walls pushed out of reach, for testing handling
    /// without a corner getting in the way.
    pub fn open(&self, laps: u8) -> Track<'_> {
        Track { wall_offset: to_fx(5000.0), ..self.view(laps) }
    }

    pub fn view(&self, laps: u8) -> Track<'_> {
        Track {
            samples: &self.samples,
            spacing: to_fx(2.0),
            wall_offset: to_fx(10.0),
            checkpoints: &self.checkpoints,
            boost_pads: &self.pads,
            laps,
            start_sample: self.start_sample,
            start_heading: self.start_heading,
        }
    }
}

fn full_throttle(steps: usize) -> Vec<Input> {
    vec![Input { steer: 0, brake: false }; steps]
}

#[test]
fn accelerates_towards_top_speed() {
    let (built, laps) = TestTrack::neon_harbor(1);
    let track = built.open(laps);
    let mut car = Car::spawn(&track);
    for input in full_throttle(600) {
        car.step(&track, input);
    }
    let speed = car.speed() as f64 / ONE as f64;
    assert!(speed > 44.0 && speed <= 50.5, "straight-line speed was {speed} m/s");
}

#[test]
fn walls_keep_the_car_on_the_circuit() {
    let (built, laps) = TestTrack::neon_harbor(1);
    let track = built.view(laps);
    let mut car = Car::spawn(&track);
    // Full lock into the wall for ten seconds.
    for _ in 0..600 {
        car.step(&track, Input { steer: 8, brake: false });
    }
    let sample = &track.samples[car.sample as usize];
    let lateral = (track.lateral(sample, car.x, car.z) as f64 / ONE as f64).abs();
    assert!(lateral <= 10.01, "car was {lateral} m from the centreline");
}

#[test]
fn a_bot_laps_the_circuit_in_a_sane_time() {
    let (built, laps) = TestTrack::neon_harbor(2);
    let track = built.view(laps);
    let bot = Bot { grip: to_fx(30.0), drift: false };
    let (inputs, finish) = drive(&track, &bot, MAX_STEPS);
    let steps = finish.expect("the bot never finished");
    let time = seconds(steps);
    assert!(time > 20.0 && time < 90.0, "two laps took {time} s");

    // The same inputs, replayed as a trace, give the same time.
    let trace = encode_trace(&inputs);
    let outcome = simulate(&track, &trace).expect("replay failed");
    assert_eq!(outcome.steps, steps);
    println!(
        "two laps in {time:.2} s, trace {} bytes ({} steps)",
        trace.len(),
        inputs.len()
    );
}

#[test]
fn traces_round_trip() {
    let inputs: Vec<Input> = (0..1000)
        .map(|i| Input {
            steer: ((i / 37) % 17 - 8) as i8,
            brake: i % 11 == 0,
        })
        .collect();
    let trace = encode_trace(&inputs);
    assert_eq!(decode_trace(&trace).unwrap(), inputs);
}

#[test]
fn padding_after_the_line_is_rejected() {
    let (built, laps) = TestTrack::neon_harbor(1);
    let track = built.view(laps);
    let bot = Bot { grip: to_fx(30.0), drift: false };
    let (mut inputs, finish) = drive(&track, &bot, MAX_STEPS);
    assert!(finish.is_some());
    inputs.push(Input { steer: 0, brake: false });
    assert_eq!(
        simulate(&track, &encode_trace(&inputs)),
        Err(SimError::FinishedEarly)
    );
}

#[test]
fn a_short_trace_never_finishes() {
    let (built, laps) = TestTrack::neon_harbor(1);
    let track = built.view(laps);
    assert_eq!(
        simulate(&track, &encode_trace(&full_throttle(120))),
        Err(SimError::NeverFinished)
    );
}

#[test]
fn a_trace_with_a_zero_repeat_is_malformed() {
    let (built, laps) = TestTrack::neon_harbor(1);
    let track = built.view(laps);
    assert_eq!(simulate(&track, &[0x08, 0]), Err(SimError::MalformedTrace));
    assert_eq!(simulate(&track, &[0x08]), Err(SimError::MalformedTrace));
}

#[test]
fn drifting_charges_a_boost_that_fires_on_release() {
    let (built, laps) = TestTrack::neon_harbor(1);
    let track = built.open(laps);
    let mut car = Car::spawn(&track);
    for _ in 0..180 {
        car.step(&track, Input { steer: 0, brake: false });
    }
    // Held long enough to charge, but not so long that the car spins past the
    // speed a drift needs.
    for _ in 0..40 {
        car.step(&track, Input { steer: 6, brake: true });
    }
    assert!(car.drifting, "the car should be drifting");
    assert!(car.drift_charge > 0, "the drift should be charging");
    car.step(&track, Input { steer: 6, brake: false });
    assert!(car.boosting(), "releasing a charged drift should boost");
}
