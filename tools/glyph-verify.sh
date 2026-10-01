#!/usr/bin/env bash
# Compiles the Unity runner's simulation outside Unity and checks it against
# the vectors generated from the server's rules. Needs Mono's C# compiler
# (apt install mono-mcs mono-runtime).
set -euo pipefail
cd "$(dirname "$0")/.."
out="$(mktemp -d)/verify.exe"
mcs -nologo -warnaserror -out:"$out" glyph/game/Assets/Scripts/Sim/RunnerSim.cs glyph/level/VerifyVectors.cs
mono "$out" glyph/level/vectors.txt
