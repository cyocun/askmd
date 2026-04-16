#!/usr/bin/env bash
# One-time setup for cyocun/homebrew-tap repository.
# Prerequisites: gh CLI authenticated with repo scope.
set -euo pipefail

OWNER="cyocun"
REPO="homebrew-tap"

echo "Creating ${OWNER}/${REPO} on GitHub..."
gh repo create "${OWNER}/${REPO}" \
  --public \
  --description "Homebrew tap for askmd — Markdown viewer with Claude AI integration"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

cd "$TMPDIR"
git init -b main
mkdir -p Casks

cat > README.md << 'EOF'
# homebrew-tap

Homebrew tap for [askmd](https://github.com/cyocun/askmd).

## Usage

```sh
brew install --cask cyocun/tap/askmd
```

Or:

```sh
brew tap cyocun/tap
brew install --cask askmd
```
EOF

cat > Casks/askmd.rb << 'EOF'
cask "askmd" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.0"
  sha256 arm:   "PLACEHOLDER",
         intel: "PLACEHOLDER"

  url "https://github.com/cyocun/askmd/releases/download/v#{version}/askmd_#{version}_#{arch}.dmg"
  name "askmd"
  desc "Markdown viewer with Claude AI integration"
  homepage "https://github.com/cyocun/askmd"

  depends_on macos: ">= :monterey"

  app "askmd.app"

  zap trash: [
    "~/Library/Application Support/com.cyocun.askmd",
    "~/Library/Caches/com.cyocun.askmd",
    "~/Library/Preferences/com.cyocun.askmd.plist",
    "~/Library/Saved Application State/com.cyocun.askmd.savedState",
  ]
end
EOF

git add -A
git commit -m "Initial Cask formula for askmd"
git remote add origin "https://github.com/${OWNER}/${REPO}.git"
git push -u origin main

echo ""
echo "Done! Next steps:"
echo "  1. Create a GitHub PAT with 'repo' scope"
echo "  2. Add it as HOMEBREW_TAP_TOKEN secret in ${OWNER}/askmd repo settings"
echo "  3. Publish a release — the update-homebrew workflow will update the Cask automatically"
