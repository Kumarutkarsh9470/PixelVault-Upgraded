using UnityEngine;

/// Owns the scene: builds the world, runs the attract loop behind the menu,
/// and starts, follows and ends runs on the page's instructions.
public class GlyphRoot : MonoBehaviour
{
    public static GlyphRoot Instance { get; private set; }

    const float AttractRestartSeconds = 1.4f;

    RunDriver driver;
    LevelView level;
    ForgeScenery scenery;
    RunnerAvatar avatar;
    FollowCamera follow;
    QualityGovernor governor;
    float restartAt = -1f;

    void Awake()
    {
        Instance = this;
        Application.targetFrameRate = 60;
        // One RunnerSim tick per FixedUpdate: the simulation runs at exactly 60 Hz.
        Time.fixedDeltaTime = 1f / RunnerSim.TickHz;

        Camera cam = Camera.main;
        cam.clearFlags = CameraClearFlags.Skybox;
        // TryGetComponent, not `?? AddComponent`: in the editor a missing component is a non-null "fake null".
        if (!cam.TryGetComponent(out follow)) follow = cam.gameObject.AddComponent<FollowCamera>();
        if (!cam.TryGetComponent(out BloomEffect bloom)) bloom = cam.gameObject.AddComponent<BloomEffect>();
        governor = gameObject.AddComponent<QualityGovernor>();
        governor.Bloom = bloom;

        Light sun = FindFirstObjectByType<Light>();
        if (sun != null)
        {
            sun.color = new Color(0.75f, 0.68f, 1f);
            sun.intensity = 0.5f;
            sun.transform.rotation = Quaternion.Euler(50f, -30f, 0f);
        }

        driver = gameObject.AddComponent<RunDriver>();
        level = new GameObject("Level").AddComponent<LevelView>();
        scenery = new GameObject("Scenery").AddComponent<ForgeScenery>();
        avatar = new GameObject("Runner").AddComponent<RunnerAvatar>();
        follow.Target = avatar;
        gameObject.AddComponent<SwipeInput>().Driver = driver;

        driver.ActionApplied += action => avatar.OnAction(driver.Sim, action);
        driver.RunePicked += pickup => level.Pick(pickup, driver.Sim.Lane);
        driver.Died += OnDied;

        if (FindFirstObjectByType<GlyphBridge>() == null)
        {
            new GameObject("Bridge").AddComponent<GlyphBridge>();
        }
    }

    void Start()
    {
        // What a bare build shows, and what the page sees until it sends its own instructions.
        if (driver.Sim == null) ShowMenu(null);
    }

    public void StartRun(StartPayload payload)
    {
        if (!uint.TryParse(payload.seed, out uint seed))
        {
            Debug.LogWarning("StartRun: bad seed " + payload.seed);
            return;
        }
        restartAt = -1f;
        if (payload.cosmetics != null) avatar.SetCosmetics(payload.cosmetics);
        driver.Prepare(seed);
        level.Bind(driver.Sim);
        avatar.ResetPose();
    }

    public void Go() => driver.Go();

    public void EndRun() => driver.Quit();

    public void ShowMenu(CosmeticsPayload cosmetics)
    {
        if (cosmetics != null) avatar.SetCosmetics(cosmetics);
        StartAttract();
    }

    void StartAttract()
    {
        restartAt = -1f;
        driver.Attract((uint)Random.Range(1, int.MaxValue));
        level.Bind(driver.Sim);
        avatar.ResetPose();
    }

    public void SetCosmetics(CosmeticsPayload cosmetics) => avatar.SetCosmetics(cosmetics);

    public void Press(int action) => driver.Press(action);

    public void SetBloom(bool enabled) => governor.SetBloom(enabled);

    void OnDied()
    {
        RunnerSim sim = driver.Sim;
        byte cell = sim.Cell(sim.DeathRow, sim.Lane);
        Color color = cell == RunnerSim.Wall ? new Color(1f, 0.24f, 0.55f) : cell == RunnerSim.Low ? new Color(0.13f, 0.83f, 0.93f) : new Color(1f, 0.66f, 0.15f);
        avatar.Crash(color);
        follow.Shake(0.35f);
        if (driver.State != RunDriver.Mode.Running) restartAt = Time.time + AttractRestartSeconds;
    }

    void Update()
    {
        if (restartAt > 0f && Time.time >= restartAt) StartAttract();

        RunnerSim sim = driver.Sim;
        if (sim == null) return;
        float distance = driver.VisualDistanceMeters();
        bool moving = driver.State == RunDriver.Mode.Running || driver.State == RunDriver.Mode.Attract;
        level.Draw(distance);
        scenery.Draw(distance, sim.Tick);
        avatar.Draw(sim, distance, moving);
    }

    void LateUpdate()
    {
        RunnerSim sim = driver.Sim;
        if (sim == null) return;
        follow.Follow(RunnerSim.SpeedAt(sim.Tick) * RunnerSim.TickHz / 1000f);
    }
}
