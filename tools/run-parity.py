# Proves the Unity client and the Solana program simulate a race identically.
#
# The program exports circuits, input traces and a checksum of the car taken
# every 32 steps; the client replays the same traces and compares. A mismatch
# is reported at the step it first appears.
#
# Usage: python tools/run-parity.py
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
UNITY = pathlib.Path(r"D:/Unity/Editors/6000.0.84f1/Editor/Unity.exe")
CASES = ROOT / "pixelvault/target/parity-cases.json"
RESULTS = ROOT / "pixelvault/target/parity-results.txt"
LOG = ROOT / "pixelvault/target/parity-unity.log"


def wsl_path(path: pathlib.Path) -> str:
    text = str(path).replace("\\", "/")
    return "/mnt/" + text[0].lower() + text[2:]


def replay(cases: pathlib.Path, results: pathlib.Path) -> tuple[int, str]:
    """Replays a case file in the Unity client and returns its report."""
    if results.exists():
        results.unlink()
    unity = subprocess.run(
        [
            str(UNITY), "-batchmode", "-quit", "-nographics",
            "-projectPath", str(ROOT / "game"),
            "-executeMethod", "ParityRunner.Run",
            "-parity", str(cases), str(results),
            "-logFile", str(LOG),
        ],
        capture_output=True,
        text=True,
    )
    report = results.read_text(encoding="utf-8") if results.exists() else ""
    return unity.returncode, report


def self_test() -> bool:
    """A harness that cannot fail proves nothing: corrupt one checksum and
    confirm the client reports the step it diverges at."""
    cases = json.loads(CASES.read_text(encoding="utf-8"))
    case = cases["tracks"][0]["cases"][0]
    case["checksums"][3] = "123456789"
    broken = CASES.with_name("parity-cases-corrupted.json")
    broken.write_text(json.dumps(cases), encoding="utf-8")
    code, report = replay(broken, RESULTS.with_name("parity-results-corrupted.txt"))
    expected_step = cases["checksumEvery"] * 4
    caught = code != 0 and f"diverged by step {expected_step}" in report
    broken.unlink(missing_ok=True)
    if caught:
        print(f"harness self-test: a corrupted checksum was caught at step {expected_step}")
    else:
        print("harness self-test FAILED: a corrupted checksum went unnoticed", file=sys.stderr)
        print(report[:500], file=sys.stderr)
    return caught


def main() -> int:
    print("exporting cases from the program...")
    export = subprocess.run(
        [
            "wsl", "-d", "Ubuntu", "--", "bash", "-lc",
            f"cd {wsl_path(ROOT / 'pixelvault')} && "
            f"PIXELVAULT_PARITY_OUT={wsl_path(CASES)} "
            "cargo test --lib sim::parity::tests::export_cases -- --nocapture",
        ],
        capture_output=True,
        text=True,
    )
    if export.returncode != 0:
        print(export.stdout[-3000:])
        print(export.stderr[-3000:], file=sys.stderr)
        return export.returncode
    if not CASES.exists():
        print("the program did not write any cases", file=sys.stderr)
        return 1
    print(f"  {CASES.stat().st_size // 1024} KB of cases")

    print("replaying them in the Unity client...")
    code, report = replay(CASES, RESULTS)
    if report:
        print(report.strip())
    else:
        print("the client wrote no results; the last of its log:", file=sys.stderr)
        if LOG.exists():
            print("\n".join(LOG.read_text(encoding="utf-8", errors="replace").splitlines()[-30:]))
        return code or 1

    # A harness that cannot fail proves nothing, so check it catches a
    # divergence unless asked to skip it.
    if code == 0 and "--quick" not in sys.argv and not self_test():
        return 1
    return code


if __name__ == "__main__":
    raise SystemExit(main())
