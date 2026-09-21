using UnityEngine;

/// Time-trial state and on-screen HUD. Uses IMGUI so the spike has no UI
/// package dependencies. Materials are awarded deterministically from the
/// finishing time, mirroring how the real game will grant crafting inputs.
public class RaceHud : MonoBehaviour
{
    const string BestKey = "best_time";

    public bool Running { get; private set; }
    public bool Finished { get; private set; }

    float elapsed;
    float penalty;
    float best;
    int materials;
    GUIStyle big;
    GUIStyle small;

    void Awake()
    {
        best = PlayerPrefs.GetFloat(BestKey, 0f);
    }

    void Update()
    {
        if (Running && !Finished)
        {
            elapsed += Time.deltaTime;
        }

        bool restartPressed = Input.GetKeyDown(KeyCode.Space) || Input.GetKeyDown(KeyCode.R);
        if (Finished && (restartPressed || TappedAfterFinish()))
        {
            Restart();
        }
    }

    float finishedAt;

    bool TappedAfterFinish()
    {
        if (Time.time - finishedAt < 1f)
        {
            return false;
        }
        return Input.GetMouseButtonDown(0) || (Input.touchCount > 0 && Input.GetTouch(0).phase == TouchPhase.Began);
    }

    public void StartRace()
    {
        Running = true;
    }

    public void AddPenalty(float seconds)
    {
        penalty += seconds;
    }

    public void Finish()
    {
        if (Finished)
        {
            return;
        }
        Finished = true;
        finishedAt = Time.time;

        float total = elapsed + penalty;
        materials = total < 14f ? 3 : total < 20f ? 2 : 1;
        if (best <= 0f || total < best)
        {
            best = total;
            PlayerPrefs.SetFloat(BestKey, best);
            PlayerPrefs.Save();
        }
    }

    void Restart()
    {
        Running = false;
        Finished = false;
        elapsed = 0f;
        penalty = 0f;
        var ball = FindFirstObjectByType<BallController>();
        if (ball != null)
        {
            ball.ResetForNewRace();
        }
    }

    void OnGUI()
    {
        float scale = Mathf.Max(1f, Screen.height / 720f);
        if (big == null)
        {
            big = new GUIStyle(GUI.skin.label) { alignment = TextAnchor.UpperCenter, fontStyle = FontStyle.Bold };
            small = new GUIStyle(GUI.skin.label) { alignment = TextAnchor.UpperCenter };
        }
        big.fontSize = Mathf.RoundToInt(40 * scale);
        small.fontSize = Mathf.RoundToInt(20 * scale);

        float total = elapsed + penalty;
        GUI.Label(new Rect(0, 12 * scale, Screen.width, 60 * scale), total.ToString("0.00") + "s", big);
        if (best > 0f)
        {
            GUI.Label(new Rect(0, 60 * scale, Screen.width, 30 * scale), "Best " + best.ToString("0.00") + "s", small);
        }

        if (!Running)
        {
            GUI.Label(new Rect(0, Screen.height * 0.6f, Screen.width, 40 * scale),
                "Tap left or right to steer. Touch to start.", small);
        }
        else if (Finished)
        {
            GUI.Label(new Rect(0, Screen.height * 0.38f, Screen.width, 60 * scale), "FINISH  " + total.ToString("0.00") + "s", big);
            GUI.Label(new Rect(0, Screen.height * 0.38f + 60 * scale, Screen.width, 40 * scale),
                "Materials earned: " + materials, small);
            GUI.Label(new Rect(0, Screen.height * 0.38f + 100 * scale, Screen.width, 40 * scale),
                "Tap to race again", small);
        }
    }
}
