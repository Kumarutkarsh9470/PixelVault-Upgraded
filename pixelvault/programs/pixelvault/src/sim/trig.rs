//! Sine and cosine from the shared quarter-wave table.
//!
//! Headings are `u32`, where the whole turn is 2^32: they wrap by themselves
//! and never need a modulo. The top 16 bits index the table.

use super::fixed::Fx;
use super::sin_table::SIN_QUARTER;

/// A whole turn, as a heading.
pub const TURN: u32 = u32::MAX; // 2^32 - 1; headings wrap naturally.

/// Heading units per degree: 2^32 / 360, rounded.
pub const PER_DEGREE: i64 = 11_930_465;

const QUARTER: u32 = 1 << 14;

/// Sine of a 16-bit angle, where 65_536 is a whole turn.
pub fn sin16(angle: u16) -> Fx {
    let a = angle as u32;
    match a >> 14 {
        0 => quarter(a),
        1 => quarter((1 << 15) - a),
        2 => -quarter(a - (1 << 15)),
        _ => -quarter((1 << 16) - a),
    }
}

/// Cosine of a 16-bit angle.
#[inline(always)]
pub fn cos16(angle: u16) -> Fx {
    sin16(angle.wrapping_add(QUARTER as u16))
}

#[inline(always)]
pub fn sin(heading: u32) -> Fx {
    sin16((heading >> 16) as u16)
}

#[inline(always)]
pub fn cos(heading: u32) -> Fx {
    cos16((heading >> 16) as u16)
}

/// Sine within the first quarter turn (0..=16384), interpolating the table.
#[inline(always)]
fn quarter(a: u32) -> Fx {
    let index = (a >> 4) as usize;
    let frac = (a & 15) as i32;
    let low = SIN_QUARTER[index];
    if frac == 0 {
        return low;
    }
    let high = SIN_QUARTER[index + 1];
    low + (((high - low) * frac) >> 4)
}

/// Degrees per second into heading units per simulation step.
pub const fn degrees_per_step(degrees_per_second_fx: Fx, steps_per_second: i64) -> i32 {
    ((degrees_per_second_fx as i64 * PER_DEGREE) / steps_per_second >> 16) as i32
}

#[cfg(test)]
mod tests {
    use super::super::fixed::ONE;
    use super::*;

    #[test]
    fn matches_floats_all_the_way_round() {
        let mut worst = 0.0f64;
        for angle in 0..=u16::MAX {
            let want = (angle as f64 / 65536.0 * std::f64::consts::TAU).sin();
            let got = sin16(angle) as f64 / ONE as f64;
            worst = worst.max((got - want).abs());
        }
        assert!(worst < 0.0005, "worst sine error {worst}");
    }

    #[test]
    fn cos_leads_sin_by_a_quarter_turn() {
        assert_eq!(cos16(0), ONE);
        assert_eq!(sin16(1 << 14), ONE);
        assert_eq!(sin16(0), 0);
    }
}
