#!/usr/bin/env bash
set -euo pipefail

repository="coderoadpl/togethercommunity-app"
origin="https://github.com/coderoadpl/togethercommunity-app.git"
pr="${PR:-}"
mode="${PREPARE_MODE:-prepare}"
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_TERMINAL_PROMPT=0

emit() {
  printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
}

if ! [[ "$pr" =~ ^[1-9][0-9]*$ ]]; then
  echo "Invalid PR number" >&2
  exit 1
fi

metadata_file="$(mktemp)"
sanitized_metadata="$(mktemp)"
trap 'rm -f "$metadata_file" "$sanitized_metadata"' EXIT
GH_HOST=github.com gh api --method GET "repos/$repository/pulls/$pr" > "$metadata_file"

if [ "$mode" = revalidate ]; then
  current=false
  if jq -e \
    --arg base_sha "${BASE_SHA:-}" \
    --arg head_sha "${HEAD_SHA:-}" \
    --arg base_ref "${BASE_REF:-}" \
    '.state == "open" and .draft == false and .base.sha == $base_sha and .head.sha == $head_sha and .base.ref == $base_ref and .base.repo.full_name == "coderoadpl/togethercommunity-app"' \
    "$metadata_file" >/dev/null; then
    current=true
  fi
  emit current "$current"
  exit 0
fi

if [ "$mode" != prepare ]; then
  echo "Invalid preparation mode" >&2
  exit 1
fi

input_root="${INPUT_ROOT:?INPUT_ROOT is required}"
trusted_root="${TRUSTED_ROOT:?TRUSTED_ROOT is required}"
run_url="${RUN_URL:-}"

case "$input_root" in
  "${RUNNER_TEMP:?RUNNER_TEMP is required}"/ai-review-input) ;;
  *) echo "INPUT_ROOT must be the dedicated runner-temporary review directory" >&2; exit 1 ;;
esac

primary_staging="${AI_REVIEW_MODEL:-claude-opus-5}"
primary_main="${AI_REVIEW_MODEL_MAIN:-claude-fable-5-1}"
fallback="${AI_REVIEW_MODEL_FALLBACK:-claude-opus-5}"
max_turns="${AI_REVIEW_MAX_TURNS:-120}"
timeout_minutes="${AI_REVIEW_TIMEOUT_MINUTES:-90}"

for model_name in "$primary_staging" "$primary_main" "$fallback"; do
  if ! [[ "$model_name" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]*$ ]]; then
    echo "Invalid AI review model" >&2
    exit 1
  fi
done
if ! [[ "$max_turns" =~ ^[0-9]+$ ]] || [ "$max_turns" -lt 1 ] || [ "$max_turns" -gt 200 ]; then
  echo "AI_REVIEW_MAX_TURNS must be an integer from 1 to 200" >&2
  exit 1
fi
if ! [[ "$timeout_minutes" =~ ^[0-9]+$ ]] || [ "$timeout_minutes" -lt 1 ] || [ "$timeout_minutes" -gt 360 ]; then
  echo "AI_REVIEW_TIMEOUT_MINUTES must be an integer from 1 to 360" >&2
  exit 1
fi

