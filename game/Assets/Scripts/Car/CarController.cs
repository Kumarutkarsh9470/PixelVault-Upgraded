using UnityEngine;

/// Arcade handling built for thumbs: the car accelerates on its own, the
/// player steers with the left and right halves of the screen (or A/D and
/// arrow keys), and holding both halves brakes into a drift.
[RequireComponent(typeof(Rigidbody))]
public class CarController : MonoBehaviour
{
    public float MaxSpeed = 46f;
    public float Acceleration = 19f;
    public float BrakeDeceleration = 26f;
    public float SteerDegreesPerSecond = 105f;
    public float Grip = 9f;
    public float DriftGrip = 2.2f;
    public float GripMultiplier = 1f;

    public bool ControlsEnabled { get; set; }
    public float Speed => new Vector3(body.linearVelocity.x, 0f, body.linearVelocity.z).magnitude;
    public float SpeedKmh => Speed * 3.6f;
    public bool Drifting { get; private set; }

    Rigidbody body;
    float steer;
    bool braking;

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
        ReadInput(out float targetSteer, out braking);
        steer = Mathf.MoveTowards(steer, targetSteer, 7f * Time.deltaTime);
    }

    void ReadInput(out float targetSteer, out bool brake)
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
        if (left && right)
        {
            brake = true;
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

        if (ControlsEnabled)
        {
            if (braking)
            {
                float decel = Mathf.Min(BrakeDeceleration, Mathf.Abs(forwardSpeed) / dt);
                body.AddForce(-forward * Mathf.Sign(forwardSpeed) * decel, ForceMode.Acceleration);
            }
            else if (forwardSpeed < MaxSpeed)
            {
                // Strong off the line, tapering towards top speed.
                float taper = 1f - Mathf.Clamp01(forwardSpeed / MaxSpeed) * 0.65f;
                body.AddForce(forward * Acceleration * taper, ForceMode.Acceleration);
            }

            float lowSpeed = Mathf.Clamp01(Mathf.Abs(forwardSpeed) / 6f);
            float highSpeed = Mathf.Lerp(1f, 0.6f, Mathf.Clamp01(Mathf.Abs(forwardSpeed) / MaxSpeed));
            float yaw = steer * SteerDegreesPerSecond * lowSpeed * highSpeed * dt * (forwardSpeed >= 0f ? 1f : -1f);
            body.MoveRotation(body.rotation * Quaternion.Euler(0f, yaw, 0f));
        }
        else
        {
            // Roll to a stop when the race is not running.
            body.AddForce(-new Vector3(velocity.x, 0f, velocity.z) * 1.5f, ForceMode.Acceleration);
        }

        Drifting = braking && Mathf.Abs(steer) > 0.5f && forwardSpeed > 14f;
        float grip = (Drifting ? DriftGrip : Grip) * GripMultiplier;
        body.AddForce(-right * lateralSpeed * grip, ForceMode.Acceleration);

        // Extra downforce keeps the car planted over kerbs.
        body.AddForce(Vector3.down * 18f, ForceMode.Acceleration);
    }

    public void Teleport(Vector3 position, Quaternion rotation)
    {
        body.linearVelocity = Vector3.zero;
        body.angularVelocity = Vector3.zero;
        body.position = position;
        body.rotation = rotation;
        transform.SetPositionAndRotation(position, rotation);
        steer = 0f;
    }
}
