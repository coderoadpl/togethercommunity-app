#!/usr/bin/env bash
set -euo pipefail

if [ "${EVENT_NAME:-pull_request}" = workflow_dispatch ]; then
  exit 0
fi
if [ "${CURRENT:-false}" != true ] && [ "${PREPARE_REASON:-}" != base_moved ]; then
  exit 0
fi

repository="${GITHUB_REPOSITORY:-coderoadpl/togethercommunity-app}"
pr="${PR:?PR is required}"
base_moved_message="Base branch moved — update the pull request branch (gh pr update-branch) and the review will re-run"
turn_limit_message="Reviewer exceeded AI_REVIEW_MAX_TURNS=${MAX_TURNS:-unknown}; raise the variable or split the pull request"

producer=""
producer_raw=""
producer_log=""
producer_model=""
producer_slot=""
producer_attempt=""

consider() {
  if [ -z "$producer" ] && { [ "$2" = pass ] || [ "$2" = fail ]; }; then
    producer="$1"
    producer_raw="$3"
    producer_log="$4"
    producer_model="$5"
    producer_slot="$6"
    producer_attempt="$7"
  fi
}

attempt_ids=()
attempt_reasons=""
attempt_list_valid=false
attempt_list_pattern='^try[1-9][0-9]*(p|pr|f|fr)( try[1-9][0-9]*(p|pr|f|fr))*$'
if [[ "${AI_REVIEW_ATTEMPTS:-}" =~ $attempt_list_pattern ]]; then
  attempt_list_valid=true
  read -r -a attempt_ids <<< "$AI_REVIEW_ATTEMPTS"
fi

attempt_value() {
  local name="${1}_${2^^}"
  printf '%s' "${!name:-}"
}

for attempt_id in "${attempt_ids[@]}"; do
  key="${attempt_id#try}"
  consider "$key" "$(attempt_value O "$key")" "$(attempt_value RAW "$key")" \
    "$(attempt_value LOG "$key")" "$(attempt_value MODEL "$key")" "${key%%[pf]*}" "$attempt_id"
  attempt_reasons+="$(attempt_value R "$key")"$'\n'
done

