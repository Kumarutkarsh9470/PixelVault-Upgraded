# Sets each circuit's medal times and its rival ghost by racing the bot.
#
# The bot drives the same simulation the chain verifies, so the times it finds
# are times a player can match in the game. Gold sits just above the bot's
# best, which takes clean lines plus the boosts drifting earns.
#
# Usage: python tools/calibrate.py   (after tools/build-circuits.mjs)
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CIRCUITS = ROOT / "web/src/data/circuits.json"
OUT = ROOT / "pixelvault/target/calibration.json"
TRACKS = ROOT / "web/src/data/tracks.json"
RIVALS = ROOT / "web/src/data/rivals.json"


def wsl_path(path: pathlib.Path) -> str:
    text = str(path).replace("\\", "/")
    return "/mnt/" + text[0].lower() + text[2:]


def main() -> int:
    if not CIRCUITS.exists():
        print("run tools/build-circuits.mjs first", file=sys.stderr)
        return 1

    print("racing the bot on every circuit...")
    run = subprocess.run(
        [
            "wsl", "-d", "Ubuntu", "--", "bash", "-lc",
            f"cd {wsl_path(ROOT / 'pixelvault')} && "
            f"PIXELVAULT_CIRCUITS={wsl_path(CIRCUITS)} "
            f"PIXELVAULT_CALIBRATION_OUT={wsl_path(OUT)} "
            "cargo test --lib sim::calibrate::tests::calibrate_circuits -- --nocapture",
        ],
        capture_output=True,
        text=True,
    )
    for line in run.stdout.splitlines():
        if "->" in line or "never finished" in line:
            print("  " + line)
    if run.returncode != 0 or not OUT.exists():
        print(run.stdout[-2000:])
        print(run.stderr[-2000:], file=sys.stderr)
        return run.returncode or 1

    calibration = json.loads(OUT.read_text(encoding="utf-8"))
    tracks = json.loads(TRACKS.read_text(encoding="utf-8"))
    for track in tracks["tracks"]:
        medals = calibration["medals"].get(track["id"])
        if medals:
            track["medals"] = medals
    TRACKS.write_text(json.dumps(tracks, indent=2) + "\n", encoding="utf-8")
    RIVALS.write_text(json.dumps(calibration["rivals"]) + "\n", encoding="utf-8")
    print(f"updated {TRACKS.relative_to(ROOT)} and {RIVALS.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
