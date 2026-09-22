using System.Collections.Generic;
using UnityEngine;

/// Builds the world around a circuit from its centreline: themed scenery,
/// street lamps, boost pads, and (in the city) a skyline, an overpass and a
/// tunnel. Materials are shared so static batching keeps draw calls low.
public static class Scenery
{
    class Kit
    {
        public Transform Root;
        public BuiltTrack Track;
        public float RailOffset;
        public Color Accent;
        public System.Random Rng;
        public Material Metal;
        public Material LampGlow;
        public Material AccentGlow;
        public readonly List<Vector3> Sparse = new List<Vector3>();
    }

    public static void Build(BuiltTrack track, ThemePayload theme, float railOffset, Color accent)
    {
        string scenery = string.IsNullOrEmpty(theme.scenery) ? "city" : theme.scenery;
        var kit = new Kit
        {
            Root = track.Root.transform,
            Track = track,
            RailOffset = railOffset,
            Accent = accent,
            Rng = new System.Random(track.Path.Count * 7919),
            Metal = Mats.Lit(new Color(0.12f, 0.14f, 0.2f), null, 0.5f),
            AccentGlow = Mats.Glow(accent, 2.6f),
        };
        kit.LampGlow = Mats.Glow(scenery == "desert" ? new Color(1f, 0.78f, 0.45f) : new Color(0.85f, 0.95f, 1f), 3f);
        for (int i = 0; i < track.Path.Count; i += 4)
        {
            kit.Sparse.Add(track.Path.Positions[i]);
        }

        Grandstands(kit);
        BoostPads(kit);
        Lamps(kit);
        switch (scenery)
        {
            case "desert":
                Desert(kit, theme);
                break;
            case "frost":
                Frost(kit, theme);
                break;
            default:
                City(kit);
                break;
        }
    }

    // ---------- shared pieces ----------

    static void Grandstands(Kit kit)
    {
        TrackPath path = kit.Track.Path;
        for (int i = -1; i <= 1; i++)
        {
            int sample = Wrap(path, i * 9);
            Vector3 outward = Outward(kit, sample);
            Place(kit, "RacingKit/grandStandCovered", path.Positions[sample] + outward * (kit.RailOffset + 15f), -outward, 7.5f);
        }
    }

    /// Glowing chevron strips on the straightest parts of three stretches of the lap.
    static void BoostPads(Kit kit)
    {
        TrackPath path = kit.Track.Path;
        Material pad = Mats.ParticleAdditive(FxTextures.Chevron);
        Mats.Tint(pad, new Color(kit.Accent.r, kit.Accent.g, kit.Accent.b, 0.9f));
        pad.mainTextureScale = new Vector2(1f, 2f);

        float[] fractions = { 0.22f, 0.55f, 0.84f };
        for (int n = 0; n < fractions.Length; n++)
        {
            int sample = Straightest(path, fractions[n] - 0.08f, fractions[n] + 0.08f);
            float lateral = (n % 2 == 0 ? -1f : 1f) * kit.Track.Width * 0.2f;
            Vector3 at = path.Positions[sample] + path.Rights[sample] * lateral + Vector3.up * 0.05f;
            Quaternion facing = Quaternion.LookRotation(path.Forwards[sample]);

            GameObject strip = GameObject.CreatePrimitive(PrimitiveType.Quad);
            strip.name = "Boost Pad";
            Object.Destroy(strip.GetComponent<Collider>());
            strip.transform.SetParent(kit.Root, false);
            strip.transform.SetPositionAndRotation(at, facing * Quaternion.Euler(90f, 0f, 0f));
            strip.transform.localScale = new Vector3(4.5f, 9f, 1f);
            strip.GetComponent<Renderer>().sharedMaterial = pad;

            var trigger = new GameObject("Boost Pad Trigger");
            trigger.transform.SetParent(kit.Root, false);
            trigger.transform.SetPositionAndRotation(at + Vector3.up * 1f, facing);
            var box = trigger.AddComponent<BoxCollider>();
            box.isTrigger = true;
            box.size = new Vector3(4.5f, 3f, 9f);
            trigger.AddComponent<BoostPad>();
        }
    }

