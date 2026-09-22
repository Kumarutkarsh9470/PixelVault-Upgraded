using UnityEngine;

/// One camera, three behaviours: a chase cam while racing, a slow orbit
/// behind the menu, and a turntable in the garage.
public class CameraRig : MonoBehaviour
{
    public enum Mode
    {
        Chase,
        Orbit,
        Garage,
    }

    public Mode Current = Mode.Orbit;
    public Transform Target;

    Camera cam;
    float orbitAngle;
    Vector3 velocity;

    void Awake()
    {
        cam = GetComponent<Camera>();
    }

    public void Snap()
    {
        if (Target == null)
        {
            return;
        }
        transform.position = DesiredPosition(0f);
        transform.LookAt(LookPoint());
        velocity = Vector3.zero;
    }

    void LateUpdate()
    {
        if (Target == null)
        {
            return;
        }
        float dt = Time.deltaTime;
        switch (Current)
        {
            case Mode.Chase:
            {
                transform.position = Vector3.SmoothDamp(transform.position, DesiredPosition(dt), ref velocity, 0.12f);
                transform.LookAt(LookPoint());
                var carController = Target.GetComponent<CarController>();
                float speed01 = carController != null ? Mathf.Clamp01(carController.Speed / carController.MaxSpeed) : 0f;
                cam.fieldOfView = Mathf.Lerp(cam.fieldOfView, Mathf.Lerp(62f, 76f, speed01), 4f * dt);
                break;
            }
            case Mode.Orbit:
                orbitAngle += 12f * dt;
                transform.position = DesiredPosition(dt);
                transform.LookAt(Target.position + Vector3.up * 1f);
                cam.fieldOfView = Mathf.Lerp(cam.fieldOfView, 50f, 3f * dt);
                break;
            case Mode.Garage:
                orbitAngle += 18f * dt;
                transform.position = DesiredPosition(dt);
                transform.LookAt(Target.position + Vector3.up * 0.7f);
                cam.fieldOfView = Mathf.Lerp(cam.fieldOfView, 40f, 3f * dt);
                break;
        }
    }

    Vector3 DesiredPosition(float dt)
    {
        switch (Current)
        {
            case Mode.Chase:
                return Target.position - Target.forward * 8.5f + Vector3.up * 3.8f;
            case Mode.Garage:
                return Target.position + Quaternion.Euler(0f, orbitAngle, 0f) * new Vector3(0f, 2.2f, -8f);
            default:
                return Target.position + Quaternion.Euler(0f, orbitAngle, 0f) * new Vector3(0f, 3.5f, -11f);
        }
    }

    Vector3 LookPoint()
    {
        return Current == Mode.Chase
            ? Target.position + Target.forward * 5f + Vector3.up * 1.2f
            : Target.position + Vector3.up;
    }
}
