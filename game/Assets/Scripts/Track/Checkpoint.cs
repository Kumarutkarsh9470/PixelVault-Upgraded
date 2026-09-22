using UnityEngine;

/// A trigger across the road. Index 0 is the start/finish line.
public class Checkpoint : MonoBehaviour
{
    public int Index;

    void OnTriggerEnter(Collider other)
    {
        if (other.attachedRigidbody != null && other.attachedRigidbody.GetComponent<CarController>() != null)
        {
            RaceManager.Instance?.OnCheckpoint(Index);
        }
    }
}
