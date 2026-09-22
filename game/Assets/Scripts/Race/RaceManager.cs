using System;
using System.Collections.Generic;
using UnityEngine;

/// Timing, laps, checkpoint order, respawns and ghost recording for one race.
/// Checkpoint 0 is the start/finish line; the car spawns just behind it, so
/// the first crossing starts lap 1 and each later crossing (after every other
/// checkpoint in order) completes a lap.
public class RaceManager : MonoBehaviour
{
    public static RaceManager Instance { get; private set; }

    /// Raised in-process when a race finishes (used by calibration runs).
    public static event Action<RaceFinishedEvent> Finished;

    const float GhostInterval = 0.1f;
    const float HudInterval = 0.05f;

    public bool Racing { get; private set; }
    public int Lap { get; private set; }

    CarController car;
    CarVisuals visuals;
    CarEffects effects;
    GhostPlayer ghost;
    BuiltTrack track;
    string trackId;
    int laps;

    float raceTime;
    int nextCheckpoint;
    int lastCheckpoint;
    int respawns;
    readonly List<int> splits = new List<int>();
    readonly List<float> ghostSamples = new List<float>();
    float ghostTimer;
    float hudTimer;
    int nearestSample;
    float stuckTimer;

    void Awake()
    {
        Instance = this;
    }

    public void Prepare(BuiltTrack builtTrack, CarController raceCar, CarVisuals raceVisuals, GhostPlayer ghostPlayer, string id, int lapCount)
    {
        if (car != raceCar)
        {
            if (car != null)
            {
                car.Impact -= OnImpact;
                car.Boosted -= OnBoost;
                car.DriftStarted -= OnDriftStarted;
            }
            raceCar.Impact += OnImpact;
            raceCar.Boosted += OnBoost;
            raceCar.DriftStarted += OnDriftStarted;
        }
        track = builtTrack;
        car = raceCar;
        visuals = raceVisuals;
        effects = raceCar.GetComponent<CarEffects>();
        ghost = ghostPlayer;
        trackId = id;
        laps = Mathf.Max(1, lapCount);
        Racing = false;
        Lap = 0;
        raceTime = 0f;
        nextCheckpoint = 0;
        lastCheckpoint = 0;
        respawns = 0;
        nearestSample = (track.Path.Count - 4 + track.Path.Count) % track.Path.Count;
        splits.Clear();
        ghostSamples.Clear();
        car.ControlsEnabled = false;
        car.Teleport(track.SpawnPosition, track.SpawnRotation);
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

    public void OnCheckpoint(int index)
    {
        if (!Racing || index != nextCheckpoint)
        {
            return;
        }
        int timeMs = Mathf.RoundToInt(raceTime * 1000f);
        lastCheckpoint = index;

        if (index == 0)
        {
            Lap++;
            if (Lap > 1)
            {
                splits.Add(timeMs);
                WebBridge.Emit("lap", new CheckpointEvent { index = 0, lap = Lap - 1, timeMs = timeMs });
            }
            if (Lap > laps)
            {
                Finish(timeMs);
                return;
            }
        }
        else
        {
            splits.Add(timeMs);
            WebBridge.Emit("checkpoint", new CheckpointEvent { index = index, lap = Lap, timeMs = timeMs });
        }
        nextCheckpoint = (index + 1) % track.Checkpoints.Count;
    }

    void Update()
    {
        if (!Racing)
        {
            return;
        }
        raceTime += Time.deltaTime;

        ghostTimer += Time.deltaTime;
        if (ghostTimer >= GhostInterval)
        {
            ghostTimer -= GhostInterval;
            Transform t = car.transform;
            ghostSamples.Add(Mathf.Round(t.position.x * 100f) / 100f);
            ghostSamples.Add(Mathf.Round(t.position.y * 100f) / 100f);
            ghostSamples.Add(Mathf.Round(t.position.z * 100f) / 100f);
            ghostSamples.Add(Mathf.Round(t.eulerAngles.y * 10f) / 10f);
        }

        hudTimer += Time.deltaTime;
        if (hudTimer >= HudInterval)
        {
            hudTimer = 0f;
            Vector3 p = car.transform.position;
            bool ghostVisible = ghost != null && ghost.Visible;
            Vector3 g = ghostVisible ? ghost.transform.position : Vector3.zero;
            WebBridge.Emit("hud", new HudEvent
            {
                timeMs = Mathf.RoundToInt(raceTime * 1000f),
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

        CheckRecovery();
    }

    /// Puts the car back on the road at the last checkpoint if it is stuck,
    /// has somehow left the circuit, or the player asks to reset.
    void CheckRecovery()
    {
        TrackPath path = track.Path;
        Vector3 position = car.transform.position;

        // Track the nearest centreline sample by searching a window around the last one.
        int best = nearestSample;
        float bestDistance = float.MaxValue;
        for (int offset = -12; offset <= 12; offset++)
        {
            int i = ((nearestSample + offset) % path.Count + path.Count) % path.Count;
            float d = (path.Positions[i] - position).sqrMagnitude;
            if (d < bestDistance)
            {
                bestDistance = d;
                best = i;
            }
        }
        nearestSample = best;

        bool offCircuit = Mathf.Sqrt(bestDistance) > track.Width * 0.5f + 8f || position.y < -3f;
        stuckTimer = car.Speed < 1.5f ? stuckTimer + Time.deltaTime : 0f;
        if (offCircuit || stuckTimer > 2.5f || Input.GetKeyDown(KeyCode.R))
        {
            Respawn();
        }
    }

    public void Respawn()
    {
        int sample = track.CheckpointSamples[lastCheckpoint];
        if (lastCheckpoint == 0 && Lap <= 1)
        {
            car.Teleport(track.SpawnPosition, track.SpawnRotation);
        }
        else
        {
            TrackPath path = track.Path;
            car.Teleport(path.Positions[sample] + Vector3.up * 0.3f, Quaternion.LookRotation(path.Forwards[sample]));
            nearestSample = sample;
        }
        stuckTimer = 0f;
        respawns++;
        visuals.ClearTrails();
        if (effects != null) effects.ClearTrails();
        WebBridge.Emit("respawn");
    }

    void Finish(int timeMs)
    {
        Racing = false;
        car.ControlsEnabled = false;
        var result = new RaceFinishedEvent
        {
            trackId = trackId,
            totalMs = timeMs,
            laps = laps,
            respawns = respawns,
            splits = splits.ToArray(),
            ghost = new GhostPayload { interval = GhostInterval, samples = ghostSamples.ToArray() },
        };
        WebBridge.Emit("raceFinished", result);
        Finished?.Invoke(result);
    }
}
