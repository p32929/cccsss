#!/usr/bin/env bash
# Install cccsss globally, then run it.
set -euo pipefail

# cccsss picks which project to open from the directory it starts in, so install
# from the repo but come back here before launching -- otherwise you would
# always land on this repo's own sessions.
start_dir="$PWD"
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing cccsss…"
npm install -g "$repo_dir" >/dev/null
echo "Installed: $(command -v cccsss)"

cd "$start_dir"
exec cccsss "$@"
