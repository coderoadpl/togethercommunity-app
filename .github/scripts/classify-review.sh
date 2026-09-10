#!/usr/bin/env bash
set -euo pipefail

raw="${RAW:-}"
try_outcome="${TRY_OUTCOME:-}"
review_mode="${REVIEW_MODE:-}"
exec_log="${EXEC_LOG:-}"
script_dir="$(cd "$(dirname "$0")" && pwd)"

emit() {
  printf 'outcome=%s\nreason=%s\ncold_start=%s\n' "$1" "$2" "$3" >> "$GITHUB_OUTPUT"
  printf 'review outcome: %s (%s)\n' "$1" "$2"
}

case "$try_outcome" in
  skipped|"") emit skip not_attempted false; exit 0 ;;
  cancelled) emit skip cancelled false; exit 0 ;;
esac

if [ "$review_mode" != staging ] && [ "$review_mode" != main ]; then
  emit infra invalid_output false
  exit 0
fi

valid=false
verdict=""
if [ -n "${raw//[[:space:]]/}" ]; then
  verdict="$(printf '%s' "$raw" | jq -er '
    select(type == "object")
    | select((.verdict == "PASS") or (.verdict == "FAIL"))
    | select((.summary | type) == "string" and (.summary | test("\\S")))
    | select((.blocking_issues | type) == "array")
    | select(all(.blocking_issues[]; type == "string" and test("\\S")))
    | select((.safe_to_merge | type) == "boolean")
    | select((.blast_radius | type) == "object")
    | select((.blast_radius.scope == "isolated") or (.blast_radius.scope == "contained") or (.blast_radius.scope == "broad"))
    | select((.blast_radius.note | type) == "string" and (.blast_radius.note | test("\\S")))
    | select(
        (.verdict == "PASS" and .safe_to_merge == true and (.blocking_issues | length) == 0)
        or
        (.verdict == "FAIL" and .safe_to_merge == false and (.blocking_issues | length) > 0)
      )
    | .verdict
  ' 2>/dev/null || true)"

  if [ -n "$verdict" ]; then
    valid=true
    if [ "$review_mode" = main ]; then
      valid="$(printf '%s' "$raw" | jq -r '
        .summary as $s
        | ["### Blast radius", "### Irreversible or hard-to-reverse changes", "### Coverage", "### Rollback", "### Confidence"] as $h
        | ([range(0; $h | length) as $i | ($s | index($h[$i]))] | all(. != null))
          and ([range(0; ($h | length) - 1) as $i | (($s | index($h[$i])) < ($s | index($h[$i + 1])))] | all)
          and (($s | [scan("(?m)^Confidence: (HIGH|MEDIUM|LOW)(?:\\s|$)")] | length) == 1)
          and ((.verdict != "PASS") or ($s | test("(?m)^Confidence: (HIGH|MEDIUM)(?:\\s|$)")))
      ' 2>/dev/null || echo false)"
    fi
  fi
fi

if [ "$valid" = true ]; then
  if [ "$verdict" = FAIL ]; then
    emit fail verdict_fail false
  elif [ "$try_outcome" = success ]; then
    emit pass verdict_pass false
  else
    emit infra action_failure false
  fi
  exit 0
fi

reason=""
if [ -n "$exec_log" ] && [ -s "$exec_log" ]; then
  evidence="$(jq -rs '
    [ .[] | if type == "array" then .[] else . end | select(type == "object") ] as $events
    | [ $events[]
        | select((.type == "result") or (.type == "error") or (.type == "api_error") or (.type == "provider_error"))
        | .error.type?, .error.error.type?, .error.message?, .error.error.message?, .message?,
          (if .type == "result" then .result? else empty end)
        | select(type == "string")
      ] | join("\n") as $text
    | {
        text: $text,
        status: ([ $events[]
          | select((.type == "result") or (.type == "error") or (.type == "api_error") or (.type == "provider_error"))
          | .status?, .status_code?, .error.status?, .error.status_code?
          | select(type == "number") ]),
        provider_types: ([ $events[]
          | select((.type == "result") or (.type == "error") or (.type == "api_error") or (.type == "provider_error"))
          | .error.type?, .error.error.type?
          | select(type == "string") ])
      }
  ' "$exec_log" 2>/dev/null || true)"

  if [ -n "$evidence" ]; then
    if printf '%s' "$evidence" | jq -e '
      any(.provider_types[]; . == "authentication_error")
      or any(.status[]; . == 401)
      or (.text | test("authenticat|invalid bearer|unauthorized|\\b401\\b"; "i"))
    ' >/dev/null; then
      reason=auth_rejected
    elif printf '%s' "$evidence" | jq -e '
      any(.provider_types[]; . == "rate_limit_error")
      or any(.status[]; . == 429)
      or (.text | test("usage.?limit|rate.?limit|quota|hit your limit|out of extra usage|credit balance|insufficient credits"; "i"))
    ' >/dev/null; then
      reason=usage_limit
    elif printf '%s' "$evidence" | jq -e '
      ((.text | test("model"; "i")) and (.text | test("not found|not available|unavailable|unsupported|does not exist|do not have access|not authorized|not allowed"; "i")))
      or ((any(.status[]; . == 403 or . == 404)) and (.text | test("model"; "i")))
    ' >/dev/null; then
      reason=model_unavailable
    elif [ "$(EXEC_LOG="$exec_log" bash "$script_dir/detect-coldstart.sh" --check)" = true ]; then
      reason=cold_start
    elif printf '%s' "$evidence" | jq -e '.text | test("timed out|timeout|time limit exceeded"; "i")' >/dev/null; then
      reason=timeout
    fi
  fi
fi

if [ -z "$reason" ]; then
  if [ -z "${raw//[[:space:]]/}" ]; then
    reason=empty_output
  elif [ -n "${raw//[[:space:]]/}" ]; then
    reason=invalid_output
  else
    reason=action_failure
  fi
fi

if [ "$reason" = cold_start ]; then
  emit infra "$reason" true
else
  emit infra "$reason" false
fi
