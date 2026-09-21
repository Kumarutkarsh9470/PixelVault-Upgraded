using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

/// Builds the time-trial scene from code and produces a Web build, so the
/// whole spike can run headless: Unity.exe -batchmode -executeMethod SpikeBuilder.BuildWebGL
public static class SpikeBuilder
{
    const string ScenePath = "Assets/Scenes/TimeTrial.unity";
    const string OutputPath = "Builds/WebGL";

    [MenuItem("PixelVault/Build Web Spike")]
    public static void BuildWebGL()
    {
        try
        {
            BuildScene();
            ConfigurePlayer();

            BuildReport report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = OutputPath,
                target = BuildTarget.WebGL,
                options = BuildOptions.None,
            });

            BuildSummary summary = report.summary;
            Debug.Log($"[SpikeBuilder] result={summary.result} size={summary.totalSize / (1024f * 1024f):0.00}MB time={summary.totalTime}");
            if (Application.isBatchMode)
            {
                EditorApplication.Exit(summary.result == BuildResult.Succeeded ? 0 : 1);
            }
        }
        catch (System.Exception e)
        {
            Debug.LogError("[SpikeBuilder] " + e);
            if (Application.isBatchMode)
            {
                EditorApplication.Exit(1);
            }
        }
    }

    static void ConfigurePlayer()
    {
        PlayerSettings.companyName = "PixelVault";
        PlayerSettings.productName = "PixelVault Racer";
        PlayerSettings.WebGL.template = "PROJECT:Telegram";
        // Brotli with no JS fallback: the smallest download, but the host must
        // send Content-Encoding: br. Our static server does.
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Brotli;
        PlayerSettings.WebGL.decompressionFallback = false;
        PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.None;
        PlayerSettings.WebGL.dataCaching = true;
        PlayerSettings.SetManagedStrippingLevel(NamedBuildTarget.WebGL, ManagedStrippingLevel.High);
        PlayerSettings.SetIl2CppCodeGeneration(NamedBuildTarget.WebGL, Il2CppCodeGeneration.OptimizeSize);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
    }

    static Material MakeMaterial(string name, Color color)
    {
        Directory.CreateDirectory("Assets/Materials");
        string path = $"Assets/Materials/{name}.mat";
        Material mat = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (mat == null)
        {
            mat = new Material(Shader.Find("Standard"));
            AssetDatabase.CreateAsset(mat, path);
        }
        mat.color = color;
        return mat;
    }

    static GameObject Block(string name, Vector3 position, Vector3 scale, Material mat, Transform parent)
    {
        GameObject go = GameObject.CreatePrimitive(PrimitiveType.Cube);
        go.name = name;
        go.transform.SetParent(parent);
        go.transform.position = position;
        go.transform.localScale = scale;
        go.GetComponent<Renderer>().sharedMaterial = mat;
        return go;
    }

    static void BuildScene()
    {
        Directory.CreateDirectory("Assets/Scenes");
        var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);

        Material trackMat = MakeMaterial("Track", new Color(0.18f, 0.2f, 0.26f));
        Material wallMat = MakeMaterial("Wall", new Color(0.95f, 0.35f, 0.75f));
        Material ballMat = MakeMaterial("Ball", new Color(0.2f, 0.9f, 1f));
        Material finishMat = MakeMaterial("Finish", new Color(1f, 0.85f, 0.2f));

        // A course of straight segments whose lateral offsets form chicanes.
        Transform track = new GameObject("Track").transform;
        float[] offsets = { 0f, 0f, 3f, 6f, 6f, 3f, 0f, -3f, -3f, 0f };
        const float segLen = 12f;
        const float width = 8f;
        for (int i = 0; i < offsets.Length; i++)
        {
            float z = i * segLen + segLen * 0.5f;
            float x = offsets[i];
            Block($"Floor{i}", new Vector3(x, -0.5f, z), new Vector3(width, 1f, segLen + 0.1f), trackMat, track);
            Block($"WallL{i}", new Vector3(x - width * 0.5f - 0.25f, 0.5f, z), new Vector3(0.5f, 1f, segLen), wallMat, track);
            Block($"WallR{i}", new Vector3(x + width * 0.5f + 0.25f, 0.5f, z), new Vector3(0.5f, 1f, segLen), wallMat, track);
        }

        float endZ = offsets.Length * segLen;
        float endX = offsets[offsets.Length - 1];
        GameObject finish = Block("Finish", new Vector3(endX, 1f, endZ - 1.5f), new Vector3(width, 2f, 1f), finishMat, track);
        finish.GetComponent<BoxCollider>().isTrigger = true;
        finish.AddComponent<FinishLine>();
        Block("RunoffFloor", new Vector3(endX, -0.5f, endZ + 5f), new Vector3(width, 1f, 10f), trackMat, track);
        Block("EndWall", new Vector3(endX, 1f, endZ + 10f), new Vector3(width + 1f, 2f, 0.5f), wallMat, track);

        GameObject ball = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        ball.name = "Ball";
        ball.transform.position = new Vector3(0f, 0.6f, 2f);
        ball.GetComponent<Renderer>().sharedMaterial = ballMat;
        Rigidbody body = ball.AddComponent<Rigidbody>();
        body.mass = 1f;
        body.linearDamping = 0.3f;
        body.angularDamping = 0.5f;
        body.interpolation = RigidbodyInterpolation.Interpolate;
        body.collisionDetectionMode = CollisionDetectionMode.Continuous;
        ball.AddComponent<BallController>();

        new GameObject("RaceHud").AddComponent<RaceHud>();

        Camera cam = Camera.main;
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0.04f, 0.06f, 0.1f);
        cam.transform.position = ball.transform.position + new Vector3(0f, 6f, -10f);
        cam.gameObject.AddComponent<CameraFollow>().target = ball.transform;

        Light sun = Object.FindFirstObjectByType<Light>();
        if (sun != null)
        {
            sun.transform.rotation = Quaternion.Euler(50f, -30f, 0f);
            sun.shadows = LightShadows.None; // cheaper on mobile GPUs
        }

        EditorSceneManager.SaveScene(scene, ScenePath);
        AssetDatabase.SaveAssets();
    }
}
