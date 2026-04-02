#!/usr/bin/env bash
# Squash beta onto main, set manifest version, one release commit, push stable tag (v* without -beta).
# Does not merge dev or push to beta — promote only what is already on beta.
# Triggers .github/workflows/deploy.yml: listed AMO submission.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

manifest_version() {
  python3 -c 'import json; print(json.load(open("manifest.json"))["version"])'
}

bump_manifest() {
  local ver="$1"
  VER="$ver" python3 <<'PY'
import json
import os

ver = os.environ["VER"]
path = "manifest.json"
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
  if [[ ! "$s" =~ ^[0-9]+(\.[0-9]+){0,3}(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; then
    echo "Error: invalid version (use something like 5.0.4)." >&2
    return 1
  fi
}

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit or stash before releasing." >&2
  exit 1
fi

git checkout beta
git pull origin beta

echo "Current version on beta (manifest.json): $(manifest_version)"
read -r -p "Release version for manifest.json + tag (e.g. 5.0.4): " SEMVER_IN
SEMVER="$(normalize_semver "$SEMVER_IN")"
validate_semver "$SEMVER"

TAG="v${SEMVER}"
if [[ "$TAG" == *-beta* ]]; then
  echo "Warning: stable tags should not contain '-beta' (workflow would use unlisted + prerelease, not AMO listed)."
  read -r -p "Continue anyway? [y/N] " w
  [[ "${w:-}" =~ ^[yY](es)?$ ]] || { echo "Aborted."; exit 1; }
fi

echo
echo "This will:"
echo "  1. checkout main, merge --squash origin/beta (single release commit on main)"
echo "  2. set manifest.json to $SEMVER in that commit (if anything else changed, it is included too)"
echo "  3. push origin main, create tag $TAG, push tag (triggers listed AMO submit)"
echo "  4. checkout dev (merge main→dev yourself if you want them aligned)"
read -r -p "Continue? [y/N] " confirm
[[ "${confirm:-}" =~ ^[yY](es)?$ ]] || { echo "Aborted."; exit 1; }

echo "🚀 Releasing stable $TAG to AMO (listed)"

git checkout main
git pull origin main
git merge --squash beta
bump_manifest "$SEMVER"
git add -A
git commit -m "Release $TAG"

git push origin main

git tag -a "$TAG" -m "$TAG"
git push origin "$TAG"

git checkout dev

echo "✅ Done: main squashed from beta, tagged $TAG (manifest $SEMVER)"
