#!/bin/bash
set -euo pipefail

# SpecGantry deploy script — Release 1.1.4 — 2026-06-15
# University Admissions Officer — AI-assisted college application profile builder
#
# Publishes university-admissions-officer to npm registry
# Users run: npx university-admissions-officer
#
# Usage:
#   ./specs/deploy.sh                  Build + verify token + publish to npm
#   ./specs/deploy.sh --bump minor     Auto-increment minor version and publish
#   ./specs/deploy.sh --bump major     Auto-increment major version and publish
#
# Prerequisites:
#   - Node.js >= 18.0.0
#   - npm >= 9.0.0
#   - Browser (for npm token generation)

BUMP_TYPE="patch"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bump)
      BUMP_TYPE="${2:-patch}"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Verify and fix package.json
echo ""
echo "-> Checking package.json..."
cd "$PROJECT_DIR"

# Fix bin field if needed
BIN_FIELD=$(node -e "const p=require('./package.json'); process.stdout.write(JSON.stringify(p.bin || {}))")
if [[ "$BIN_FIELD" == "{}" ]] || [[ "$BIN_FIELD" == '{"university-admissions-officer":"./bin/cli.js"}' ]]; then
  echo "  -> Fixing bin field in package.json..."
  node -e "
    const fs = require('fs');
    const pkg = require('./package.json');
    pkg.bin = './bin/cli.js';
    fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
    console.log('  -> bin field fixed: \"bin\": \"./bin/cli.js\"');
  "
fi

# Read current version from npm registry (published version)
PUBLISHED_VERSION=$(npm view university-admissions-officer version 2>/dev/null || echo "0.0.0")
echo "-> Currently published version: $PUBLISHED_VERSION"

# Update package.json to published version first, then increment
npm version "$PUBLISHED_VERSION" --no-git-tag-version --allow-same-version 2>/dev/null || true

# Auto-increment version (always)
VERSION=$(npm version --no-git-tag-version "$BUMP_TYPE" 2>/dev/null | tail -1 | tr -d 'v')
echo "-> Version auto-incremented: $PUBLISHED_VERSION → $VERSION"

echo "  Building and publishing to npm registry"

echo ""
echo "========================================"
echo " university-admissions-officer — Release $VERSION"
echo " Publishing to npm registry"
echo " Users will run: npx university-admissions-officer"
echo ""
echo " In this release:"
echo "   STORY-002  Single navbar Upload button replaces 4 per-section buttons"
echo "              Section selector modal with Academic/Tests/Achievements/Activities pills"
echo "              'Add manually' buttons remain on section cards"
echo " Project: $PROJECT_DIR"
echo "========================================"
echo ""

# ---------------------------------------------------------------------------
# Pre-flight: Node.js version gate
# ---------------------------------------------------------------------------
echo "-> Pre-flight: checking Node.js >= 18"
node_major=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [[ "$node_major" -lt 18 ]]; then
  echo "  ERROR: Node.js 18 or higher required (found: $(node --version))"
  exit 1
fi
echo "  -> Node.js $(node --version)  [ok]"

echo "-> Pre-flight: checking npm"
npm --version > /dev/null
echo "  -> npm $(npm --version)  [ok]"

# ---------------------------------------------------------------------------
# Version stamping — update package.json to 1.1.4
# ---------------------------------------------------------------------------
echo ""
echo "-> Stamping version $VERSION"
cd "$PROJECT_DIR"
npm version "$VERSION" --no-git-tag-version --allow-same-version 2>/dev/null || true

WRITTEN_VERSION=$(node -p "require('./package.json').version")
if [[ "$WRITTEN_VERSION" != "$VERSION" ]]; then
  echo "  ERROR: Version stamp failed — package.json shows $WRITTEN_VERSION, expected $VERSION"
  exit 1
fi
echo "  -> package.json version = $WRITTEN_VERSION  [ok]"

