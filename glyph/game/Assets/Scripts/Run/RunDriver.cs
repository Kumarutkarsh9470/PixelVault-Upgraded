using System;
using System.Collections.Generic;
using UnityEngine;

/// Advances the run one RunnerSim tick per FixedUpdate (60 Hz), applying at
/// most one input per tick and recording every input that changed something.
/// That record is what the server replays, so nothing visual may feed back
/// into the simulation.
public class RunDriver : MonoBehaviour
{
    public enum Mode { Idle, Waiting, Running, Finished, Attract }

    const int HudEveryTicks = 6;

    public RunnerSim Sim { get; private set; }
    public Mode State { get; private set; } = Mode.Idle;
    public int PreviousDistanceMm { get; private set; }

    /// An input the simulation accepted, at the tick it applied.
    public event Action<int> ActionApplied;
    public event Action<RunnerSim.Pickup> RunePicked;
    public event Action Died;
    public event Action<FinishedEvent> Finished;

    readonly Queue<int> pending = new Queue<int>();
    readonly List<int> recorded = new List<int>();
    readonly int[] runes = new int[7];
    int seenPickups;

    /// Lays out a level and holds at the start line until Go().
    public void Prepare(uint seed)
    {
        Sim = new RunnerSim(seed);
        State = Mode.Waiting;
        Reset();
    }

    public void Go()
    {
        if (State == Mode.Waiting) State = Mode.Running;
    }

    /// Runs a level by itself behind the menu.
    public void Attract(uint seed)
    {
        Sim = new RunnerSim(seed);
        State = Mode.Attract;
        Reset();
    }

    void Reset()
    {
        pending.Clear();
        recorded.Clear();
        Array.Clear(runes, 0, runes.Length);
        seenPickups = 0;
        PreviousDistanceMm = 0;
    }

    public void Press(int action)
    {
        if (State == Mode.Running && pending.Count < 4) pending.Enqueue(action);
    }

    /// The player quit mid-run: finish where the simulation is.
    public void Quit()
    {
        if (State == Mode.Running) Finish(false);
    }

    void FixedUpdate()
    {
        if (Sim == null || (State != Mode.Running && State != Mode.Attract)) return;

        int action = State == Mode.Attract ? Autopilot.Decide(Sim) : (pending.Count > 0 ? pending.Dequeue() : -1);
        if (action >= 0)
        {
            int tick = Sim.Tick;
            if (Sim.Input(action))
            {
                if (State == Mode.Running)
                {
                    recorded.Add(tick);
                    recorded.Add(action);
                }
                ActionApplied?.Invoke(action);
            }
        }

        PreviousDistanceMm = Sim.DistanceMm;
        Sim.Step();

        while (seenPickups < Sim.Collected.Count)
        {
            RunnerSim.Pickup pickup = Sim.Collected[seenPickups++];
            runes[pickup.Type]++;
            RunePicked?.Invoke(pickup);
            if (State == Mode.Running) GlyphBridge.Emit("rune", new RuneEvent { type = pickup.Type, row = pickup.Row });
        }

        if (Sim.Dead)
        {
            Died?.Invoke();
            if (State == Mode.Running) Finish(true);
            else State = Mode.Finished;
            return;
        }
        if (State == Mode.Running)
        {
            if (Sim.Tick >= RunnerSim.MaxTicks) Finish(false);
            else if (Sim.Tick % HudEveryTicks == 0) EmitHud();
        }
    }

    void EmitHud()
    {
        GlyphBridge.Emit("hud", new HudEvent
        {
            tick = Sim.Tick,
            distanceMm = Sim.DistanceMm,
            speedMmPerSecond = RunnerSim.SpeedAt(Sim.Tick) * RunnerSim.TickHz,
            ember = runes[RunnerSim.Ember],
            tide = runes[RunnerSim.Tide],
            storm = runes[RunnerSim.Storm],
        });
    }

    void Finish(bool died)
    {
        State = Mode.Finished;
        EmitHud();
        var result = new FinishedEvent
        {
            inputs = recorded.ToArray(),
            endTick = Sim.Tick,
            died = died,
            distanceMm = Sim.DistanceMm,
            ember = runes[RunnerSim.Ember],
            tide = runes[RunnerSim.Tide],
            storm = runes[RunnerSim.Storm],
        };
        GlyphBridge.Emit("finished", result);
        Finished?.Invoke(result);
    }

    /// Distance to draw this frame, interpolated between the last two ticks.
    public float VisualDistanceMeters()
    {
        if (Sim == null) return 0f;
        float alpha = State == Mode.Running || State == Mode.Attract
            ? Mathf.Clamp01((Time.time - Time.fixedTime) / Time.fixedDeltaTime)
            : 1f;
        return Mathf.Lerp(PreviousDistanceMm, Sim.DistanceMm, alpha) / 1000f;
    }
}
