using System.Collections.Generic;
using UnityEngine;

/// Draws the simulation's level around the runner: a scrolling lane floor,
/// and pooled obstacles and runes for the rows just behind to far ahead.
/// Read-only: it never affects the run.
public class LevelView : MonoBehaviour
{
    public const float LaneWidth = 2.4f;
    const int RowsAhead = 34;
    const int RowsBehind = 2;
    const float FloorLength = 420f;

    public static float LaneX(float lane) => (lane - 1f) * LaneWidth;
    public static float RowZ(int row) => (row + 1) * RunnerSim.RowMm / 1000f;

    RunnerSim sim;
    Transform floor;
    Material floorMat;
    int firstRow;
    int lastRow = -1;

    readonly Dictionary<int, GameObject> live = new Dictionary<int, GameObject>();
    readonly Dictionary<byte, Stack<GameObject>> pools = new Dictionary<byte, Stack<GameObject>>();
    readonly Dictionary<byte, Material[]> mats = new Dictionary<byte, Material[]>();
    ParticleSystem burst;

    public static readonly Color EmberColor = new Color(0.98f, 0.44f, 0.52f);
    public static readonly Color TideColor = new Color(0.22f, 0.74f, 0.97f);
    public static readonly Color StormColor = new Color(0.75f, 0.52f, 0.99f);

    public static Color RuneColor(int type) =>
        type == RunnerSim.Ember ? EmberColor : type == RunnerSim.Tide ? TideColor : StormColor;

    void Awake()
    {
        BuildFloor();
        Color wall = new Color(1f, 0.24f, 0.55f);
        Color low = new Color(0.13f, 0.83f, 0.93f);
        Color high = new Color(1f, 0.66f, 0.15f);
        mats[RunnerSim.Wall] = new[] { Mats.Lit(new Color(0.06f, 0.05f, 0.09f)), Mats.Glow(wall, 2.4f) };
        mats[RunnerSim.Low] = new[] { Mats.Lit(new Color(0.05f, 0.07f, 0.1f)), Mats.Glow(low, 2.6f) };
        mats[RunnerSim.High] = new[] { Mats.Lit(new Color(0.07f, 0.06f, 0.05f)), Mats.Glow(high, 2.6f) };
        mats[RunnerSim.Ember] = new[] { Mats.Glow(EmberColor, 3f) };
        mats[RunnerSim.Tide] = new[] { Mats.Glow(TideColor, 3f) };
        mats[RunnerSim.Storm] = new[] { Mats.Glow(StormColor, 3.2f) };
        burst = Fx.Burst(transform, 40);
    }

    void BuildFloor()
    {
        var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
        Destroy(go.GetComponent<Collider>());
        go.name = "Floor";
        floor = go.transform;
        floor.SetParent(transform, false);
        floor.localRotation = Quaternion.Euler(90f, 0f, 0f);
        floor.localScale = new Vector3(3f * LaneWidth + 1.6f, FloorLength, 1f);
        floorMat = Mats.Glow(new Color(0.35f, 0.55f, 1f), 1.4f);
        floorMat.color = new Color(0.03f, 0.035f, 0.06f);
        Texture2D grid = LaneTexture();
        floorMat.mainTexture = grid;
        floorMat.SetTexture("_EmissionMap", grid);
        floorMat.mainTextureScale = new Vector2(1f, FloorLength / (RunnerSim.RowMm / 1000f));
        go.GetComponent<Renderer>().sharedMaterial = floorMat;
    }

    /// One row's worth of floor: bright lane dividers and edges, a faint cross line.
    static Texture2D LaneTexture()
    {
        const int size = 128;
        var tex = new Texture2D(size, size, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Repeat };
        float width = 3f * LaneWidth + 1.6f;
        float[] lines = { 0.8f, 0.8f + LaneWidth, 0.8f + 2f * LaneWidth, 0.8f + 3f * LaneWidth };
        for (int y = 0; y < size; y++)
        {
            for (int x = 0; x < size; x++)
            {
                float metres = (x + 0.5f) / size * width;
                float v = 0.02f;
                foreach (float line in lines)
                {
                    float d = Mathf.Abs(metres - line);
                    bool edge = line == lines[0] || line == lines[3];
                    v = Mathf.Max(v, Mathf.Clamp01(1f - d / (edge ? 0.12f : 0.06f)) * (edge ? 1f : 0.55f));
                }
                if (y < 2) v = Mathf.Max(v, 0.18f);
                tex.SetPixel(x, y, new Color(v, v, v, 1f));
            }
        }
        tex.Apply(true);
        return tex;
    }

    /// Starts drawing a new run's level.
    public void Bind(RunnerSim runner)
    {
        foreach (GameObject go in live.Values) Recycle(go);
        live.Clear();
        sim = runner;
        firstRow = 0;
        lastRow = -1;
    }

    public void Pick(RunnerSim.Pickup pickup, int lane)
    {
        int key = pickup.Row * 3 + lane;
        if (live.TryGetValue(key, out GameObject rune))
        {
            burst.transform.position = rune.transform.position;
            var main = burst.main;
            main.startColor = RuneColor(pickup.Type);
            burst.Emit(18);
            Recycle(rune);
            live.Remove(key);
        }
    }

