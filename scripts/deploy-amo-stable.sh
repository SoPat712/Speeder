#!/usr/bin/env bash
# Make main's tree match beta, set manifest version, one release commit, push stable tag (v* without -beta).
# Does not merge dev or push to beta — promote only what is already on beta.
# Triggers .github/workflows/deploy.yml: listed AMO submission.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
MANIFEST_PATH="extension/manifest.json"

manifest_version() {
  MANIFEST_PATH="$MANIFEST_PATH" python3 -c 'import json, os; print(json.load(open(os.environ["MANIFEST_PATH"]))["version"])'
}

bump_manifest() {
  local ver="$1"
  VER="$ver" MANIFEST_PATH="$MANIFEST_PATH" python3 <<'PY'
import json
import os

ver = os.environ["VER"]
path = os.environ["MANIFEST_PATH"]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
data["version"] = ver
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY
}

normalize_semver() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  s="${s#v}"
  s="${s#V}"
  printf '%s' "$s"
}

validate_semver() {
  local s="$1"
  if [[ -z "$s" ]]; then
    echo "Error: empty version." >&2
    return 1
  fi
  if [[ ! "$s" =~ ^[0-9]+(\.[0-9]+){0,3}$ ]]; then
    echo "Error: Firefox versions must contain only 1-4 numeric parts (for example, 6.0.8.1)." >&2
    return 1
  fi
}

# Firefox compares up to four numeric parts; missing parts count as zero.
normalize_version_parts() {
  local IFS=.
  local -a parts=($1)
  local -a out=()
  local part
  for part in "${parts[@]}"; do
    out+=("$((10#$part))")
  done
  while ((${#out[@]} < 4)); do
    out+=(0)
  done
  printf '%s' "${out[*]}"
}

# Succeeds when version $1 is strictly greater than version $2.
version_gt() {
  local a b
  a="$(normalize_version_parts "$1")"
  b="$(normalize_version_parts "$2")"
  [[ "$a" != "$b" && "$(printf '%s\n%s\n' "$b" "$a" | sort -V | tail -n 1)" == "$a" ]]
}

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit or stash before releasing." >&2
  exit 1
fi

git checkout beta
git pull origin beta

CURRENT_VERSION="$(manifest_version)"
echo "Current version on beta ($MANIFEST_PATH): $CURRENT_VERSION"
read -r -p "Release version for $MANIFEST_PATH + tag (e.g. 5.0.4): " SEMVER_IN
SEMVER="$(normalize_semver "$SEMVER_IN")"
validate_semver "$SEMVER"
if ! version_gt "$SEMVER" "$CURRENT_VERSION"; then
  echo "Error: release version must be greater than the current manifest version $CURRENT_VERSION." >&2
  exit 1
fi

TAG="v${SEMVER}"
if [[ "$TAG" == *-beta* ]]; then
  echo "Warning: stable tags should not contain '-beta' (workflow would use unlisted + prerelease, not AMO listed)."
  read -r -p "Continue anyway? [y/N] " w
  [[ "${w:-}" =~ ^[yY](es)?$ ]] || { echo "Aborted."; exit 1; }
fi
if git show-ref --verify --quiet "refs/tags/$TAG" ||
  git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "Error: tag $TAG already exists." >&2
  exit 1
fi

echo
echo "This will:"
echo "  1. checkout main and make its files exactly match beta (files deleted on beta are deleted on main)"
echo "  2. set $MANIFEST_PATH to $SEMVER and commit everything as one release commit on main"
echo "  3. push origin main, create tag $TAG, push tag (triggers listed AMO submit)"
echo "  4. checkout dev (merge main→dev yourself if you want them aligned)"
read -r -p "Continue? [y/N] " confirm
[[ "${confirm:-}" =~ ^[yY](es)?$ ]] || { echo "Aborted."; exit 1; }

echo "🚀 Releasing stable $TAG to AMO (listed)"

git checkout main
git pull origin main
# main only receives these release commits and shares no recent history with
# beta, so a squash merge conflicts. Take beta's tree as-is instead.
git read-tree -u --reset beta
bump_manifest "$SEMVER"
git add -A
git commit -m "chore(release): prepare $TAG"

git push origin main

git tag -s "$TAG" -m "$TAG"
git push origin "$TAG"

git checkout dev

echo "✅ Done: main set to beta's tree, tagged $TAG (manifest $SEMVER)"
