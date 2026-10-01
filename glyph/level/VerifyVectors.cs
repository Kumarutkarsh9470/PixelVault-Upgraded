using System;
using System.Collections.Generic;
using System.IO;

/// Checks RunnerSim.cs against vectors.txt (written from the server's runner.js).
/// Run with tools/glyph-verify.sh; exits non-zero on any mismatch.
public static class VerifyVectors
{
    public static int Main(string[] args)
    {
        string path = args.Length > 0 ? args[0] : "glyph/level/vectors.txt";
        int failures = 0, checks = 0;
        foreach (string line in File.ReadAllLines(path))
        {
            if (line.Trim().Length == 0) continue;
            string[] f = line.Split(' ');
            int p = 1;
            Func<int> nextInt = () => int.Parse(f[p++]);
            Func<uint> nextUint = () => uint.Parse(f[p++]);

            if (f[0] == "ROWS")
            {
                uint seed = nextUint();
                int count = nextInt();
                string expected = f[p];
                byte[] cells = RunnerSim.GenerateRows(seed, count);
                var actual = new System.Text.StringBuilder(cells.Length);
                foreach (byte c in cells) actual.Append((char)('0' + c));
                checks++;
                if (actual.ToString() != expected)
                {
                    failures++;
                    int at = 0;
                    while (at < expected.Length && expected[at] == actual[at]) at++;
                    Console.WriteLine($"FAIL rows seed {seed}: first difference at cell {at} (row {at / 3})");
                }
            }
            else if (f[0] == "RUN")
            {
                uint seed = nextUint();
                int endTick = nextInt();
                int inputCount = nextInt();
                var inputs = new List<int[]>();
                for (int i = 0; i < inputCount; i++) inputs.Add(new[] { nextInt(), nextInt() });
                int expectEnd = nextInt();
                bool expectDied = nextInt() == 1;
                int expectDeathRow = nextInt();
                int expectDistance = nextInt();
                int pickups = nextInt();
                var expectPickups = new List<int[]>();
                for (int i = 0; i < pickups; i++) expectPickups.Add(new[] { nextInt(), nextInt() });

                RunnerSim sim = RunnerSim.Simulate(seed, inputs, endTick);
                checks++;
                bool same = sim.Tick == expectEnd && sim.Dead == expectDied && sim.DeathRow == expectDeathRow
                    && sim.DistanceMm == expectDistance && sim.Collected.Count == expectPickups.Count;
                for (int i = 0; same && i < pickups; i++)
                {
                    same = sim.Collected[i].Row == expectPickups[i][0] && sim.Collected[i].Type == expectPickups[i][1];
                }
                if (!same)
                {
                    failures++;
                    Console.WriteLine($"FAIL run seed {seed}: got tick {sim.Tick} dead {sim.Dead} row {sim.DeathRow} distance {sim.DistanceMm} pickups {sim.Collected.Count}; "
                        + $"expected tick {expectEnd} dead {expectDied} row {expectDeathRow} distance {expectDistance} pickups {pickups}");
                }
            }
        }
        Console.WriteLine($"{checks - failures}/{checks} vectors match");
        return failures == 0 && checks > 0 ? 0 : 1;
    }
}