    /// Street lamps along the outside of the circuit, arms reaching over the road.
    static void Lamps(Kit kit)
    {
        TrackPath path = kit.Track.Path;
        int step = Mathf.Max(6, Mathf.RoundToInt(38f / path.Spacing));
        for (int sample = step / 2; sample < path.Count; sample += step)
        {
            Vector3 outward = Outward(kit, sample);
            Vector3 foot = path.Positions[sample] + outward * (kit.RailOffset + 1.4f);
            Quaternion facing = Quaternion.LookRotation(path.Forwards[sample]);
            Block(kit.Root, foot + Vector3.up * 3.5f, facing, new Vector3(0.22f, 7f, 0.22f), kit.Metal);
            Block(kit.Root, foot + Vector3.up * 7f - outward * 1.1f, Quaternion.LookRotation(outward), new Vector3(0.14f, 0.14f, 2.4f), kit.Metal);
            Block(kit.Root, foot + Vector3.up * 6.85f - outward * 2.2f, Quaternion.LookRotation(outward), new Vector3(0.5f, 0.12f, 0.9f), kit.LampGlow);
        }
    }

    // ---------- city ----------

    static void City(Kit kit)
    {
        Skyline(kit);
        NeonAds(kit);
        Overpass(kit);
        Tunnel(kit);
    }

    static void Skyline(Kit kit)
    {
        TrackPath path = kit.Track.Path;
        Bounds bounds = PathBounds(path);
        Texture2D windowsTex = WindowTexture(kit.Rng);
        Material[] facades =
        {
            Mats.Windows(new Color(0.06f, 0.07f, 0.11f), windowsTex, new Vector2(2f, 6f)),
            Mats.Windows(new Color(0.08f, 0.06f, 0.1f), windowsTex, new Vector2(3f, 9f), 1.1f),
            Mats.Windows(new Color(0.05f, 0.08f, 0.1f), windowsTex, new Vector2(2f, 4f), 1.5f),
        };
        Material beacon = Mats.Glow(new Color(1f, 0.25f, 0.35f), 3f);

        const float step = 26f;
        for (float x = bounds.min.x - 170f; x <= bounds.max.x + 170f; x += step)
        {
            for (float z = bounds.min.z - 170f; z <= bounds.max.z + 170f; z += step)
            {
                var at = new Vector3(x + Jitter(kit, 8f), 0f, z + Jitter(kit, 8f));
                float distance = DistanceToTrack(kit, at);
                if (distance < kit.RailOffset + 24f || distance > 240f || kit.Rng.NextDouble() < 0.28)
                {
                    continue;
                }
                float far = Mathf.InverseLerp(30f, 200f, distance);
                float height = Mathf.Lerp(14f, 72f, far) * (0.6f + (float)kit.Rng.NextDouble() * 0.8f);
                float width = 10f + (float)kit.Rng.NextDouble() * 12f;
                float depth = 10f + (float)kit.Rng.NextDouble() * 12f;
                Quaternion turn = Quaternion.Euler(0f, (float)kit.Rng.NextDouble() * 90f, 0f);
                Block(kit.Root, at + Vector3.up * height * 0.5f, turn, new Vector3(width, height, depth), facades[kit.Rng.Next(facades.Length)]);
                if (kit.Rng.NextDouble() < 0.18)
                {
                    Block(kit.Root, at + Vector3.up * (height + 0.6f), turn, new Vector3(0.8f, 1.2f, 0.8f), beacon);
                }
            }
        }
    }

    /// Glowing billboard panels on posts facing the road.
    static void NeonAds(Kit kit)
    {
        TrackPath path = kit.Track.Path;
        Color[] colours = { kit.Accent, new Color(0.96f, 0.3f, 0.7f), new Color(1f, 0.7f, 0.2f), new Color(0.55f, 0.4f, 1f) };
        int step = Mathf.Max(20, Mathf.RoundToInt(110f / path.Spacing));
        int n = 0;
        for (int sample = step / 3; sample < path.Count; sample += step, n++)
        {
            Vector3 outward = Outward(kit, sample);
            Vector3 foot = path.Positions[sample] + outward * (kit.RailOffset + 11f);
            Quaternion face = Quaternion.LookRotation(-outward);
            Block(kit.Root, foot + Vector3.up * 3f, face, new Vector3(0.4f, 6f, 0.4f), kit.Metal);
            Block(kit.Root, foot + Vector3.up * 8f, face, new Vector3(9f, 4f, 0.4f), kit.Metal);
            Block(kit.Root, foot + Vector3.up * 8f - outward * 0.25f, face, new Vector3(8.4f, 3.4f, 0.1f), Mats.Glow(colours[n % colours.Length], 2.4f));
        }
    }

