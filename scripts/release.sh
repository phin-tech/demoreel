#!/usr/bin/env bash
# Releases demoreel: scripts/release.sh <version> [--dry-run]
#
# From a clean, pushed main with passing tests: sets the version in package.json, commits and pushes it, tags v<version>
# and publishes a GitHub release (notes made from the commits since the last tag), then points the formula in
# phin-tech/homebrew-tap at it, so `brew upgrade demoreel` gets it. --dry-run checks everything and only prints the rest.
set -euo pipefail

version="${1:-}"
dry=""
[[ "${2:-}" == "--dry-run" || "${1:-}" == "--dry-run" ]] && dry=1
[[ "$version" == "--dry-run" ]] && version="${2:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: scripts/release.sh <version, like 0.1.1> [--dry-run]" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
run() { if [[ -n "$dry" ]]; then echo "  would run: $*"; else "$@"; fi; }
say() { echo "› $*"; }

say "Checking"
[[ "$(git branch --show-current)" == main ]] || { echo "Release from main." >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "Commit or stash your changes first." >&2; exit 1; }
git fetch --quiet origin main --tags
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || { echo "main isn't the same as origin/main: push or pull first." >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$version" >/dev/null && { echo "v$version is already tagged." >&2; exit 1; }
current="$(node -p 'require("./package.json").version')"
echo "  $current -> $version"
npm test --silent >/dev/null 2>&1 || { echo "The tests fail: npm test." >&2; exit 1; }
command -v gh >/dev/null || { echo "This needs the GitHub CLI, gh." >&2; exit 1; }

say "Versioning demoreel $version"
if [[ "$current" != "$version" ]]; then
  run npm version "$version" --no-git-tag-version
  run git commit --quiet -am "demoreel $version"
  run git push --quiet origin main
fi
run git tag -a "v$version" -m "demoreel $version"
run git push --quiet origin "v$version"
run gh release create "v$version" --title "demoreel $version" --generate-notes

say "Updating the Homebrew formula"
archive="https://github.com/phin-tech/demoreel/archive/refs/tags/v$version.tar.gz"
if [[ -n "$dry" ]]; then
  echo "  would point Formula/demoreel.rb in phin-tech/homebrew-tap at $archive"
  exit 0
fi
sha=""
for _ in 1 2 3 4 5 6; do
  sha="$(curl -fsSL "$archive" | shasum -a 256 | cut -d' ' -f1)" && [[ -n "$sha" ]] && break
  sleep 5
done
[[ -n "$sha" ]] || { echo "Couldn't fetch $archive to hash it; update the formula by hand." >&2; exit 1; }
tap="$(mktemp -d)"
trap 'rm -rf "$tap"' EXIT
gh repo clone phin-tech/homebrew-tap "$tap" -- --quiet
sed -i '' -E \
  -e "s|^  url \".*\"|  url \"$archive\"|" \
  -e "s|^  sha256 \".*\"|  sha256 \"$sha\"|" \
  "$tap/Formula/demoreel.rb"
git -C "$tap" add Formula/demoreel.rb
git -C "$tap" commit --quiet -m "demoreel $version"
git -C "$tap" push --quiet
echo "Released demoreel $version: brew upgrade demoreel (after brew update) installs it."
