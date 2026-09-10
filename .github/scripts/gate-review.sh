#!/usr/bin/env bash
set -euo pipefail

if [ "${PREPARED:-false}" != true ] || [ "${CURRENT:-false}" != true ] || [ "${DRAFT:-true}" != false ]; then
  echo "AI review preconditions were not satisfied. Merge remains blocked."
  exit 1
fi

for outcome in \
  "${O_1P:-}" "${O_1PR:-}" "${O_1F:-}" "${O_1FR:-}" \
  "${O_2P:-}" "${O_2PR:-}" "${O_2F:-}" "${O_2FR:-}" \
  "${O_3P:-}" "${O_3PR:-}" "${O_3F:-}" "${O_3FR:-}"; do
  case "$outcome" in
    pass)
      echo "AI review PASS."
      exit 0
      ;;
    fail)
      echo "AI review FAIL. Merge remains blocked."
      exit 1
      ;;
  esac
done

echo "AI review produced no verdict. Merge remains blocked."
exit 1
