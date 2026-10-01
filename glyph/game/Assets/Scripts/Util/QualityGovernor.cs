using UnityEngine;

/// Watches the frame rate and sheds the most expensive effects on phones that
/// cannot keep up, so the game stays smooth rather than pretty-but-choppy.
public class QualityGovernor : MonoBehaviour
{
    public BloomEffect Bloom;

    const float SampleSeconds = 3f;
    const float SlowFrameSeconds = 1f / 42f;

    float elapsed;
    int frames;
    bool degraded;

    void Update()
    {
        if (degraded)
        {
            return;
        }
        elapsed += Time.unscaledDeltaTime;
        frames++;
        if (elapsed < SampleSeconds)
        {
            return;
        }
        float average = elapsed / frames;
        elapsed = 0f;
        frames = 0;
        if (average > SlowFrameSeconds && Bloom != null && Bloom.enabled)
        {
            Bloom.enabled = false;
            degraded = true;
            GlyphBridge.Emit("quality", new QualityEvent { bloom = false, fps = Mathf.RoundToInt(1f / average) });
        }
    }

    /// The page can force effects off or back on.
    public void SetBloom(bool enabled)
    {
        if (Bloom != null) Bloom.enabled = enabled;
        degraded = !enabled;
    }
}
