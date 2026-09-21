using UnityEngine;

/// Rolls the ball down the track. Forward thrust is automatic; the player only
/// steers, via A/D or arrow keys on desktop and the left/right half of the
/// screen on touch devices.
[RequireComponent(typeof(Rigidbody))]
public class BallController : MonoBehaviour
{
    public float forwardForce = 18f;
    public float steerForce = 26f;
    public float maxSpeed = 22f;
    public float fallHeight = -6f;

    Rigidbody body;
    Vector3 spawnPosition;
    RaceHud hud;

    void Awake()
    {
        body = GetComponent<Rigidbody>();
        spawnPosition = transform.position;
        hud = FindFirstObjectByType<RaceHud>();
    }

    void FixedUpdate()
    {
        if (hud != null && hud.Finished)
        {
            body.linearVelocity *= 0.95f;
            return;
        }

        float steer = ReadSteer();
        if (hud != null && !hud.Running && (steer != 0f || Input.anyKey || Input.touchCount > 0))
        {
            hud.StartRace();
        }
        if (hud == null || !hud.Running)
        {
            return;
        }

        body.AddForce(Vector3.forward * forwardForce, ForceMode.Acceleration);
        body.AddForce(Vector3.right * steer * steerForce, ForceMode.Acceleration);

        Vector3 v = body.linearVelocity;
        Vector3 flat = new Vector3(v.x, 0f, v.z);
        if (flat.magnitude > maxSpeed)
        {
            flat = flat.normalized * maxSpeed;
            body.linearVelocity = new Vector3(flat.x, v.y, flat.z);
        }

        if (transform.position.y < fallHeight)
        {
            Respawn();
        }
    }

    float ReadSteer()
    {
        float steer = Input.GetAxisRaw("Horizontal");
        if (Input.touchCount > 0)
        {
            Touch touch = Input.GetTouch(0);
            steer = touch.position.x < Screen.width * 0.5f ? -1f : 1f;
        }
        else if (Input.GetMouseButton(0))
        {
            steer = Input.mousePosition.x < Screen.width * 0.5f ? -1f : 1f;
        }
        return steer;
    }

    public void Respawn()
    {
        body.linearVelocity = Vector3.zero;
        body.angularVelocity = Vector3.zero;
        transform.position = spawnPosition;
        if (hud != null)
        {
            hud.AddPenalty(2f);
        }
    }

    public void ResetForNewRace()
    {
        body.linearVelocity = Vector3.zero;
        body.angularVelocity = Vector3.zero;
        transform.position = spawnPosition;
    }
}