    static void Overpass(Kit kit)
    {
        TrackPath path = kit.Track.Path;
        int sample = Straightest(path, 0.3f, 0.45f);
        Vector3 centre = path.Positions[sample];
        Quaternion facing = Quaternion.LookRotation(path.Forwards[sample]);
        Vector3 right = path.Rights[sample];
        float span = kit.RailOffset * 2f + 18f;
        const float height = 9f;

        Block(kit.Root, centre + Vector3.up * height, facing, new Vector3(span, 1.3f, 11f), kit.Metal);
        Block(kit.Root, centre + Vector3.up * (height - 0.7f) + path.Forwards[sample] * 5.6f, facing, new Vector3(span, 0.15f, 0.2f), kit.AccentGlow);
        Block(kit.Root, centre + Vector3.up * (height - 0.7f) - path.Forwards[sample] * 5.6f, facing, new Vector3(span, 0.15f, 0.2f), kit.AccentGlow);
        for (int side = -1; side <= 1; side += 2)
        {
            Block(kit.Root, centre + right * side * (kit.RailOffset + 6f) + Vector3.up * height * 0.5f, facing, new Vector3(1.6f, height, 1.6f), kit.Metal);
        }
    }

    /// A 50 m tunnel on a straight: walls, a roof, and strobing roof lights.
    static void Tunnel(Kit kit)
    {
        TrackPath path = kit.Track.Path;
        int centre = Straightest(path, 0.66f, 0.82f);
        int half = Mathf.RoundToInt(25f / path.Spacing);
        float offset = kit.RailOffset + 0.9f;
        const float height = 7.5f;

        var vertices = new List<Vector3>();
        var triangles = new List<int>();
        for (int k = -half; k < half; k++)
        {
            int a = Wrap(path, centre + k);
            int b = Wrap(path, centre + k + 1);
            Vector3 la = path.Positions[a] - path.Rights[a] * offset;
            Vector3 ra = path.Positions[a] + path.Rights[a] * offset;
            Vector3 lb = path.Positions[b] - path.Rights[b] * offset;
            Vector3 rb = path.Positions[b] + path.Rights[b] * offset;
            Vector3 up = Vector3.up * height;
            // Left wall, right wall and roof, each facing into the tunnel.
            Quad(vertices, triangles, la, lb, lb + up, la + up);
            Quad(vertices, triangles, rb, ra, ra + up, rb + up);
            Quad(vertices, triangles, la + up, lb + up, rb + up, ra + up);
        }
        var mesh = new Mesh { name = "Tunnel" };
        mesh.SetVertices(vertices);
        mesh.SetTriangles(triangles, 0);
        mesh.RecalculateNormals();
        var go = new GameObject("Tunnel");
        go.transform.SetParent(kit.Root, false);
        go.AddComponent<MeshFilter>().sharedMesh = mesh;
        go.AddComponent<MeshRenderer>().sharedMaterial = Mats.Lit(new Color(0.09f, 0.1f, 0.14f), null, 0.3f);

        for (int k = -half; k < half; k += 3)
        {
            int s = Wrap(path, centre + k);
            Block(kit.Root, path.Positions[s] + Vector3.up * (height - 0.1f), Quaternion.LookRotation(path.Forwards[s]), new Vector3(kit.Track.Width * 0.7f, 0.1f, 0.6f), kit.LampGlow);
            Block(kit.Root, path.Positions[s] + path.Rights[s] * (offset - 0.1f) + Vector3.up * 1.2f, Quaternion.LookRotation(path.Forwards[s]), new Vector3(0.1f, 0.15f, 1.6f), kit.AccentGlow);
            Block(kit.Root, path.Positions[s] - path.Rights[s] * (offset - 0.1f) + Vector3.up * 1.2f, Quaternion.LookRotation(path.Forwards[s]), new Vector3(0.1f, 0.15f, 1.6f), kit.AccentGlow);
        }
    }

    // ---------- desert ----------

