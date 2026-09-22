using System.Collections.Generic;
using UnityEngine;

public class BuiltTrack
{
    public TrackPath Path;
    public GameObject Root;
    public float Width;
    public readonly List<Checkpoint> Checkpoints = new List<Checkpoint>();
    public readonly List<int> CheckpointSamples = new List<int>();
    public Vector3 SpawnPosition;
    public Quaternion SpawnRotation;
    public Vector3 Centroid;
}

/// Generates a complete circuit from a list of control points: ground, road,
/// kerbs, glowing rails with invisible wall colliders, checkpoints, the start
/// line and gantry, and themed trackside dressing.
public static class TrackBuilder
{
    const float Spacing = 2f;
    const float CurbWidth = 1.4f;
    const float RailGap = 1.6f;
    const float RailHeight = 0.6f;
    const float WallHeight = 3f;
    const float CheckpointSpacing = 55f;

    public static BuiltTrack Build(TrackPayload payload, Transform parent)
    {
        ThemePayload theme = payload.theme ?? new ThemePayload();
        TrackPath path = TrackPath.FromFlatPoints(payload.points, Spacing);
        var root = new GameObject("Track " + payload.id);
        root.transform.SetParent(parent, false);

        float half = payload.width * 0.5f;
        float railOffset = half + CurbWidth + RailGap;
        var track = new BuiltTrack { Path = path, Root = root, Width = payload.width };

        Vector3 centroid = Vector3.zero;
        foreach (Vector3 p in path.Positions)
        {
            centroid += p;
        }
        track.Centroid = centroid / path.Count;

        Color ground = Palette.Parse(theme.ground, new Color(0.05f, 0.07f, 0.13f));
        Color road = Palette.Parse(theme.road, new Color(0.1f, 0.12f, 0.18f));
        Color line = Palette.Parse(theme.line, Color.white);
        Color curbA = Palette.Parse(theme.curbA, new Color(1f, 0.24f, 0.55f));
        Color curbB = Palette.Parse(theme.curbB, Color.white);
        Color accent = Palette.Parse(theme.accent, new Color(0.13f, 0.83f, 0.93f));

        BuildGround(root.transform, path, ground);
        MakeStrip(root.transform, "Road", path, -half, half, 0.02f, Mats.Lit(Color.white, RoadTexture(road, line), 0.35f), 8f);
        Material curb = Mats.Lit(Color.white, CurbTexture(curbA, curbB), 0.3f);
        MakeStrip(root.transform, "Curb L", path, -half - CurbWidth, -half, 0.03f, curb, 6f);
        MakeStrip(root.transform, "Curb R", path, half, half + CurbWidth, 0.03f, curb, 6f);

        Material rail = Mats.Glow(accent);
        MakeWall(root.transform, "Rail L", path, -railOffset, 0f, RailHeight, rail, false);
        MakeWall(root.transform, "Rail R", path, railOffset, 0f, RailHeight, rail, false);
        MakeWall(root.transform, "Wall L", path, -railOffset, 0f, WallHeight, null, true);
        MakeWall(root.transform, "Wall R", path, railOffset, 0f, WallHeight, null, true);

        BuildCheckpoints(track, railOffset);
        BuildStart(track, payload.width, railOffset);
        Decorate(track, theme, railOffset, accent);

        StaticBatchingUtility.Combine(root);
        return track;
    }

    static void BuildGround(Transform parent, TrackPath path, Color color)
    {
        var bounds = new Bounds(path.Positions[0], Vector3.zero);
        foreach (Vector3 p in path.Positions)
        {
            bounds.Encapsulate(p);
        }
        float size = Mathf.Max(bounds.size.x, bounds.size.z) + 500f;

        GameObject ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
        ground.name = "Ground";
        ground.transform.SetParent(parent, false);
        ground.transform.position = new Vector3(bounds.center.x, 0f, bounds.center.z);
        ground.transform.localScale = new Vector3(size / 10f, 1f, size / 10f);
        ground.GetComponent<Renderer>().sharedMaterial = Mats.Lit(color, null, 0.05f);
    }

