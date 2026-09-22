using System.Collections;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

/// Headless medal calibration. The Windows build runs:
///   PixelVaultRacer.exe -batchmode -nographics -calibrate <tracks.json> <out.json> [-grips 20,30,40]
/// For each track the autopilot races the full distance at several cornering
/// limits; the fastest clean run becomes the rival ("Nova") time, splits and
/// ghost. Game time advances a fixed 1/60 s per frame, so runs are
/// deterministic and finish as fast as the CPU allows.
public class CalibrationRunner : MonoBehaviour
{
    static readonly float[] DefaultGripLimits = { 20f, 26f, 32f, 38f, 44f, 50f, 56f, 64f };
    const float TimeoutSeconds = 300f;

    [System.Serializable]
    public class RivalRun
    {
        public string trackId;
        public int totalMs;
        public int respawns;
        public float grip;
        public int[] splits;
        public GhostPayload ghost;
    }

    [System.Serializable]
    public class RivalFile
    {
        public string driver = "Nova";
        public RivalRun[] rivals;
    }

    RaceFinishedEvent finished;

    IEnumerator Start()
    {
        string[] args = System.Environment.GetCommandLineArgs();
        int at = System.Array.IndexOf(args, "-calibrate");
        if (at < 0 || at + 2 >= args.Length)
        {
            Debug.LogError("[calibrate] usage: -calibrate <tracks.json> <out.json>");
            Application.Quit(2);
            yield break;
        }
        string input = args[at + 1];
        string output = args[at + 2];
        float[] gripLimits = DefaultGripLimits;
        int gripsAt = System.Array.IndexOf(args, "-grips");
        if (gripsAt >= 0 && gripsAt + 1 < args.Length)
        {
            gripLimits = System.Array.ConvertAll(args[gripsAt + 1].Split(','),
                v => float.Parse(v, System.Globalization.CultureInfo.InvariantCulture));
        }

        GameRoot root = GameRoot.Instance;
        root.Calibrating = true;
        Application.targetFrameRate = -1;
        QualitySettings.vSyncCount = 0;
        Time.captureDeltaTime = 1f / 60f;
        RaceManager.Finished += e => finished = e;

        TrackList list = JsonUtility.FromJson<TrackList>(File.ReadAllText(input));
        var results = new List<RivalRun>();
        yield return null;

        foreach (TrackPayload track in list.tracks)
        {
            track.ghost = null;
            RivalRun best = null;
            foreach (float grip in gripLimits)
            {
                root.LoadTrack(track);
                yield return null;
                root.ReadyRace();
                root.Autopilot.CorneringGrip = grip;
                root.Autopilot.Begin(root.Track.Path, (root.Track.Path.Count - 4 + root.Track.Path.Count) % root.Track.Path.Count);
                finished = null;
                RaceManager.Instance.Begin();

                float elapsed = 0f;
                while (finished == null && elapsed < TimeoutSeconds)
                {
                    elapsed += Time.deltaTime;
                    yield return null;
                }
                root.Autopilot.End();

                if (finished == null)
                {
                    Debug.Log($"[calibrate] {track.id} grip={grip} timed out");
                    continue;
                }
                Debug.Log($"[calibrate] {track.id} grip={grip} time={finished.totalMs} respawns={finished.respawns}");
                bool better = best == null
                    || finished.respawns < best.respawns
                    || (finished.respawns == best.respawns && finished.totalMs < best.totalMs);
                if (better)
                {
                    best = new RivalRun
                    {
                        trackId = track.id,
                        totalMs = finished.totalMs,
                        respawns = finished.respawns,
                        grip = grip,
                        splits = finished.splits,
                        ghost = finished.ghost,
                    };
                }
            }
            if (best != null)
            {
                results.Add(best);
            }
        }

        File.WriteAllText(output, JsonUtility.ToJson(new RivalFile { rivals = results.ToArray() }));
        Debug.Log($"[calibrate] wrote {results.Count} rivals to {output}");
        Application.Quit(0);
    }
}
