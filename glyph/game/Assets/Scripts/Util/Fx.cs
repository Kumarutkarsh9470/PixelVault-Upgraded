using UnityEngine;

/// Particle systems built from code, so effects cost nothing to download.
public static class Fx
{
    /// An idle system that only emits on Emit(): sparks for pickups and crashes.
    public static ParticleSystem Burst(Transform parent, int maxParticles)
    {
        var go = new GameObject("Burst");
        go.transform.SetParent(parent, false);
        var ps = go.AddComponent<ParticleSystem>();
        ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);

        var main = ps.main;
        main.loop = false;
        main.playOnAwake = false;
        main.maxParticles = maxParticles;
        main.startLifetime = new ParticleSystem.MinMaxCurve(0.25f, 0.6f);
        main.startSpeed = new ParticleSystem.MinMaxCurve(2f, 7f);
        main.startSize = new ParticleSystem.MinMaxCurve(0.08f, 0.22f);
        main.gravityModifier = 0.6f;
        main.simulationSpace = ParticleSystemSimulationSpace.World;

        var emission = ps.emission;
        emission.rateOverTime = 0f;
        var shape = ps.shape;
        shape.shapeType = ParticleSystemShapeType.Sphere;
        shape.radius = 0.2f;

        var size = ps.sizeOverLifetime;
        size.enabled = true;
        size.size = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.Linear(0f, 1f, 1f, 0f));

        go.GetComponent<ParticleSystemRenderer>().sharedMaterial = Mats.ParticleAdditive(FxTextures.SoftDot);
        return ps;
    }

    /// A continuous soft glow cloud around a moving object.
    public static ParticleSystem Aura(Transform parent, float radius, float rate)
    {
        var go = new GameObject("Aura");
        go.transform.SetParent(parent, false);
        var ps = go.AddComponent<ParticleSystem>();

        var main = ps.main;
        main.loop = true;
        main.maxParticles = 120;
        main.startLifetime = new ParticleSystem.MinMaxCurve(0.4f, 0.8f);
        main.startSpeed = new ParticleSystem.MinMaxCurve(0.1f, 0.6f);
        main.startSize = new ParticleSystem.MinMaxCurve(0.15f, 0.4f);
        main.simulationSpace = ParticleSystemSimulationSpace.World;

        var emission = ps.emission;
        emission.rateOverTime = rate;
        var shape = ps.shape;
        shape.shapeType = ParticleSystemShapeType.Sphere;
        shape.radius = radius;

        var size = ps.sizeOverLifetime;
        size.enabled = true;
        size.size = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.EaseInOut(0f, 0.6f, 1f, 0f));

        go.GetComponent<ParticleSystemRenderer>().sharedMaterial = Mats.ParticleAdditive(FxTextures.SoftDot);
        return ps;
    }
}