# ---------------------------------------------------------------------------
# Build: STORY-002 — Document upload and AI classification (patch)
# ---------------------------------------------------------------------------
echo ""
echo "-> Building Document upload and AI classification ($VERSION)"
cd "$PROJECT_DIR"
npm install 2>&1 | tail -5

REQUIRED_DEPS=(
  "@google/generative-ai"
  "archiver"
  "body-parser"
  "dotenv"
  "express"
  "multer"
  "pdf-parse"
  "pdfkit"
  "sharp"
  "uuid"
)
MISSING_DEPS=()
for dep in "${REQUIRED_DEPS[@]}"; do
  if [[ ! -d "$PROJECT_DIR/node_modules/$dep" ]]; then
    MISSING_DEPS+=("$dep")
  fi
done
if [[ ${#MISSING_DEPS[@]} -gt 0 ]]; then
  echo "  ERROR: Missing from node_modules: ${MISSING_DEPS[*]}"
  echo "         Run: npm install"
  exit 1
fi
echo "  -> All required dependencies present  [ok]"

# Patch verification: single navbar Upload button must be present
echo "-> Verifying STORY-002 patch: single navbar Upload button"
if [[ -f "$PROJECT_DIR/src/public/index.html" ]]; then
  if grep -q 'nav-btn-upload\|id="navUploadBtn"\|id="uploadNavBtn"' "$PROJECT_DIR/src/public/index.html" 2>/dev/null; then
    echo "  -> Navbar upload button reference found in index.html  [ok]"
  else
    echo "  Note: Navbar upload button identifier not detected in index.html — verify single Upload button is in navbar"
  fi
fi

# Patch verification: per-section Upload docs buttons must be absent
echo "-> Verifying STORY-002 patch: per-section upload buttons removed"
if [[ -f "$PROJECT_DIR/src/public/js/app.js" ]]; then
  if grep -qE 'btn-upload-(academic|tests|achievements|activities)|uploadSection(Academic|Tests|Achievements|Activities)' \
      "$PROJECT_DIR/src/public/js/app.js" 2>/dev/null; then
    echo "  WARNING: Per-section upload button identifiers still present in app.js — verify removal"
  else
    echo "  -> No per-section upload button identifiers in app.js  [ok]"
  fi
fi

# Patch verification: section selector pills must be present in upload modal
echo "-> Verifying STORY-002 patch: section selector pills in upload modal"
if [[ -f "$PROJECT_DIR/src/public/js/app.js" ]]; then
  if grep -qE 'section.*pill|pill.*section|Academic.*pill|pill.*Academic|sectionSelector|section-pill' \
      "$PROJECT_DIR/src/public/js/app.js" 2>/dev/null; then
    echo "  -> Section selector pill references found in app.js  [ok]"
  else
    echo "  Note: Section pill selector pattern not detected in app.js — verify modal section selector is implemented"
  fi
fi

# ---------------------------------------------------------------------------
# Critical source file verification
# ---------------------------------------------------------------------------
echo ""
echo "-> Verifying critical source files"

declare -a REQUIRED_FILES=(
  # Core entry
  "bin/cli.js"
  "src/server/index.js"
  "src/config/index.js"
  # STORY-001
  "src/server/routes/profile.js"
  "src/server/routes/settings.js"
  "src/public/index.html"
  "src/public/js/app.js"
  "src/public/js/api-client.js"
  "src/public/js/ui-utils.js"
  "src/public/css/custom.css"
  # STORY-002 (this release)
  "src/server/routes/documents.js"
  "src/ai/extraction.js"
  # Previously deployed stories
  "src/utils/profile-merge.js"
  "src/server/routes/essays.js"
  "src/server/routes/impact-statements.js"
  "src/ai/impact.js"
  "src/lib/pdfExport.js"
  "src/lib/zipExport.js"
  "src/lib/shareTokens.js"
  "src/server/routes/export.js"
  "src/server/routes/share.js"
  "src/ai/essay.js"
  # STORY-007
  "src/config/limits.json"
  "src/config/limitsDefaults.js"
  "src/public/js/limits-settings.js"
  "src/server/routes/config-limits.js"
)

FILE_ERRORS=0
for f in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "$PROJECT_DIR/$f" ]]; then
    echo "  ERROR: Missing file: $f"
    FILE_ERRORS=$((FILE_ERRORS + 1))
  fi
done

if [[ $FILE_ERRORS -gt 0 ]]; then
  echo "  $FILE_ERRORS required file(s) missing — build is incomplete"
  exit 1
fi
echo "  -> All critical source files present  [ok]"

# Verify bin field in package.json
BIN_FIELD=$(node -e "const p=require('./package.json'); if(typeof p.bin === 'string') process.stdout.write(p.bin); else if(p.bin && p.bin.university-admissions-officer) process.stdout.write(p.bin.university-admissions-officer); else process.stdout.write('')")
if [[ "$BIN_FIELD" != "./bin/cli.js" ]]; then
  echo "  ERROR: package.json bin expected './bin/cli.js', got: '$BIN_FIELD'"
  exit 1
fi
echo "  -> package.json bin = ./bin/cli.js  [ok]"

# ---------------------------------------------------------------------------
# Syntax check — story source files
# ---------------------------------------------------------------------------
echo ""
echo "-> Syntax checking source files"

SYNTAX_FILES=(
  "bin/cli.js"
  "src/server/index.js"
  "src/server/routes/profile.js"
  "src/server/routes/documents.js"
  "src/server/routes/essays.js"
  "src/server/routes/impact-statements.js"
  "src/server/routes/share.js"
  "src/server/routes/export.js"
  "src/server/routes/config-limits.js"
  "src/public/js/app.js"
  "src/public/js/api-client.js"
  "src/public/js/ui-utils.js"
  "src/public/js/limits-settings.js"
  "src/ai/extraction.js"
  "src/ai/impact.js"
  "src/ai/essay.js"
  "src/lib/pdfExport.js"
  "src/lib/zipExport.js"
  "src/lib/shareTokens.js"
  "src/utils/profile-merge.js"
  "src/config/limitsDefaults.js"
)
SYNTAX_ERRORS=0
for f in "${SYNTAX_FILES[@]}"; do
  if ! node --check "$PROJECT_DIR/$f" 2>/tmp/university-admissions-officer-syntax-err.txt; then
    echo "  ERROR: Syntax error in $f:"
    sed 's/^/    /' /tmp/university-admissions-officer-syntax-err.txt
    SYNTAX_ERRORS=$((SYNTAX_ERRORS + 1))
  else
    echo "  -> $f  [ok]"
  fi
done
if [[ $SYNTAX_ERRORS -gt 0 ]]; then
  echo "  STOP: $SYNTAX_ERRORS file(s) have syntax errors — fix before deploying"
  exit 1
fi


# ---------------------------------------------------------------------------
# .npmignore check
# ---------------------------------------------------------------------------
echo ""
echo "-> Verifying .npmignore"
if [[ ! -f "$PROJECT_DIR/.npmignore" ]]; then
  echo "  ERROR: .npmignore missing — specs/ and .env may be published to npm"
  exit 1
fi
echo "  -> .npmignore present  [ok]"

# ---------------------------------------------------------------------------
# npm pack dry-run — verify package contents before publish
# ---------------------------------------------------------------------------
echo ""
echo "-> Verifying npm package contents (npm pack --dry-run)"
cd "$PROJECT_DIR"

PACK_FILES=$(npm pack --dry-run --json 2>/dev/null | node -e "
  let data = '';
  process.stdin.on('data', d => data += d);
  process.stdin.on('end', () => {
    try {
      const arr = JSON.parse(data);
      const files = (arr[0] && arr[0].files) || [];
      files.forEach(f => console.log(f.path));
    } catch (e) {}
  });
" 2>/dev/null || true)

PACK_ERRORS=0
if echo "$PACK_FILES" | grep -q "^specs/"; then
  echo "  ERROR: specs/ directory would be included in npm package — fix .npmignore"
  PACK_ERRORS=$((PACK_ERRORS + 1))
fi
if echo "$PACK_FILES" | grep -qE "^\.env$"; then
  echo "  ERROR: .env would be included in npm package — fix .npmignore"
  PACK_ERRORS=$((PACK_ERRORS + 1))
fi
if [[ $PACK_ERRORS -gt 0 ]]; then
  exit 1
fi
echo "  -> Package contents safe (no specs/ or .env in bundle)  [ok]"

# ---------------------------------------------------------------------------
# npm Authentication
# ---------------------------------------------------------------------------
echo ""
echo "-> npm Granular Access Token Setup"
echo ""
echo "  Opening browser to create a token..."
echo ""

# Open browser to token generation page
TOKEN_URL="https://www.npmjs.com/settings/~/tokens"
if [[ "$OSTYPE" == "darwin"* ]]; then
  open "$TOKEN_URL"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  xdg-open "$TOKEN_URL" 2>/dev/null || echo "Visit: $TOKEN_URL"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
  start "$TOKEN_URL"
else
  echo "Visit: $TOKEN_URL"
fi

echo ""
echo "  Steps to create token:"
echo "    1. Click 'Generate new access token' → 'Granular Access Token'"
echo "    2. Name: any name (e.g., deploy-token)"
echo "    3. Expiration: 30 days"
echo "    4. Permissions: CHECK 'Read and publish packages'"
echo "    5. Scroll down - CHECK 'Bypass 2FA for automation'"
echo "    6. Scope: All packages"
echo "    7. Click 'Generate'"
echo "    8. Copy the token (starts with npm_)"
echo ""

read -r -p "Press ENTER when you have copied the token... " DUMMY
echo ""
read -sp "Paste your npm token here: " NPM_TOKEN
echo ""
echo ""

if [[ -z "$NPM_TOKEN" ]]; then
  echo "ERROR: No token provided"
  exit 1
fi

# Set the token
echo "-> Setting npm token..."
npm config set //registry.npmjs.org/:_authToken="$NPM_TOKEN"

# Verify it works
if npm whoami &>/dev/null; then
  CURRENT_USER=$(npm whoami)
  echo "  -> Authenticated as: $CURRENT_USER  [ok]"
else
  echo "ERROR: Token verification failed"
  echo "Make sure your token has 'Bypass 2FA for automation' enabled"
  exit 1
fi

# ---------------------------------------------------------------------------
# npm pack verification
# ---------------------------------------------------------------------------
echo ""
echo "-> Verifying npm package (npm pack --dry-run)"
npm pack --dry-run
echo ""

# ---------------------------------------------------------------------------
# Deploy — npm publish
# ---------------------------------------------------------------------------
echo "-> Publishing university-admissions-officer@$VERSION to npm registry"

# Confirmation prompt
read -r -p "Publish university-admissions-officer@$VERSION to npmjs.org? [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "  Publish cancelled by user."
  exit 0
fi

npm publish
echo "  -> university-admissions-officer@$VERSION published  [ok]"

# Post-publish verification
echo ""
echo "-> Verifying npm registry publish"
sleep 5
PUBLISHED_VERSION=$(npm view university-admissions-officer version 2>/dev/null || echo "unavailable")
if [[ "$PUBLISHED_VERSION" == "$VERSION" ]]; then
  echo "  -> university-admissions-officer@$VERSION confirmed on npm  [ok]"
else
  echo "  Note: Registry shows '$PUBLISHED_VERSION' — propagation may take 1-2 minutes"
fi

echo ""
echo "========================================"
echo " university-admissions-officer@$VERSION deployed to npm ✓"
echo " Users can now run:  npx university-admissions-officer"
echo "========================================"
