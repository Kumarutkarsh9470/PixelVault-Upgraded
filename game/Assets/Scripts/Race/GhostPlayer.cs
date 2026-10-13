using System.Collections.Generic;
using UnityEngine;

/// Races an opponent's recorded run alongside the player.
///
/// A ghost is the opponent's inputs, not a list of positions: the same
/// simulation is stepped with them, so what you chase is exactly the run the
/// chain verified, in a few hundred bytes rather than a few thousand.
public class GhostPlayer : MonoBehaviour
{
    SimTrack track;
    List<SimInput> inputs;
    CarSim car;
    int step;
    bool playing;
    GameObject model;

    Vector3 previousPosition;
    Vector3 currentPosition;
    float previousYaw;
    float currentYaw;

    public bool HasGhost => inputs != null && inputs.Count > 0;
    public bool Visible => playing && model != null && model.activeSelf;
    /// The ghost's finish time so far, in steps, for live split comparisons.
    public int Steps => step;

    public void Load(SimTrack simTrack, byte[] trace, LoadoutPayload loadout)
    {
        track = simTrack;
        inputs = trace != null && trace.Length >= 2 ? TraceCodec.Decode(trace) : null;
        playing = false;
        step = 0;
        if (model != null)
        {
            Destroy(model);
            model = null;
        }
        if (!HasGhost || track == null)
        {
            return;
        }

        car = CarSim.Spawn(track);
        previousPosition = currentPosition = Position();
        previousYaw = currentYaw = Yaw();

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
        Place(1f);
    }

    public void Play()
    {
        if (!HasGhost)
        {
            return;
        }
        car = CarSim.Spawn(track);
        step = 0;
        playing = true;
        model.SetActive(true);
        previousPosition = currentPosition = Position();
        previousYaw = currentYaw = Yaw();
    }

    public void Stop()
    {
        playing = false;
        if (model != null) model.SetActive(false);
    }

    /// Stepped in lockstep with the player, so both cars see the same clock.
    void FixedUpdate()
    {
        if (!playing)
        {
            return;
        }
        if (step >= inputs.Count)
        {
            // Its run is over: the ghost leaves rather than parking on the line.
            Stop();
            return;
        }
        previousPosition = currentPosition;
        previousYaw = currentYaw;
        car.Step(track, inputs[step]);
        step++;
        currentPosition = Position();
        currentYaw = Yaw();
    }

    void Update()
    {
        if (playing)
        {
            Place(Mathf.Clamp01((Time.time - Time.fixedTime) / Time.fixedDeltaTime));
        }
    }

    void Place(float blend)
    {
        transform.SetPositionAndRotation(
            Vector3.Lerp(previousPosition, currentPosition, blend),
            Quaternion.Euler(0f, Mathf.LerpAngle(previousYaw, currentYaw, blend), 0f));
    }

    Vector3 Position()
    {
        return new Vector3(FixedMath.ToFloat(car.X), 0.3f, FixedMath.ToFloat(car.Z));
    }

    float Yaw()
    {
        return car.Heading / 4294967296f * 360f;
    }
}
