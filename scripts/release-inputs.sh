#!/usr/bin/env bash
# Validate values before they enter shell commands or GitHub Actions outputs.
set -euo pipefail

command="${1:-}"
value="${2:-}"
case "$command" in
  itch-target)
    if [[ "$value" =~ ^([a-zA-Z0-9_][a-zA-Z0-9_-]*)/([a-zA-Z0-9_][a-zA-Z0-9_-]*)/?$ ]]; then
      printf '%s/%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    elif [[ "$value" =~ ^(https://)?([a-zA-Z0-9_][a-zA-Z0-9_-]*)\.itch\.io/([a-zA-Z0-9_][a-zA-Z0-9_-]*)/?$ ]]; then
      printf '%s/%s\n' "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
    else
      echo 'Itch target must be account/game or an itch.io game page address.' >&2
      exit 1
    fi
    ;;
  version-tag)
    if [[ "$value" =~ ^v((0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*))(-retry\.([1-9][0-9]*))?$ ]]; then
      printf '%s\n' "${BASH_REMATCH[1]}"
    else
      echo 'Tag must be vX.Y.Z or vX.Y.Z-retry.N with a positive retry number.' >&2
      exit 1
    fi
    ;;
  *) echo 'Unknown release input.' >&2; exit 1 ;;
esac