    static void Desert(Kit kit, ThemePayload theme)
    {
        TrackPath path = kit.Track.Path;
        Color ground = Palette.Parse(theme.ground, new Color(0.79f, 0.6f, 0.36f));
        Material rock = Mats.Lit(new Color(0.55f, 0.33f, 0.2f), null, 0.1f);
        Material sand = Mats.Lit(ground * 1.05f, null, 0.05f);

        Scatter(kit, 70, kit.RailOffset + 60f, 260f, (at) =>
        {
            float h = 12f + (float)kit.Rng.NextDouble() * 30f;
            float w = 20f + (float)kit.Rng.NextDouble() * 40f;
            Block(kit.Root, at + Vector3.up * h * 0.5f, Quaternion.Euler(0f, (float)kit.Rng.NextDouble() * 90f, 0f), new Vector3(w, h, w * 0.7f), rock);
        });
        Scatter(kit, 40, kit.RailOffset + 16f, 120f, (at) =>
        {
            GameObject dune = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            Object.Destroy(dune.GetComponent<Collider>());
            dune.transform.SetParent(kit.Root, false);
            dune.transform.position = at;
            dune.transform.localScale = new Vector3(30f + (float)kit.Rng.NextDouble() * 20f, 5f, 20f + (float)kit.Rng.NextDouble() * 15f);
            dune.GetComponent<Renderer>().sharedMaterial = sand;
        });
        int step = Mathf.Max(10, Mathf.RoundToInt(60f / path.Spacing));
        for (int sample = step; sample < path.Count; sample += step)
        {
            Vector3 outward = Outward(kit, sample);
            Place(kit, sample % 2 == 0 ? "RacingKit/tent" : "RacingKit/pylon", path.Positions[sample] + outward * (kit.RailOffset + 12f), -outward, sample % 2 == 0 ? 7f : 2f);
        }
    }

    // ---------- frost ----------

    static void Frost(Kit kit, ThemePayload theme)
    {
        Material snow = Mats.Lit(new Color(0.93f, 0.96f, 1f), null, 0.4f);
        Material ice = Mats.Glow(new Color(0.49f, 0.83f, 0.99f), 1.8f);

        Scatter(kit, 110, kit.RailOffset + 12f, 150f, (at) =>
        {
            string model = kit.Rng.NextDouble() < 0.6 ? "RacingKit/treeLarge" : "RacingKit/treeSmall";
            Place(kit, model, at, Quaternion.Euler(0f, (float)kit.Rng.NextDouble() * 360f, 0f) * Vector3.forward, 9f + (float)kit.Rng.NextDouble() * 6f);
        });
        Scatter(kit, 40, kit.RailOffset + 14f, 110f, (at) =>
        {
            GameObject mound = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            Object.Destroy(mound.GetComponent<Collider>());
            mound.transform.SetParent(kit.Root, false);
            mound.transform.position = at;
            mound.transform.localScale = new Vector3(18f + (float)kit.Rng.NextDouble() * 14f, 4f, 14f + (float)kit.Rng.NextDouble() * 10f);
            mound.GetComponent<Renderer>().sharedMaterial = snow;
        });
        Scatter(kit, 30, kit.RailOffset + 10f, 70f, (at) =>
        {
            float h = 2f + (float)kit.Rng.NextDouble() * 5f;
            Block(kit.Root, at + Vector3.up * h * 0.45f, Quaternion.Euler((float)kit.Rng.NextDouble() * 20f, (float)kit.Rng.NextDouble() * 90f, 12f), new Vector3(0.9f, h, 0.9f), ice);
        });
    }

    // ---------- helpers ----------

    static void Scatter(Kit kit, int count, float minDistance, float maxDistance, System.Action<Vector3> place)
    {
        Bounds bounds = PathBounds(kit.Track.Path);
        int placed = 0;
        for (int attempt = 0; attempt < count * 12 && placed < count; attempt++)
        {
            var at = new Vector3(
                Mathf.Lerp(bounds.min.x - maxDistance, bounds.max.x + maxDistance, (float)kit.Rng.NextDouble()),
                0f,
                Mathf.Lerp(bounds.min.z - maxDistance, bounds.max.z + maxDistance, (float)kit.Rng.NextDouble()));
            float distance = DistanceToTrack(kit, at);
            if (distance < minDistance || distance > maxDistance)
            {
                continue;
            }
            place(at);
            placed++;
        }
    }

    static float DistanceToTrack(Kit kit, Vector3 at)
    {
        float best = float.MaxValue;
        foreach (Vector3 p in kit.Sparse)
        {
            float d = (p.x - at.x) * (p.x - at.x) + (p.z - at.z) * (p.z - at.z);
            if (d < best) best = d;
        }
        return Mathf.Sqrt(best);
    }

