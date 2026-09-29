using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEngine;

/// Replays the cases the program exported and checks the client agrees with it
/// step for step. Runs headless:
///   Unity.exe -batchmode -quit -projectPath game -executeMethod ParityRunner.Run
///             -parity <cases.json> <results.json>
/// tools/run-parity.py drives the whole cycle.
public static class ParityRunner
{
    [Serializable]
    class Case
    {
        public string name;
        public int steps;
        public int finishedAt;
        public int traceBytes;
        public int[] trace;
        public string[] checksums;
        public int finalX;
        public int finalZ;
        public uint finalHeading;
        public int crossings;
    }

    [Serializable]
    class TrackCase
    {
        public string id;
        public int laps;
        public int spacing;
        public int wallOffset;
        public int startSample;
        public uint startHeading;
        public int[] samples;
        public int[] checkpoints;
        public int[] padSamples;
        public int[] padLaterals;
        public Case[] cases;
    }

    [Serializable]
    class CaseFile
    {
        public int checksumEvery;
        public string seed;
        public TrackCase[] tracks;
    }

    public static void Run()
    {
        string[] args = Environment.GetCommandLineArgs();
        int at = Array.IndexOf(args, "-parity");
        if (at < 0 || at + 2 >= args.Length)
        {
            Fail("usage: -parity <cases.json> <results.json>");
            return;
        }

        try
        {
            CaseFile file = JsonUtility.FromJson<CaseFile>(File.ReadAllText(args[at + 1]));
            var report = new StringBuilder();
            int checked_ = 0;
            int failures = 0;

            foreach (TrackCase track in file.tracks)
            {
                SimTrack simTrack = Build(track);
                foreach (Case test in track.cases)
                {
                    checked_++;
                    string problem = Check(simTrack, test, file.checksumEvery);
                    if (problem != null)
                    {
                        failures++;
                        report.AppendLine($"FAIL {track.id}/{test.name}: {problem}");
                    }
                    else
                    {
                        report.AppendLine($"ok   {track.id}/{test.name}: {test.steps} steps, {test.traceBytes} trace bytes");
                    }
                }
            }

            string summary = failures == 0
                ? $"PARITY OK: {checked_} runs replayed identically"
                : $"PARITY FAILED: {failures} of {checked_} runs diverged";
            File.WriteAllText(args[at + 2], summary + "\n" + report);
            Debug.Log("[parity] " + summary);
            if (Application.isBatchMode)
            {
                EditorApplication.Exit(failures == 0 ? 0 : 1);
            }
        }
        catch (Exception e)
        {
            Fail(e.ToString());
        }
    }

    static void Fail(string message)
    {
        Debug.LogError("[parity] " + message);
        if (Application.isBatchMode)
        {
            EditorApplication.Exit(2);
        }
    }

    static SimTrack Build(TrackCase track)
    {
        var pads = new SimBoostPad[track.padSamples.Length];
        for (int i = 0; i < pads.Length; i++)
        {
            pads[i] = new SimBoostPad { Sample = track.padSamples[i], Lateral = track.padLaterals[i] };
        }
        return new SimTrack
        {
            Samples = SimTrack.FromFlat(track.samples),
            Spacing = track.spacing,
            WallOffset = track.wallOffset,
            Checkpoints = track.checkpoints,
            BoostPads = pads,
            Laps = track.laps,
            StartSample = track.startSample,
            StartHeading = track.startHeading,
        };
    }

    /// Replays one case, returning null when the client matched the program, or
    /// a description of where the two first parted company.
    static string Check(SimTrack track, Case test, int checksumEvery)
    {
        List<SimInput> inputs = TraceCodec.Decode(ToBytes(test.trace));
        if (inputs.Count != test.steps)
        {
            return $"trace decoded to {inputs.Count} steps, expected {test.steps}";
        }

        CarSim car = CarSim.Spawn(track);
        ulong hash = SimHash.Seed;
        int checksum = 0;
        int finishedAt = 0;
        for (int step = 1; step <= inputs.Count; step++)
        {
            car.Step(track, inputs[step - 1]);
            hash = SimHash.Step(hash, ref car);
            if (finishedAt == 0 && car.Crossings >= track.CrossingsNeeded)
            {
                finishedAt = step;
            }
            if (step % checksumEvery == 0)
            {
                string expected = test.checksums[checksum++];
                if (hash.ToString() != expected)
                {
                    return $"diverged by step {step} (checksum {hash} vs {expected} on-chain)";
                }
            }
        }

        string last = test.checksums[test.checksums.Length - 1];
        if (hash.ToString() != last)
        {
            return $"final checksum {hash} does not match {last}";
        }
        if (finishedAt != test.finishedAt)
        {
            return $"finished at step {finishedAt}, the program says {test.finishedAt}";
        }
        if (car.X != test.finalX || car.Z != test.finalZ || car.Heading != test.finalHeading)
        {
            return $"ended at ({car.X}, {car.Z}) heading {car.Heading}, the program says ({test.finalX}, {test.finalZ}) heading {test.finalHeading}";
        }
        if (car.Crossings != test.crossings)
        {
            return $"took {car.Crossings} checkpoints, the program counted {test.crossings}";
        }
        return null;
    }

    static byte[] ToBytes(int[] values)
    {
        var bytes = new byte[values.Length];
        for (int i = 0; i < values.Length; i++)
        {
            bytes[i] = (byte)values[i];
        }
        return bytes;
    }
}
