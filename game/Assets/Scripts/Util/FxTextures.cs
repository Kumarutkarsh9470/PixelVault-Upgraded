using UnityEngine;

/// Small textures generated at runtime, so effects cost nothing to download.
public static class FxTextures
{
    static Texture2D softDot;
    static Texture2D streak;
    static Texture2D chevron;

    /// A round, soft-edged dot for smoke and sparks.
    public static Texture2D SoftDot
    {
        get
        {
            if (softDot != null) return softDot;
            const int size = 64;
            softDot = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            var pixels = new Color[size * size];
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    float dx = (x + 0.5f) / size * 2f - 1f;
                    float dy = (y + 0.5f) / size * 2f - 1f;
                    float a = Mathf.Clamp01(1f - Mathf.Sqrt(dx * dx + dy * dy));
                    pixels[y * size + x] = new Color(1f, 1f, 1f, a * a);
                }
            }
            softDot.SetPixels(pixels);
            softDot.Apply();
            return softDot;
        }
    }

    /// A horizontal streak, bright in the middle, for speed lines.
    public static Texture2D Streak
    {
        get
        {
            if (streak != null) return streak;
            const int w = 64;
            const int h = 8;
            streak = new Texture2D(w, h, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            var pixels = new Color[w * h];
            for (int y = 0; y < h; y++)
            {
                for (int x = 0; x < w; x++)
                {
                    float u = Mathf.Sin(Mathf.PI * (x + 0.5f) / w);
                    float v = 1f - Mathf.Abs((y + 0.5f) / h * 2f - 1f);
                    pixels[y * w + x] = new Color(1f, 1f, 1f, u * v);
                }
            }
            streak.SetPixels(pixels);
            streak.Apply();
            return streak;
        }
    }

    /// Three forward-pointing chevrons for boost pads (tiles along the road).
    public static Texture2D Chevron
    {
        get
        {
            if (chevron != null) return chevron;
            const int size = 64;
            chevron = new Texture2D(size, size, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Repeat };
            var pixels = new Color[size * size];
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    float u = Mathf.Abs((x + 0.5f) / size * 2f - 1f);
                    float v = (y + 0.5f) / size;
                    // A "^" shape: distance from the line v = 0.55 + 0.45 * (1 - u).
                    float d = Mathf.Abs(v - (0.25f + 0.5f * (1f - u)));
                    float a = d < 0.12f ? 1f : 0f;
                    pixels[y * size + x] = new Color(1f, 1f, 1f, a);
                }
            }
            chevron.SetPixels(pixels);
            chevron.Apply(true);
            return chevron;
        }
    }
}
