// The car: one deterministic step of arcade handling.
//
// A line-by-line port of pixelvault/programs/pixelvault/src/sim/car.rs, which
// is the canonical version. The chain replays a player's inputs through that
// code and derives the finish time, so this must agree with it bit for bit:
// same operations, same order, same integer widths. tools/run-parity.py proves
// it on thousands of runs, and any change to handling must be made in both and
// re-proved.

using static FixedMath;

public struct SimInput
{
    /// -8..=8: a thumb on one side is full lock, tilt uses the levels between.
    public sbyte Steer;
    /// Both thumbs down: brake, which at speed and on lock becomes a drift.
    public bool Brake;

    public const int SteerScale = 8;

    /// Packs into the byte a trace stores: steer in the low five bits, biased
    /// so it is unsigned, and brake in bit five.
    public byte Pack()
    {
        int steer = Clamp(Steer, -8, 8) + 8;
        return (byte)(steer | ((Brake ? 1 : 0) << 5));
    }

    public static SimInput Unpack(byte value)
    {
        return new SimInput
        {
            Steer = (sbyte)((value & 0x1f) - 8),
            Brake = (value & 0x20) != 0,
        };
    }

    public int SteerTarget()
    {
        return (Clamp(Steer, -8, 8) * One) / SteerScale;
    }

    static int Clamp(int value, int low, int high)
    {
        if (value < low) return low;
        if (value > high) return high;
        return value;
    }
}

public struct CarSim
{
    /// Simulation rate. One step is 1/60 s of race time.
    public const long StepsPerSecond = 60;
    /// Step length in seconds, as Q16.16.
    public const int Dt = One / (int)StepsPerSecond;

    // Handling, mirroring the feel tuned in the Unity prototype.
    static readonly int MaxSpeed = Fx(50);
    static readonly int BoostMaxSpeed = Fx(62);
    static readonly int Acceleration = Fx(20);
    static readonly int BoostAcceleration = Fx(36);
    static readonly int BrakeDeceleration = Fx(30);
    static readonly int AccelerationTaper = Pct(65);
    static readonly int DriftScrub = Fx(5);
    static readonly int Grip = Fx(9);
    static readonly int DriftGrip = Num(1, 7);
    static readonly int SteerRate = Fx(7);
    static readonly int LinearDamping = Pct(5);
    static readonly int DriftMinSpeed = Fx(16);
    static readonly int DriftMinSteer = Pct(40);
    static readonly int DriftMinCharge = Pct(35);
    static readonly int DriftBoostBase = Pct(50);
    static readonly int DriftBoostSpan = Num(1, 3);
    static readonly int ImpactSpeedLoss = Pct(40);
    static readonly int WallScrape = Pct(99) - Pct(1) / 2; // 0.985
    const int BoostPadSteps = 66; // 1.1 s
    static readonly int BoostPadHalfWidth = Num(2, 3);
    const int BoostPadHalfLength = 2;

    // Reciprocals of the constants the step divides by, because division is
    // expensive on-chain and a race is a few thousand steps.
    const int InvMaxSpeed = One / 50;
    const int InvBoostMaxSpeed = One / 62;
    const int InvLowSpeedReference = One / 6;
    const int InvImpactReference = One / 22;
    static readonly int BoostMaxSpeedSquared = Mul(BoostMaxSpeed, BoostMaxSpeed);
    static readonly int DriftChargePerStep = Mul(Dt, One / 14 * 10);
    static readonly int SteerPerStep = Mul(SteerRate, Dt);
    static readonly int DampingPerStep = One - Mul(LinearDamping, Dt);

    // Steering rates, in heading units turned per step (a whole turn is 2^32).
    static readonly int LowSpeedYaw = SimTrig.DegreesPerStep(Fx(125), StepsPerSecond);
    static readonly int HighSpeedYaw = SimTrig.DegreesPerStep(Fx(46), StepsPerSecond);
    static readonly int DriftYaw = SimTrig.DegreesPerStep(Fx(92), StepsPerSecond);

    public int X;
    public int Z;
    public int Vx;
    public int Vz;
    /// Heading: a whole turn is 2^32, so it wraps by itself.
    public uint Heading;
    public int Steer;
    public int DriftCharge;
    public int BoostSteps;
    public bool Drifting;
    /// Centreline samples travelled since the start. Checkpoints are positions
    /// along this count, so they can only be taken in order.
    public int Progress;
    public int Sample;
    /// Checkpoint crossings so far, including the start line.
    public int Crossings;
    /// Progress at which the next checkpoint falls.
    public int NextTarget;
    /// Strength of a wall hit this step, for effects and sound.
    public int Impact;

