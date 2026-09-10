#!/usr/bin/env bash
set -euo pipefail

exec_log="${EXEC_LOG:-}"
label="model=${MODEL:-unreported} slot=${SLOT:-unknown} attempt=${ATTEMPT:-unknown} reason=${REASON:-unknown}"

if [ -z "$exec_log" ] || [ ! -s "$exec_log" ]; then
  printf '  | %s: no execution log\n' "$label"
  exit 0
fi

message="$(jq -rs '
  [ .[] | if type == "array" then .[] else . end | select(type == "object") ] as $events
  | ([ $events[] | select(.type == "result") ] | last) as $result
  | [ $events[]
      | select((.type == "error") or (.type == "api_error") or (.type == "provider_error"))
      | .error.message?, .error.error.message?, .message?
      | select(type == "string")
    ] as $errors
  | if ($errors | length) > 0 then ($errors | last)
    elif $result == null then "no result event in execution log"
    else ($result.result // "result event contained no diagnostic" | tostring)
    end
' "$exec_log" 2>/dev/null || printf 'execution log is not parsable JSON')"

{
  printf '%s: ' "$label"
  printf '%s' "$message" \
    | sed -E 's/(Bearer[[:space:]]+)[A-Za-z0-9._~+\/=:-]+/\1[REDACTED]/Ig; s/((oauth|api)[_-]?token|api[_-]?key|token|secret)(["'"'"'=: ]+)[^[:space:]"'"'"']+/\1\3[REDACTED]/Ig' \
    | head -c 2000
  printf '\n'
} | sed 's/^/  | /'
