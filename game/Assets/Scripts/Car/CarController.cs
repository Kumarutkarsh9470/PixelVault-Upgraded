using System;
using System.Collections.Generic;
using UnityEngine;

/// The car the player drives. Handling lives in CarSim, the integer simulation
/// the Solana program also runs, so what happens here is exactly what the
/// chain will replay: this class reads thumbs, steps the simulation sixty
/// times a second, records the inputs, and moves the transform to match.
///
/// Nothing here uses Unity physics. Walls, boost pads and checkpoints are all
/// part of the simulation, so a run cannot depend on a collider or a frame rate.
public class CarController : MonoBehaviour
{
    /// Top speed without a boost, in m/s, for effects that scale with pace.
    public const float MaxSpeed = 50f;

    /// Set by the page for tilt steering (-1..1).
    public static bool TiltEnabled;
    public static float TiltSteer;

    /// The bot drives through this instead of the screen.
    public bool UseExternalInput;
    public SimInput External;
    /// A driver for the menu's attract lap and demo runs. Its input is worked
    /// out inside the step it applies to, so nothing depends on script order.
    public SimBot Bot;
    public bool UseBot;
    /// The bot brakes plainly; braking while steering would otherwise drift.
    public bool AllowDrift = true;

    public bool ControlsEnabled { get; set; }
    public bool Recording { get; private set; }

    public CarSim Sim => sim;
    public SimTrack Track => track;
    public int Steps { get; private set; }
    public int Crossings => sim.Crossings;
    public bool Drifting => sim.Drifting;
    public float DriftCharge => FixedMath.ToFloat(sim.DriftCharge);
    public bool Boosting => sim.Boosting;
    public float Speed => FixedMath.ToFloat(sim.Speed());
    public float SpeedKmh => Speed * 3.6f;
    /// The inputs pressed so far this run, one per step.
    public IReadOnlyList<SimInput> Inputs => inputs;

    public event Action<float> Impact;
    public event Action Boosted;
    public event Action DriftStarted;
    /// Raised when the simulation says a checkpoint was crossed: its index
    /// around the lap, and the step it happened on.
    public event Action<int, int> Checkpoint;

    SimTrack track;
    CarSim sim;
    readonly List<SimInput> inputs = new List<SimInput>();
    /// Below this a wall touch is a scrape, not a knock.
    const int ImpactThreshold = FixedMath.One / 12;

    int firstSide;
    int lastImpactStep = -100;
    bool wasBoosting;
    bool wasDrifting;

    // Rendering runs at whatever rate the device manages, so the visible car
    // is interpolated between the last two simulation steps.
    Vector3 previousPosition;
    Vector3 currentPosition;
    float previousYaw;
    float currentYaw;

    public void Load(SimTrack simTrack)
    {
        track = simTrack;
        Reset();
    }

    /// Puts the car back on the grid and forgets the run so far.
    public void Reset()
    {
        if (track == null)
        {
            return;
        }
        sim = CarSim.Spawn(track);
        Steps = 0;
        inputs.Clear();
        Recording = false;
        wasBoosting = false;
        wasDrifting = false;
        previousPosition = currentPosition = Position();
        previousYaw = currentYaw = Yaw();
        ApplyTransform(1f);
    }

    /// Starts collecting the inputs that become the run's trace.
    public void BeginRecording()
    {
        inputs.Clear();
        Steps = 0;
        Recording = true;
    }

    public void StopRecording()
    {
        Recording = false;
    }

    /// The trace to send on-chain: the whole run in a few hundred bytes.
    public byte[] Trace()
    {
        return TraceCodec.Encode(inputs);
    }

