using UnityEngine;

/// The runner, built from primitives and animated from the simulation's state.
/// Wears cosmetics from both games: a Glyph Forge frame (the glowing bands and
/// visor) and aura, plus a Neon Racer trail and underglow found in the wallet.
public class RunnerAvatar : MonoBehaviour
{
    const float JumpHeight = 1.7f;
    const int LaneTweenTicks = 9;
    static readonly Color DefaultFrame = new Color(0.62f, 0.7f, 1f);

    Transform body;
    Transform leftLeg, rightLeg, leftArm, rightArm;
    Material frameMat;
    Material underglowMat;
    Renderer[] renderers;
    ParticleSystem aura;
    TrailRenderer trail;
    GameObject underglow;
    Light underglowLight;
    ParticleSystem shatter;

    float laneFrom = 1f, laneTo = 1f;
    int laneTweenStart = -100;
    float stride;

    public float JumpY { get; private set; }

    void Awake()
    {
        Material suit = Mats.Lit(new Color(0.09f, 0.1f, 0.15f), 0.5f);
        frameMat = Mats.Glow(DefaultFrame, 2.4f);

        body = new GameObject("Body").transform;
        body.SetParent(transform, false);
        Part(body, PrimitiveType.Capsule, suit, new Vector3(0f, 1.05f, 0f), new Vector3(0.55f, 0.42f, 0.4f));
        Part(body, PrimitiveType.Sphere, suit, new Vector3(0f, 1.78f, 0f), Vector3.one * 0.42f);
        Part(body, PrimitiveType.Cube, frameMat, new Vector3(0f, 1.8f, -0.19f), new Vector3(0.32f, 0.08f, 0.04f));
        Part(body, PrimitiveType.Cylinder, frameMat, new Vector3(0f, 1.38f, 0f), new Vector3(0.64f, 0.015f, 0.5f));
        Part(body, PrimitiveType.Cylinder, frameMat, new Vector3(0f, 0.86f, 0f), new Vector3(0.6f, 0.015f, 0.46f));
        leftArm = Limb(body, suit, new Vector3(-0.36f, 1.42f, 0f), 0.55f);
        rightArm = Limb(body, suit, new Vector3(0.36f, 1.42f, 0f), 0.55f);
        leftLeg = Limb(body, suit, new Vector3(-0.14f, 0.68f, 0f), 0.68f);
        rightLeg = Limb(body, suit, new Vector3(0.14f, 0.68f, 0f), 0.68f);

        aura = Fx.Aura(transform, 0.55f, 0f);
        aura.transform.localPosition = new Vector3(0f, 1.1f, 0f);

        var trailGo = new GameObject("Trail");
        trailGo.transform.SetParent(transform, false);
        trailGo.transform.localPosition = new Vector3(0f, 0.2f, 0f);
        trail = trailGo.AddComponent<TrailRenderer>();
        trail.time = 0.35f;
        trail.minVertexDistance = 0.2f;
        trail.widthCurve = AnimationCurve.Linear(0f, 0.45f, 1f, 0f);
        trail.sharedMaterial = Mats.Trail(Color.white);
        trail.emitting = false;

        underglowMat = Mats.Glow(Color.cyan, 1.6f);
        underglow = Part(transform, PrimitiveType.Cylinder, underglowMat, new Vector3(0f, 0.02f, 0f), new Vector3(1.3f, 0.005f, 1.3f));
        underglowLight = new GameObject("Underglow").AddComponent<Light>();
        underglowLight.transform.SetParent(transform, false);
        underglowLight.transform.localPosition = new Vector3(0f, 0.4f, 0f);
        underglowLight.type = LightType.Point;
        underglowLight.range = 4f;
        underglowLight.intensity = 2f;

        shatter = Fx.Burst(transform, 80);
        renderers = body.GetComponentsInChildren<Renderer>();
        SetCosmetics(new CosmeticsPayload());
    }

    static GameObject Part(Transform parent, PrimitiveType type, Material mat, Vector3 position, Vector3 scale)
    {
        var go = GameObject.CreatePrimitive(type);
        Destroy(go.GetComponent<Collider>());
        go.transform.SetParent(parent, false);
        go.transform.localPosition = position;
        go.transform.localScale = scale;
        go.GetComponent<Renderer>().sharedMaterial = mat;
        return go;
    }