jq -ce '
  select(.state == "open")
  | select(.base.repo.full_name == "coderoadpl/togethercommunity-app")
  | select(.base.ref == "staging" or .base.ref == "main")
  | select(.base.sha | test("^[0-9a-f]{40}$"))
  | select(.head.sha | test("^[0-9a-f]{40}$"))
  | {
      number, title, body: (.body // ""), state, draft,
      base_ref: .base.ref, base_sha: .base.sha,
      head_ref: .head.ref, head_sha: .head.sha,
      base_repo: .base.repo.full_name, head_repo: .head.repo.full_name,
      fork: (.head.repo.full_name != .base.repo.full_name)
    }
' "$metadata_file" > "$sanitized_metadata" 2>/dev/null || true
if [ ! -s "$sanitized_metadata" ]; then
  echo "PR metadata does not satisfy the review contract" >&2
  exit 1
fi

base_ref="$(jq -r .base_ref "$sanitized_metadata")"
base_sha="$(jq -r .base_sha "$sanitized_metadata")"
head_ref="$(jq -r .head_ref "$sanitized_metadata")"
head_sha="$(jq -r .head_sha "$sanitized_metadata")"
draft="$(jq -r .draft "$sanitized_metadata")"
review_mode="$base_ref"

if [ "$review_mode" = main ]; then
  if [ "$(jq -r .head_repo "$sanitized_metadata")" != "$repository" ] || [ "$head_ref" != staging ]; then
    echo "Promotions must be same-repository staging to main" >&2
    exit 1
  fi
fi
if [ -n "${EXPECTED_BASE_SHA:-}" ] && [ "$base_sha" != "$EXPECTED_BASE_SHA" ]; then
  echo "PR base SHA changed before preparation" >&2
  exit 1
fi
if [ -n "${EXPECTED_HEAD_SHA:-}" ] && [ "$head_sha" != "$EXPECTED_HEAD_SHA" ]; then
  echo "PR head SHA changed before preparation" >&2
  exit 1
fi

prompt_file="$trusted_root/.github/ai-review/PROMPT-$review_mode.md"
staging_prompt="$trusted_root/.github/ai-review/PROMPT-staging.md"
for required in \
  "$trusted_root/.github/scripts/classify-review.sh" \
  "$trusted_root/.github/scripts/detect-coldstart.sh" \
  "$trusted_root/.github/scripts/failure-reason.sh" \
  "$trusted_root/.github/scripts/gate-review.sh" \
  "$trusted_root/.github/scripts/post-review.sh" \
  "$trusted_root/.github/scripts/prepare-review.sh" \
  "$trusted_root/.github/scripts/review-tool-policy.sh" \
  "$prompt_file" "$staging_prompt"; do
  if [ ! -f "$required" ]; then
    echo "bootstrap-not-installed: trusted review file is missing" >&2
    exit 1
  fi
done

git_safe=(git -c core.hooksPath=/dev/null -c protocol.file.allow=never -c diff.external= -c filter.lfs.smudge= -c filter.lfs.required=false)
"${git_safe[@]}" fetch --no-tags --no-recurse-submodules "$origin" \
  "+refs/pull/$pr/head:refs/ai-review/fetched-head" \
  "+refs/heads/$base_ref:refs/ai-review/fetched-base"

if [ "$("${git_safe[@]}" rev-parse refs/ai-review/fetched-head)" != "$head_sha" ] || \
   [ "$("${git_safe[@]}" rev-parse refs/ai-review/fetched-base)" != "$base_sha" ]; then
  echo "Fetched refs do not match pinned PR metadata" >&2
  exit 1
fi
"${git_safe[@]}" update-ref refs/ai-review/base "$base_sha"
"${git_safe[@]}" update-ref refs/ai-review/head "$head_sha"
merge_base="$("${git_safe[@]}" merge-base "$base_sha" "$head_sha" 2>/dev/null || true)"
if ! [[ "$merge_base" =~ ^[0-9a-f]{40}$ ]]; then
  echo "No merge base exists for the pinned PR" >&2
  exit 1
fi

rm -rf "$input_root"
mkdir -p "$input_root/base" "$input_root/head" "$input_root/patches"

export AI_PREP_REPOSITORY="$repository"
export AI_PREP_PR="$pr"
export AI_PREP_METADATA_FILE="$sanitized_metadata"
export AI_PREP_BASE_SHA="$base_sha"
export AI_PREP_HEAD_SHA="$head_sha"
export AI_PREP_MERGE_BASE="$merge_base"
export AI_PREP_INPUT_ROOT="$input_root"
export AI_PREP_RUN_URL="$run_url"
export AI_PREP_MODE="$review_mode"
export AI_PREP_ORIGIN="$origin"

python3 - <<'PY'
import json
import os
import re
import subprocess
from pathlib import Path, PurePosixPath

repo = os.environ["AI_PREP_REPOSITORY"]
pr = int(os.environ["AI_PREP_PR"])
metadata = json.loads(Path(os.environ["AI_PREP_METADATA_FILE"]).read_text(encoding="utf-8"))
base = os.environ["AI_PREP_BASE_SHA"]
head = os.environ["AI_PREP_HEAD_SHA"]
merge_base = os.environ["AI_PREP_MERGE_BASE"]
root = Path(os.environ["AI_PREP_INPUT_ROOT"])
run_url = os.environ["AI_PREP_RUN_URL"]
mode = os.environ["AI_PREP_MODE"]

git_prefix = [
    "git", "-c", "core.hooksPath=/dev/null", "-c", "protocol.file.allow=never",
    "-c", "diff.external=", "-c", "filter.lfs.smudge=", "-c", "filter.lfs.required=false",
]

def git(*args: str, text: bool = False) -> bytes | str:
    result = subprocess.run(
        [*git_prefix, *args], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=text, env={**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_TERMINAL_PROMPT": "0"},
    )
    return result.stdout

def valid_path(value: str) -> bool:
    path = PurePosixPath(value)
    return bool(value) and not value.startswith("/") and "\x00" not in value and all(
        part not in {"", ".", ".."} for part in path.parts
    )

def bucket(path: str) -> str:
    parts = path.split("/")
    if path.startswith(".github/") or (len(parts) == 1 and not path.lower().endswith(".md")):
        return "ci_root_configuration"
    if path.startswith("app/drizzle/"):
        return "migrations"
    if path.startswith("app/core/domain/"):
        return "core_domain"
    if path.startswith("app/core/server/"):
        return "core_server"
    if path.startswith("app/core/contract/") or path.startswith("app/core/client/"):
        return "core_contract_client"
    if path.startswith("app/adapters/"):
        return "adapters"
    if path.startswith("app/apps/server/"):
        return "server"
    if path.startswith("app/apps/web/src/i18n/"):
        return "web_i18n"
    if path.startswith("app/apps/web/"):
        return "other_web"
    test_suffixes = (".test.ts", ".spec.ts", ".test.tsx", ".spec.tsx")
    if path.startswith("app/scripts/") or path.startswith("app/config-regression/") or any(
        part in {"tests", "__tests__", "e2e"} for part in parts
    ) or path.endswith(test_suffixes):
        return "scripts_tests"
    if path.startswith("app/docs/") or path.lower().endswith(".md"):
        return "docs"
    return "other"

def parse_name_status(data: bytes) -> list[dict[str, object]]:
    tokens = data.decode("utf-8", "surrogateescape").split("\0")
    if tokens and tokens[-1] == "":
        tokens.pop()
    entries = []
    index = 0
    while index < len(tokens):
        status = tokens[index]
        index += 1
        if status.startswith(("R", "C")):
            old, new = tokens[index], tokens[index + 1]
            index += 2
        else:
            old = tokens[index] if status == "D" else None
            new = None if status == "D" else tokens[index]
            index += 1
        path = new or old
        if path is None or not valid_path(path) or (old is not None and not valid_path(old)):
            raise RuntimeError("Git produced a noncanonical path")
        entries.append({"status": status, "source": old, "path": path})
    return entries

entries = parse_name_status(git("diff", "--name-status", "-z", "--find-renames", "--no-ext-diff", "--no-textconv", merge_base, head, "--"))

def tree_index(commit: str) -> dict[str, tuple[str, str]]:
    raw = git("ls-tree", "-rz", "-r", commit)
    assert isinstance(raw, bytes)
    result = {}
    for record in raw.split(b"\0"):
        if not record:
            continue
        header, encoded_path = record.split(b"\t", 1)
        path = encoded_path.decode("utf-8", "surrogateescape")
        if not valid_path(path):
            raise RuntimeError("Git produced a noncanonical path")
        mode_value, kind, oid = header.decode().split(" ")
        result[path] = (mode_value, oid)
    mapped = sorted(f"{path}.txt" for path in result)
    for index, value in enumerate(mapped):
        for other in mapped[index + 1:]:
            if other.startswith(value + "/"):
                raise RuntimeError("Snapshot file/directory collision")
    return result

base_tree = tree_index(base)
head_tree = tree_index(head)

numstat_raw = git("diff", "--numstat", "-z", "--find-renames", "--no-ext-diff", "--no-textconv", merge_base, head, "--")
numstat = {}
tokens = numstat_raw.decode("utf-8", "surrogateescape").split("\0")
index = 0
while index < len(tokens) and tokens[index] != "":
    fields = tokens[index].split("\t")
    index += 1
    if len(fields) >= 3 and fields[2] != "":
        target = fields[2]
    elif len(fields) >= 3 and index + 1 < len(tokens):
        index += 1
        target = tokens[index]
        index += 1
    else:
        continue
    numstat[target] = {"added": fields[0], "deleted": fields[1], "binary": fields[0] == "-" or fields[1] == "-"}

batch = subprocess.Popen(
    [*git_prefix, "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
    stderr=subprocess.PIPE, env={**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_TERMINAL_PROMPT": "0"},
)

def read_blob(oid: str) -> bytes:
    if batch.stdin is None or batch.stdout is None:
        raise RuntimeError("Git batch input is unavailable")
    batch.stdin.write((oid + "\n").encode("ascii"))
    batch.stdin.flush()
    header = batch.stdout.readline().decode("ascii").rstrip("\n")
    fields = header.split(" ")
    if len(fields) != 3 or fields[0] != oid or fields[1] != "blob" or not fields[2].isdigit():
        raise RuntimeError("Git returned an invalid batch blob header")
    size = int(fields[2])
    data = batch.stdout.read(size)
    if len(data) != size or batch.stdout.read(1) != b"\n":
        raise RuntimeError("Git returned an incomplete batch blob")
    return data

def snapshot(side: str, path: str, tree: dict[str, tuple[str, str]]) -> dict[str, object] | None:
    record = tree.get(path)
    if record is None:
        return None
    mode_value, oid = record
    destination = root / side / f"{path}.txt"
    destination.parent.mkdir(parents=True, exist_ok=True)
    if mode_value == "160000":
        return {"kind": "submodule", "oid": oid}
    blob = read_blob(oid)
    if mode_value == "120000":
        destination.write_text("Symlink target: " + blob.decode("utf-8", "replace") + "\n", encoding="utf-8")
        return {"kind": "symlink", "file": str(destination.relative_to(root)), "oid": oid}
    try:
        text = blob.decode("utf-8")
    except UnicodeDecodeError:
        return {"kind": "binary", "oid": oid, "bytes": len(blob)}
    destination.write_text(text, encoding="utf-8")
    return {"kind": "text", "file": str(destination.relative_to(root)), "oid": oid}

snapshots = {"base": {}, "head": {}}
try:
    for side, tree in (("base", base_tree), ("head", head_tree)):
        for path in tree:
            snapshots[side][path] = snapshot(side, path, tree)
finally:
    if batch.stdin is not None:
        batch.stdin.close()
    if batch.stdout is not None:
        batch.stdout.close()
    batch_stderr = batch.stderr.read().decode("utf-8", "replace") if batch.stderr is not None else ""
    if batch.stderr is not None:
        batch.stderr.close()
    if batch.wait() != 0:
        raise RuntimeError("Git batch blob reader failed: " + batch_stderr.strip())

files = []
areas = {}
complete_patch = git("diff", "--find-renames", "--no-ext-diff", "--no-textconv", merge_base, head, "--")
assert isinstance(complete_patch, bytes)
patches = []
if complete_patch:
    starts = [0]
    offset = 0
    while True:
        boundary = complete_patch.find(b"\ndiff --git ", offset)
        if boundary < 0:
            break
        starts.append(boundary + 1)
        offset = boundary + 1
    starts.append(len(complete_patch))
    patches = [complete_patch[starts[index]:starts[index + 1]] for index in range(len(starts) - 1)]
if len(patches) != len(entries):
    raise RuntimeError("Combined patch does not match the changed-file inventory")
for patch_id, entry in enumerate(entries, 1):
    path = str(entry["path"])
    source = entry.get("source")
    patch = patches[patch_id - 1]
    patch_path = root / "patches" / f"{patch_id}.patch.txt"
    try:
        patch_text = patch.decode("utf-8")
        patch_path.write_text(patch_text, encoding="utf-8")
        patch_meta = {"kind": "text", "file": str(patch_path.relative_to(root))}
    except UnicodeDecodeError:
        patch_meta = {"kind": "binary", "bytes": len(patch)}
    stats = numstat.get(path, {"added": "?", "deleted": "?", "binary": False})
    item = {
        "id": patch_id, "status": entry["status"], "path": path, "source": source,
        "area": bucket(path), "added": stats["added"], "deleted": stats["deleted"],
        "binary": stats["binary"], "patch": patch_meta,
        "base": snapshots["base"].get(str(source or path)),
        "head": snapshots["head"].get(path),
    }
    files.append(item)
    areas[item["area"]] = areas.get(item["area"], 0) + 1

required = [
    "FOUNDATION.md", "architecture.md", "CONTRIBUTING.md", "app/AGENTS.md", "app/CLAUDE.md",
    "app/core/CLAUDE.md", "app/adapters/CLAUDE.md", "app/apps/CLAUDE.md",
    "app/docs/architecture.md", "app/docs/permission-table.md", "app/docs/route-table.md",
    "app/docs/security.md", "app/docs/deployment-risk-classes.md", "app/docs/deployment-environments.md",
    "app/docs/go-live-checklist.md", "app/docs/visual-regression.md", "app/docs/terminology-glossary.md",
    "app/eslint.config.js", "app/.dependency-cruiser.cjs", "app/package.json",
    "app/scripts/language-lint.ts", "app/scripts/tenant-neutral-lint.ts", ".tenant-neutral-allow",
    "app/scripts/tenant-scope-check.ts", "app/scripts/migration-lint.ts",
    "app/config-regression/authorization.test.ts", "app/core/domain/authorization.ts",
    "app/core/server/authorize.ts", "app/config-regression/public-surface.test.ts",
    "app/apps/server/src/public-route-manifest.ts", "app/apps/server/src/self-authenticating-route-manifest.ts",
]
missing = []
for path in required:
    if path not in base_tree:
        missing.append(path)

if missing:
    raise RuntimeError("Missing required doctrine: " + ", ".join(missing))

decision_files = sorted(path for path in base_tree if path.startswith("app/docs/decisions/"))

summary = git("diff", "--summary", "--find-renames", "--no-ext-diff", "--no-textconv", merge_base, head, "--", text=True)
dirstat = git("diff", "--dirstat=files,0", "--no-ext-diff", "--no-textconv", merge_base, head, "--", text=True)
base_delta = parse_name_status(git("diff", "--name-status", "-z", "--find-renames", "--no-ext-diff", "--no-textconv", base, head, "--"))

(root / "files.json").write_text(json.dumps({
    "files": files, "base_decision_files": decision_files,
}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(root / "diffstat.json").write_text(json.dumps({
    "range": {"merge_base": merge_base, "head": head}, "total_files": len(files),
    "areas": areas, "files": [{key: value for key, value in item.items() if key not in {"base", "head", "patch"}} for item in files],
    "summary": summary.splitlines(), "dirstat": dirstat.splitlines(), "base_to_head": base_delta,
}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

merge_log = git("log", "--first-parent", "--merges", "--format=%H %s", f"{base}..{head}", text=True)
commit_log = git("log", "--first-parent", "--format=%H %P %s", f"{base}..{head}", text=True)
candidates = []
unmatched = []
direct_commits = []
for line in merge_log.splitlines():
    match = re.search(r"#([1-9][0-9]*)", line)
    if match:
        candidates.append((line.split(" ", 1)[0], int(match.group(1))))
    else:
        unmatched.append(line)
for line in commit_log.splitlines():
    fields = line.split(" ")
    if len(fields) >= 3 and not re.fullmatch(r"[0-9a-f]{40}", fields[2]):
        direct_commits.append(line)

cache = {}
merged = []
incomplete = []
for merge_sha, number in candidates:
    try:
        if number not in cache:
            response = subprocess.run(
                ["gh", "api", "--method", "GET", f"repos/{repo}/pulls/{number}"], check=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env={**os.environ, "GH_HOST": "github.com"},
            )
            cache[number] = json.loads(response.stdout)
        item = cache[number]
        candidate_sha = item.get("merge_commit_sha")
        if item.get("merged_at") and item.get("base", {}).get("ref") == "staging" and candidate_sha:
            in_head = subprocess.run([*git_prefix, "merge-base", "--is-ancestor", candidate_sha, head], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode
            if in_head == 0:
                before_base = subprocess.run([*git_prefix, "merge-base", "--is-ancestor", candidate_sha, base], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
                if not before_base:
                    merged.append({"number": number, "title": item.get("title", ""), "body": item.get("body") or "", "merge_sha": candidate_sha})
            elif in_head == 1:
                unmatched.append(f"{merge_sha} #{number}")
            else:
                incomplete.append({"number": number, "merge_sha": merge_sha, "error": "GitAncestryError"})
        else:
            unmatched.append(f"{merge_sha} #{number}")
    except (subprocess.CalledProcessError, json.JSONDecodeError, KeyError) as error:
        incomplete.append({"number": number, "merge_sha": merge_sha, "error": type(error).__name__})

(root / "merged-prs.json").write_text(json.dumps({
    "merged_prs": merged, "unmatched_merges": unmatched,
    "direct_commits": direct_commits, "first_parent_commits": commit_log.splitlines(),
    "metadata_incomplete": incomplete,
}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

context = {
    **metadata, "merge_base_sha": merge_base, "mode": mode, "run_url": run_url,
    "prepared": True, "integration_stale": merge_base != base,
    "completeness_errors": [f"PR metadata unavailable for #{item['number']}" for item in incomplete],
}
(root / "context.json").write_text(json.dumps(context, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

python3 - "$staging_prompt" "$input_root/PROMPT-staging.md.txt" <<'PY'
from pathlib import Path
import sys
Path(sys.argv[2]).write_bytes(Path(sys.argv[1]).read_bytes())
PY

hook_path="$trusted_root/.github/scripts/review-tool-policy.sh"
settings_file="$RUNNER_TEMP/ai-review-settings.json"
jq -n --arg command "$(printf '%q' "$hook_path")" '{hooks:{PreToolUse:[{matcher:"*",hooks:[{type:"command",command:$command}]}]}}' > "$settings_file"

delimiter="AI_REVIEW_PROMPT_$(python3 -c 'import secrets; print(secrets.token_hex(16))')"
while grep -Fq "$delimiter" "$prompt_file"; do
  delimiter="AI_REVIEW_PROMPT_$(python3 -c 'import secrets; print(secrets.token_hex(16))')"
done
{
  printf 'prompt<<%s\n' "$delimiter"
  cat "$prompt_file"
  printf '\n%s\n' "$delimiter"
} >> "$GITHUB_OUTPUT"

primary="$primary_staging"
[ "$review_mode" = main ] && primary="$primary_main"
emit prepared true
emit review_mode "$review_mode"
emit draft "$draft"
emit base_ref "$base_ref"
emit base_sha "$base_sha"
emit head_sha "$head_sha"
emit primary_model "$primary"
emit fallback_model "$fallback"
emit max_turns "$max_turns"
emit timeout_minutes "$timeout_minutes"
emit settings_file "$settings_file"
