using UnityEngine;

/// Owns the scene: builds tracks from page messages, spawns the car, applies
/// themes, and switches between menu, race and garage.
public class GameRoot : MonoBehaviour
{
    public static GameRoot Instance { get; private set; }

    static readonly Vector3 GaragePosition = new Vector3(0f, 0f, -4000f);

    CameraRig rig;
    SpeedLines speedLines;
    QualityGovernor governor;
    Material sky;
    Light sun;
    RaceManager race;
    GhostPlayer ghost;
    CarController car;
    CarVisuals visuals;
    SimBot bot;
    BuiltTrack track;
    SimTrack circuit;
    TrackPayload current;
    LoadoutPayload loadout = new LoadoutPayload();
    GameObject garage;
    bool attract;
    float attractStuck;

    public CarController Car => car;
    public BuiltTrack Track => track;
    /// The circuit the simulation runs, shared with the chain.
    public SimTrack Circuit => circuit;

    void Awake()
    {
        Instance = this;
        Application.targetFrameRate = 60;
        // The simulation advances exactly sixty times a second, and the chain
        // replays those same steps.
        Time.fixedDeltaTime = 1f / (float)CarSim.StepsPerSecond;

        Camera cam = Camera.main;
        cam.farClipPlane = Mathf.Max(cam.farClipPlane, 1400f);
        rig = cam.GetComponent<CameraRig>() ?? cam.gameObject.AddComponent<CameraRig>();
        var bloom = cam.GetComponent<BloomEffect>() ?? cam.gameObject.AddComponent<BloomEffect>();
        speedLines = cam.GetComponent<SpeedLines>() ?? cam.gameObject.AddComponent<SpeedLines>();
        governor = gameObject.AddComponent<QualityGovernor>();
        governor.Bloom = bloom;
        sky = Mats.Sky();
        sun = FindFirstObjectByType<Light>();
        race = GetComponent<RaceManager>() ?? gameObject.AddComponent<RaceManager>();

        var ghostObject = new GameObject("Ghost");
        ghost = ghostObject.AddComponent<GhostPlayer>();

        CreateCar();
        rig.Follow(car.transform);
        speedLines.Car = car;
        if (FindFirstObjectByType<WebBridge>() == null)
        {
            new GameObject("Bridge").AddComponent<WebBridge>();
        }
    }

    void Start()
    {
        // Shown until the page sends its own track; also what a bare build displays.
        // The page's LoadTrack can arrive before Start runs, so never overwrite it.
        if (track == null)
        {
            LoadTrack(DefaultTrack());
        }
    }

    /// The car carries no rigidbody or collider: the simulation moves it, and
    /// the same simulation is what the chain replays.
    void CreateCar()
    {
        var go = new GameObject("Car");
        car = go.AddComponent<CarController>();
        visuals = go.AddComponent<CarVisuals>();
        go.AddComponent<CarEffects>();
        bot = new SimBot();
        visuals.Apply(loadout);
    }

    /// The menu shows the car lapping on its own under the orbit camera, so the
    /// scene behind the page is alive rather than a parked car.
    void Update()
    {
        if (!attract || track == null)
        {
            return;
        }
        attractStuck = car.Speed < 2f ? attractStuck + Time.deltaTime : 0f;
        if (attractStuck > 2.5f)
        {
            // Wedged somewhere: start the lap again rather than sit there.
            attractStuck = 0f;
            car.Reset();
        }
    }

    void StartAttract()
    {
        if (track == null)
        {
            return;
        }
        attract = true;
        attractStuck = 0f;
        car.Reset();
        car.Bot = bot;
        car.UseBot = true;
        car.ControlsEnabled = true;
    }

    void StopAttract()
    {
        attract = false;
        car.UseBot = false;
    }

    /// Races the bot, recording the run like any other: a demo lap, and the
    /// quickest way to see a verified time end to end.
    public void BotRace(float grip)
    {
        if (circuit == null)
        {
            return;
        }
        ReadyRace();
        bot.Grip = FixedMath.FromFloat(grip > 0f ? grip : 30f);
        car.Bot = bot;
        car.UseBot = true;
        race.Begin();
        ghost.Play();
    }

    public void LoadTrack(TrackPayload payload)
    {
        if (payload.points == null || payload.points.Length < 8)
        {
            payload.points = DefaultTrack().points;
        }
        ExitGarage();
        StopAttract();
        ghost.Stop();
        if (track != null)
        {
            Destroy(track.Root);
        }

        current = payload;
        ApplyTheme(payload.theme ?? new ThemePayload());
        circuit = BuildCircuit(payload);
        track = TrackBuilder.Build(payload, circuit, transform);

        loadout = payload.loadout ?? loadout;
        visuals.Apply(loadout);
        car.Load(circuit);
        race.Prepare(circuit, car, visuals, ghost, payload.id, circuit.Laps);
        ghost.Load(circuit, DecodeTrace(payload.ghostTrace), loadout);
        speedLines.Active = false;

        rig.Current = CameraRig.Mode.Orbit;
        rig.Snap();
        StartAttract();

        WebBridge.Emit("trackLoaded", new TrackLoadedEvent
        {
            id = payload.id,
            lengthMeters = track.Path.Length,
            laps = circuit.Laps,
            checkpoints = circuit.Checkpoints.Length,
            verifiable = payload.circuit != null,
        });
    }

