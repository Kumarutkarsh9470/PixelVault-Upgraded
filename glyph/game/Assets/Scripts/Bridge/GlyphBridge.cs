using System.Runtime.InteropServices;
using UnityEngine;

/// Messages between the host page and Unity. The page calls these methods via
/// unityInstance.SendMessage("Bridge", method, value); Unity replies with
/// window events named "glyph:<type>".
public class GlyphBridge : MonoBehaviour
{
#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")]
    static extern void GF_Emit(string type, string json);
#else
    static void GF_Emit(string type, string json)
    {
        Debug.Log($"[bridge] {type} {json}");
    }
#endif

    public static void Emit(string type, object payload = null)
    {
        GF_Emit(type, payload == null ? "{}" : JsonUtility.ToJson(payload));
    }

    void Awake()
    {
        gameObject.name = "Bridge";
    }

    void Start()
    {
        Emit("ready");
    }

    /// Lays out the seed's level and waits at the start line for Go.
    public void StartRun(string json)
    {
        GlyphRoot.Instance.StartRun(JsonUtility.FromJson<StartPayload>(json));
    }

    public void Go(string unused)
    {
        GlyphRoot.Instance.Go();
    }

    /// The player quit: finish the run where it is.
    public void EndRun(string unused)
    {
        GlyphRoot.Instance.EndRun();
    }

    /// Back to the attract loop behind the menu.
    public void ShowMenu(string json)
    {
        GlyphRoot.Instance.ShowMenu(string.IsNullOrEmpty(json) ? null : JsonUtility.FromJson<CosmeticsPayload>(json));
    }

    public void SetCosmetics(string json)
    {
        GlyphRoot.Instance.SetCosmetics(JsonUtility.FromJson<CosmeticsPayload>(json));
    }

    /// On-screen buttons: "0" left, "1" right, "2" jump, "3" slide.
    public void Press(string action)
    {
        if (int.TryParse(action, out int value) && value >= RunnerSim.Left && value <= RunnerSim.Slide)
        {
            GlyphRoot.Instance.Press(value);
        }
    }

    public void SetBloom(string value)
    {
        GlyphRoot.Instance.SetBloom(value == "1" || value == "true");
    }
}
