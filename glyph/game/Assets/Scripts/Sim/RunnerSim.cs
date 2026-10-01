using System;
using System.Collections.Generic;

/// Glyph Forge run rules: the level a seed produces, and what inputs do on it.
/// A line-for-line port of deploy/racer/api/glyph/_lib/runner.js, which the
/// server uses to replay every run. Integer-only and tick-based so both sides
/// agree exactly; glyph/level/vectors.txt pins them together. No UnityEngine
/// here, so it also compiles and runs outside Unity (tools/glyph-verify.sh).
public sealed class RunnerSim
{
    public const int TickHz = 60;
    /// Distance between rows. Row r sits at (r + 1) * RowMm.
    public const int RowMm = 8000;
    public const int SafeRows = 6;
    public const int RowsPerTier = 40;
    public const int MaxTier = 4;
    /// Forward speed in millimetres per tick: 12 m/s rising to 28 m/s.
    public const int V0Mm = 200;
    public const int VMaxMm = 467;
    public const int AccelEvery = 24;
    public const int LaneDelay = 4;
    public const int JumpTicks = 30;
    public const int SlideTicks = 30;
    public const int MaxTicks = 36000;

    public const byte Empty = 0, Wall = 1, Low = 2, High = 3, Ember = 4, Tide = 5, Storm = 6;
    public const int Left = 0, Right = 1, Jump = 2, Slide = 3;

    const byte W = Wall, L = Low, H = High, _ = Empty;
    static readonly byte[][] Patterns =
    {
        new[] { W, _, _ }, new[] { _, W, _ }, new[] { _, _, W }, new[] { L, _, _ }, new[] { _, L, _ }, new[] { _, _, L },
        new[] { W, W, _ }, new[] { _, W, W }, new[] { W, _, W }, new[] { L, L, L }, new[] { H, _, _ }, new[] { _, H, _ }, new[] { _, _, H },
        new[] { H, H, H }, new[] { W, L, W }, new[] { W, H, W }, new[] { L, W, L },
        new[] { L, H, W }, new[] { W, H, L }, new[] { H, W, L }, new[] { L, W, H },
        new[] { W, W, L }, new[] { L, W, W }, new[] { W, W, H }, new[] { H, W, W },
    };
    static readonly int[] PatternCounts = { 6, 13, 17, 21, 25 };

    /// mulberry32, matching the JavaScript version bit for bit.
    public sealed class Random
    {
        uint state;
        public Random(uint seed) { state = seed; }

        public uint Next()
        {
            unchecked
            {
                state += 0x6D2B79F5u;
                uint t = state;
                t = (t ^ (t >> 15)) * (t | 1u);
                t ^= t + (t ^ (t >> 7)) * (t | 61u);
                return t ^ (t >> 14);
            }
        }
    }

    public static byte[] GenerateRows(uint seed, int count)
    {
        var random = new Random(seed);
        var cells = new byte[count * 3];
        int runLane = 0, runLeft = 0;
        byte runType = Ember;
        for (int r = SafeRows; r < count; r++)
        {
            int tier = Math.Min(MaxTier, (r - SafeRows) / RowsPerTier);
            int b = r * 3;
            if ((r & 1) == 1)
            {
                if (random.Next() % 100 < (uint)(45 + tier * 10))
                {
                    byte[] pattern = Patterns[random.Next() % (uint)PatternCounts[tier]];
                    cells[b] = pattern[0];
                    cells[b + 1] = pattern[1];
                    cells[b + 2] = pattern[2];
                }
            }
            else
            {
                if (runLeft == 0 && random.Next() % 100 < 40)
                {
                    runLane = (int)(random.Next() % 3);
                    runLeft = 3 + (int)(random.Next() % 4);
                    uint roll = random.Next() % 100;
                    uint storm = (uint)(10 + tier * 5);
                    runType = roll < storm ? Storm : roll < storm + 35 ? Tide : Ember;
                }
                if (runLeft > 0)
                {
                    cells[b + runLane] = runType;
                    runLeft--;
                }
            }
        }
        return cells;
    }

    public static int SpeedAt(int tick) => Math.Min(VMaxMm, V0Mm + tick / AccelEvery);

    public static int RowsFor(int ticks) => ticks * VMaxMm / RowMm + 2;

    public struct Pickup
    {
        public int Row;
        public byte Type;
    }

    readonly byte[] rows;
    public int Tick { get; private set; }
    public int Lane { get; private set; } = 1;
    public int PendingLane { get; private set; } = -1;
    int pendingAt;
    public int AirUntil { get; private set; }
    public int SlideUntil { get; private set; }
    public int DistanceMm { get; private set; }
    public int NextRow { get; private set; }
    public bool Dead { get; private set; }
    public int DeathRow { get; private set; } = -1;
    public readonly List<Pickup> Collected = new List<Pickup>();

    public RunnerSim(uint seed, int maxTicks = MaxTicks)
    {
        rows = GenerateRows(seed, RowsFor(maxTicks));
    }

    public int RowCount => rows.Length / 3;

    public byte Cell(int row, int lane) => rows[row * 3 + lane];

    public bool Airborne => Tick < AirUntil;
    public bool Sliding => Tick < SlideUntil;

    /// Applies an input at the current tick, before Step().
    public void Input(int action)
    {
        int tick = Tick;
        if (action == Left || action == Right)
        {
            int target = (PendingLane >= 0 ? PendingLane : Lane) + (action == Left ? -1 : 1);
            if (target >= 0 && target <= 2)
            {
                PendingLane = target;
                pendingAt = tick + LaneDelay;
            }
        }
        else if (tick >= AirUntil && tick >= SlideUntil)
        {
            if (action == Jump) AirUntil = tick + JumpTicks;
            else if (action == Slide) SlideUntil = tick + SlideTicks;
        }
    }

    /// Advances one tick: settles lane changes, moves forward, resolves every row crossed.
    public void Step()
    {
        if (Dead) return;
        int tick = Tick;
        if (PendingLane >= 0 && tick >= pendingAt)
        {
            Lane = PendingLane;
            PendingLane = -1;
        }
        DistanceMm += SpeedAt(tick);
        Tick = tick + 1;
        while ((NextRow + 1) * RowMm <= DistanceMm)
        {
            byte cell = Cell(NextRow, Lane);
            bool blocked = cell == Wall || (cell == Low && tick >= AirUntil) || (cell == High && tick >= SlideUntil);
            if (blocked)
            {
                Dead = true;
                DeathRow = NextRow;
                return;
            }
            if (cell >= Ember) Collected.Add(new Pickup { Row = NextRow, Type = cell });
            NextRow++;
        }
    }

    /// Replays (tick, action) inputs for at most endTick ticks, as the server does.
    public static RunnerSim Simulate(uint seed, IList<int[]> inputs, int endTick)
    {
        var sim = new RunnerSim(seed, endTick);
        int i = 0;
        while (sim.Tick < endTick && !sim.Dead)
        {
            while (i < inputs.Count && inputs[i][0] == sim.Tick) sim.Input(inputs[i++][1]);
            sim.Step();
        }
        return sim;
    }
}