    public static CarSim Spawn(SimTrack track)
    {
        SimSample sample = track.Samples[track.StartSample];
        return new CarSim
        {
            X = sample.X,
            Z = sample.Z,
            Heading = track.StartHeading,
            Sample = track.StartSample,
            NextTarget = track.CheckpointProgress(0, 0),
        };
    }

    public int Speed()
    {
        return Length(Vx, Vz);
    }

    public bool Boosting => BoostSteps > 0;

    /// Advances the car by one step. Returns the checkpoint index if this step
    /// crossed the next one, or -1.
    public int Step(SimTrack track, SimInput input)
    {
        Impact = 0;
        int forwardX = SimTrig.Sin(Heading);
        int forwardZ = SimTrig.Cos(Heading);
        int rightX = forwardZ;
        int rightZ = -forwardX;

        int forwardSpeed = Mul(Vx, forwardX) + Mul(Vz, forwardZ);
        int lateralSpeed = Mul(Vx, rightX) + Mul(Vz, rightZ);

        Steer = MoveTowards(Steer, input.SteerTarget(), SteerPerStep);

        // A drift needs a committed steering angle and real speed. It scrubs
        // speed, turns harder, and charges a boost that fires on release.
        bool wasDrifting = Drifting;
        Drifting = input.Brake && Abs(Steer) > DriftMinSteer && forwardSpeed > DriftMinSpeed;

        int ax = 0;
        int az = 0;
        if (Drifting)
        {
            ax -= Mul(forwardX, DriftScrub);
            az -= Mul(forwardZ, DriftScrub);
            DriftCharge = Clamp01(DriftCharge + DriftChargePerStep);
        }
        else if (input.Brake)
        {
            // Never brake past a standstill within one step.
            int most = Abs(forwardSpeed) * (int)StepsPerSecond;
            int decel = most < BrakeDeceleration ? most : BrakeDeceleration;
            int sign = forwardSpeed >= 0 ? One : -One;
            ax -= Mul(Mul(forwardX, sign), decel);
            az -= Mul(Mul(forwardZ, sign), decel);
        }
        else
        {
            bool boosting = Boosting;
            int top = boosting ? BoostMaxSpeed : MaxSpeed;
            int rate = boosting ? BoostAcceleration : Acceleration;
            int invTop = boosting ? InvBoostMaxSpeed : InvMaxSpeed;
            if (forwardSpeed < top)
            {
                // Strong off the line, tapering towards top speed.
                int taper = One - Mul(Clamp01(Mul(forwardSpeed, invTop)), AccelerationTaper);
                ax += Mul(Mul(forwardX, rate), taper);
                az += Mul(Mul(forwardZ, rate), taper);
            }
        }

        if (wasDrifting && !Drifting)
        {
            if (DriftCharge >= DriftMinCharge)
            {
                int seconds = DriftBoostBase + Mul(DriftCharge, DriftBoostSpan);
                AddBoost((int)(ushort)((seconds * StepsPerSecond) >> 16));
            }
            DriftCharge = 0;
        }

        // Steering bites less at speed, and barely at all when nearly stopped.
        int speed01 = Clamp01(Mul(Abs(forwardSpeed), InvMaxSpeed));
        int crawl = Clamp01(Mul(Abs(forwardSpeed), InvLowSpeedReference));
        int yaw = LowSpeedYaw + (int)(((long)(HighSpeedYaw - LowSpeedYaw) * speed01) >> 16);
        yaw = (int)(((long)yaw * crawl) >> 16);
        if (Drifting && yaw < DriftYaw)
        {
            yaw = DriftYaw;
        }
        int turn = (int)(((long)yaw * Steer) >> 16);
        if (forwardSpeed < 0)
        {
            turn = -turn;
        }
        Heading = unchecked(Heading + (uint)turn);

        // Tyres resist sliding sideways; a drift lets them go.
        int grip = Drifting ? DriftGrip : Grip;
        ax -= Mul(Mul(rightX, lateralSpeed), grip);
        az -= Mul(Mul(rightZ, lateralSpeed), grip);

        Vx = unchecked(Vx + Mul(ax, Dt));
        Vz = unchecked(Vz + Mul(az, Dt));
        Vx = Mul(Vx, DampingPerStep);
        Vz = Mul(Vz, DampingPerStep);

        // Stacked boosts never exceed the boosted top speed.
        if (Mul(Vx, Vx) + Mul(Vz, Vz) > BoostMaxSpeedSquared)
        {
            int speed = Length(Vx, Vz);
            Vx = Mul(Div(Vx, speed), BoostMaxSpeed);
            Vz = Mul(Div(Vz, speed), BoostMaxSpeed);
        }

        X = unchecked(X + Mul(Vx, Dt));
        Z = unchecked(Z + Mul(Vz, Dt));
        if (BoostSteps > 0)
        {
            BoostSteps--;
        }

        SimSample sample = FollowTrack(track);
        int lateral = HitWalls(track, ref sample);
        CrossBoostPads(track, lateral);
        return CrossCheckpoint(track);
    }

