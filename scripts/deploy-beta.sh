#!/usr/bin/env bash
# Merge dev → beta, push beta, and push a signed beta tag (v*-beta*).
# Triggers .github/workflows/deploy.yml: unlisted AMO sign + GitHub prerelease.

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

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit or stash before releasing." >&2
  exit 1
fi

git checkout dev
git pull origin dev

CURRENT_VERSION="$(manifest_version)"
echo "Current version in $MANIFEST_PATH: $CURRENT_VERSION"
read -r -p "New version for $MANIFEST_PATH (e.g. 5.0.4): " SEMVER_IN
SEMVER="$(normalize_semver "$SEMVER_IN")"
validate_semver "$SEMVER"
if [[ "$SEMVER" == "$CURRENT_VERSION" ]]; then
  echo "Error: release version must differ from the current manifest version $CURRENT_VERSION." >&2
  exit 1
fi

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
if git show-ref --verify --quiet "refs/tags/$TAG" ||
  git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "Error: tag $TAG already exists." >&2
  exit 1
fi

echo
echo "This will:"
echo "  1. set $MANIFEST_PATH version to $SEMVER, commit on dev, push origin dev"
echo "  2. checkout beta, merge dev (no-ff), push origin beta"
echo "  3. create tag $TAG and push it (triggers beta AMO + prerelease)"
echo "  4. checkout dev (main is not modified)"
read -r -p "Continue? [y/N] " confirm
[[ "${confirm:-}" =~ ^[yY](es)?$ ]] || { echo "Aborted."; exit 1; }

echo "🚀 Releasing beta $TAG"

bump_manifest "$SEMVER"
git add "$MANIFEST_PATH"
git commit -m "chore(release): bump version to $SEMVER"
git push origin dev

git checkout beta
git pull origin beta
git merge dev --no-ff -m "$TAG"
git push origin beta

git tag -s "$TAG" -m "$TAG"
git push origin "$TAG"

git checkout dev
git pull origin dev

echo "✅ Done: beta $TAG (manifest $SEMVER; dev + beta + tag pushed)"