    /// A flat strip following the path between two lateral offsets.
    static GameObject MakeStrip(Transform parent, string name, TrackPath path, float inner, float outer, float y, Material material, float vTile)
    {
        int n = path.Count;
        var vertices = new Vector3[(n + 1) * 2];
        var uvs = new Vector2[(n + 1) * 2];
        var triangles = new int[n * 6];
        float distance = 0f;

        for (int i = 0; i <= n; i++)
        {
            int k = i % n;
            Vector3 p = path.Positions[k] + Vector3.up * y;
            Vector3 r = path.Rights[k];
            vertices[i * 2] = p + r * inner;
            vertices[i * 2 + 1] = p + r * outer;
            float v = distance / vTile;
            uvs[i * 2] = new Vector2(0f, v);
            uvs[i * 2 + 1] = new Vector2(1f, v);
            distance += Vector3.Distance(path.Positions[k], path.Positions[(k + 1) % n]);
        }
        for (int i = 0; i < n; i++)
        {
            int a = i * 2;
            int t = i * 6;
            triangles[t] = a;
            triangles[t + 1] = a + 2;
            triangles[t + 2] = a + 1;
            triangles[t + 3] = a + 1;
            triangles[t + 4] = a + 2;
            triangles[t + 5] = a + 3;
        }
        return MeshObject(parent, name, vertices, uvs, triangles, material, false);
    }

    /// A vertical strip following the path, double-sided so it reads and
    /// collides from either side. Each side has its own vertices: shared
    /// vertices would average opposite normals to zero and render black.
    static GameObject MakeWall(Transform parent, string name, TrackPath path, float offset, float y0, float y1, Material material, bool collider)
    {
        int n = path.Count;
        int perSide = (n + 1) * 2;
        var vertices = new Vector3[perSide * 2];
        var uvs = new Vector2[perSide * 2];
        var triangles = new int[n * 12];

        for (int i = 0; i <= n; i++)
        {
            int k = i % n;
            Vector3 p = path.Positions[k] + path.Rights[k] * offset;
            Vector3 bottom = p + Vector3.up * y0;
            Vector3 top = p + Vector3.up * y1;
            vertices[i * 2] = bottom;
            vertices[i * 2 + 1] = top;
            vertices[perSide + i * 2] = bottom;
            vertices[perSide + i * 2 + 1] = top;
            uvs[i * 2] = uvs[perSide + i * 2] = new Vector2(i, 0f);
            uvs[i * 2 + 1] = uvs[perSide + i * 2 + 1] = new Vector2(i, 1f);
        }
        for (int i = 0; i < n; i++)
        {
            int a = i * 2;
            int b = perSide + i * 2;
            int t = i * 12;
            // Front face.
            triangles[t] = a;
            triangles[t + 1] = a + 1;
            triangles[t + 2] = a + 2;
            triangles[t + 3] = a + 2;
            triangles[t + 4] = a + 1;
            triangles[t + 5] = a + 3;
            // Back face, reversed winding on its own vertices.
            triangles[t + 6] = b;
            triangles[t + 7] = b + 2;
            triangles[t + 8] = b + 1;
            triangles[t + 9] = b + 2;
            triangles[t + 10] = b + 3;
            triangles[t + 11] = b + 1;
        }
        return MeshObject(parent, name, vertices, uvs, triangles, material, collider);
    }

    static GameObject MeshObject(Transform parent, string name, Vector3[] vertices, Vector2[] uvs, int[] triangles, Material material, bool collider)
    {
        var mesh = new Mesh { name = name };
        if (vertices.Length > 65000)
        {
            mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
        }
        mesh.vertices = vertices;
        mesh.uv = uvs;
        mesh.triangles = triangles;
        mesh.RecalculateNormals();
        mesh.RecalculateBounds();

        var go = new GameObject(name);
        go.transform.SetParent(parent, false);
        go.AddComponent<MeshFilter>().sharedMesh = mesh;
        // Invisible walls get a collider and no renderer.
        if (material != null)
        {
            go.AddComponent<MeshRenderer>().sharedMaterial = material;
        }
        if (collider)
        {
            go.AddComponent<MeshCollider>().sharedMesh = mesh;
        }
        return go;
    }

    static void BuildCheckpoints(BuiltTrack track, float railOffset)
    {
        TrackPath path = track.Path;
        int count = Mathf.Max(8, Mathf.RoundToInt(path.Length / CheckpointSpacing));
        for (int i = 0; i < count; i++)
        {
            int sample = i * path.Count / count;
            var go = new GameObject("Checkpoint " + i);
            go.transform.SetParent(track.Root.transform, false);
            go.transform.position = path.Positions[sample] + Vector3.up * 2f;
            go.transform.rotation = Quaternion.LookRotation(path.Forwards[sample]);
            var box = go.AddComponent<BoxCollider>();
            box.isTrigger = true;
            box.size = new Vector3(railOffset * 2f + 2f, 6f, 1.5f);
            var checkpoint = go.AddComponent<Checkpoint>();
            checkpoint.Index = i;
            track.Checkpoints.Add(checkpoint);
            track.CheckpointSamples.Add(sample);
        }
    }