    static Bounds PathBounds(TrackPath path)
    {
        var bounds = new Bounds(path.Positions[0], Vector3.zero);
        foreach (Vector3 p in path.Positions) bounds.Encapsulate(p);
        return bounds;
    }

    /// The sample whose neighbourhood turns least, within a fraction of the lap.
    static int Straightest(TrackPath path, float from, float to)
    {
        int start = Mathf.RoundToInt(Mathf.Repeat(from, 1f) * path.Count);
        int end = Mathf.RoundToInt(Mathf.Repeat(to, 1f) * path.Count);
        if (end <= start) end += path.Count;
        int best = start;
        float bestTurn = float.MaxValue;
        for (int i = start; i <= end; i++)
        {
            float turn = Vector3.Angle(path.Forwards[Wrap(path, i - 12)], path.Forwards[Wrap(path, i + 12)]);
            if (turn < bestTurn)
            {
                bestTurn = turn;
                best = Wrap(path, i);
            }
        }
        return best;
    }

    static Vector3 Outward(Kit kit, int sample)
    {
        TrackPath path = kit.Track.Path;
        Vector3 r = path.Rights[sample];
        return Vector3.Dot(r, path.Positions[sample] - kit.Track.Centroid) >= 0f ? r : -r;
    }

    static int Wrap(TrackPath path, int i)
    {
        return ((i % path.Count) + path.Count) % path.Count;
    }

    static float Jitter(Kit kit, float amount)
    {
        return ((float)kit.Rng.NextDouble() * 2f - 1f) * amount;
    }

    static void Place(Kit kit, string model, Vector3 position, Vector3 facing, float size)
    {
        GameObject prop = Props.Spawn(model, kit.Root, size);
        prop.transform.position = position;
        prop.transform.rotation = Quaternion.LookRotation(facing, Vector3.up);
        Props.Ground(prop);
        foreach (var c in prop.GetComponentsInChildren<Collider>())
        {
            Object.Destroy(c);
        }
    }

    public static void Block(Transform parent, Vector3 position, Quaternion rotation, Vector3 scale, Material material)
    {
        GameObject block = GameObject.CreatePrimitive(PrimitiveType.Cube);
        Object.Destroy(block.GetComponent<Collider>());
        block.transform.SetParent(parent, false);
        block.transform.SetPositionAndRotation(position, rotation);
        block.transform.localScale = scale;
        block.GetComponent<Renderer>().sharedMaterial = material;
    }

    static void Quad(List<Vector3> vertices, List<int> triangles, Vector3 a, Vector3 b, Vector3 c, Vector3 d)
    {
        int i = vertices.Count;
        vertices.Add(a);
        vertices.Add(b);
        vertices.Add(c);
        vertices.Add(d);
        triangles.Add(i);
        triangles.Add(i + 1);
        triangles.Add(i + 2);
        triangles.Add(i);
        triangles.Add(i + 2);
        triangles.Add(i + 3);
        // Also the reverse side, so the geometry reads from either direction.
        triangles.Add(i);
        triangles.Add(i + 2);
        triangles.Add(i + 1);
        triangles.Add(i);
        triangles.Add(i + 3);
        triangles.Add(i + 2);
    }

    /// A facade tile of windows, some lit in warm or cool colours.
    static Texture2D WindowTexture(System.Random rng)
    {
        const int w = 64;
        const int h = 128;
        var tex = new Texture2D(w, h, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Repeat };
        var pixels = new Color[w * h];
        Color[] lit = { new Color(1f, 0.85f, 0.55f), new Color(0.6f, 0.9f, 1f), new Color(1f, 0.55f, 0.85f) };
        const int cols = 8;
        const int rows = 16;
        var cells = new Color[cols * rows];
        for (int i = 0; i < cells.Length; i++)
        {
            cells[i] = rng.NextDouble() < 0.38 ? lit[rng.Next(lit.Length)] * (0.6f + (float)rng.NextDouble() * 0.4f) : new Color(0.02f, 0.03f, 0.05f);
        }
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int cx = x * cols / w;
                int cy = y * rows / h;
                float u = (x % (w / cols)) / (float)(w / cols);
                float v = (y % (h / rows)) / (float)(h / rows);
                bool window = u > 0.2f && u < 0.8f && v > 0.25f && v < 0.8f;
                pixels[y * w + x] = window ? cells[cy * cols + cx] : Color.black;
            }
        }
        tex.SetPixels(pixels);
        tex.Apply(true);
        return tex;
    }
}
