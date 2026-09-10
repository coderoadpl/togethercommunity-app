#!/usr/bin/env bash
set -uo pipefail

input_root="${AI_REVIEW_INPUT_ROOT:-}"
if [ -z "$input_root" ] || [ ! -d "$input_root" ]; then
  echo "Review input root is unavailable" >&2
  exit 2
fi

python3 -c '
import json
import os
import sys

def deny(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(2)

try:
    root = os.path.realpath(sys.argv[1])
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict):
        deny("Malformed tool request")
    tool = payload.get("tool_name")
    tool_input = payload.get("tool_input")
    if not isinstance(tool, str) or not isinstance(tool_input, dict):
        deny("Malformed tool request")
    if tool == "StructuredOutput":
        raise SystemExit(0)
    if tool not in {"Read", "Grep", "Glob"}:
        deny("Tool is not allowed")

    key = "file_path" if tool == "Read" else "path"
    target = tool_input.get(key, root)
    if target in (None, ""):
        target = root
    if not isinstance(target, str) or "\x00" in target:
        deny("Invalid path")
    if tool == "Glob":
        pattern = tool_input.get("pattern")
        if not isinstance(pattern, str) or "\x00" in pattern:
            deny("Invalid glob")
        if os.path.isabs(pattern) or ".." in pattern.split("/"):
            deny("Glob escapes the review input")

    candidate = target if os.path.isabs(target) else os.path.join(root, target)
    resolved = os.path.realpath(candidate)
    try:
        inside = os.path.commonpath([root, resolved]) == root
    except ValueError:
        inside = False
    if not inside:
        deny("Path escapes the review input")
    if tool != "Glob" and not os.path.exists(resolved):
        deny("Path does not exist")
except SystemExit:
    raise
except Exception:
    deny("Internal tool-policy failure")
' "$input_root"
status=$?
if [ "$status" -eq 0 ] || [ "$status" -eq 2 ]; then
  exit "$status"
fi
echo "Internal tool-policy failure" >&2
exit 2
