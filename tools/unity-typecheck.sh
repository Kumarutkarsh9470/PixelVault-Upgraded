#!/usr/bin/env bash
# Compiles a Unity project's runtime scripts (Assets/**/*.cs outside Editor/)
# against Unity's reference assemblies, so C# errors surface without the Unity
# editor. Runs the Roslyn compiler on Mono (apt install mono-devel); Roslyn and
# the reference assemblies come from NuGet into .cache/unity-typecheck.
# The references are Unity 2021.3's, so Unity 6-only APIs (Rigidbody.linearVelocity,
# PhysicsMaterial) fail here: the Glyph Forge runner avoids them, the racer does not.
# Usage: tools/unity-typecheck.sh glyph/game
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
project="$root/${1:?project directory}"
cache="$root/.cache/unity-typecheck"
mkdir -p "$cache"

fetch() { # <package id> <version>
  local dir="$cache/$1.$2"
  if [ ! -d "$dir" ]; then
    curl -sSfL "https://api.nuget.org/v3-flatcontainer/$1/$2/$1.$2.nupkg" -o "$cache/pkg.zip"
    mkdir -p "$dir" && (cd "$dir" && unzip -q "$cache/pkg.zip") && rm "$cache/pkg.zip"
  fi
  echo "$dir"
}
unity="$(fetch unityengine.modules 2021.3.33)/lib/net45"
csc="$(fetch microsoft.net.compilers.toolset 4.14.0)/tasks/net472/csc.exe"
fx=/usr/lib/mono/4.5

mapfile -t sources < <(cd "$project/Assets" && find . -name '*.cs' -not -path '*/Editor/*' | sort)
refs=(-r:"$fx/mscorlib.dll" -r:"$fx/System.dll" -r:"$fx/System.Core.dll" -r:"$fx/Facades/netstandard.dll")
for dll in "$unity"/*.dll; do refs+=(-r:"$dll"); done

cd "$project/Assets"
mono "$csc" -nologo -noconfig -nostdlib -langversion:9 -target:library -warnaserror -nowarn:CS0618 \
  -out:"$cache/$(basename "$(dirname "$project")")-$(basename "$project").dll" "${refs[@]}" "${sources[@]}"
echo "compiled ${#sources[@]} scripts in $1"
