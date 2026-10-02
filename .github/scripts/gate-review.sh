#!/usr/bin/env bash
set -euo pipefail

base_moved_message="Base branch moved — update the pull request branch (gh pr update-branch) and the review will re-run"

summarize() {
  echo "$1"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"
  fi
}

if [ "${PREPARE_REASON:-}" = base_moved ]; then
  summarize "$base_moved_message"
  exit 1
fi

if [ "${PREPARED:-false}" != true ] || [ "${CURRENT:-false}" != true ] || [ "${DRAFT:-true}" != false ]; then
  summarize "AI review preconditions were not satisfied. Merge remains blocked."
  exit 1
fi

for outcome in \
  "${O_1P:-}" "${O_1PR:-}" "${O_1F:-}" "${O_1FR:-}" \
  "${O_2P:-}" "${O_2PR:-}" "${O_2F:-}" "${O_2FR:-}" \
  "${O_3P:-}" "${O_3PR:-}" "${O_3F:-}" "${O_3FR:-}"; do
  case "$outcome" in
    pass)
      summarize "AI review PASS."
      exit 0
      ;;
    fail)
      summarize "AI review FAIL. Merge remains blocked."
      exit 1
      ;;
  esac
done

summarize "AI review produced no verdict. Merge remains blocked."
exit 1