    void FixedUpdate()
    {
        if (track == null || !ControlsEnabled)
        {
            return;
        }

        SimInput input = UseBot && Bot != null ? Bot.Drive(track, ref sim)
            : UseExternalInput ? External
            : ReadInput();
        previousPosition = currentPosition;
        previousYaw = currentYaw;

        int checkpoint = sim.Step(track, input);
        Steps++;
        if (Recording)
        {
            inputs.Add(input);
        }

        currentPosition = Position();
        currentYaw = Yaw();

        // Grinding along a wall touches it every step; only a real knock, and
        // not more than a few a second, is worth an effect.
        if (sim.Impact > ImpactThreshold && Steps - lastImpactStep > 12)
        {
            lastImpactStep = Steps;
            Impact?.Invoke(FixedMath.ToFloat(sim.Impact));
        }
        if (sim.Boosting && !wasBoosting)
        {
            Boosted?.Invoke();
        }
        if (sim.Drifting && !wasDrifting)
        {
            DriftStarted?.Invoke();
        }
        wasBoosting = sim.Boosting;
        wasDrifting = sim.Drifting;

        if (checkpoint >= 0)
        {
            Checkpoint?.Invoke(checkpoint, Steps);
        }
    }

    void Update()
    {
        if (track == null)
        {
            return;
        }
        // How far through the current simulation step this frame sits.
        float blend = ControlsEnabled
            ? Mathf.Clamp01((Time.time - Time.fixedTime) / Time.fixedDeltaTime)
            : 1f;
        ApplyTransform(blend);
    }

    void ApplyTransform(float blend)
    {
        transform.SetPositionAndRotation(
            Vector3.Lerp(previousPosition, currentPosition, blend),
            Quaternion.Euler(0f, Mathf.LerpAngle(previousYaw, currentYaw, blend), 0f));
    }

    Vector3 Position()
    {
        return new Vector3(FixedMath.ToFloat(sim.X), 0.3f, FixedMath.ToFloat(sim.Z));
    }

    float Yaw()
    {
        // A whole turn is 2^32 heading units.
        return sim.Heading / 4294967296f * 360f;
    }

    /// Reads thumbs, keys or tilt into the one input the simulation takes.
    SimInput ReadInput()
    {
        bool left = false;
        bool right = false;
        for (int i = 0; i < Input.touchCount; i++)
        {
            Touch touch = Input.GetTouch(i);
            if (touch.phase == TouchPhase.Ended || touch.phase == TouchPhase.Canceled)
            {
                continue;
            }
            if (touch.position.x < Screen.width * 0.5f) left = true;
            else right = true;
        }
        if (Input.touchCount == 0 && Input.GetMouseButton(0))
        {
            left = Input.mousePosition.x < Screen.width * 0.5f;
            right = !left;
        }

        float keyboard = Input.GetAxisRaw("Horizontal");
        bool keyBrake = Input.GetKey(KeyCode.Space) || Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow);

        if (TiltEnabled)
        {
            // Tilt steers; a touch brakes, which at speed becomes a drift.
            float steer = Mathf.Clamp(TiltSteer, -1f, 1f);
            if (Mathf.Abs(keyboard) > 0.01f) steer = keyboard;
            return new SimInput
            {
                Steer = Quantise(steer),
                Brake = keyBrake || left || right,
            };
        }

        // Remember which side went down first: adding the other thumb drifts
        // towards that side.
        if (left && !right) firstSide = -1;
        else if (right && !left) firstSide = 1;
        else if (!left && !right) firstSide = 0;

        if (left && right)
        {
            return new SimInput { Steer = (sbyte)(firstSide * SimInput.SteerScale), Brake = true };
        }
        if (left)
        {
            return new SimInput { Steer = -8, Brake = keyBrake };
        }
        if (right)
        {
            return new SimInput { Steer = 8, Brake = keyBrake };
        }
        return new SimInput { Steer = Quantise(keyboard), Brake = keyBrake };
    }

    /// Steering is recorded in seventeen levels, which is all a trace carries.
    static sbyte Quantise(float steer)
    {
        return (sbyte)Mathf.Clamp(Mathf.RoundToInt(steer * SimInput.SteerScale), -8, 8);
    }

    /// Used by the page's practice modes; boosts are otherwise part of the run.
    public void AddBoost(float seconds)
    {
        sim.AddBoost(Mathf.RoundToInt(seconds * (float)CarSim.StepsPerSecond));
    }
}
