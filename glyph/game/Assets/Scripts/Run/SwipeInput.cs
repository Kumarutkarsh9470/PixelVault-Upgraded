using UnityEngine;

/// Swipes on phones, arrows / WASD / space on keyboards, mouse drags for desktop testing.
public class SwipeInput : MonoBehaviour
{
    public RunDriver Driver;

    Vector2 start;
    bool tracking;

    float Threshold => Mathf.Max(30f, (Screen.dpi > 0 ? Screen.dpi : 160f) * 0.18f);

    void Update()
    {
        if (Driver == null || Driver.State != RunDriver.Mode.Running) return;

        if (Input.GetKeyDown(KeyCode.LeftArrow) || Input.GetKeyDown(KeyCode.A)) Driver.Press(RunnerSim.Left);
        if (Input.GetKeyDown(KeyCode.RightArrow) || Input.GetKeyDown(KeyCode.D)) Driver.Press(RunnerSim.Right);
        if (Input.GetKeyDown(KeyCode.UpArrow) || Input.GetKeyDown(KeyCode.W) || Input.GetKeyDown(KeyCode.Space)) Driver.Press(RunnerSim.Jump);
        if (Input.GetKeyDown(KeyCode.DownArrow) || Input.GetKeyDown(KeyCode.S)) Driver.Press(RunnerSim.Slide);

        if (Input.touchCount > 0)
        {
            Touch touch = Input.GetTouch(0);
            if (touch.phase == TouchPhase.Began) Begin(touch.position);
            else if (touch.phase == TouchPhase.Moved) Track(touch.position);
            else if (touch.phase == TouchPhase.Ended || touch.phase == TouchPhase.Canceled) tracking = false;
        }
        else if (Input.GetMouseButtonDown(0)) Begin(Input.mousePosition);
        else if (Input.GetMouseButton(0)) Track(Input.mousePosition);
        else if (Input.GetMouseButtonUp(0)) tracking = false;
    }

    void Begin(Vector2 position)
    {
        start = position;
        tracking = true;
    }

    /// One action per swipe, decided as soon as the finger has moved far enough.
    void Track(Vector2 position)
    {
        if (!tracking) return;
        Vector2 delta = position - start;
        if (delta.magnitude < Threshold) return;
        tracking = false;
        if (Mathf.Abs(delta.x) > Mathf.Abs(delta.y)) Driver.Press(delta.x < 0 ? RunnerSim.Left : RunnerSim.Right);
        else Driver.Press(delta.y > 0 ? RunnerSim.Jump : RunnerSim.Slide);
    }
}
