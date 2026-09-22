using System;
using UnityEngine;

/// Arcade handling built for thumbs. The car accelerates on its own; the
/// player steers with the left and right halves of the screen (or A/D and
/// arrows). Holding one side and adding the other thumb drifts towards the
/// first side: the drift scrubs speed and charges a boost that fires on
/// release. Walls cost time. Steering tightens less at speed, so tight corners
/// need a lift or a drift rather than full throttle.
[RequireComponent(typeof(Rigidbody))]
public class CarController : MonoBehaviour
{
    public float MaxSpeed = 50f;
    public float BoostMaxSpeed = 62f;
    public float Acceleration = 20f;
    public float BoostAcceleration = 36f;
    public float BrakeDeceleration = 30f;
    public float LowSpeedYaw = 125f;
    public float HighSpeedYaw = 46f;
    public float DriftYaw = 92f;
    public float DriftScrub = 5f;
    public float Grip = 9f;
    public float DriftGrip = 1.7f;
    public float GripMultiplier = 1f;

    /// Set by the page for tilt steering (-1..1).
    public static bool TiltEnabled;
    public static float TiltSteer;

    /// Autopilot and calibration drive through these instead of the screen.
    public bool UseExternalInput;
    public float ExternalSteer;
    public bool ExternalBrake;
    /// The autopilot brakes plainly; braking while steering would otherwise drift.
    public bool AllowDrift = true;

    public bool ControlsEnabled { get; set; }
    public bool Drifting { get; private set; }
    public float DriftCharge { get; private set; }
    public bool Boosting => boostTime > 0f;
    public float Speed => new Vector3(body.linearVelocity.x, 0f, body.linearVelocity.z).magnitude;
    public float SpeedKmh => Speed * 3.6f;

    public event Action<float> Impact;
    public event Action Boosted;
    public event Action DriftStarted;

    Rigidbody body;
    float steer;
    bool braking;
    float boostTime;
    int firstSide;

    void Awake()
    {
        body = GetComponent<Rigidbody>();
        body.mass = 1000f;
        body.linearDamping = 0.05f;
        body.angularDamping = 6f;
        body.interpolation = RigidbodyInterpolation.Interpolate;
        body.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
        // Tracks are flat, so keeping the car upright removes every flip-over edge case.
        body.constraints = RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationZ;
    }

    void Update()
    {
        float targetSteer;
        if (UseExternalInput)
        {
            targetSteer = ExternalSteer;
            braking = ExternalBrake;
        }
        else
        {
            ReadPlayerInput(out targetSteer, out braking);
        }
        steer = Mathf.MoveTowards(steer, Mathf.Clamp(targetSteer, -1f, 1f), 7f * Time.deltaTime);
    }

    void ReadPlayerInput(out float targetSteer, out bool brake)
    {
        targetSteer = Input.GetAxisRaw("Horizontal");
        brake = Input.GetKey(KeyCode.Space) || Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow);

        bool left = false;
        bool right = false;
        for (int i = 0; i < Input.touchCount; i++)
        {
            Touch touch = Input.GetTouch(i);
            if (touch.phase == TouchPhase.Ended || touch.phase == TouchPhase.Canceled)
            {
                continue;
            }
            if (touch.position.x < Screen.width * 0.5f)
            {
                left = true;
            }
            else
            {
                right = true;
            }
        }
        if (Input.touchCount == 0 && Input.GetMouseButton(0))
        {
            left = Input.mousePosition.x < Screen.width * 0.5f;
            right = !left;
        }

        if (TiltEnabled)
        {
            // Tilt steers; any touch brakes, which at speed becomes a drift.
            targetSteer = TiltSteer;
            brake |= left || right;
            return;
        }

        // Remember which side went down first: adding the other thumb drifts that way.
        if (left && !right)
        {
            firstSide = -1;
        }
        else if (right && !left)
        {
            firstSide = 1;
        }
        else if (!left && !right)
        {
            firstSide = 0;
        }

