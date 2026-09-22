using UnityEngine;

/// A glowing strip on the road that gives a short boost when driven over.
public class BoostPad : MonoBehaviour
{
    public float Seconds = 1.1f;

    void OnTriggerEnter(Collider other)
    {
        var car = other.attachedRigidbody != null ? other.attachedRigidbody.GetComponent<CarController>() : null;
        if (car != null && car.ControlsEnabled)
        {
            car.AddBoost(Seconds);
        }
    }
}
