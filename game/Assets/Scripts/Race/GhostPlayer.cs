using UnityEngine;

/// Replays a recorded run as a translucent car, interpolating between samples.
/// Hidden until the race starts, so it never overlaps the player's car on the menu.
public class GhostPlayer : MonoBehaviour
{
    GhostPayload ghost;
    float time;
    bool playing;
    GameObject model;

    public bool HasGhost => ghost != null && ghost.samples != null && ghost.samples.Length >= 8;
    public bool Visible => playing && model != null && model.activeSelf;

    public void Load(GhostPayload payload, LoadoutPayload loadout)
    {
        ghost = payload;
        playing = false;
        time = 0f;
        if (model != null)
        {
            Destroy(model);
            model = null;
        }
        if (!HasGhost)
        {
            return;
        }

        model = Props.Spawn("CarKit/" + (string.IsNullOrEmpty(loadout?.chassis) ? "race" : loadout.chassis), transform, CarVisuals.CarLength, Props.Axis.Z);
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
        model.SetActive(false);
        Pose(0f);
    }

    public void Play()
    {
        if (!HasGhost)
        {
            return;
        }
        playing = true;
        time = 0f;
        model.SetActive(true);
    }

    public void Stop()
    {
        playing = false;
        if (model != null) model.SetActive(false);
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
            // Finished its run: fade out rather than sit on the finish line.
            Stop();
        }
    }
}
