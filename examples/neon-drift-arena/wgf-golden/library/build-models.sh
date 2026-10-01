#!/usr/bin/env bash
# Rebuild the library's GLBs from their model specs with the Factory's pinned Blender
# (web-game-factory scripts/wgf-model.py; docs/blender-pipeline.md), twice each, then hold
# each file to the Factory's model quality bars for its role and the neon-night palette.
#
#   WGF_FACTORY=<web-game-factory checkout> WGF_BLENDER=<blender 4.5> ./build-models.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
factory="${WGF_FACTORY:?set WGF_FACTORY to a web-game-factory checkout}"
palette="#0B0B12,#16162A,#EDEBFF,#FF2E88,#2EF2FF,#FFB020"
# id  kind  role
models=(
  "craft model player"
  "wall model threat"
  "arena-track environment environment"
  "arena-skyline environment environment"
)
for row in "${models[@]}"; do
  read -r id kind role <<<"$row"
  python3 "$factory/scripts/wgf-model.py" build "$here/models/$id.model.json" \
    --id "$id" --kind "$kind" -o "$here/models/$id.glb" --twice
  python3 "$factory/scripts/wgf-model.py" inspect "$here/models/$id.glb" \
    --spec "$here/models/$id.model.json" --kind "$kind" --role "$role" --palette "$palette"
done
