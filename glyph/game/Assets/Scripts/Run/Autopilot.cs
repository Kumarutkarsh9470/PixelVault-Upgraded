/// Plays the level behind the menu: picks a survivable lane for the next
/// obstacle row, preferring nearby lanes with runes, and jumps or slides just
/// in time. Mirrors the server tests' bot (deploy/racer/test/glyph-bot.mjs).
public static class Autopilot
{
    /// The input to apply this tick, or -1 for none.
    public static int Decide(RunnerSim sim)
    {
        int row = sim.NextRow;
        if (row + 2 >= sim.RowCount) return -1;
        int current = sim.PendingLane >= 0 ? sim.PendingLane : sim.Lane;
        int target = ChooseLane(sim, row, current);
        if (target != current && sim.PendingLane < 0) return target < current ? RunnerSim.Left : RunnerSim.Right;
        if (sim.PendingLane >= 0) return -1;

        byte cell = sim.Cell(row, sim.Lane);
        int speed = RunnerSim.SpeedAt(sim.Tick);
        int ticksToRow = ((row + 1) * RunnerSim.RowMm - sim.DistanceMm + speed - 1) / speed;
        bool free = sim.Tick >= sim.AirUntil && sim.Tick >= sim.SlideUntil;
        if (!free || ticksToRow > 12) return -1;
        if (cell == RunnerSim.Low) return RunnerSim.Jump;
        if (cell == RunnerSim.High) return RunnerSim.Slide;
        return -1;
    }

    static int ChooseLane(RunnerSim sim, int row, int current)
    {
        int obstacleRow = row % 2 == 1 ? row : row + 1;
        int best = current;
        int bestScore = int.MaxValue;
        for (int lane = 0; lane < 3; lane++)
        {
            if (sim.Cell(obstacleRow, lane) == RunnerSim.Wall) continue;
            int score = System.Math.Abs(lane - current) * 2;
            if (sim.Cell(obstacleRow + 1, lane) >= RunnerSim.Ember) score--;
            if (row % 2 == 0 && sim.Cell(row, lane) >= RunnerSim.Ember) score--;
            if (score < bestScore)
            {
                bestScore = score;
                best = lane;
            }
        }
        return best;
    }
}