    public void Draw(float distanceMeters)
    {
        if (sim == null) return;
        floor.localPosition = new Vector3(0f, 0f, distanceMeters + FloorLength * 0.5f - 20f);
        float rowMeters = RunnerSim.RowMm / 1000f;
        floorMat.mainTextureOffset = new Vector2(0f, ((distanceMeters - 20f) / rowMeters) % 1f);

        int wantFirst = Mathf.Max(0, sim.NextRow - RowsBehind);
        int wantLast = Mathf.Min(sim.RowCount - 1, sim.NextRow + RowsAhead);
        for (int row = firstRow; row < wantFirst; row++) Despawn(row);
        for (int row = Mathf.Max(lastRow + 1, wantFirst); row <= wantLast; row++) Spawn(row);
        firstRow = wantFirst;
        lastRow = Mathf.Max(lastRow, wantLast);

        float spin = Time.time * 120f;
        float bob = Mathf.Sin(Time.time * 3f) * 0.12f;
        for (int row = wantFirst; row <= wantLast; row++)
        {
            for (int lane = 0; lane < 3; lane++)
            {
                if (sim.Cell(row, lane) >= RunnerSim.Ember && live.TryGetValue(row * 3 + lane, out GameObject rune))
                {
                    rune.transform.localRotation = Quaternion.Euler(45f, spin, 45f);
                    rune.transform.localPosition = new Vector3(LaneX(lane), 1.1f + bob, RowZ(row));
                }
            }
        }
    }

    void Spawn(int row)
    {
        for (int lane = 0; lane < 3; lane++)
        {
            byte cell = sim.Cell(row, lane);
            if (cell == RunnerSim.Empty) continue;
            GameObject go = Take(cell);
            go.transform.localPosition = new Vector3(LaneX(lane), 0f, RowZ(row));
            go.transform.localRotation = Quaternion.identity;
            live[row * 3 + lane] = go;
        }
    }

    void Despawn(int row)
    {
        for (int lane = 0; lane < 3; lane++)
        {
            int key = row * 3 + lane;
            if (live.TryGetValue(key, out GameObject go))
            {
                Recycle(go);
                live.Remove(key);
            }
        }
    }

    GameObject Take(byte cell)
    {
        if (!pools.TryGetValue(cell, out Stack<GameObject> pool)) pools[cell] = pool = new Stack<GameObject>();
        GameObject go = pool.Count > 0 ? pool.Pop() : Build(cell);
        go.SetActive(true);
        return go;
    }

    void Recycle(GameObject go)
    {
        go.SetActive(false);
        pools[(byte)go.GetComponent<CellTag>().Cell].Push(go);
    }

    GameObject Build(byte cell)
    {
        var root = new GameObject(CellName(cell));
        root.transform.SetParent(transform, false);
        root.AddComponent<CellTag>().Cell = cell;
        Material[] m = mats[cell];
        float w = LaneWidth - 0.35f;
        switch (cell)
        {
            case RunnerSim.Wall:
                Part(root, PrimitiveType.Cube, m[0], new Vector3(0f, 1.4f, 0f), new Vector3(w, 2.8f, 0.6f));
                Part(root, PrimitiveType.Cube, m[1], new Vector3(0f, 2.75f, -0.32f), new Vector3(w, 0.1f, 0.02f));
                Part(root, PrimitiveType.Cube, m[1], new Vector3(-w * 0.5f, 1.4f, -0.32f), new Vector3(0.08f, 2.8f, 0.02f));
                Part(root, PrimitiveType.Cube, m[1], new Vector3(w * 0.5f, 1.4f, -0.32f), new Vector3(0.08f, 2.8f, 0.02f));
                Part(root, PrimitiveType.Cube, m[1], new Vector3(0f, 1.4f, -0.32f), new Vector3(0.5f, 0.5f, 0.02f), 45f);
                break;
            case RunnerSim.Low:
                Part(root, PrimitiveType.Cube, m[0], new Vector3(0f, 0.35f, 0f), new Vector3(w, 0.7f, 0.35f));
                Part(root, PrimitiveType.Cube, m[1], new Vector3(0f, 0.68f, -0.19f), new Vector3(w, 0.08f, 0.02f));
                Part(root, PrimitiveType.Cube, m[1], new Vector3(0f, 0.3f, -0.19f), new Vector3(w, 0.05f, 0.02f));
                break;
            case RunnerSim.High:
                Part(root, PrimitiveType.Cube, m[0], new Vector3(0f, 2.1f, 0f), new Vector3(w, 0.9f, 0.35f));
                Part(root, PrimitiveType.Cube, m[1], new Vector3(0f, 1.67f, -0.19f), new Vector3(w, 0.07f, 0.02f));
                Part(root, PrimitiveType.Cube, m[0], new Vector3(-w * 0.5f, 1.3f, 0f), new Vector3(0.12f, 2.6f, 0.12f));
                Part(root, PrimitiveType.Cube, m[0], new Vector3(w * 0.5f, 1.3f, 0f), new Vector3(0.12f, 2.6f, 0.12f));
                break;
            default:
                Part(root, PrimitiveType.Cube, m[0], Vector3.zero, Vector3.one * 0.5f);
                break;
        }
        return root;
    }

    static string CellName(byte cell) => cell switch
    {
        RunnerSim.Wall => "Wall",
        RunnerSim.Low => "Low",
        RunnerSim.High => "High",
        _ => "Rune",
    };

    static void Part(GameObject parent, PrimitiveType type, Material mat, Vector3 position, Vector3 scale, float roll = 0f)
    {
        var go = GameObject.CreatePrimitive(type);
        Destroy(go.GetComponent<Collider>());
        go.transform.SetParent(parent.transform, false);
        go.transform.localPosition = position;
        go.transform.localRotation = Quaternion.Euler(0f, 0f, roll);
        go.transform.localScale = scale;
        go.GetComponent<Renderer>().sharedMaterial = mat;
    }
}

/// Which pool a level object returns to.
public class CellTag : MonoBehaviour
{
    public byte Cell;
}