    /// A limb that swings from its top end.
    static Transform Limb(Transform parent, Material mat, Vector3 pivot, float length)
    {
        var joint = new GameObject("Joint").transform;
        joint.SetParent(parent, false);
        joint.localPosition = pivot;
        Part(joint, PrimitiveType.Cube, mat, new Vector3(0f, -length * 0.5f, 0f), new Vector3(0.16f, length, 0.16f));
        return joint;
    }

    public void SetCosmetics(CosmeticsPayload c)
    {
        Color frame = Palette.Parse(c.frame, DefaultFrame);
        frameMat.color = frame * 0.35f;
        frameMat.SetColor("_EmissionColor", frame * 2.4f);

        bool hasAura = !string.IsNullOrEmpty(c.aura);
        var emission = aura.emission;
        emission.rateOverTime = hasAura ? 28f : 0f;
        var main = aura.main;
        main.startColor = Palette.Parse(c.aura, Color.white);

        bool hasTrail = !string.IsNullOrEmpty(c.trail);
        trail.emitting = hasTrail;
        if (!hasTrail) trail.Clear();
        Color trailColor = Palette.Parse(c.trail, Color.white);
        trail.startColor = trailColor;
        trail.endColor = new Color(trailColor.r, trailColor.g, trailColor.b, 0f);

        bool hasGlow = !string.IsNullOrEmpty(c.underglow);
        Color glow = Palette.Parse(c.underglow, Color.cyan);
        underglow.SetActive(hasGlow);
        underglowLight.enabled = hasGlow;
        underglowMat.SetColor("_EmissionColor", glow * 1.6f);
        underglowLight.color = glow;
    }

    /// Back to the start line, visible and standing.
    public void ResetPose()
    {
        laneFrom = laneTo = 1f;
        laneTweenStart = -100;
        foreach (Renderer r in renderers) r.enabled = true;
        trail.Clear();
        body.localRotation = Quaternion.identity;
        body.localPosition = Vector3.zero;
    }

    public void OnAction(RunnerSim sim, int action)
    {
        if (action == RunnerSim.Left || action == RunnerSim.Right)
        {
            laneFrom = CurrentLane(sim.Tick);
            laneTo = sim.PendingLane;
            laneTweenStart = sim.Tick;
        }
    }

    float CurrentLane(int tick)
    {
        float t = Mathf.Clamp01((tick - laneTweenStart) / (float)LaneTweenTicks);
        return Mathf.Lerp(laneFrom, laneTo, t * t * (3f - 2f * t));
    }

    public void Crash(Color color)
    {
        foreach (Renderer r in renderers) r.enabled = false;
        var main = shatter.main;
        main.startColor = color;
        shatter.transform.position = transform.position + Vector3.up;
        shatter.Emit(60);
    }

    public void Draw(RunnerSim sim, float distanceMeters, bool running)
    {
        if (sim == null) return;
        float tick = sim.Tick + Mathf.Clamp01((Time.time - Time.fixedTime) / Time.fixedDeltaTime);
        float lane = CurrentLane(Mathf.FloorToInt(tick));

        JumpY = 0f;
        if (sim.Airborne)
        {
            float p = Mathf.Clamp01((tick - (sim.AirUntil - RunnerSim.JumpTicks)) / RunnerSim.JumpTicks);
            JumpY = 4f * JumpHeight * p * (1f - p);
        }
        transform.localPosition = new Vector3(LevelView.LaneX(lane), JumpY, distanceMeters);

        float lean = (laneTo - lane) * -18f;
        if (sim.Sliding)
        {
            body.localRotation = Quaternion.Euler(-68f, 0f, lean);
            body.localPosition = new Vector3(0f, 0.1f, 0.4f);
        }
        else
        {
            body.localRotation = Quaternion.Euler(sim.Airborne ? -10f : 6f, 0f, lean);
            body.localPosition = Vector3.zero;
        }

        if (running && !sim.Dead)
        {
            stride += Time.deltaTime * RunnerSim.SpeedAt(sim.Tick) * RunnerSim.TickHz / 1000f * 1.3f;
        }
        float swing = sim.Airborne || sim.Sliding ? 0.25f : Mathf.Sin(stride);
        leftLeg.localRotation = Quaternion.Euler(swing * 38f, 0f, 0f);
        rightLeg.localRotation = Quaternion.Euler(-swing * 38f, 0f, 0f);
        leftArm.localRotation = Quaternion.Euler(-swing * 30f, 0f, 0f);
        rightArm.localRotation = Quaternion.Euler(swing * 30f, 0f, 0f);
    }
}
