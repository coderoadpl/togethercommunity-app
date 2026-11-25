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

no_verdict_message="AI review produced no verdict. Merge remains blocked."
attempt_list_pattern='^try[1-9][0-9]*(p|pr|f|fr)( try[1-9][0-9]*(p|pr|f|fr))*$'
if ! [[ "${AI_REVIEW_ATTEMPTS:-}" =~ $attempt_list_pattern ]]; then
  summarize "$no_verdict_message"
  exit 1
fi
read -r -a attempt_ids <<< "$AI_REVIEW_ATTEMPTS"

for attempt_id in "${attempt_ids[@]}"; do
  key="${attempt_id#try}"
  outcome_name="O_${key^^}"
  outcome="${!outcome_name:-}"
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

summarize "$no_verdict_message"
exit 1
