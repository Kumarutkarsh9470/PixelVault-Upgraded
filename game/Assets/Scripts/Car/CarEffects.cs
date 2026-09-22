using UnityEngine;

/// Tyre smoke and skid marks while drifting, sparks on wall hits, and a
/// boost flame. Pure feedback: nothing here affects handling.
[RequireComponent(typeof(CarController))]
public class CarEffects : MonoBehaviour
{
    CarController car;
    CarVisuals visuals;
    ParticleSystem smoke;
    ParticleSystem sparks;
    TrailRenderer[] skids;
    GameObject flame;
    Material flameMat;

    void Awake()
    {
        car = GetComponent<CarController>();
        visuals = GetComponent<CarVisuals>();
        smoke = CreateSmoke();
        sparks = CreateSparks();
        skids = new[] { CreateSkid(-1f), CreateSkid(1f) };
        flame = CreateFlame();
        car.Impact += OnImpact;
    }

    void OnDestroy()
    {
        if (car != null) car.Impact -= OnImpact;
    }

    void LateUpdate()
    {
        Vector3 size = visuals != null ? visuals.ModelSize : new Vector3(1.9f, 1.1f, 3.8f);
        smoke.transform.localPosition = new Vector3(0f, 0.3f, -size.z * 0.42f);

        var emission = smoke.emission;
        emission.rateOverTime = car.Drifting ? 45f : car.Boosting ? 8f : 0f;

        for (int i = 0; i < skids.Length; i++)
        {
            float side = i == 0 ? -1f : 1f;
            skids[i].transform.localPosition = new Vector3(side * size.x * 0.38f, 0.04f, -size.z * 0.4f);
            skids[i].emitting = car.Drifting;
        }

        bool boosting = car.Boosting;
        if (flame.activeSelf != boosting) flame.SetActive(boosting);
        if (boosting)
        {
            flame.transform.localPosition = new Vector3(0f, 0.45f, -size.z * 0.55f);
            float pulse = 1f + Mathf.Sin(Time.time * 40f) * 0.15f;
            flame.transform.localScale = new Vector3(size.x * 0.6f, 0.35f, 1.6f * pulse);
        }
    }

    void OnImpact(float strength)
    {
        sparks.transform.position = transform.position + transform.forward * 1.2f + Vector3.up * 0.4f;
        sparks.Emit(Mathf.RoundToInt(10 + 40 * strength));
    }

    ParticleSystem CreateSmoke()
    {
        var go = new GameObject("Tyre Smoke");
        go.transform.SetParent(transform, false);
        var ps = go.AddComponent<ParticleSystem>();
        ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);

        var main = ps.main;
        main.duration = 1f;
        main.loop = true;
        main.startLifetime = new ParticleSystem.MinMaxCurve(0.6f, 1.1f);
        main.startSpeed = new ParticleSystem.MinMaxCurve(0.5f, 2f);
        main.startSize = new ParticleSystem.MinMaxCurve(1.2f, 2.4f);
        main.startColor = new Color(0.85f, 0.88f, 0.95f, 0.35f);
        main.simulationSpace = ParticleSystemSimulationSpace.World;
        main.maxParticles = 200;

        var shape = ps.shape;
        shape.shapeType = ParticleSystemShapeType.Box;
        shape.scale = new Vector3(1.6f, 0.1f, 0.4f);

        var size = ps.sizeOverLifetime;
        size.enabled = true;
        size.size = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.Linear(0f, 0.6f, 1f, 1.6f));

        var colour = ps.colorOverLifetime;
        colour.enabled = true;
        var gradient = new Gradient();
        gradient.SetKeys(
            new[] { new GradientColorKey(Color.white, 0f), new GradientColorKey(Color.white, 1f) },
            new[] { new GradientAlphaKey(1f, 0f), new GradientAlphaKey(0f, 1f) });
        colour.color = gradient;

        var emission = ps.emission;
        emission.rateOverTime = 0f;

        var renderer = go.GetComponent<ParticleSystemRenderer>();
        renderer.sharedMaterial = Mats.ParticleAlpha(FxTextures.SoftDot);
        ps.Play();
        return ps;
    }

    ParticleSystem CreateSparks()
    {
        var go = new GameObject("Sparks");
        go.transform.SetParent(null, false);
        var ps = go.AddComponent<ParticleSystem>();
        ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);

        var main = ps.main;
        main.loop = false;
        main.playOnAwake = false;
        main.startLifetime = new ParticleSystem.MinMaxCurve(0.2f, 0.5f);
        main.startSpeed = new ParticleSystem.MinMaxCurve(6f, 16f);
        main.startSize = new ParticleSystem.MinMaxCurve(0.08f, 0.2f);
        main.startColor = new Color(1f, 0.75f, 0.3f, 1f);
        main.gravityModifier = 1.5f;
        main.simulationSpace = ParticleSystemSimulationSpace.World;
        main.maxParticles = 200;

        var shape = ps.shape;
        shape.shapeType = ParticleSystemShapeType.Sphere;
        shape.radius = 0.3f;

        var emission = ps.emission;
        emission.rateOverTime = 0f;

        var renderer = go.GetComponent<ParticleSystemRenderer>();
        renderer.renderMode = ParticleSystemRenderMode.Stretch;
        renderer.velocityScale = 0.06f;
        renderer.lengthScale = 1f;
        renderer.sharedMaterial = Mats.ParticleAdditive(FxTextures.SoftDot);
        return ps;
    }

    TrailRenderer CreateSkid(float side)
    {
        var go = new GameObject(side < 0f ? "Skid L" : "Skid R");
        go.transform.SetParent(transform, false);
        var trail = go.AddComponent<TrailRenderer>();
        trail.time = 2.5f;
        trail.minVertexDistance = 0.4f;
        trail.widthMultiplier = 0.35f;
        trail.alignment = LineAlignment.TransformZ;
        go.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
        trail.sharedMaterial = Mats.ParticleAlpha(null);
        trail.startColor = new Color(0.05f, 0.05f, 0.07f, 0.55f);
        trail.endColor = new Color(0.05f, 0.05f, 0.07f, 0f);
        trail.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        trail.emitting = false;
        return trail;
    }

    GameObject CreateFlame()
    {
        GameObject go = GameObject.CreatePrimitive(PrimitiveType.Quad);
        go.name = "Boost Flame";
        Destroy(go.GetComponent<Collider>());
        go.transform.SetParent(transform, false);
        go.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
        flameMat = Mats.ParticleAdditive(FxTextures.SoftDot);
        Mats.Tint(flameMat, new Color(0.4f, 0.8f, 1f, 1f));
        go.GetComponent<Renderer>().sharedMaterial = flameMat;
        go.SetActive(false);
        return go;
    }

    public void ClearTrails()
    {
        foreach (var s in skids)
        {
            s.Clear();
        }
        smoke.Clear();
    }
}
