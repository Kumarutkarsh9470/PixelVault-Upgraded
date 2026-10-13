// A driver that follows the centreline: it aims at a point that moves further
// ahead with speed, and brakes for the tightest bend it can see. Used for the
// menu's attract lap and for calibrating medal times.
//
// A port of the bot in the program's sim module, so a time it sets here is a
// time the chain agrees with.

using static FixedMath;

public class SimBot
{
    /// Cornering force the driver believes it has, in m/s^2.
    public int Grip = Fx(30);
    /// Whether it is allowed to brake into corners hard enough to drift.
    public bool Drift;

    public SimInput Drive(SimTrack track, ref CarSim car)
    {
        int look = Fx(8) + Mul(car.Speed(), Pct(45));
        int ahead = System.Math.Max(1, Div(look, track.Spacing) >> 16);
        SimSample target = track.Samples[track.Wrap(car.Sample + ahead)];

        int forwardX = SimTrig.Sin(car.Heading);
        int forwardZ = SimTrig.Cos(car.Heading);
        int toX = target.X - car.X;
        int toZ = target.Z - car.Z;
        int cross = Mul(forwardX, toZ) - Mul(forwardZ, toX);
        int dot = Mul(forwardX, toX) + Mul(forwardZ, toZ);
        int distance = System.Math.Max(Sqrt(Mul(toX, toX) + Mul(toZ, toZ)), One);
        int sine = Div(cross, distance);

        int steer = -(sine * 3 / One) * SimInput.SteerScale;
        if (dot < 0)
        {
            // The aim point is behind: turn the shortest way round.
            steer = cross > 0 ? -8 : 8;
        }
        steer = steer < -8 ? -8 : steer > 8 ? 8 : steer;

        // Slowest speed the coming bends allow, from their curvature.
        int speed = car.Speed();
        int horizon = System.Math.Max(4, Div(Fx(20) + speed, track.Spacing) >> 16);
        int safe = Fx(62);
        for (int s = 2; s < horizon; s += 2)
        {
            SimSample a = track.Samples[track.Wrap(car.Sample + s)];
            SimSample b = track.Samples[track.Wrap(car.Sample + s + 3)];
            int turn = Abs(Mul(a.Fx, b.Fz) - Mul(a.Fz, b.Fx));
            if (turn <= One / 200)
            {
                continue;
            }
            int radius = Div(Mul(track.Spacing, Fx(3)), turn);
            // Anything this open is a straight. The cap also keeps
            // grip * radius inside the fixed-point range, which matters most
            // at the high cornering limits calibration tries.
            if (radius > Div(Fx(25_000), Grip))
            {
                continue;
            }
            int corner = Sqrt(Mul(Grip, radius));
            int braking = Sqrt(Mul(corner, corner) + Mul(Fx(36), Mul(track.Spacing, Fx(s))));
            if (braking < safe)
            {
                safe = braking;
            }
        }

        bool brake = speed > safe + Fx(2);
        return new SimInput
        {
            Steer = (sbyte)steer,
            Brake = brake && (Drift || System.Math.Abs(steer) < 4),
        };
    }
}
