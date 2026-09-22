using UnityEngine;

/// Replays a recorded run as a translucent car, interpolating between samples.
public class GhostPlayer : MonoBehaviour
{
    GhostPayload ghost;
    float time;
    bool playing;

    public void Load(GhostPayload payload, LoadoutPayload loadout)
    {
        ghost = payload;
        playing = false;
        time = 0f;
        gameObject.SetActive(payload != null && payload.samples != null && payload.samples.Length >= 8);
        if (!gameObject.activeSelf)
        {
            return;
        }

        foreach (Transform child in transform)
        {
            Destroy(child.gameObject);
        }
        GameObject model = Props.Spawn("CarKit/" + (string.IsNullOrEmpty(loadout?.chassis) ? "race" : loadout.chassis), transform, CarVisuals.CarLength, Props.Axis.Z);
        foreach (var c in model.GetComponentsInChildren<Collider>())
        {
            Destroy(c);
        }
        Material mat = Mats.Ghost();
        foreach (var r in model.GetComponentsInChildren<Renderer>())
        {
            var shared = new Material[r.sharedMaterials.Length];
            for (int i = 0; i < shared.Length; i++)
            {
                shared[i] = mat;
            }
            r.sharedMaterials = shared;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        }
        Pose(0f);
    }

    public void Play()
    {
        playing = gameObject.activeSelf;
        time = 0f;
    }

    void Update()
    {
        if (!playing)
        {
            return;
        }
        time += Time.deltaTime;
        Pose(time);
    }

    void Pose(float t)
    {
        int count = ghost.samples.Length / 4;
        float f = t / ghost.interval;
        int i = Mathf.Clamp(Mathf.FloorToInt(f), 0, count - 1);
        int j = Mathf.Min(i + 1, count - 1);
        float blend = Mathf.Clamp01(f - i);

        Vector3 a = new Vector3(ghost.samples[i * 4], ghost.samples[i * 4 + 1], ghost.samples[i * 4 + 2]);
        Vector3 b = new Vector3(ghost.samples[j * 4], ghost.samples[j * 4 + 1], ghost.samples[j * 4 + 2]);
        float yaw = Mathf.LerpAngle(ghost.samples[i * 4 + 3], ghost.samples[j * 4 + 3], blend);
        transform.SetPositionAndRotation(Vector3.Lerp(a, b, blend), Quaternion.Euler(0f, yaw, 0f));
        if (i >= count - 1)
        {
            playing = false;
        }
    }
}
