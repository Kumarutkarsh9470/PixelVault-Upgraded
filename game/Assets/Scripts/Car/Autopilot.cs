using UnityEngine;

/// A driver that follows the centreline: steers at a point ahead that moves
/// further out with speed, and brakes for the tightest bend coming up. Used to
/// calibrate medal times and to record the rival ghost on every track.
[RequireComponent(typeof(CarController))]
public class Autopilot : MonoBehaviour
{
    public TrackPath Path;

    /// Sustained lateral grip the driver assumes, in m/s^2.
    public float CorneringGrip = 26f;

    CarController car;
    int nearest;

    void Awake()
    {
        car = GetComponent<CarController>();
    }

    public void Begin(TrackPath path, int startSample)
    {
        Path = path;
        nearest = startSample;
        car.UseExternalInput = true;
        car.AllowDrift = false;
    }

    public void End()
    {
        car.UseExternalInput = false;
        car.AllowDrift = true;
        car.ExternalSteer = 0f;
        car.ExternalBrake = false;
        Path = null;
    }

    void Update()
    {
        if (Path == null)
        {
            return;
        }
        Vector3 position = transform.position;

        int best = nearest;
        float bestDistance = float.MaxValue;
        for (int offset = -6; offset <= 20; offset++)
        {
            int i = Wrap(nearest + offset);
            float d = (Path.Positions[i] - position).sqrMagnitude;
            if (d < bestDistance)
            {
                bestDistance = d;
                best = i;
            }
        }
        nearest = best;

        float speed = car.Speed;
        float lookAhead = 8f + speed * 0.45f;
        Vector3 target = Path.Positions[Wrap(nearest + Mathf.RoundToInt(lookAhead / Path.Spacing))];
        Vector3 toTarget = target - position;
        toTarget.y = 0f;
        float angle = Vector3.SignedAngle(transform.forward, toTarget, Vector3.up);
        car.ExternalSteer = Mathf.Clamp(angle / 16f, -1f, 1f);

        // Slowest safe speed over the next stretch, from curvature: v = sqrt(a * r).
        float safe = car.BoostMaxSpeed;
        int horizon = Mathf.RoundToInt((20f + speed * 1.4f) / Path.Spacing);
        for (int s = 2; s < horizon; s += 2)
        {
            int a = Wrap(nearest + s);
            int b = Wrap(nearest + s + 3);
            float turn = Vector3.Angle(Path.Forwards[a], Path.Forwards[b]) * Mathf.Deg2Rad;
            if (turn < 1e-4f) continue;
            float radius = (3f * Path.Spacing) / turn;
            float v = Mathf.Sqrt(CorneringGrip * radius);
            // Allow for braking distance to that bend.
            float distance = s * Path.Spacing;
            float reachable = Mathf.Sqrt(v * v + 2f * car.BrakeDeceleration * 0.6f * distance);
            safe = Mathf.Min(safe, reachable);
        }
        car.ExternalBrake = speed > safe + 1.5f;
    }

    int Wrap(int i)
    {
        return ((i % Path.Count) + Path.Count) % Path.Count;
    }
}
