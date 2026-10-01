using UnityEngine;

/// The forge the runner runs through: glyph-lit pillars, overhead arches and
/// drifting embers, recycled along the run. The glow colour moves through the
/// three rune colours as the run gets longer and faster.
public class ForgeScenery : MonoBehaviour
{
    const float PillarSpacing = 16f;
    const float PillarX = 5.6f;
    const int Pillars = 18;
    const float ArchEvery = 3;

    Transform[] pillars;
    Material pillarGlow;
    Material sky;
    ParticleSystem embers;

    void Awake()
    {
        Material stone = Mats.Lit(new Color(0.07f, 0.06f, 0.1f), 0.15f);
        pillarGlow = Mats.Glow(LevelView.EmberColor, 2.2f);

        pillars = new Transform[Pillars];
        for (int i = 0; i < Pillars; i++)
        {
            var pair = new GameObject("Pillars").transform;
            pair.SetParent(transform, false);
            for (int side = -1; side <= 1; side += 2)
            {
                Box(pair, stone, new Vector3(side * PillarX, 3.5f, 0f), new Vector3(1f, 7f, 1f));
                Box(pair, pillarGlow, new Vector3(side * (PillarX - 0.51f), 3.2f, 0f), new Vector3(0.02f, 4.5f, 0.18f));
                Box(pair, pillarGlow, new Vector3(side * (PillarX - 0.51f), 3.2f, 0f), new Vector3(0.02f, 0.18f, 0.6f));
            }
            if (i % ArchEvery == 0)
            {
                Box(pair, stone, new Vector3(0f, 7.3f, 0f), new Vector3(2f * PillarX + 1f, 0.8f, 1f));
                Box(pair, pillarGlow, new Vector3(0f, 6.88f, 0f), new Vector3(2f * PillarX - 1f, 0.04f, 0.2f));
            }
            pillars[i] = pair;
        }

        embers = Fx.Aura(transform, 6f, 30f);
        var main = embers.main;
        main.startColor = new Color(1f, 0.55f, 0.35f, 0.7f);
        main.startSize = new ParticleSystem.MinMaxCurve(0.05f, 0.14f);
        main.startSpeed = new ParticleSystem.MinMaxCurve(0.3f, 1.2f);
        var shape = embers.shape;
        shape.shapeType = ParticleSystemShapeType.Box;
        shape.scale = new Vector3(14f, 6f, 40f);

        sky = Mats.Sky();
        RenderSettings.skybox = sky;
        RenderSettings.fog = true;
        RenderSettings.fogMode = FogMode.Linear;
        RenderSettings.fogStartDistance = 40f;
        RenderSettings.fogEndDistance = 230f;
        RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
        RenderSettings.ambientLight = new Color(0.32f, 0.3f, 0.45f);
    }

    static void Box(Transform parent, Material mat, Vector3 position, Vector3 scale)
    {
        var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
        Destroy(go.GetComponent<Collider>());
        go.transform.SetParent(parent, false);
        go.transform.localPosition = position;
        go.transform.localScale = scale;
        go.GetComponent<Renderer>().sharedMaterial = mat;
    }

    public void Draw(float distanceMeters, int tick)
    {
        float start = Mathf.Floor((distanceMeters - PillarSpacing * 2f) / PillarSpacing) * PillarSpacing;
        for (int i = 0; i < Pillars; i++)
        {
            float z = start + i * PillarSpacing;
            int index = Mathf.RoundToInt(z / PillarSpacing);
            Transform pair = pillars[((index % Pillars) + Pillars) % Pillars];
            pair.localPosition = new Vector3(0f, 0f, z);
        }
        embers.transform.localPosition = new Vector3(0f, 3f, distanceMeters + 20f);

        // Ember, then tide, then storm as the run speeds up.
        float t = Mathf.Clamp01(tick / (float)(RunnerSim.TickHz * 120));
        Color mood = t < 0.5f
            ? Color.Lerp(LevelView.EmberColor, LevelView.TideColor, t * 2f)
            : Color.Lerp(LevelView.TideColor, LevelView.StormColor, (t - 0.5f) * 2f);
        pillarGlow.SetColor("_EmissionColor", mood * 2.2f);
        Color horizon = Color.Lerp(new Color(0.12f, 0.05f, 0.08f), mood * 0.25f, 0.5f);
        sky.SetColor("_TopColor", new Color(0.02f, 0.015f, 0.04f));
        sky.SetColor("_HorizonColor", horizon);
        sky.SetColor("_BottomColor", horizon * 0.5f);
        RenderSettings.fogColor = horizon;
    }
}
