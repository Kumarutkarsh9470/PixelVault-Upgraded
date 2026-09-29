using System;
using System.Collections.Generic;
using UnityEngine;

/// Runs one race and reports it.
///
/// Nothing here measures time: the simulation counts its own steps, and a step
/// is exactly a sixtieth of a second. The finish time the player sees is the
/// same number the Solana program derives when it replays the trace, so the
/// HUD and the leaderboard can never disagree.
public class RaceManager : MonoBehaviour
{
    public static RaceManager Instance { get; private set; }

    /// Raised in-process when a race finishes (used by calibration runs).
    public static event Action<RaceFinishedEvent> Finished;

    const float HudInterval = 0.05f;

    public bool Racing { get; private set; }
    public int Lap { get; private set; }

    CarController car;
    CarVisuals visuals;
    CarEffects effects;
    GhostPlayer ghost;
    SimTrack track;
    string trackId;
    int laps;
    int checkpointsPerLap;

    readonly List<int> splits = new List<int>();
    float hudTimer;

    void Awake()
    {
        Instance = this;
    }

    public void Prepare(SimTrack simTrack, CarController raceCar, CarVisuals raceVisuals, GhostPlayer ghostPlayer, string id, int lapCount)
    {
        if (car != raceCar)
        {
            if (car != null)
            {
                car.Impact -= OnImpact;
                car.Boosted -= OnBoost;
                car.DriftStarted -= OnDriftStarted;
                car.Checkpoint -= OnCheckpoint;
            }
            raceCar.Impact += OnImpact;
            raceCar.Boosted += OnBoost;
            raceCar.DriftStarted += OnDriftStarted;
            raceCar.Checkpoint += OnCheckpoint;
        }
        track = simTrack;
        car = raceCar;
        visuals = raceVisuals;
        effects = raceCar.GetComponent<CarEffects>();
        ghost = ghostPlayer;
        trackId = id;
        laps = Mathf.Max(1, lapCount);
        checkpointsPerLap = track != null ? track.Checkpoints.Length : 1;
        Racing = false;
        Lap = 0;
        splits.Clear();
        car.ControlsEnabled = false;
        car.Reset();
        visuals.ClearTrails();
        if (effects != null) effects.ClearTrails();
    }

    public void Begin()
    {
        if (track == null || Racing)
        {
            return;
        }
        Racing = true;
        Lap = 1;
        splits.Clear();
        car.Reset();
        car.BeginRecording();
        car.ControlsEnabled = true;
        WebBridge.Emit("raceStarted");
    }

    void OnImpact(float strength)
    {
        if (Racing) WebBridge.Emit("impact", new ImpactEvent { strength = strength });
    }

    void OnBoost()
    {
        if (Racing) WebBridge.Emit("boost");
    }

    void OnDriftStarted()
    {
        if (Racing) WebBridge.Emit("drift");
    }

    /// The simulation crossed a checkpoint. Crossing the start line completes a
    /// lap, and the last one ends the race.
    void OnCheckpoint(int index, int steps)
    {
        if (!Racing)
        {
            return;
        }
        // The very first crossing is the start line as the race begins, which
        // is not a split: the server counts one per checkpoint per lap.
        if (car.Crossings > 1)
        {
            splits.Add(Milliseconds(steps));
        }

        if (index == 0)
        {
            // The first crossing starts lap one; later ones complete a lap.
            int completed = car.Crossings / checkpointsPerLap;
            if (completed >= 1)
            {
                WebBridge.Emit("lap", new CheckpointEvent { index = 0, lap = completed, timeMs = Milliseconds(steps) });
            }
            if (completed >= laps)
            {
                Finish(steps);
                return;
            }
            Lap = Mathf.Clamp(completed + 1, 1, laps);
        }
        else
        {
            WebBridge.Emit("checkpoint", new CheckpointEvent { index = index, lap = Lap, timeMs = Milliseconds(steps) });
        }
    }

    void Update()
    {
        if (!Racing)
        {
            return;
        }
        hudTimer += Time.deltaTime;
        if (hudTimer < HudInterval)
        {
            return;
        }
        hudTimer = 0f;

        Vector3 p = car.transform.position;
        bool ghostVisible = ghost != null && ghost.Visible;
        Vector3 g = ghostVisible ? ghost.transform.position : Vector3.zero;
        WebBridge.Emit("hud", new HudEvent
        {
            timeMs = Milliseconds(car.Steps),
            lap = Mathf.Clamp(Lap, 1, laps),
            laps = laps,
            speedKmh = Mathf.RoundToInt(car.SpeedKmh),
            x = p.x,
            z = p.z,
            gx = g.x,
            gz = g.z,
            ghost = ghostVisible,
            drift = car.Drifting,
            charge = Mathf.RoundToInt(car.DriftCharge * 100f),
            boost = car.Boosting,
        });
    }

    /// Steps into milliseconds. A step is a sixtieth of a second, exactly as
    /// the program counts it.
    public static int Milliseconds(int steps)
    {
        return (int)((long)steps * 1000 / CarSim.StepsPerSecond);
    }

    void Finish(int steps)
    {
        Racing = false;
        car.ControlsEnabled = false;
        car.StopRecording();
        byte[] trace = car.Trace();

        var result = new RaceFinishedEvent
        {
            trackId = trackId,
            totalMs = Milliseconds(steps),
            steps = steps,
            laps = laps,
            splits = splits.ToArray(),
            // The whole run, for the chain to replay and for others to race.
            trace = Convert.ToBase64String(trace),
        };
        WebBridge.Emit("raceFinished", result);
        Finished?.Invoke(result);
    }
}