        if (left && right)
        {
            brake = true;
            targetSteer = firstSide;
        }
        else if (left)
        {
            targetSteer = -1f;
        }
        else if (right)
        {
            targetSteer = 1f;
        }
    }

    void FixedUpdate()
    {
        Vector3 velocity = body.linearVelocity;
        Vector3 forward = transform.forward;
        Vector3 right = transform.right;
        float forwardSpeed = Vector3.Dot(velocity, forward);
        float lateralSpeed = Vector3.Dot(velocity, right);
        float dt = Time.fixedDeltaTime;
        bool wasDrifting = Drifting;

        if (ControlsEnabled)
        {
            Drifting = AllowDrift && braking && Mathf.Abs(steer) > 0.4f && forwardSpeed > 16f;
            if (Drifting)
            {
                // A drift trades speed for rotation and charges the boost.
                body.AddForce(-forward * DriftScrub, ForceMode.Acceleration);
                DriftCharge = Mathf.Min(1f, DriftCharge + dt / 1.4f);
                if (!wasDrifting)
                {
                    DriftStarted?.Invoke();
                }
            }
            else if (braking)
            {
                float decel = Mathf.Min(BrakeDeceleration, Mathf.Abs(forwardSpeed) / dt);
                body.AddForce(-forward * Mathf.Sign(forwardSpeed) * decel, ForceMode.Acceleration);
            }
            else
            {
                float top = Boosting ? BoostMaxSpeed : MaxSpeed;
                float accel = Boosting ? BoostAcceleration : Acceleration;
                if (forwardSpeed < top)
                {
                    // Strong off the line, tapering towards top speed.
                    float taper = 1f - Mathf.Clamp01(forwardSpeed / top) * 0.65f;
                    body.AddForce(forward * accel * taper, ForceMode.Acceleration);
                }
            }

            // Releasing a drift fires the boost it charged.
            if (wasDrifting && !Drifting)
            {
                if (DriftCharge >= 0.35f)
                {
                    AddBoost(0.5f + DriftCharge * 1.3f);
                }
                DriftCharge = 0f;
            }

            float speed01 = Mathf.Clamp01(Mathf.Abs(forwardSpeed) / MaxSpeed);
            float lowSpeed = Mathf.Clamp01(Mathf.Abs(forwardSpeed) / 6f);
            float yawRate = Mathf.Lerp(LowSpeedYaw, HighSpeedYaw, speed01) * lowSpeed;
            if (Drifting)
            {
                yawRate = Mathf.Max(yawRate, DriftYaw);
            }
            float yaw = steer * yawRate * dt * (forwardSpeed >= 0f ? 1f : -1f);
            body.MoveRotation(body.rotation * Quaternion.Euler(0f, yaw, 0f));
        }
        else
        {
            Drifting = false;
            DriftCharge = 0f;
            // Roll to a stop when the race is not running.
            body.AddForce(-new Vector3(velocity.x, 0f, velocity.z) * 1.5f, ForceMode.Acceleration);
        }

        float grip = (Drifting ? DriftGrip : Grip) * GripMultiplier;
        body.AddForce(-right * lateralSpeed * grip, ForceMode.Acceleration);

        // Extra downforce keeps the car planted over kerbs.
        body.AddForce(Vector3.down * 18f, ForceMode.Acceleration);
        boostTime = Mathf.Max(0f, boostTime - dt);

        // Hard cap, so stacked boosts never exceed the boosted top speed.
        Vector3 flat = new Vector3(body.linearVelocity.x, 0f, body.linearVelocity.z);
        if (flat.magnitude > BoostMaxSpeed)
        {
            flat = flat.normalized * BoostMaxSpeed;
            body.linearVelocity = new Vector3(flat.x, body.linearVelocity.y, flat.z);
        }
    }

    public void AddBoost(float seconds)
    {
        boostTime = Mathf.Max(boostTime, seconds);
        Boosted?.Invoke();
    }

    void OnCollisionEnter(Collision collision)
    {
        // Only side walls count: contacts from below are the road and ground.
        Vector3 normal = collision.GetContact(0).normal;
        if (Mathf.Abs(normal.y) > 0.5f)
        {
            return;
        }
        float strength = Mathf.Clamp01(Mathf.Abs(Vector3.Dot(collision.relativeVelocity, normal)) / 22f);
        if (strength < 0.05f)
        {
            return;
        }
        body.linearVelocity *= 1f - 0.4f * strength;
        DriftCharge = 0f;
        Impact?.Invoke(strength);
    }

    void OnCollisionStay(Collision collision)
    {
        // Scraping along a wall bleeds speed.
        if (Mathf.Abs(collision.GetContact(0).normal.y) < 0.5f)
        {
            body.linearVelocity *= 0.985f;
        }
    }

    public void Teleport(Vector3 position, Quaternion rotation)
    {
        body.linearVelocity = Vector3.zero;
        body.angularVelocity = Vector3.zero;
        body.position = position;
        body.rotation = rotation;
        transform.SetPositionAndRotation(position, rotation);
        steer = 0f;
        boostTime = 0f;
        DriftCharge = 0f;
        Drifting = false;
    }
}
