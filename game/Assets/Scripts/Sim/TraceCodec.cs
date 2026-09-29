// Run-length encoding of a run's inputs, and the rolling checksum the parity
// harness compares. Ports of the same code in the program's sim module.

using System.Collections.Generic;

public static class TraceCodec
{
    /// Turns one input per step into the trace sent on-chain: pairs of (packed
    /// input, repeat count). A real run compresses to a few hundred bytes.
    public static byte[] Encode(IList<SimInput> inputs)
    {
        var trace = new List<byte>(inputs.Count / 8);
        for (int i = 0; i < inputs.Count; i++)
        {
            byte value = inputs[i].Pack();
            int count = trace.Count;
            if (count >= 2 && trace[count - 2] == value && trace[count - 1] < byte.MaxValue)
            {
                trace[count - 1]++;
            }
            else
            {
                trace.Add(value);
                trace.Add(1);
            }
        }
        return trace.ToArray();
    }

    /// Expands a trace back into one input per step.
    public static List<SimInput> Decode(byte[] trace)
    {
        var inputs = new List<SimInput>();
        for (int i = 0; i + 1 < trace.Length; i += 2)
        {
            SimInput input = SimInput.Unpack(trace[i]);
            for (int n = 0; n < trace[i + 1]; n++)
            {
                inputs.Add(input);
            }
        }
        return inputs;
    }
}

/// A rolling checksum of the car's state, so the parity harness can say which
/// step first diverged rather than only that two runs differ.
public static class SimHash
{
    public const ulong Seed = 14695981039346656037UL;
    const ulong Prime = 1099511628211UL;

    public static ulong Mix(ulong hash, long value)
    {
        unchecked
        {
            return (hash ^ (ulong)value) * Prime;
        }
    }

    public static ulong Step(ulong hash, ref CarSim car)
    {
        hash = Mix(hash, car.X);
        hash = Mix(hash, car.Z);
        hash = Mix(hash, car.Vx);
        hash = Mix(hash, car.Vz);
        hash = Mix(hash, car.Heading);
        hash = Mix(hash, car.Steer);
        hash = Mix(hash, car.DriftCharge);
        hash = Mix(hash, car.BoostSteps);
        hash = Mix(hash, car.Drifting ? 1 : 0);
        hash = Mix(hash, car.Progress);
        hash = Mix(hash, car.Sample);
        hash = Mix(hash, car.Crossings);
        return hash;
    }
}
