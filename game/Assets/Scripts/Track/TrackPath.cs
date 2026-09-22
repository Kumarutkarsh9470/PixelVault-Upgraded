using System.Collections.Generic;
using UnityEngine;

/// A closed centripetal Catmull-Rom loop through control points, resampled at
/// even spacing so meshes, checkpoints and props can be laid out by distance.
public class TrackPath
{
    public readonly List<Vector3> Positions = new List<Vector3>();
    public readonly List<Vector3> Forwards = new List<Vector3>();
    public readonly List<Vector3> Rights = new List<Vector3>();
    public float Length { get; private set; }
    public float Spacing { get; private set; }

    public int Count => Positions.Count;

    public static TrackPath FromFlatPoints(float[] flat, float spacing)
    {
        var controls = new List<Vector3>();
        for (int i = 0; i + 1 < flat.Length; i += 2)
        {
            controls.Add(new Vector3(flat[i], 0f, flat[i + 1]));
        }
        return Build(controls, spacing);
    }

    public static TrackPath Build(IList<Vector3> controls, float spacing)
    {
        // Dense sampling of the spline first, then even resampling by arc length.
        var dense = new List<Vector3>();
        int n = controls.Count;
        const int stepsPerSegment = 48;
        for (int i = 0; i < n; i++)
        {
            Vector3 p0 = controls[(i - 1 + n) % n];
            Vector3 p1 = controls[i];
            Vector3 p2 = controls[(i + 1) % n];
            Vector3 p3 = controls[(i + 2) % n];
            for (int s = 0; s < stepsPerSegment; s++)
            {
                dense.Add(CentripetalCatmullRom(p0, p1, p2, p3, s / (float)stepsPerSegment));
            }
        }

        var path = new TrackPath { Spacing = spacing };
        float total = 0f;
        for (int i = 0; i < dense.Count; i++)
        {
            total += Vector3.Distance(dense[i], dense[(i + 1) % dense.Count]);
        }
        int count = Mathf.Max(16, Mathf.RoundToInt(total / spacing));
        float step = total / count;

        int seg = 0;
        float segStart = 0f;
        for (int k = 0; k < count; k++)
        {
            float target = k * step;
            float segLen = Vector3.Distance(dense[seg], dense[(seg + 1) % dense.Count]);
            while (segStart + segLen < target && seg < dense.Count - 1)
            {
                segStart += segLen;
                seg++;
                segLen = Vector3.Distance(dense[seg], dense[(seg + 1) % dense.Count]);
            }
            float t = segLen > 0f ? (target - segStart) / segLen : 0f;
            path.Positions.Add(Vector3.Lerp(dense[seg], dense[(seg + 1) % dense.Count], t));
        }

        for (int k = 0; k < count; k++)
        {
            Vector3 prev = path.Positions[(k - 1 + count) % count];
            Vector3 next = path.Positions[(k + 1) % count];
            Vector3 forward = (next - prev).normalized;
            path.Forwards.Add(forward);
            path.Rights.Add(Vector3.Cross(Vector3.up, forward).normalized);
        }
        path.Length = total;
        return path;
    }

    static Vector3 CentripetalCatmullRom(Vector3 p0, Vector3 p1, Vector3 p2, Vector3 p3, float t)
    {
        float t0 = 0f;
        float t1 = Knot(t0, p0, p1);
        float t2 = Knot(t1, p1, p2);
        float t3 = Knot(t2, p2, p3);
        float u = Mathf.Lerp(t1, t2, t);

        Vector3 a1 = Blend(p0, p1, t0, t1, u);
        Vector3 a2 = Blend(p1, p2, t1, t2, u);
        Vector3 a3 = Blend(p2, p3, t2, t3, u);
        Vector3 b1 = Blend(a1, a2, t0, t2, u);
        Vector3 b2 = Blend(a2, a3, t1, t3, u);
        return Blend(b1, b2, t1, t2, u);
    }

    static float Knot(float t, Vector3 a, Vector3 b)
    {
        return t + Mathf.Max(Mathf.Pow(Vector3.Distance(a, b), 0.5f), 1e-4f);
    }

    static Vector3 Blend(Vector3 a, Vector3 b, float ta, float tb, float u)
    {
        return (tb - u) / (tb - ta) * a + (u - ta) / (tb - ta) * b;
    }
}