    /// The circuit the page sent, which is the one the chain stores. Without
    /// it the track is still playable, but its runs cannot be verified, so a
    /// bare build falls back to deriving the geometry locally.
    SimTrack BuildCircuit(TrackPayload payload)
    {
        CircuitPayload from = payload.circuit;
        if (from == null || from.samples == null || from.samples.Length < 64)
        {
            Debug.LogWarning("No circuit data: this track cannot be verified on-chain");
            return LocalCircuit(payload);
        }

        var pads = new SimBoostPad[from.padSamples != null ? from.padSamples.Length : 0];
        for (int i = 0; i < pads.Length; i++)
        {
            pads[i] = new SimBoostPad { Sample = from.padSamples[i], Lateral = from.padLaterals[i] };
        }
        return new SimTrack
        {
            Samples = SimTrack.FromFlat(from.samples),
            Spacing = from.spacing,
            WallOffset = from.wallOffset,
            Checkpoints = from.checkpoints,
            BoostPads = pads,
            Laps = Mathf.Max(1, from.laps),
            StartSample = from.startSample,
            StartHeading = (uint)from.startHeading,
        };
    }

    /// Geometry derived on the spot, for a build running without the page.
    SimTrack LocalCircuit(TrackPayload payload)
    {
        TrackPath path = TrackPath.FromFlatPoints(payload.points, 2f);
        var samples = new SimSample[path.Count];
        for (int i = 0; i < path.Count; i++)
        {
            samples[i] = new SimSample
            {
                X = FixedMath.FromFloat(path.Positions[i].x),
                Z = FixedMath.FromFloat(path.Positions[i].z),
                Fx = FixedMath.FromFloat(path.Forwards[i].x),
                Fz = FixedMath.FromFloat(path.Forwards[i].z),
            };
        }
        int count = Mathf.Max(8, Mathf.RoundToInt(path.Length / 55f));
        var checkpoints = new int[count];
        for (int i = 0; i < count; i++)
        {
            checkpoints[i] = i * path.Count / count;
        }
        int start = (path.Count - 4 + path.Count) % path.Count;
        return new SimTrack
        {
            Samples = samples,
            Spacing = FixedMath.FromFloat(2f),
            WallOffset = FixedMath.FromFloat(10f),
            Checkpoints = checkpoints,
            BoostPads = new SimBoostPad[0],
            Laps = Mathf.Max(1, payload.laps),
            StartSample = start,
            StartHeading = (uint)(long)(Mathf.Atan2(path.Forwards[start].x, path.Forwards[start].z)
                * Mathf.Rad2Deg * SimTrig.PerDegree),
        };
    }

    static byte[] DecodeTrace(string base64)
    {
        if (string.IsNullOrEmpty(base64))
        {
            return null;
        }
        try
        {
            return System.Convert.FromBase64String(base64);
        }
        catch (System.FormatException)
        {
            Debug.LogWarning("Ignoring a malformed ghost trace");
            return null;
        }
    }

    /// Chase camera behind the stationary car, for the page's countdown.
    public void ReadyRace()
    {
        if (track == null)
        {
            return;
        }
        ExitGarage();
        StopAttract();
        race.Prepare(circuit, car, visuals, ghost, current.id, circuit.Laps);
        ghost.Load(circuit, DecodeTrace(current.ghostTrace), loadout);
        speedLines.Active = true;
        rig.Current = CameraRig.Mode.Chase;
        rig.Snap();
    }

    public void StartRace()
    {
        car.UseBot = false;
        if (rig.Current != CameraRig.Mode.Chase)
        {
            ReadyRace();
        }
        race.Begin();
        ghost.Play();
    }

    public void ShowMenu()
    {
        ExitGarage();
        ghost.Stop();
        speedLines.Active = false;
        if (track != null)
        {
            race.Prepare(circuit, car, visuals, ghost, current.id, circuit.Laps);
        }
        rig.Current = CameraRig.Mode.Orbit;
        rig.Snap();
        StartAttract();
    }

    public void SetBloom(bool enabled)
    {
        governor.SetBloom(enabled);
    }