observed_model=""
turns=""
tokens_in=""
tokens_out=""
cost=""
if [ -n "$producer_log" ] && [ -s "$producer_log" ]; then
  log_meta="$(jq -rs '
    [ .[] | if type == "array" then .[] else . end | select(type == "object") ] as $events
    | ([ $events[] | select(.type == "assistant" and ((.message.model? | type) == "string")) | .message.model ] | last) as $assistant_model
    | ([ $events[] | select(.type == "system" and .subtype == "init") ] | last) as $init
    | ([ $events[] | select(.type == "result") ] | last) as $result
    | [ ($assistant_model // $init.model // "" | tostring),
        ($result.num_turns // "" | tostring),
        (if $result == null then "" else ((($result.usage.input_tokens // 0) + ($result.usage.cache_creation_input_tokens // 0) + ($result.usage.cache_read_input_tokens // 0)) | tostring) end),
        (if $result == null then "" else (($result.usage.output_tokens // 0) | tostring) end),
        (if (($result.total_cost_usd | type) == "number") then ($result.total_cost_usd | tostring) else "" end)
      ] | join("\u001f")
  ' "$producer_log" 2>/dev/null || true)"
  IFS=$'\x1f' read -r observed_model turns tokens_in tokens_out cost <<< "$log_meta" || true
fi

first_paragraph() {
  awk '
    /^[[:space:]]*$/ { if (started) exit; next }
    /^#/ { if (started) exit; next }
    { started = 1; print }
  '
}

summary_sections() {
  awk '
    function emit() {
      if (title == "" && body !~ /[^ \t\n]/) return
      sub(/^\n+/, "", body)
      sub(/\n+$/, "", body)
      printf "<details>\n<summary>%s</summary>\n\n%s\n\n</details>\n\n", (title == "" ? "Full report" : title), body
    }
    /^### / { emit(); title = substr($0, 5); body = ""; next }
    { body = body $0 "\n" }
    END { emit() }
  '
}

body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT
{
  printf '%s\n\n' '<!-- ai-review-gate -->'
  printf "<sub>Base \`%s\` · head \`%s\` · [run](%s)</sub>\n\n" "${BASE_SHA:-unknown}" "${HEAD_SHA:-unknown}" "${RUN_URL:-#}"
  if [ -z "$producer" ]; then
    printf '## AI review: NO VERDICT — infrastructure failure\n\n'
    if [ "${PREPARE_REASON:-}" = base_moved ]; then
      printf '%s\n\n' "$base_moved_message"
    elif printf '%s' "$attempt_reasons" | grep -qx turn_limit; then
      printf '%s\n\n' "$turn_limit_message"
    else
      printf 'The gate did not obtain a valid verdict. Merge remains blocked.\n\n'
    fi
    printf '### Attempts\n\n'
    if [ "$attempt_list_valid" != true ]; then
      printf -- '- AI_REVIEW_ATTEMPTS is missing or invalid\n'
    fi
    for attempt_id in "${attempt_ids[@]}"; do
      reason="$(attempt_value R "${attempt_id#try}")"
      printf -- '- %s: %s\n' "$attempt_id" "${reason:-not_attempted}"
    done
    printf '\nProducer: none\n'
  else
    verdict="$(printf '%s' "$producer_raw" | jq -r .verdict)"
    safe="$(printf '%s' "$producer_raw" | jq -r 'if .safe_to_merge then "yes" else "no" end')"
    scope="$(printf '%s' "$producer_raw" | jq -r .blast_radius.scope)"
    note="$(printf '%s' "$producer_raw" | jq -r '.blast_radius.note | gsub("[\\r\\n]+"; " ")')"
    summary="$(printf '%s' "$producer_raw" | jq -r .summary)"
    tldr="$(printf '%s' "$producer_raw" | jq -r 'if (.tldr | type) == "string" then (.tldr | gsub("^\\s+|\\s+$"; "")) else "" end')"
    if [ -z "$tldr" ]; then
      tldr="$(printf '%s\n' "$summary" | first_paragraph)"
    fi
    printf '## AI review: %s\n\n' "$verdict"
    printf '**Safe to merge:** %s · **Blast radius:** %s — %s\n\n' "$safe" "$scope" "$note"
    if [ -n "${tldr//[[:space:]]/}" ]; then
      printf '**TL;DR:** %s\n\n' "$tldr"
    fi
    issues="$(printf '%s' "$producer_raw" | jq -r '.blocking_issues[]? | "- " + .')"
    if [ -n "$issues" ]; then
      printf '### Blocking issues\n\n%s\n\n' "$issues"
    fi
    printf '%s\n' "$summary" | summary_sections
    printf -- '---\n\n'
    printf '<details>\n<summary>Run details</summary>\n\n'
    if [ -n "$observed_model" ]; then
      printf "Verdict produced by: \`%s\` · token slot %s · attempt \`%s\`" "$observed_model" "$producer_slot" "$producer_attempt"
      if [ "$observed_model" != "$producer_model" ]; then
        printf " · requested \`%s\`" "$producer_model"
      fi
      printf '\n'
    else
      printf "Verdict produced by: \`%s\` (requested; runtime model unreported) · token slot %s · attempt \`%s\`\n" "$producer_model" "$producer_slot" "$producer_attempt"
    fi
    if [ -n "$turns$tokens_in$tokens_out$cost" ]; then
      printf '\n<sub>'
      [ -n "$turns" ] && printf 'Turns %s' "$turns"
      [ -n "$tokens_in" ] && printf '%sinput tokens %s' "$([ -n "$turns" ] && printf ' · ')" "$tokens_in"
      [ -n "$tokens_out" ] && printf '%soutput tokens %s' "$([ -n "$turns$tokens_in" ] && printf ' · ')" "$tokens_out"
      [ -n "$cost" ] && printf '%sAPI-equivalent cost $%.2f' "$([ -n "$turns$tokens_in$tokens_out" ] && printf ' · ')" "$cost"
      printf '</sub>\n'
    fi
    printf '\n</details>\n'
  fi
} > "$body_file"

comments="$(gh api --paginate --method GET "repos/$repository/issues/$pr/comments")"
comment_id="$(printf '%s' "$comments" | jq -rs '
  [ .[] | if type == "array" then .[] else . end
    | select(.user.login == "github-actions[bot]")
    | select((.body // "") | contains("<!-- ai-review-gate -->"))
  ] | sort_by(.created_at, .id) | last | .id // empty
')"

if [ -n "$comment_id" ]; then
  gh api --method PATCH "repos/$repository/issues/comments/$comment_id" -F body=@"$body_file" >/dev/null
else
  gh api --method POST "repos/$repository/issues/$pr/comments" -F body=@"$body_file" >/dev/null
fi
