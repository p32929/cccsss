#!/usr/bin/env bash
# Remove cccsss from this system: the global package and the saved settings.
# Claude Code's own sessions in ~/.claude are NOT touched.
set -euo pipefail

confs=()
conf_root="${XDG_CONFIG_HOME:-$HOME/.config}"
[ "$(uname)" = Darwin ] && conf_root="$HOME/Library/Application Support"
for n in cccsss ccss ccsessions; do
  [ -d "$conf_root/$n" ] && confs+=("$conf_root/$n")
  [ -d "$HOME/.config/$n" ] && confs+=("$HOME/.config/$n")
done

installed=""
npm ls -g --depth=0 cccsss >/dev/null 2>&1 && installed=1

if [ -z "$installed" ] && [ ${#confs[@]} -eq 0 ]; then
  echo "Nothing to uninstall — cccsss isn't installed."
  exit 0
fi

echo "Will remove:"
[ -n "$installed" ] && echo "  global package cccsss ($(command -v cccsss || echo '?'))"
for d in "${confs[@]:-}"; do [ -n "$d" ] && echo "  settings $d"; done

if [ "${1:-}" != "-y" ]; then
  printf 'proceed? [y/N] '
  read -r ans
  [ "$ans" = y ] || [ "$ans" = Y ] || { echo "cancelled"; exit 1; }
fi

[ -n "$installed" ] && npm uninstall -g cccsss >/dev/null
for d in "${confs[@]:-}"; do [ -n "$d" ] && rm -rf "$d"; done
echo "Done. cccsss is uninstalled."
