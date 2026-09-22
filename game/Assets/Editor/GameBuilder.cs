using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

/// Creates the shared materials and the game scene from code, then produces
/// the Web build. Runs headless:
///   Unity.exe -batchmode -projectPath game -buildTarget WebGL -executeMethod GameBuilder.BuildWeb
public static class GameBuilder
{
    const string ScenePath = "Assets/Scenes/Game.unity";
    const string MaterialsDir = "Assets/Resources/Materials";
    const string OutputPath = "Builds/WebGL";

    [MenuItem("PixelVault/Build Web")]
    public static void BuildWeb()
    {
        try
        {
            CreateMaterials();
            CreateScene();
            ConfigurePlayer();

            BuildReport report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = OutputPath,
                target = BuildTarget.WebGL,
                options = BuildOptions.None,
            });
            BuildSummary summary = report.summary;
            Debug.Log($"[GameBuilder] result={summary.result} size={summary.totalSize / (1024f * 1024f):0.00}MB time={summary.totalTime}");
            if (Application.isBatchMode)
            {
                EditorApplication.Exit(summary.result == BuildResult.Succeeded ? 0 : 1);
            }
        }
        catch (System.Exception e)
        {
            Debug.LogError("[GameBuilder] " + e);
            if (Application.isBatchMode)
            {
                EditorApplication.Exit(1);
            }
        }
    }

    /// Materials saved as assets so the shader variants they use (emission,
    /// transparency) survive build-time stripping. Runtime code clones them.
    static void CreateMaterials()
    {
        Directory.CreateDirectory(MaterialsDir);

        Material lit = GetOrCreate("Lit", "Standard");
        lit.color = Color.white;

        Material glow = GetOrCreate("Glow", "Standard");
        glow.color = Color.black;
        glow.EnableKeyword("_EMISSION");
        glow.SetColor("_EmissionColor", Color.cyan * 2f);
        glow.globalIlluminationFlags = MaterialGlobalIlluminationFlags.None;

        Material trail = GetOrCreate("Trail", "Sprites/Default");
        trail.color = Color.white;

        Material ghost = GetOrCreate("Ghost", "Standard");
        ghost.color = new Color(0.55f, 0.85f, 1f, 0.3f);
        ghost.SetFloat("_Mode", 3f);
        ghost.SetOverrideTag("RenderType", "Transparent");
        ghost.SetInt("_SrcBlend", (int)BlendMode.One);
        ghost.SetInt("_DstBlend", (int)BlendMode.OneMinusSrcAlpha);
        ghost.SetInt("_ZWrite", 0);
        ghost.DisableKeyword("_ALPHATEST_ON");
        ghost.DisableKeyword("_ALPHABLEND_ON");
        ghost.EnableKeyword("_ALPHAPREMULTIPLY_ON");
        ghost.EnableKeyword("_EMISSION");
        ghost.SetColor("_EmissionColor", new Color(0.2f, 0.6f, 0.9f));
        ghost.renderQueue = (int)RenderQueue.Transparent;

        AssetDatabase.SaveAssets();
    }

    static Material GetOrCreate(string name, string shader)
    {
        string path = $"{MaterialsDir}/{name}.mat";
        var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (mat == null)
        {
            mat = new Material(Shader.Find(shader));
            AssetDatabase.CreateAsset(mat, path);
        }
        else
        {
            mat.shader = Shader.Find(shader);
        }
        EditorUtility.SetDirty(mat);
        return mat;
    }

    static void CreateScene()
    {
        Directory.CreateDirectory("Assets/Scenes");
        var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);

        Camera cam = Camera.main;
        cam.gameObject.AddComponent<CameraRig>();
        cam.farClipPlane = 900f;
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0.03f, 0.04f, 0.09f);

        new GameObject("GameRoot").AddComponent<GameRoot>();
        new GameObject("Bridge").AddComponent<WebBridge>();

        // Saving the scene with exponential fog keeps that fog variant in the build.
        RenderSettings.fog = true;
        RenderSettings.fogMode = FogMode.ExponentialSquared;
        RenderSettings.fogDensity = 0.004f;
        RenderSettings.ambientMode = AmbientMode.Flat;

        EditorSceneManager.SaveScene(scene, ScenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
    }

    static void ConfigurePlayer()
    {
        PlayerSettings.companyName = "PixelVault";
        PlayerSettings.productName = "PixelVault Racer";
        PlayerSettings.SplashScreen.show = false;
        PlayerSettings.WebGL.template = "PROJECT:Telegram";
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Brotli;
        PlayerSettings.WebGL.decompressionFallback = false;
        PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.None;
        PlayerSettings.WebGL.dataCaching = true;
        PlayerSettings.SetManagedStrippingLevel(NamedBuildTarget.WebGL, ManagedStrippingLevel.High);
        PlayerSettings.SetIl2CppCodeGeneration(NamedBuildTarget.WebGL, Il2CppCodeGeneration.OptimizeSize);
        // Keep the scripts that are only created from code at runtime.
        PlayerSettings.stripEngineCode = true;
    }
}
