using UnityEngine;

/// Streaks rushing past the camera once the car is fast, stronger on boost.
[RequireComponent(typeof(Camera))]
public class SpeedLines : MonoBehaviour
{
    public CarController Car;
    public bool Active;

    ParticleSystem lines;

    void Awake()
    {
        var go = new GameObject("Speed Lines");
        go.transform.SetParent(transform, false);
        go.transform.localPosition = new Vector3(0f, 0f, 22f);
        go.transform.localRotation = Quaternion.Euler(0f, 180f, 0f);
        lines = go.AddComponent<ParticleSystem>();
        lines.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);

        var main = lines.main;
        main.loop = true;
        main.startLifetime = 0.35f;
        main.startSpeed = new ParticleSystem.MinMaxCurve(55f, 75f);
        main.startSize = new ParticleSystem.MinMaxCurve(0.05f, 0.12f);
        main.startColor = new Color(0.8f, 0.95f, 1f, 0.55f);
        main.simulationSpace = ParticleSystemSimulationSpace.Local;
        main.maxParticles = 150;

        var shape = lines.shape;
        shape.shapeType = ParticleSystemShapeType.Circle;
        shape.radius = 9f;
        shape.radiusThickness = 0.35f;

        var emission = lines.emission;
        emission.rateOverTime = 0f;

        var renderer = go.GetComponent<ParticleSystemRenderer>();
        renderer.renderMode = ParticleSystemRenderMode.Stretch;
        renderer.velocityScale = 0.08f;
        renderer.lengthScale = 2f;
        renderer.sharedMaterial = Mats.ParticleAdditive(FxTextures.Streak);
        lines.Play();
    }

    void LateUpdate()
    {
        float rate = 0f;
        if (Active && Car != null && Car.ControlsEnabled)
        {
            float speed01 = Mathf.InverseLerp(Car.MaxSpeed * 0.7f, Car.MaxSpeed, Car.Speed);
            rate = speed01 * 60f + (Car.Boosting ? 90f : 0f);
        }
        var emission = lines.emission;
        emission.rateOverTime = rate;
    }
}
