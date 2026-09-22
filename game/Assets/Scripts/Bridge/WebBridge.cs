using System.Runtime.InteropServices;
using UnityEngine;

/// Messages between the host page and Unity. The page calls these methods via
/// unityInstance.SendMessage("Bridge", method, json); Unity replies with
/// window events named "pixelvault:<type>".
public class WebBridge : MonoBehaviour
{
#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")]
    static extern void PV_Emit(string type, string json);
#else
    static void PV_Emit(string type, string json)
    {
        Debug.Log($"[bridge] {type} {json}");
    }
#endif

    public static void Emit(string type, object payload = null)
    {
        PV_Emit(type, payload == null ? "{}" : JsonUtility.ToJson(payload));
    }

    void Awake()
    {
        gameObject.name = "Bridge";
    }

    void Start()
    {
        Emit("ready");
    }

    public void LoadTrack(string json)
    {
        GameRoot.Instance.LoadTrack(JsonUtility.FromJson<TrackPayload>(json));
    }

    public void ReadyRace(string unused)
    {
        GameRoot.Instance.ReadyRace();
    }

    public void StartRace(string unused)
    {
        GameRoot.Instance.StartRace();
    }

    public void ShowGarage(string json)
    {
        GameRoot.Instance.ShowGarage(JsonUtility.FromJson<LoadoutPayload>(json));
    }

    public void SetLoadout(string json)
    {
        GameRoot.Instance.SetLoadout(JsonUtility.FromJson<LoadoutPayload>(json));
    }

    public void ShowMenu(string unused)
    {
        GameRoot.Instance.ShowMenu();
    }
}
