#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"
set -a
source "${HOME}/.config/neon-gardener/env"
set +a
exec bun gardener.ts
