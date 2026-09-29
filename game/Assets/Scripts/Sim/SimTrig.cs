// Sine and cosine from the shared quarter-wave table, a port of
// pixelvault/programs/pixelvault/src/sim/trig.rs.
//
// Headings are uint, where the whole turn is 2^32: they wrap by themselves and
// never need a modulo. The top 16 bits index the table.

public static class SimTrig
{
    /// Heading units per degree: 2^32 / 360, rounded.
    public const long PerDegree = 11_930_465;

    const uint QuarterTurn = 1 << 14;

    /// Sine of a 16-bit angle, where 65_536 is a whole turn.
    public static int Sin16(ushort angle)
    {
        uint a = angle;
        switch (a >> 14)
        {
            case 0: return Quarter(a);
            case 1: return Quarter((1u << 15) - a);
            case 2: return -Quarter(a - (1u << 15));
            default: return -Quarter((1u << 16) - a);
        }
    }

    public static int Cos16(ushort angle)
    {
        return Sin16((ushort)(angle + QuarterTurn));
    }

    public static int Sin(uint heading)
    {
        return Sin16((ushort)(heading >> 16));
    }

    public static int Cos(uint heading)
    {
        return Cos16((ushort)(heading >> 16));
    }

    /// Sine within the first quarter turn (0..=16384), interpolating the table.
    static int Quarter(uint a)
    {
        int index = (int)(a >> 4);
        int frac = (int)(a & 15);
        int low = SinTable.Quarter[index];
        if (frac == 0)
        {
            return low;
        }
        int high = SinTable.Quarter[index + 1];
        return low + (((high - low) * frac) >> 4);
    }

    /// Degrees per second into heading units per simulation step.
    public static int DegreesPerStep(int degreesPerSecondFx, long stepsPerSecond)
    {
        return (int)((degreesPerSecondFx * PerDegree / stepsPerSecond) >> 16);
    }
}
