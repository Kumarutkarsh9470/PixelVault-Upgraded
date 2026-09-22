using UnityEngine;

/// One camera, three behaviours: a chase cam while racing (with speed FOV,
/// boost kick and impact shake), a slow orbit behind the menu, and a
/// turntable in the garage that keeps the car above the page's item sheet.
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
    CarController car;
    float orbitAngle;
    Vector3 velocity;
    float shake;
    float boostKick;

    void Awake()
    {
        cam = GetComponent<Camera>();
    }

    public void Follow(Transform target)
    {
        if (car != null)
        {
            car.Impact -= OnImpact;
            car.Boosted -= OnBoost;
        }
        Target = target;
        car = target != null ? target.GetComponent<CarController>() : null;
        if (car != null)
        {
            car.Impact += OnImpact;
            car.Boosted += OnBoost;
        }
    }

    void OnImpact(float strength)
    {
        if (Current != Mode.Chase) return;
        shake = Mathf.Max(shake, 0.25f + strength * 0.6f);
    }

    void OnBoost()
    {
        if (Current != Mode.Chase) return;
        boostKick = 1f;
        shake = Mathf.Max(shake, 0.12f);
    }

    public void Snap()
    {
        if (Target == null)
        {
            return;
        }
        transform.position = DesiredPosition();
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
                transform.position = Vector3.SmoothDamp(transform.position, DesiredPosition(), ref velocity, 0.1f);
                transform.LookAt(LookPoint());
                float speed01 = car != null ? Mathf.Clamp01(car.Speed / car.MaxSpeed) : 0f;
                float fov = Mathf.Lerp(62f, 78f, speed01) + boostKick * 8f;
                cam.fieldOfView = Mathf.Lerp(cam.fieldOfView, fov, 5f * dt);
                break;
            }
            case Mode.Orbit:
                orbitAngle += 12f * dt;
                transform.position = DesiredPosition();
                transform.LookAt(LookPoint());
                cam.fieldOfView = Mathf.Lerp(cam.fieldOfView, 50f, 3f * dt);
                break;
            case Mode.Garage:
                orbitAngle += 16f * dt;
                transform.position = DesiredPosition();
                transform.LookAt(LookPoint());
                cam.fieldOfView = Mathf.Lerp(cam.fieldOfView, 42f, 3f * dt);
                break;
        }

        if (shake > 0f)
        {
            transform.position += Random.insideUnitSphere * shake * 0.35f;
            shake = Mathf.Max(0f, shake - dt * 2.5f);
        }
        boostKick = Mathf.Max(car != null && car.Boosting ? 0.6f : 0f, boostKick - dt * 2f);
    }

    Vector3 DesiredPosition()
    {
        switch (Current)
        {
            case Mode.Chase:
                return Target.position - Target.forward * 8.5f + Vector3.up * 3.8f;
            case Mode.Garage:
                return Target.position + Quaternion.Euler(0f, orbitAngle, 0f) * new Vector3(0f, 3.6f, -10.5f);
            default:
                return Target.position + Quaternion.Euler(0f, orbitAngle, 0f) * new Vector3(0f, 3.5f, -11f);
        }
    }

    Vector3 LookPoint()
    {
        switch (Current)
        {
            case Mode.Chase:
                return Target.position + Target.forward * 5f + Vector3.up * 1.2f;
            case Mode.Garage:
                // Looking below the car puts it in the top third of a portrait
                // screen, clear of the item sheet.
                return Target.position + Vector3.down * 2.2f;
            default:
                return Target.position + Vector3.up;
        }
    }
}
