//! Q16.16 fixed-point maths. Every value in the race simulation is an integer,
//! so the program and the Unity client produce bit-identical results: a run
//! verified on-chain is exactly the run the player drove.

/// Q16.16: one unit of distance (a metre) is 65_536.
pub type Fx = i32;

pub const ONE: Fx = 1 << 16;
pub const FRAC_BITS: u32 = 16;

/// Whole number to fixed point.
#[inline(always)]
pub const fn fx(n: i32) -> Fx {
    n << FRAC_BITS
}

/// A decimal constant as fixed point, e.g. `num(1, 7)` is 1.7.
/// The fraction is a tenth, which is all the handling constants need.
pub const fn num(whole: i32, tenths: i32) -> Fx {
    (whole << FRAC_BITS) + (tenths << FRAC_BITS) / 10
}

/// A percentage as fixed point, e.g. `pct(65)` is 0.65.
pub const fn pct(p: i32) -> Fx {
    (p * ONE) / 100
}

/// Truncating multiply. The cast back to i32 wraps rather than panicking, but
/// every quantity in the simulation is bounded by the speed cap and the walls.
#[inline(always)]
pub fn mul(a: Fx, b: Fx) -> Fx {
    (((a as i64) * (b as i64)) >> FRAC_BITS) as Fx
}

#[inline(always)]
pub fn div(a: Fx, b: Fx) -> Fx {
    if b == 0 {
        return 0;
    }
    (((a as i64) << FRAC_BITS) / (b as i64)) as Fx
}

#[inline(always)]
pub fn abs(a: Fx) -> Fx {
    if a < 0 {
        -a
    } else {
        a
    }
}

#[inline(always)]
pub fn clamp(a: Fx, low: Fx, high: Fx) -> Fx {
    if a < low {
        low
    } else if a > high {
        high
    } else {
        a
    }
}

#[inline(always)]
pub fn clamp01(a: Fx) -> Fx {
    clamp(a, 0, ONE)
}

/// Linear interpolation with `t` clamped to 0..1.
#[inline(always)]
pub fn lerp(a: Fx, b: Fx, t: Fx) -> Fx {
    a + mul(b - a, clamp01(t))
}

/// Moves `from` towards `to` by at most `step`, as Unity's Mathf.MoveTowards.
#[inline(always)]
pub fn move_towards(from: Fx, to: Fx, step: Fx) -> Fx {
    let delta = to - from;
    if abs(delta) <= step {
        to
    } else if delta > 0 {
        from + step
    } else {
        from - step
    }
}

/// Square root of a fixed-point value, rounded down. Bit-by-bit so that it is
/// identical everywhere; used only when the speed cap actually bites.
pub fn sqrt(a: Fx) -> Fx {
    if a <= 0 {
        return 0;
    }
    let value = (a as u64) << FRAC_BITS;
    let mut root: u64 = 0;
    let mut bit: u64 = 1 << 46;
    let mut rest = value;
    while bit > rest {
        bit >>= 2;
    }
    while bit != 0 {
        if rest >= root + bit {
            rest -= root + bit;
            root = (root >> 1) + bit;
        } else {
            root >>= 1;
        }
        bit >>= 2;
    }
    root as Fx
}

/// Length of a 2D vector.
#[inline(always)]
pub fn length(x: Fx, z: Fx) -> Fx {
    sqrt(mul(x, x) + mul(z, z))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqrt_matches_floats() {
        // Q16.16 holds whole numbers up to 32_767.
        for whole in [0i32, 1, 2, 9, 16, 50, 3844, 30000] {
            let got = sqrt(fx(whole)) as f64 / ONE as f64;
            let want = (whole as f64).sqrt();
            assert!((got - want).abs() < 0.001, "sqrt({whole}) = {got}, want {want}");
        }
    }

    #[test]
    fn move_towards_never_overshoots() {
        assert_eq!(move_towards(0, ONE, ONE / 4), ONE / 4);
        assert_eq!(move_towards(0, ONE / 8, ONE / 4), ONE / 8);
        assert_eq!(move_towards(0, -ONE, ONE / 4), -ONE / 4);
    }

    #[test]
    fn num_reads_as_decimal() {
        assert_eq!(num(1, 7), (1.7 * ONE as f64) as i32);
        assert_eq!(num(0, 5), ONE / 2);
    }
}
