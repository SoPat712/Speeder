#!/usr/bin/env bash
# Merge dev → beta, push beta, and push an annotated beta tag (v*-beta*).
# Triggers .github/workflows/deploy.yml: unlisted AMO sign + GitHub prerelease.

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
echo "Beta tags should include '-beta' (e.g. v5.0.3-beta.1) to match deploy.yml."
read -r -p "Annotated tag to create and push: " VERSION
VERSION="${VERSION#"${VERSION%%[![:space:]]*}"}"
VERSION="${VERSION%"${VERSION##*[![:space:]]}"}"
if [[ -z "$VERSION" ]]; then
  echo "Error: empty version." >&2
  exit 1
fi

echo
echo "This will:"
echo "  1. checkout beta, merge dev (no-ff), push origin beta"
echo "  2. create tag $VERSION and push it (triggers beta AMO + prerelease)"
echo "  3. checkout dev"
read -r -p "Continue? [y/N] " confirm
[[ "${confirm:-}" =~ ^[yY](es)?$ ]] || { echo "Aborted."; exit 1; }

echo "🚀 Releasing beta $VERSION"

git checkout beta
git pull origin beta
git merge dev --no-ff -m "$VERSION"
git push origin beta

git tag -a "$VERSION" -m "$VERSION"
git push origin "$VERSION"

git checkout dev

echo "✅ Done: beta $VERSION (merge + tag pushed)"
