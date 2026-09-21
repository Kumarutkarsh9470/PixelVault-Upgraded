using UnityEngine;

public class CameraFollow : MonoBehaviour
{
    public Transform target;
    public Vector3 offset = new Vector3(0f, 6f, -10f);
    public float smoothing = 8f;

    void LateUpdate()
    {
        if (target == null)
        {
            return;
        }
        Vector3 desired = target.position + offset;
        transform.position = Vector3.Lerp(transform.position, desired, smoothing * Time.deltaTime);
        transform.LookAt(target.position + Vector3.forward * 6f);
    }
}
