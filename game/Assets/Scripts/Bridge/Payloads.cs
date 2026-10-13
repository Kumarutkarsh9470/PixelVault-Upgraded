using System;

// JSON contracts between the page and Unity. JsonUtility cannot read nested
// arrays, so point lists are flat: [x0, z0, x1, z1, ...].

[Serializable]
public class TrackPayload
{
    public string id = "neon-harbor";
    public string name = "Neon Harbor";
    public int laps = 2;
    public float width = 14f;
    public float[] points;
    public ThemePayload theme = new ThemePayload();
    /// The circuit the simulation runs on, shared with the chain.
    public CircuitPayload circuit;
    /// The opponent's run, as a base64 input trace.
    public string ghostTrace;
    public LoadoutPayload loadout = new LoadoutPayload();
}

/// A circuit exactly as the Solana program stores it: the centreline in fixed
/// point, its checkpoints and its boost pads. Built by tools/build-circuits.mjs
/// and never derived again, so the game and the chain race the same corners.
[Serializable]
public class CircuitPayload
{
    public int laps;
    public int spacing;
    public int wallOffset;
    public int startSample;
    /// A whole turn is 2^32, so this does not fit in a signed int.
    public long startHeading;
    public int sampleCount;
    /// Four values per sample: x, z, forward x, forward z.
    public int[] samples;
    public int[] checkpoints;
    public int[] padSamples;
    public int[] padLaterals;
}

[Serializable]
public class ThemePayload
{
    public string sky = "#070b17";
    public string fog = "#0b1226";
    public float fogDensity = 0.004f;
    public string ground = "#0d1322";
    public string road = "#1b2131";
    public string line = "#e8f1ff";
    public string curbA = "#ff3d8b";
    public string curbB = "#f5f7ff";
    public string accent = "#22d3ee";
    public string ambient = "#33416a";
    public string sun = "#9fb4ff";
    public float sunIntensity = 0.55f;
    public string scenery = "city";
}

[Serializable]
public class LoadoutPayload
{
    public string chassis = "race";
    public string underglow = "";
    public string trail = "";
}

[Serializable]
public class TrackLoadedEvent
{
    public string id;
    public float lengthMeters;
    public int laps;
    public int checkpoints;
    /// False when the page sent no circuit: the track is playable but its runs
    /// cannot be verified on-chain.
    public bool verifiable;
}

[Serializable]
public class HudEvent
{
    public int timeMs;
    public int lap;
    public int laps;
    public int speedKmh;
    /// Car and ghost positions on the ground plane, for the minimap.
    public float x;
    public float z;
    public float gx;
    public float gz;
    public bool ghost;
    public bool drift;
    /// Drift boost charge, 0-100.
    public int charge;
    public bool boost;
}

[Serializable]
public class ImpactEvent
{
    public float strength;
}

[Serializable]
public class QualityEvent
{
    public bool bloom;
    public int fps;
}

[Serializable]
public class TrackList
{
    public TrackPayload[] tracks;
}

[Serializable]
public class CheckpointEvent
{
    public int index;
    public int lap;
    public int timeMs;
}

[Serializable]
public class RaceFinishedEvent
{
    public string trackId;
    public int totalMs;
    /// Simulation steps, which is the time the chain will derive.
    public int steps;
    public int laps;
    /// Race time in ms at each checkpoint crossing, in order.
    public int[] splits;
    /// The inputs that produced this run, base64 encoded. This is what gets
    /// verified on-chain, and what other players race against.
    public string trace;
}