    static void BuildStart(BuiltTrack track, float width, float railOffset)
    {
        TrackPath path = track.Path;
        Vector3 start = path.Positions[0];
        Quaternion facing = Quaternion.LookRotation(path.Forwards[0]);

        GameObject stripe = GameObject.CreatePrimitive(PrimitiveType.Quad);
        stripe.name = "Start Line";
        Object.Destroy(stripe.GetComponent<Collider>());
        stripe.transform.SetParent(track.Root.transform, false);
        stripe.transform.position = start + Vector3.up * 0.04f;
        stripe.transform.rotation = facing * Quaternion.Euler(90f, 0f, 0f);
        stripe.transform.localScale = new Vector3(width, 3f, 1f);
        Material checker = Mats.Lit(Color.white, CheckerTexture(), 0.3f);
        checker.mainTextureScale = new Vector2(width / 1.5f, 2f);
        stripe.GetComponent<Renderer>().sharedMaterial = checker;

        BuildGantry(track.Root.transform, start, path.Rights[0], facing, railOffset * 2f + 2f);

        int spawnSample = (path.Count - 4 + path.Count) % path.Count;
        track.SpawnPosition = path.Positions[spawnSample] + Vector3.up * 0.3f;
        track.SpawnRotation = Quaternion.LookRotation(path.Forwards[spawnSample]);
    }

    /// A slim start/finish gantry: two uprights and a beam with neon trim.
    static void BuildGantry(Transform parent, Vector3 start, Vector3 right, Quaternion facing, float span)
    {
        const float height = 7.5f;
        Material metal = Mats.Lit(new Color(0.12f, 0.14f, 0.2f), null, 0.6f);
        Material neon = Mats.Glow(Color.white, 2.4f);
        var gantry = new GameObject("Gantry");
        gantry.transform.SetParent(parent, false);

        for (int side = -1; side <= 1; side += 2)
        {
            Vector3 foot = start + right * side * span * 0.5f;
            Block(gantry.transform, foot + Vector3.up * height * 0.5f, facing, new Vector3(0.5f, height, 0.5f), metal);
            Block(gantry.transform, foot + Vector3.up * height * 0.5f - right * side * 0.3f, facing, new Vector3(0.1f, height, 0.1f), neon);
        }
        Block(gantry.transform, start + Vector3.up * height, facing, new Vector3(span + 0.5f, 0.8f, 0.6f), metal);
        Block(gantry.transform, start + Vector3.up * (height - 0.45f), facing, new Vector3(span, 0.1f, 0.15f), neon);

        GameObject banner = GameObject.CreatePrimitive(PrimitiveType.Quad);
        banner.name = "Banner";
        Object.Destroy(banner.GetComponent<Collider>());
        banner.transform.SetParent(gantry.transform, false);
        banner.transform.position = start + Vector3.up * height + facing * Vector3.back * 0.31f;
        banner.transform.rotation = facing;
        banner.transform.localScale = new Vector3(span * 0.6f, 0.7f, 1f);
        Material checker = Mats.Lit(Color.white, CheckerTexture(), 0.3f);
        checker.mainTextureScale = new Vector2(span * 0.6f / 0.35f, 2f);
        banner.GetComponent<Renderer>().sharedMaterial = checker;
    }

    static void Block(Transform parent, Vector3 position, Quaternion rotation, Vector3 scale, Material material)
    {
        GameObject block = GameObject.CreatePrimitive(PrimitiveType.Cube);
        Object.Destroy(block.GetComponent<Collider>());
        block.transform.SetParent(parent, false);
        block.transform.SetPositionAndRotation(position, rotation);
        block.transform.localScale = scale;
        block.GetComponent<Renderer>().sharedMaterial = material;
    }

