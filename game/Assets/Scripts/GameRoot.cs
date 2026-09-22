using UnityEngine;

/// Owns the scene: builds tracks from page messages, spawns the car, applies
/// themes, and switches between menu, race and garage.
public class GameRoot : MonoBehaviour
{
    public static GameRoot Instance { get; private set; }

    static readonly Vector3 GaragePosition = new Vector3(0f, 0f, -4000f);

    CameraRig rig;
    Light sun;
    RaceManager race;
    GhostPlayer ghost;
    CarController car;
    CarVisuals visuals;
    Rigidbody carBody;
    BuiltTrack track;
    TrackPayload current;
    LoadoutPayload loadout = new LoadoutPayload();
    GameObject garage;

    void Awake()
    {
        Instance = this;
        Application.targetFrameRate = 60;

        Camera cam = Camera.main;
        rig = cam.GetComponent<CameraRig>() ?? cam.gameObject.AddComponent<CameraRig>();
        sun = FindFirstObjectByType<Light>();
        race = GetComponent<RaceManager>() ?? gameObject.AddComponent<RaceManager>();

        var ghostObject = new GameObject("Ghost");
        ghost = ghostObject.AddComponent<GhostPlayer>();
        ghostObject.SetActive(false);

        CreateCar();
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

    void CreateCar()
    {
        var go = new GameObject("Car");
        carBody = go.AddComponent<Rigidbody>();
        var box = go.AddComponent<BoxCollider>();
        // Frictionless body so the car slides along walls instead of sticking.
        box.material = new PhysicsMaterial("Car Body")
        {
            dynamicFriction = 0f,
            staticFriction = 0f,
            bounciness = 0f,
            frictionCombine = PhysicsMaterialCombine.Minimum,
            bounceCombine = PhysicsMaterialCombine.Minimum,
        };
        car = go.AddComponent<CarController>();
        visuals = go.AddComponent<CarVisuals>();
        visuals.Apply(loadout);
    }

    public void LoadTrack(TrackPayload payload)
    {
        if (payload.points == null || payload.points.Length < 8)
        {
            payload.points = DefaultTrack().points;
        }
        ExitGarage();
        if (track != null)
        {
            Destroy(track.Root);
        }

        current = payload;
        ApplyTheme(payload.theme ?? new ThemePayload());
        track = TrackBuilder.Build(payload, transform);

        loadout = payload.loadout ?? loadout;
        visuals.Apply(loadout);
        car.GripMultiplier = payload.theme != null && payload.theme.grip > 0f ? payload.theme.grip : 1f;
        race.Prepare(track, car, visuals, payload.id, payload.laps);
        ghost.Load(payload.ghost, loadout);

        rig.Target = car.transform;
        rig.Current = CameraRig.Mode.Orbit;
        rig.Snap();

        WebBridge.Emit("trackLoaded", new TrackLoadedEvent
        {
            id = payload.id,
            lengthMeters = track.Path.Length,
            laps = payload.laps,
            checkpoints = track.Checkpoints.Count,
        });
    }

    /// Chase camera behind the stationary car, for the page's countdown.
    public void ReadyRace()
    {
        if (track == null)
        {
            return;
        }
        ExitGarage();
        race.Prepare(track, car, visuals, current.id, current.laps);
        ghost.Load(current.ghost, loadout);
        rig.Current = CameraRig.Mode.Chase;
        rig.Snap();
    }

    public void StartRace()
    {
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
        if (track != null)
        {
            race.Prepare(track, car, visuals, current.id, current.laps);
        }
        rig.Current = CameraRig.Mode.Orbit;
        rig.Snap();
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
        ghost.gameObject.SetActive(false);

        carBody.isKinematic = true;
        car.ControlsEnabled = false;
        car.transform.SetPositionAndRotation(GaragePosition + Vector3.up * 0.3f, Quaternion.Euler(0f, 150f, 0f));
        visuals.Apply(loadout);

        rig.Target = car.transform;
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
        carBody.isKinematic = false;
        if (track != null)
        {
            track.Root.SetActive(true);
        }
    }

    void ApplyTheme(ThemePayload theme)
    {
        Camera cam = Camera.main;
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = Palette.Parse(theme.sky, new Color(0.03f, 0.04f, 0.09f));

        RenderSettings.fog = true;
        RenderSettings.fogMode = FogMode.ExponentialSquared;
        RenderSettings.fogColor = Palette.Parse(theme.fog, cam.backgroundColor);
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
