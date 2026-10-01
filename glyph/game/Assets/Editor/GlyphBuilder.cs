using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

/// Creates the shared materials and the scene from code, then produces the
/// Web build. Runs headless:
///   Unity -batchmode -projectPath glyph/game -buildTarget WebGL -executeMethod GlyphBuilder.BuildWeb
public static class GlyphBuilder
{
    const string ScenePath = "Assets/Scenes/Glyph.unity";
    const string MaterialsDir = "Assets/Resources/Materials";
    const string OutputPath = "Builds/WebGL";

    [MenuItem("Glyph Forge/Build Web")]
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
            Debug.Log($"[GlyphBuilder] result={summary.result} size={summary.totalSize / (1024f * 1024f):0.00}MB time={summary.totalTime}");
            if (Application.isBatchMode)
            {
                EditorApplication.Exit(summary.result == BuildResult.Succeeded ? 0 : 1);
            }
        }
        catch (System.Exception e)
        {
            Debug.LogError("[GlyphBuilder] " + e);
            if (Application.isBatchMode)
            {
                EditorApplication.Exit(1);
            }
        }
    }

    /// Builds the scene without a player build, to press Play in the editor.
    [MenuItem("Glyph Forge/Create Scene")]
    public static void CreateSceneOnly()
    {
        CreateMaterials();
        CreateScene();
    }

    /// Materials saved as assets so the shader variants they use (emission,
    /// additive particles) survive build-time stripping. Runtime code clones them.
    static void CreateMaterials()
    {
        Directory.CreateDirectory(MaterialsDir);

        Material lit = GetOrCreate("Lit", "Standard");
        lit.color = Color.white;

        Material glow = GetOrCreate("Glow", "Standard");
        glow.color = Color.black;
        glow.EnableKeyword("_EMISSION");
        glow.SetColor("_EmissionColor", Color.cyan * 2f);
        glow.SetTexture("_EmissionMap", Texture2D.whiteTexture);
        glow.globalIlluminationFlags = MaterialGlobalIlluminationFlags.None;

        Material trail = GetOrCreate("Trail", "Sprites/Default");
        trail.color = Color.white;

        GetOrCreate("ParticleAdditive", "Legacy Shaders/Particles/Additive");
        GetOrCreate("Sky", "PixelVault/GradientSky");
        GetOrCreate("Bloom", "Hidden/PixelVault/Bloom");

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
        cam.gameObject.AddComponent<FollowCamera>();
        cam.farClipPlane = 260f;

        new GameObject("GlyphRoot").AddComponent<GlyphRoot>();
        new GameObject("Bridge").AddComponent<GlyphBridge>();

        // Saving the scene with linear fog keeps that fog variant in the build.
        RenderSettings.fog = true;
        RenderSettings.fogMode = FogMode.Linear;
        RenderSettings.fogStartDistance = 40f;
        RenderSettings.fogEndDistance = 230f;
        RenderSettings.ambientMode = AmbientMode.Flat;

        EditorSceneManager.SaveScene(scene, ScenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
    }

    static void ConfigurePlayer()
    {
        PlayerSettings.companyName = "Glyph Forge";
        PlayerSettings.productName = "Glyph Forge";
        PlayerSettings.SplashScreen.show = false;
        // The Mini App page hosts the canvas; only the Build/ files are used.
        PlayerSettings.WebGL.template = "APPLICATION:Minimal";
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Brotli;
        PlayerSettings.WebGL.decompressionFallback = false;
        PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.None;
        PlayerSettings.WebGL.dataCaching = true;
        PlayerSettings.SetManagedStrippingLevel(NamedBuildTarget.WebGL, ManagedStrippingLevel.High);
        PlayerSettings.SetIl2CppCodeGeneration(NamedBuildTarget.WebGL, Il2CppCodeGeneration.OptimizeSize);
        PlayerSettings.stripEngineCode = true;
    }
}
