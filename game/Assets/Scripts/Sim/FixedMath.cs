// Q16.16 fixed-point maths, a line-by-line port of
// pixelvault/programs/pixelvault/src/sim/fixed.rs.
//
// The race simulation must produce bit-identical results here and on-chain, so
// every operation below matches its Rust counterpart exactly, including how
// casts truncate. C# arithmetic is unchecked by default, which is the same
// wrapping behaviour the program relies on.

public static class FixedMath
{
    /// Q16.16: one unit of distance (a metre) is 65_536.
    public const int One = 1 << 16;
    public const int FracBits = 16;

    /// Whole number to fixed point.
    public static int Fx(int n)
    {
        return n << FracBits;
    }

    /// A decimal constant as fixed point, e.g. Num(1, 7) is 1.7.
    public static int Num(int whole, int tenths)
    {
        return (whole << FracBits) + (tenths << FracBits) / 10;
    }

    /// A percentage as fixed point, e.g. Pct(65) is 0.65.
    public static int Pct(int p)
    {
        return (p * One) / 100;
    }

    /// Truncating multiply. The cast back to int wraps, as the Rust `as i32` does.
    public static int Mul(int a, int b)
    {
        return (int)(((long)a * b) >> FracBits);
    }

    public static int Div(int a, int b)
    {
        if (b == 0)
        {
            return 0;
        }
        return (int)((((long)a) << FracBits) / b);
    }

    public static int Abs(int a)
    {
        return a < 0 ? -a : a;
    }

    public static int Clamp(int a, int low, int high)
    {
        if (a < low) return low;
        if (a > high) return high;
        return a;
    }

    public static int Clamp01(int a)
    {
        return Clamp(a, 0, One);
    }

    /// Linear interpolation with t clamped to 0..1.
    public static int Lerp(int a, int b, int t)
    {
        return a + Mul(b - a, Clamp01(t));
    }

    /// Moves from towards to by at most step, as Unity's Mathf.MoveTowards.
    public static int MoveTowards(int from, int to, int step)
    {
        int delta = to - from;
        if (Abs(delta) <= step) return to;
        return delta > 0 ? from + step : from - step;
    }

    /// Square root of a fixed-point value, rounded down. Bit-by-bit so that it
    /// is identical everywhere.
    public static int Sqrt(int a)
    {
        if (a <= 0)
        {
            return 0;
        }
        ulong value = ((ulong)(uint)a) << FracBits;
        ulong root = 0;
        ulong bit = 1UL << 46;
        ulong rest = value;
        while (bit > rest)
        {
            bit >>= 2;
        }
        while (bit != 0)
        {
            if (rest >= root + bit)
            {
                rest -= root + bit;
                root = (root >> 1) + bit;
            }
            else
            {
                root >>= 1;
            }
            bit >>= 2;
        }
        return (int)root;
    }

    /// Length of a 2D vector.
    public static int Length(int x, int z)
    {
        return Sqrt(Mul(x, x) + Mul(z, z));
    }

    /// Fixed point as a float, for rendering only. Never feed this back into
    /// the simulation.
    public static float ToFloat(int a)
    {
        return a / (float)One;
    }

    public static int FromFloat(float a)
    {
        return (int)System.Math.Round(a * (double)One);
    }
}
