#!/usr/bin/env bash
# Bump manifest on dev, merge dev→beta→main, push an annotated stable tag (v* without -beta).
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

git checkout dev
git pull origin dev

echo "Current version in manifest.json: $(manifest_version)"
read -r -p "New version for manifest.json (e.g. 5.0.4): " SEMVER_IN
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
echo "  1. set manifest.json version to $SEMVER and commit on dev"
echo "  2. merge dev → beta and push beta"
echo "  3. merge beta → main and push main"
echo "  4. create tag $TAG on main and push it (triggers listed AMO submit)"
echo "  5. checkout dev"
read -r -p "Continue? [y/N] " confirm
[[ "${confirm:-}" =~ ^[yY](es)?$ ]] || { echo "Aborted."; exit 1; }

echo "🚀 Releasing stable $TAG to AMO (listed)"

bump_manifest "$SEMVER"
git add manifest.json
git commit -m "Bump version to $SEMVER"

git checkout beta
git pull origin beta
git merge dev --no-ff -m "Merge dev ($TAG)"
git push origin beta

git checkout main
git pull origin main
git merge beta --no-ff -m "Merge beta ($TAG)"
git push origin main

git tag -a "$TAG" -m "$TAG"
git push origin "$TAG"

git checkout dev

echo "✅ Done: stable $TAG (manifest $SEMVER, main + tag pushed)"