    public void AddBoost(int steps)
    {
        if (steps > BoostSteps)
        {
            BoostSteps = steps;
        }
    }

    /// Tracks the nearest centreline sample, searching only the few samples the
    /// car could have reached, and accumulates progress around the lap.
    SimSample FollowTrack(SimTrack track)
    {
        int best = Sample;
        long bestDistance = long.MaxValue;
        // At the speed cap the car covers about half a sample per step, so a
        // short window either side is always enough.
        for (int offset = -1; offset <= 3; offset++)
        {
            int index = track.Wrap(Sample + offset);
            SimSample sample = track.Samples[index];
            long dx = X - sample.X;
            long dz = Z - sample.Z;
            long distance = dx * dx + dz * dz;
            if (distance < bestDistance)
            {
                bestDistance = distance;
                best = index;
            }
        }
        // The shortest signed step around the loop, so passing sample 0 counts
        // as progress forward rather than a lap backwards.
        int n = track.Count;
        int delta = best - Sample;
        if (delta > n / 2) delta -= n;
        else if (delta < -n / 2) delta += n;
        Progress += delta;
        Sample = best;
        return track.Samples[best];
    }

    /// Walls are the edge of the circuit rather than colliders: the car is put
    /// back on the track and loses speed, hard on impact, slowly while scraping.
    int HitWalls(SimTrack track, ref SimSample sample)
    {
        int rx = sample.RightX;
        int rz = sample.RightZ;
        int lateral = Mul(X - sample.X, rx) + Mul(Z - sample.Z, rz);
        int over = Abs(lateral) - track.WallOffset;
        if (over <= 0)
        {
            return lateral;
        }

        int sign = lateral > 0 ? One : -One;
        int outX = Mul(rx, sign);
        int outZ = Mul(rz, sign);
        X -= Mul(outX, over);
        Z -= Mul(outZ, over);

        int intoWall = Mul(Vx, outX) + Mul(Vz, outZ);
        if (intoWall > 0)
        {
            Vx -= Mul(outX, intoWall);
            Vz -= Mul(outZ, intoWall);
            int strength = Clamp01(Mul(intoWall, InvImpactReference));
            int keep = One - Mul(strength, ImpactSpeedLoss);
            Vx = Mul(Vx, keep);
            Vz = Mul(Vz, keep);
            DriftCharge = 0;
            Impact = strength;
        }
        else
        {
            Vx = Mul(Vx, WallScrape);
            Vz = Mul(Vz, WallScrape);
        }
        // The car now sits exactly on the wall.
        return lateral > 0 ? track.WallOffset : -track.WallOffset;
    }

    void CrossBoostPads(SimTrack track, int lateral)
    {
        int n = track.Count;
        foreach (SimBoostPad pad in track.BoostPads)
        {
            int delta = pad.Sample - Sample;
            if (delta > n / 2) delta -= n;
            else if (delta < -n / 2) delta += n;
            if (System.Math.Abs(delta) > BoostPadHalfLength)
            {
                continue;
            }
            if (Abs(lateral - pad.Lateral) <= BoostPadHalfWidth)
            {
                AddBoost(BoostPadSteps);
            }
        }
    }

    /// Checkpoints sit at fixed distances along the progress count, so they can
    /// only be taken in order, and only once each.
    int CrossCheckpoint(SimTrack track)
    {
        if (Progress < NextTarget)
        {
            return -1;
        }
        int perLap = track.Checkpoints.Length;
        int index = Crossings % perLap;
        Crossings++;
        int next = Crossings % perLap;
        int lap = Crossings / perLap;
        NextTarget = track.CheckpointProgress(next, lap);
        return index;
    }
}
