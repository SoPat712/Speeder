#!/usr/bin/env bash
# Merge dev → beta, push beta, and push an annotated beta tag (v*-beta*).
# Triggers .github/workflows/deploy.yml: unlisted AMO sign + GitHub prerelease.

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
    echo "Error: invalid version (use something like 5.0.4 or 5.0.4-beta.1)." >&2
    return 1
  fi
}

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit or stash before releasing." >&2
  exit 1
fi

git checkout dev
git pull origin dev

echo "Current version in manifest.json: $(manifest_version)"
read -r -p "New version for manifest.json (e.g. 5.0.4): " SEMVER_IN
SEMVER="$(normalize_semver "$SEMVER_IN")"
validate_semver "$SEMVER"

echo "Beta git tag will include '-beta' (required by deploy.yml)."
read -r -p "Beta tag suffix [beta.1]: " SUFFIX_IN
SUFFIX="${SUFFIX_IN#"${SUFFIX_IN%%[![:space:]]*}"}"
SUFFIX="${SUFFIX%"${SUFFIX##*[![:space:]]}"}"
SUFFIX="${SUFFIX:-beta.1}"

TAG="v${SEMVER}-${SUFFIX}"
if [[ "$TAG" != *-beta* ]]; then
  echo "Error: beta tag must contain '-beta' for the workflow (got $TAG). Try suffix like beta.1." >&2
  exit 1
fi

echo
echo "This will:"
echo "  1. set manifest.json version to $SEMVER and commit on dev"
echo "  2. checkout beta, merge dev (no-ff), push origin beta"
echo "  3. create tag $TAG and push it (triggers beta AMO + prerelease)"
echo "  4. checkout dev"
read -r -p "Continue? [y/N] " confirm
[[ "${confirm:-}" =~ ^[yY](es)?$ ]] || { echo "Aborted."; exit 1; }

echo "🚀 Releasing beta $TAG"

bump_manifest "$SEMVER"
git add manifest.json
git commit -m "Bump version to $SEMVER"

git checkout beta
git pull origin beta
git merge dev --no-ff -m "$TAG"
git push origin beta

git tag -a "$TAG" -m "$TAG"
git push origin "$TAG"

git checkout dev

echo "✅ Done: beta $TAG (manifest $SEMVER, merge + tag pushed)"