    public void ShowGarage(LoadoutPayload payload)
    {
        if (payload != null)
        {
            loadout = payload;
        }
        if (garage == null)
        {
            garage = BuildGarage();
        }
        garage.SetActive(true);
        if (track != null)
        {
            track.Root.SetActive(false);
        }
        StopAttract();
        ghost.Stop();
        speedLines.Active = false;

        car.ControlsEnabled = false;
        car.transform.SetPositionAndRotation(GaragePosition + Vector3.up * 0.3f, Quaternion.Euler(0f, 150f, 0f));
        visuals.Apply(loadout);

        rig.Current = CameraRig.Mode.Garage;
        rig.Snap();
    }

    public void SetLoadout(LoadoutPayload payload)
    {
        loadout = payload ?? new LoadoutPayload();
        visuals.Apply(loadout);
    }

    void ExitGarage()
    {
        if (garage == null || !garage.activeSelf)
        {
            return;
        }
        garage.SetActive(false);
        if (track != null)
        {
            track.Root.SetActive(true);
        }
    }

    void ApplyTheme(ThemePayload theme)
    {
        Camera cam = Camera.main;
        Color top = Palette.Parse(theme.sky, new Color(0.03f, 0.04f, 0.09f));
        Color horizon = Palette.Parse(theme.fog, top);
        cam.backgroundColor = horizon;

        // Gradient sky whose horizon matches the fog, so distant scenery melts into it.
        string scenery = string.IsNullOrEmpty(theme.scenery) ? "city" : theme.scenery;
        if (sky != null && sky.shader != null && sky.shader.isSupported)
        {
            sky.SetColor("_TopColor", top);
            sky.SetColor("_HorizonColor", horizon);
            sky.SetColor("_BottomColor", horizon * 0.6f);
            sky.SetFloat("_Stars", scenery == "desert" ? 0f : scenery == "frost" ? 0.35f : 0.7f);
            sky.SetColor("_SunColor", Palette.Parse(theme.sun, Color.white));
            sky.SetFloat("_SunSize", scenery == "desert" ? 0.06f : scenery == "frost" ? 0.03f : 0f);
            RenderSettings.skybox = sky;
            cam.clearFlags = CameraClearFlags.Skybox;
        }
        else
        {
            cam.clearFlags = CameraClearFlags.SolidColor;
        }

        RenderSettings.fog = true;
        RenderSettings.fogMode = FogMode.ExponentialSquared;
        RenderSettings.fogColor = horizon;
        RenderSettings.fogDensity = theme.fogDensity > 0f ? theme.fogDensity : 0.004f;
        RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
        RenderSettings.ambientLight = Palette.Parse(theme.ambient, new Color(0.2f, 0.25f, 0.4f));

        if (sun != null)
        {
            sun.color = Palette.Parse(theme.sun, Color.white);
            sun.intensity = theme.sunIntensity > 0f ? theme.sunIntensity : 0.6f;
            sun.transform.rotation = Quaternion.Euler(48f, -32f, 0f);
            sun.shadows = LightShadows.None;
        }
    }

    GameObject BuildGarage()
    {
        var stage = new GameObject("Garage");
        stage.transform.position = GaragePosition;
        Color accent = Palette.Parse(current?.theme?.accent, new Color(0.13f, 0.83f, 0.93f));

        GameObject floor = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        floor.name = "Turntable";
        floor.transform.SetParent(stage.transform, false);
        floor.transform.localPosition = new Vector3(0f, 0.05f, 0f);
        floor.transform.localScale = new Vector3(9f, 0.05f, 9f);
        floor.GetComponent<Renderer>().sharedMaterial = Mats.Lit(new Color(0.08f, 0.1f, 0.16f), null, 0.6f);

        GameObject ring = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        ring.name = "Ring";
        ring.transform.SetParent(stage.transform, false);
        ring.transform.localPosition = new Vector3(0f, 0.02f, 0f);
        ring.transform.localScale = new Vector3(9.5f, 0.03f, 9.5f);
        ring.GetComponent<Renderer>().sharedMaterial = Mats.Glow(accent, 2.5f);

        GameObject ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
        ground.name = "Garage Ground";
        ground.transform.SetParent(stage.transform, false);
        ground.transform.localScale = new Vector3(20f, 1f, 20f);
        ground.GetComponent<Renderer>().sharedMaterial = Mats.Lit(new Color(0.03f, 0.04f, 0.07f), null, 0.1f);
        return stage;
    }

    /// Neon Harbor, used until the page supplies a track.
    public static TrackPayload DefaultTrack()
    {
        return new TrackPayload
        {
            id = "neon-harbor",
            name = "Neon Harbor",
            laps = 2,
            width = 14f,
            points = new float[]
            {
                0f, 0f, 0f, 120f, 20f, 160f, 60f, 175f, 110f, 165f, 140f, 130f, 150f, 90f,
                175f, 60f, 180f, 20f, 160f, -20f, 120f, -40f, 70f, -45f, 30f, -30f,
            },
            theme = new ThemePayload(),
            loadout = new LoadoutPayload(),
        };
    }
}
