using UnityEngine;

public static class Palette
{
    public static Color Parse(string hex, Color fallback)
    {
        return !string.IsNullOrEmpty(hex) && ColorUtility.TryParseHtmlString(hex, out Color c) ? c : fallback;
    }
}

/// Loads the materials GlyphBuilder saves at build time (so their shader
/// variants survive stripping) and hands out tinted runtime copies.
public static class Mats
{
    static Material Load(string name)
    {
        var mat = Resources.Load<Material>("Materials/" + name);
        if (mat == null)
        {
            Debug.LogWarning("Missing material Resources/Materials/" + name);
            mat = new Material(Shader.Find("Standard"));
        }
        return mat;
    }

    public static Material Lit(Color color, float smoothness = 0.3f)
    {
        var mat = new Material(Load("Lit"));
        mat.color = color;
        mat.SetFloat("_Glossiness", smoothness);
        return mat;
    }

    public static Material Glow(Color color, float intensity = 2.2f)
    {
        var mat = new Material(Load("Glow"));
        mat.color = color * 0.35f;
        mat.SetColor("_EmissionColor", color * intensity);
        return mat;
    }

    public static Material Trail(Color color)
    {
        var mat = new Material(Load("Trail"));
        mat.color = color;
        return mat;
    }

    public static Material ParticleAdditive(Texture texture)
    {
        var mat = new Material(Load("ParticleAdditive"));
        if (texture != null) mat.mainTexture = texture;
        return mat;
    }

    /// Legacy particle shaders tint with _TintColor (0.5 is neutral) rather than _Color.
    public static void Tint(Material mat, Color color)
    {
        if (mat.HasProperty("_TintColor"))
        {
            mat.SetColor("_TintColor", new Color(color.r * 0.5f, color.g * 0.5f, color.b * 0.5f, color.a * 0.5f));
        }
        else
        {
            mat.color = color;
        }
    }

    public static Material Sky() => new Material(Load("Sky"));

    public static Material Bloom() => new Material(Load("Bloom"));
}
