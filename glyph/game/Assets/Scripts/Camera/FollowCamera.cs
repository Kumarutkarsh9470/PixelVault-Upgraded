using UnityEngine;

/// Chases the runner from behind and above, eases across lane changes, widens
/// the view as speed rises, and shakes on a crash.
[RequireComponent(typeof(Camera))]
public class FollowCamera : MonoBehaviour
{
    public RunnerAvatar Target;

    Camera cam;
    float x;
    float xVelocity;
    float shake;

    void Awake()
    {
        cam = GetComponent<Camera>();
        cam.nearClipPlane = 0.2f;
        cam.farClipPlane = 260f;
    }

    public void Shake(float amount) => shake = Mathf.Max(shake, amount);

    public void Follow(float speedMetersPerSecond)
    {
        if (Target == null) return;
        Vector3 runner = Target.transform.position;
        x = Mathf.SmoothDamp(x, runner.x * 0.6f, ref xVelocity, 0.12f);

        Vector3 jitter = shake > 0f ? Random.insideUnitSphere * shake : Vector3.zero;
        shake = Mathf.MoveTowards(shake, 0f, Time.deltaTime * 1.5f);

        transform.position = new Vector3(x, 3.1f + Target.JumpY * 0.35f, runner.z - 6.6f) + jitter;
        transform.LookAt(new Vector3(x * 0.9f, 1.3f, runner.z + 7f));
        float speed01 = Mathf.InverseLerp(12f, 28f, speedMetersPerSecond);
        cam.fieldOfView = Mathf.Lerp(cam.fieldOfView, Mathf.Lerp(60f, 74f, speed01), Time.deltaTime * 3f);
    }
}
