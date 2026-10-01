using UnityEngine;

/// Makes emissive neon actually glow. Runs as an image effect on the camera;
/// QualityGovernor turns it off on devices that cannot keep the frame rate.
[RequireComponent(typeof(Camera))]
public class BloomEffect : MonoBehaviour
{
    public float Threshold = 0.72f;
    public float Intensity = 0.85f;
    public int Iterations = 4;

    Material material;
    readonly RenderTexture[] levels = new RenderTexture[8];

    void OnEnable()
    {
        if (material == null)
        {
            material = Mats.Bloom();
        }
    }

    void OnRenderImage(RenderTexture source, RenderTexture destination)
    {
        if (material == null || material.shader == null || !material.shader.isSupported)
        {
            Graphics.Blit(source, destination);
            return;
        }
        material.SetFloat("_Threshold", Threshold);
        material.SetFloat("_Intensity", Intensity);

        int width = source.width / 2;
        int height = source.height / 2;
        RenderTextureFormat format = source.format;

        RenderTexture current = levels[0] = RenderTexture.GetTemporary(width, height, 0, format);
        Graphics.Blit(source, current, material, 0);
        RenderTexture previous = current;

        int i = 1;
        for (; i < Iterations; i++)
        {
            width /= 2;
            height /= 2;
            if (height < 2)
            {
                break;
            }
            current = levels[i] = RenderTexture.GetTemporary(width, height, 0, format);
            Graphics.Blit(previous, current, material, 1);
            previous = current;
        }

        for (i -= 2; i >= 0; i--)
        {
            current = levels[i];
            levels[i] = null;
            Graphics.Blit(previous, current, material, 2);
            RenderTexture.ReleaseTemporary(previous);
            previous = current;
        }

        material.SetTexture("_SourceTex", source);
        Graphics.Blit(previous, destination, material, 3);
        RenderTexture.ReleaseTemporary(previous);
    }
}
