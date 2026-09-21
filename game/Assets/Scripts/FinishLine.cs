using UnityEngine;

public class FinishLine : MonoBehaviour
{
    void OnTriggerEnter(Collider other)
    {
        if (other.GetComponent<BallController>() == null)
        {
            return;
        }
        var hud = FindFirstObjectByType<RaceHud>();
        if (hud != null)
        {
            hud.Finish();
        }
    }
}
