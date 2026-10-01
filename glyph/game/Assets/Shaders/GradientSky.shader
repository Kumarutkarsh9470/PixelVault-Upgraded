// Skybox: three-colour vertical gradient, optional star field and sun disc.
// Skyboxes are drawn without fog, so the horizon colour should match the fog.
Shader "PixelVault/GradientSky"
{
    Properties
    {
        _TopColor ("Top", Color) = (0.02, 0.03, 0.08, 1)
        _HorizonColor ("Horizon", Color) = (0.05, 0.07, 0.15, 1)
        _BottomColor ("Bottom", Color) = (0.02, 0.02, 0.04, 1)
        _Stars ("Star density", Range(0, 1)) = 0.6
        _SunColor ("Sun", Color) = (1, 0.9, 0.7, 1)
        _SunSize ("Sun size", Range(0, 0.2)) = 0
        _SunDir ("Sun direction", Vector) = (0.3, 0.35, 0.6, 0)
    }

    SubShader
    {
        Tags { "Queue" = "Background" "RenderType" = "Background" "PreviewType" = "Skybox" }
        Cull Off ZWrite Off

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            fixed4 _TopColor;
            fixed4 _HorizonColor;
            fixed4 _BottomColor;
            half _Stars;
            fixed4 _SunColor;
            half _SunSize;
            float4 _SunDir;

            struct v2f
            {
                float4 pos : SV_POSITION;
                float3 dir : TEXCOORD0;
            };

            v2f vert(appdata_base v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.dir = v.vertex.xyz;
                return o;
            }

            float hash(float3 p)
            {
                p = frac(p * 0.3183099 + 0.1);
                p *= 17.0;
                return frac(p.x * p.y * p.z * (p.x + p.y + p.z));
            }

            fixed4 frag(v2f i) : SV_Target
            {
                float3 d = normalize(i.dir);
                float up = d.y;
                fixed3 col = up > 0
                    ? lerp(_HorizonColor.rgb, _TopColor.rgb, pow(saturate(up), 0.6))
                    : lerp(_HorizonColor.rgb, _BottomColor.rgb, saturate(-up * 4));

                // Stars: sparse bright cells above the horizon.
                float3 cell = floor(d * 180.0);
                float h = hash(cell);
                float star = step(1.0 - 0.012 * _Stars, h) * saturate(up * 3.0);
                col += star * (0.6 + 0.4 * frac(h * 97.0));

                // Sun disc with a soft halo.
                float3 sunDir = normalize(_SunDir.xyz);
                float s = dot(d, sunDir);
                float disc = smoothstep(1.0 - _SunSize, 1.0 - _SunSize * 0.7, s);
                float halo = pow(saturate(s), 64.0) * step(0.0001, _SunSize);
                col += _SunColor.rgb * (disc + halo * 0.5);
                return fixed4(col, 1);
            }
            ENDCG
        }
    }
}
