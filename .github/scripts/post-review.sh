#!/usr/bin/env bash
set -euo pipefail

if [ "${EVENT_NAME:-pull_request}" = workflow_dispatch ] || [ "${CURRENT:-false}" != true ]; then
  exit 0
fi

repository="${GITHUB_REPOSITORY:-coderoadpl/togethercommunity-app}"
pr="${PR:?PR is required}"

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

consider 1p "${O_1P:-}" "${RAW_1P:-}" "${LOG_1P:-}" "${MODEL_1P:-}" 1 try1p
consider 1pr "${O_1PR:-}" "${RAW_1PR:-}" "${LOG_1PR:-}" "${MODEL_1PR:-}" 1 try1pr
consider 1f "${O_1F:-}" "${RAW_1F:-}" "${LOG_1F:-}" "${MODEL_1F:-}" 1 try1f
consider 1fr "${O_1FR:-}" "${RAW_1FR:-}" "${LOG_1FR:-}" "${MODEL_1FR:-}" 1 try1fr
consider 2p "${O_2P:-}" "${RAW_2P:-}" "${LOG_2P:-}" "${MODEL_2P:-}" 2 try2p
consider 2pr "${O_2PR:-}" "${RAW_2PR:-}" "${LOG_2PR:-}" "${MODEL_2PR:-}" 2 try2pr
consider 2f "${O_2F:-}" "${RAW_2F:-}" "${LOG_2F:-}" "${MODEL_2F:-}" 2 try2f
consider 2fr "${O_2FR:-}" "${RAW_2FR:-}" "${LOG_2FR:-}" "${MODEL_2FR:-}" 2 try2fr
consider 3p "${O_3P:-}" "${RAW_3P:-}" "${LOG_3P:-}" "${MODEL_3P:-}" 3 try3p
consider 3pr "${O_3PR:-}" "${RAW_3PR:-}" "${LOG_3PR:-}" "${MODEL_3PR:-}" 3 try3pr
consider 3f "${O_3F:-}" "${RAW_3F:-}" "${LOG_3F:-}" "${MODEL_3F:-}" 3 try3f
consider 3fr "${O_3FR:-}" "${RAW_3FR:-}" "${LOG_3FR:-}" "${MODEL_3FR:-}" 3 try3fr

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
    printf 'The gate did not obtain a valid verdict. Merge remains blocked.\n\n'
    printf '### Attempts\n\n'
    printf '%s\n' \
      "- try1p: ${R_1P:-not_attempted}" "- try1pr: ${R_1PR:-not_attempted}" \
      "- try1f: ${R_1F:-not_attempted}" "- try1fr: ${R_1FR:-not_attempted}" \
      "- try2p: ${R_2P:-not_attempted}" "- try2pr: ${R_2PR:-not_attempted}" \
      "- try2f: ${R_2F:-not_attempted}" "- try2fr: ${R_2FR:-not_attempted}" \
      "- try3p: ${R_3P:-not_attempted}" "- try3pr: ${R_3PR:-not_attempted}" \
      "- try3f: ${R_3F:-not_attempted}" "- try3fr: ${R_3FR:-not_attempted}"
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
