using System;

/// Colours (hex) of what the player wears. Empty means none. Frames and auras
/// are Glyph Forge items; trail and underglow are Neon Racer items the page
/// found in the player's wallet.
[Serializable]
public class CosmeticsPayload
{
    public string frame = "";
    public string aura = "";
    public string trail = "";
    public string underglow = "";
}

[Serializable]
public class StartPayload
{
    /// Decimal uint32, as issued by /api/glyph/start.
    public string seed;
    public CosmeticsPayload cosmetics = new CosmeticsPayload();
}

[Serializable]
public class HudEvent
{
    public int tick;
    public int distanceMm;
    public int speedMmPerSecond;
    public int ember;
    public int tide;
    public int storm;
}

[Serializable]
public class RuneEvent
{
    public int type;
    public int row;
}

[Serializable]
public class ActionEvent
{
    public int action;
}

/// Everything the server needs to replay the run. Inputs are flattened
/// (tick, action) pairs because JsonUtility cannot write nested arrays.
[Serializable]
public class FinishedEvent
{
    public int[] inputs;
    public int endTick;
    public bool died;
    public int distanceMm;
    public int ember;
    public int tide;
    public int storm;
}

[Serializable]
public class QualityEvent
{
    public bool bloom;
    public int fps;
}
