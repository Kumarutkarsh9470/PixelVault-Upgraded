// The circuit as the simulation sees it, a port of
// pixelvault/programs/pixelvault/src/sim/track.rs.
//
// The client builds this centreline from a track's control points and the
// chain stores the same samples, so both replay a run against identical
// geometry.

public struct SimSample
{
    public int X;
    public int Z;
    public int Fx;
    public int Fz;

    /// Right of the direction of travel, as Unity's Vector3.Cross(up, forward).
    public int RightX => Fz;
    public int RightZ => -Fx;
}

public struct SimBoostPad
{
    public int Lateral;
    public int Sample;
}

public class SimTrack
{
    public SimSample[] Samples;
    /// Metres between centreline samples.
    public int Spacing;
    /// Lateral distance from the centreline to the walls.
    public int WallOffset;
    /// Centreline samples where checkpoints sit; index 0 is the start line.
    public int[] Checkpoints;
    public SimBoostPad[] BoostPads;
    public int Laps;
    public int StartSample;
    public uint StartHeading;

    public int Count => Samples.Length;

    /// Every checkpoint of every lap, plus the final line crossing.
    public int CrossingsNeeded => Checkpoints.Length * Laps + 1;

    /// Wraps an index that is at most one lap either side of the loop.
    public int Wrap(int index)
    {
        int n = Count;
        if (index < 0) index += n;
        else if (index >= n) index -= n;
        return index;
    }

    /// How far past the start each checkpoint sits, counted in samples, so a
    /// lap is Count and checkpoints must be taken in order.
    public int CheckpointProgress(int index, int lap)
    {
        int n = Count;
        int fromStart = Checkpoints[index] - StartSample;
        if (fromStart < 0) fromStart += n;
        return fromStart + lap * n;
    }

    public int FinishProgress()
    {
        return CheckpointProgress(0, Laps);
    }

    /// Lateral offset of a point from a centreline sample: positive is right of
    /// the direction of travel.
    public int Lateral(ref SimSample sample, int x, int z)
    {
        return FixedMath.Mul(x - sample.X, sample.RightX) + FixedMath.Mul(z - sample.Z, sample.RightZ);
    }

    /// Reads samples from the flat array the track data ships: four values per
    /// sample (x, z, forward x, forward z), already in fixed point.
    ///
    /// The geometry is never derived here. The chain and the client must agree
    /// exactly, so both read the samples the registration tool produced.
    public static SimSample[] FromFlat(int[] flat)
    {
        var samples = new SimSample[flat.Length / 4];
        for (int i = 0; i < samples.Length; i++)
        {
            samples[i] = new SimSample
            {
                X = flat[i * 4],
                Z = flat[i * 4 + 1],
                Fx = flat[i * 4 + 2],
                Fz = flat[i * 4 + 3],
            };
        }
        return samples;
    }
}
