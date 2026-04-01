#!/usr/bin/env bash
# Merge beta → main, push main, and push an annotated stable tag (v* without -beta).
# Triggers .github/workflows/deploy.yml: listed AMO submission.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

manifest_version() {
  python3 -c 'import json; print(json.load(open("manifest.json"))["version"])'
}

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit or stash before releasing." >&2
  exit 1
fi

echo "Current version in manifest.json: $(manifest_version)"
echo "Stable AMO releases use a tag like v5.0.3 (no '-beta' in the tag per deploy.yml)."
read -r -p "Annotated tag to create and push: " VERSION
VERSION="${VERSION#"${VERSION%%[![:space:]]*}"}"
VERSION="${VERSION%"${VERSION##*[![:space:]]}"}"
if [[ -z "$VERSION" ]]; then
  echo "Error: empty version." >&2
  exit 1
fi
if [[ "$VERSION" == *-beta* ]]; then
  echo "Warning: tag contains '-beta'; workflow will treat this as beta (unlisted + prerelease), not stable AMO listed."
  read -r -p "Continue anyway? [y/N] " w
  [[ "${w:-}" =~ ^[yY](es)?$ ]] || { echo "Aborted."; exit 1; }
fi

echo
echo "This will:"
echo "  1. checkout main, merge beta (no-ff), push origin main"
echo "  2. create tag $VERSION on main and push it (triggers listed AMO submit)"
echo "  3. checkout dev"
read -r -p "Continue? [y/N] " confirm
[[ "${confirm:-}" =~ ^[yY](es)?$ ]] || { echo "Aborted."; exit 1; }

echo "🚀 Releasing stable $VERSION to AMO (listed)"

git checkout main
git pull origin main
git merge beta --no-ff -m "Merge beta ($VERSION)"
git push origin main

git tag -a "$VERSION" -m "$VERSION"
git push origin "$VERSION"

git checkout dev

echo "✅ Done: stable $VERSION (main merge + tag pushed)"
