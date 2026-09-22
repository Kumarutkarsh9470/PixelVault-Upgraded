using UnityEngine;

public static class Palette
{
    public static Color Parse(string hex, Color fallback)
    {
        return !string.IsNullOrEmpty(hex) && ColorUtility.TryParseHtmlString(hex, out Color c) ? c : fallback;
    }
}

/// Loads shared materials created at build time (so the needed shader
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

    public static Material Lit(Color color, Texture texture = null, float smoothness = 0.2f)
    {
        var mat = new Material(Load("Lit"));
        mat.color = color;
        mat.mainTexture = texture;
        mat.SetFloat("_Glossiness", smoothness);
        return mat;
    }

    public static Material Glow(Color color, float intensity = 2.2f)
    {
        var mat = new Material(Load("Glow"));
        mat.color = color * 0.4f;
        mat.SetColor("_EmissionColor", color * intensity);
        return mat;
    }

    public static Material Trail(Color color)
    {
        var mat = new Material(Load("Trail"));
        mat.color = color;
        return mat;
    }

    public static Material Ghost()
    {
        return new Material(Load("Ghost"));
    }
}
