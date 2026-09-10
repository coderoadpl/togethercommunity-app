#!/usr/bin/env bash
set -euo pipefail

exec_log="${EXEC_LOG:-}"
cold_start=false

if [ -n "$exec_log" ] && [ -s "$exec_log" ]; then
  cold_start="$(jq -rs '
    [ .[] | if type == "array" then .[] else . end | select(type == "object") ] as $events
    | ([ $events[] | select(.type == "result") ] | last) as $result
    | [ $events[]
        | select((.type == "result") or (.type == "error") or (.type == "api_error") or (.type == "provider_error"))
        | .error.type?, .error.error.type?, .error.message?, .error.error.message?, .message?,
          (if .type == "result" then .result? else empty end)
        | select(type == "string")
      ] | join("\n") as $text
    | [ $events[]
        | select((.type == "result") or (.type == "error") or (.type == "api_error") or (.type == "provider_error"))
        | .status?, .status_code?, .error.status?, .error.status_code?
        | select(type == "number")
      ] as $statuses
    | [ $events[]
        | select((.type == "result") or (.type == "error") or (.type == "api_error") or (.type == "provider_error"))
        | .error.type?, .error.error.type?
        | select(type == "string")
      ] as $types
    | ($result != null)
      and ($result.is_error == true)
      and (($result.total_cost_usd | type) == "number")
      and ($result.total_cost_usd == 0)
      and ([ $events[] | select(.type == "assistant") ] | length == 0)
      and ([
        ($result.usage.input_tokens // 0),
        ($result.usage.output_tokens // 0),
        ($result.usage.cache_creation_input_tokens // 0),
        ($result.usage.cache_read_input_tokens // 0),
        ($result.modelUsage // {} | to_entries[]?.value.inputTokens // 0),
        ($result.modelUsage // {} | to_entries[]?.value.outputTokens // 0),
        ($result.modelUsage // {} | to_entries[]?.value.cacheReadInputTokens // 0),
        ($result.modelUsage // {} | to_entries[]?.value.cacheCreationInputTokens // 0)
      ] | add) == 0
      and (any($types[]; . == "authentication_error") | not)
      and (any($types[]; . == "rate_limit_error") | not)
      and (any($statuses[]; . == 401 or . == 429) | not)
      and ($text | test("authenticat|invalid bearer|unauthorized|\\b401\\b|usage.?limit|rate.?limit|quota|hit your limit|out of extra usage|credit balance|insufficient credits"; "i") | not)
      and (((($text | test("model"; "i")) and ($text | test("not found|not available|unavailable|unsupported|does not exist|do not have access|not authorized|not allowed"; "i"))) or ((any($statuses[]; . == 403 or . == 404)) and ($text | test("model"; "i")))) | not)
  ' "$exec_log" 2>/dev/null || echo false)"
fi

[ "$cold_start" = true ] || cold_start=false
if [ "${1:-}" = --check ]; then
  printf '%s\n' "$cold_start"
  exit 0
fi
printf 'cold_start=%s\n' "$cold_start" >> "$GITHUB_OUTPUT"
printf 'cold-start signature: %s\n' "$cold_start"
