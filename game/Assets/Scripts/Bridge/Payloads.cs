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
    public GhostPayload ghost;
    public LoadoutPayload loadout = new LoadoutPayload();
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
    public float grip = 1f;
    public string scenery = "city";
}

[Serializable]
public class GhostPayload
{
    public float interval;
    /// Flat samples: x, y, z, yaw per sample.
    public float[] samples;
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
    public int laps;
    public int respawns;
    /// Race time in ms at each checkpoint crossing, in order, for server-side plausibility checks.
    public int[] splits;
    public GhostPayload ghost;
}