    static void Decorate(BuiltTrack track, ThemePayload theme, float railOffset, Color accent)
    {
        TrackPath path = track.Path;
        Transform root = track.Root.transform;
        string scenery = string.IsNullOrEmpty(theme.scenery) ? "city" : theme.scenery;

        // Grandstands along the outside of the start straight, facing the road.
        for (int i = -1; i <= 1; i++)
        {
            int sample = (i * 9 + path.Count) % path.Count;
            PlaceOutside(track, "RacingKit/grandStandCovered", sample, railOffset + 15f, 7.5f, true);
        }

        // Light towers and scenery every so often around the lap.
        int step = Mathf.Max(8, Mathf.RoundToInt(45f / path.Spacing));
        int n = 0;
        for (int sample = step; sample < path.Count - step; sample += step, n++)
        {
            PlaceOutside(track, "RacingKit/lightPostModern", sample, railOffset + 2.5f, 9f, false);
            switch (scenery)
            {
                case "desert":
                    PlaceOutside(track, n % 2 == 0 ? "RacingKit/tent" : "RacingKit/pylon", sample + step / 2, railOffset + 12f, n % 2 == 0 ? 7f : 2f, true);
                    break;
                case "frost":
                    PlaceOutside(track, n % 2 == 0 ? "RacingKit/treeLarge" : "RacingKit/treeSmall", sample + step / 2, railOffset + 10f, n % 2 == 0 ? 12f : 8f, false);
                    PlaceInside(track, "RacingKit/treeLarge", sample, railOffset + 14f, 11f);
                    break;
                default:
                    PlaceOutside(track, n % 2 == 0 ? "RacingKit/bannerTowerRed" : "RacingKit/billboard", sample + step / 2, railOffset + 12f, 9f, true);
                    break;
            }
        }
    }

    static void PlaceOutside(BuiltTrack track, string model, int sample, float offset, float size, bool faceRoad)
    {
        TrackPath path = track.Path;
        sample = ((sample % path.Count) + path.Count) % path.Count;
        Vector3 p = path.Positions[sample];
        Vector3 r = path.Rights[sample];
        float side = Vector3.Dot(r, p - track.Centroid) >= 0f ? 1f : -1f;
        Place(track, model, p + r * side * offset, faceRoad ? -r * side : path.Forwards[sample], size);
    }

    static void PlaceInside(BuiltTrack track, string model, int sample, float offset, float size)
    {
        TrackPath path = track.Path;
        sample = ((sample % path.Count) + path.Count) % path.Count;
        Vector3 p = path.Positions[sample];
        Vector3 r = path.Rights[sample];
        float side = Vector3.Dot(r, p - track.Centroid) >= 0f ? -1f : 1f;
        Vector3 at = p + r * side * offset;
        // Skip infield spots that would land on another part of the circuit.
        if (Vector3.Distance(at, track.Centroid) < 15f)
        {
            return;
        }
        Place(track, model, at, path.Forwards[sample], size);
    }

    static void Place(BuiltTrack track, string model, Vector3 position, Vector3 facing, float size)
    {
        GameObject prop = Props.Spawn(model, track.Root.transform, size);
        prop.transform.position = position;
        prop.transform.rotation = Quaternion.LookRotation(facing, Vector3.up);
        Props.Ground(prop);
        foreach (var c in prop.GetComponentsInChildren<Collider>())
        {
            Object.Destroy(c);
        }
    }

    static Texture2D RoadTexture(Color asphalt, Color line)
    {
        const int w = 128;
        const int h = 128;
        var tex = new Texture2D(w, h, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Repeat };
        var rng = new System.Random(7);
        var pixels = new Color[w * h];
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                float u = x / (float)w;
                float v = y / (float)h;
                float noise = (float)rng.NextDouble() * 0.05f - 0.025f;
                Color c = asphalt + new Color(noise, noise, noise, 0f);
                bool edge = (u > 0.03f && u < 0.055f) || (u > 0.945f && u < 0.97f);
                bool centre = u > 0.49f && u < 0.51f && v < 0.5f;
                if (edge || centre)
                {
                    c = Color.Lerp(c, line, 0.85f);
                }
                pixels[y * w + x] = c;
            }
        }
        tex.SetPixels(pixels);
        tex.Apply(true);
        return tex;
    }

    static Texture2D CurbTexture(Color a, Color b)
    {
        var tex = new Texture2D(2, 2, TextureFormat.RGBA32, false)
        {
            wrapMode = TextureWrapMode.Repeat,
            filterMode = FilterMode.Point,
        };
        tex.SetPixels(new[] { a, a, b, b });
        tex.Apply();
        return tex;
    }

    static Texture2D CheckerTexture()
    {
        var tex = new Texture2D(2, 2, TextureFormat.RGBA32, false)
        {
            wrapMode = TextureWrapMode.Repeat,
            filterMode = FilterMode.Point,
        };
        tex.SetPixels(new[] { Color.white, Color.black, Color.black, Color.white });
        tex.Apply();
        return tex;
    }
}
