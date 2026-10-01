// Lightweight bloom for the built-in pipeline: bright-pass, a chain of box
// downsamples, additive box upsamples, then a combine over the source.
Shader "Hidden/PixelVault/Bloom"
{
    Properties
    {
        _MainTex ("Texture", 2D) = "white" {}
    }

    CGINCLUDE
    #include "UnityCG.cginc"

    sampler2D _MainTex;
    sampler2D _SourceTex;
    float4 _MainTex_TexelSize;
    half _Threshold;
    half _Intensity;

    struct v2f
    {
        float4 pos : SV_POSITION;
        float2 uv : TEXCOORD0;
    };

    v2f vert(appdata_img v)
    {
        v2f o;
        o.pos = UnityObjectToClipPos(v.vertex);
        o.uv = v.texcoord;
        return o;
    }

    half3 SampleBox(float2 uv, float delta)
    {
        float4 o = _MainTex_TexelSize.xyxy * float2(-delta, delta).xxyy;
        half3 s = tex2D(_MainTex, uv + o.xy).rgb + tex2D(_MainTex, uv + o.zy).rgb
                + tex2D(_MainTex, uv + o.xw).rgb + tex2D(_MainTex, uv + o.zw).rgb;
        return s * 0.25;
    }

    half3 Prefilter(half3 c)
    {
        half brightness = max(c.r, max(c.g, c.b));
        half contribution = max(0, brightness - _Threshold) / max(brightness, 0.00001);
        return c * contribution;
    }
    ENDCG

    SubShader
    {
        Cull Off ZTest Always ZWrite Off

        Pass // 0: bright pass + first downsample
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            half4 frag(v2f i) : SV_Target { return half4(Prefilter(SampleBox(i.uv, 1)), 1); }
            ENDCG
        }

        Pass // 1: downsample
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            half4 frag(v2f i) : SV_Target { return half4(SampleBox(i.uv, 1), 1); }
            ENDCG
        }

        Pass // 2: upsample, added onto the larger level
        {
            Blend One One
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            half4 frag(v2f i) : SV_Target { return half4(SampleBox(i.uv, 0.5), 1); }
            ENDCG
        }

        Pass // 3: combine with the original image
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            half4 frag(v2f i) : SV_Target
            {
                half4 c = tex2D(_SourceTex, i.uv);
                c.rgb += _Intensity * SampleBox(i.uv, 0.5);
                return c;
            }
            ENDCG
        }
    }
}
