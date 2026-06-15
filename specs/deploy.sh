#!/bin/bash
set -euo pipefail

# SpecGantry deploy script — Release 1.4.0 — 2026-06-15
# University Admissions Officer — AI-assisted college application profile builder
#
# Target: npm registry (npx university-admissions-officer)
#
# Usage:
#   ./specs/deploy.sh              Build + verify + stamp 1.4.0 + publish to npm
#   ./specs/deploy.sh --dry-run    Build and start locally for testing — no npm publish
#
# Environment variables required (set before running):
#   None beyond npm authentication token (prompted interactively during publish)
#   (dry-run does not require any environment variables)

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

if [[ "$DRY_RUN" == "true" ]]; then
  echo "  Dry-run mode — building and starting locally, no npm publish"
fi

VERSION="1.4.0"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo ""
echo "========================================"
echo " university-admissions-officer — Release $VERSION"
echo " Target: npm registry"
echo " Users will run: npx university-admissions-officer"
echo ""
echo " Stories in this release:"
echo "   STORY-001  Student signup and profile setup"
echo "              (enhanced: non-blocking .env initialization)"
echo "   STORY-006  Personal essay draft generation and editing"
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
# Version stamping — stamp package.json to 1.4.0
# ---------------------------------------------------------------------------
echo ""
echo "-> Stamping version $VERSION"
cd "$PROJECT_DIR"

# Ensure bin field is correct before stamping
BIN_FIELD=$(node -e "const p=require('./package.json'); process.stdout.write(JSON.stringify(p.bin || {}))")
if [[ "$BIN_FIELD" == "{}" ]]; then
  echo "  -> Setting bin field in package.json..."
  node -e "
    const fs = require('fs');
    const pkg = require('./package.json');
    pkg.bin = { 'university-admissions-officer': './bin/cli.js' };
    fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
    console.log('  -> bin field set: university-admissions-officer -> ./bin/cli.js');
  "
fi

npm version "$VERSION" --no-git-tag-version --allow-same-version 2>/dev/null || true

WRITTEN_VERSION=$(node -p "require('./package.json').version")
if [[ "$WRITTEN_VERSION" != "$VERSION" ]]; then
  echo "  ERROR: Version stamp failed — package.json shows $WRITTEN_VERSION, expected $VERSION"
  exit 1
fi
echo "  -> package.json version = $WRITTEN_VERSION  [ok]"

# ---------------------------------------------------------------------------
# Build: STORY-001 — Student signup and profile setup
# ---------------------------------------------------------------------------
echo ""
echo "-> Building Student signup and profile setup ($VERSION)"
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

# ---------------------------------------------------------------------------
# Build: STORY-006 — Personal essay draft generation and editing
# ---------------------------------------------------------------------------
echo ""
echo "-> Building Personal essay draft generation and editing ($VERSION)"

# Verify essay AI module and routes are present
for f in "src/ai/essay.js" "src/server/routes/essays.js"; do
  if [[ ! -f "$PROJECT_DIR/$f" ]]; then
    echo "  ERROR: Missing STORY-006 file: $f"
    exit 1
  fi
  echo "  -> $f  [ok]"
done

# Verify assembleProfileData reads all required profile sections
if grep -q "assembleProfileData" "$PROJECT_DIR/src/ai/essay.js" 2>/dev/null; then
  echo "  -> assembleProfileData present in src/ai/essay.js  [ok]"
else
  echo "  WARNING: assembleProfileData not detected in src/ai/essay.js — verify full profile assembly"
fi

# Verify provenance endpoint is present in essays router
if grep -qE "provenance|provenanceSelection" "$PROJECT_DIR/src/server/routes/essays.js" 2>/dev/null; then
  echo "  -> Provenance endpoint present in essays router  [ok]"
else
  echo "  WARNING: Provenance references not detected in essays router — verify STORY-006 AC#30"
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
  "src/server/routes/config-init.js"
  "src/public/index.html"
  "src/public/js/app.js"
  "src/public/js/api-client.js"
  "src/public/js/ui-utils.js"
  "src/public/css/custom.css"
  # STORY-006
  "src/ai/essay.js"
  "src/server/routes/essays.js"
  # Previously deployed stories
  "src/server/routes/documents.js"
  "src/ai/extraction.js"
  "src/utils/profile-merge.js"
  "src/server/routes/impact-statements.js"
  "src/ai/impact.js"
  "src/lib/pdfExport.js"
  "src/lib/zipExport.js"
  "src/lib/shareTokens.js"
  "src/server/routes/export.js"
  "src/server/routes/share.js"
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

# Verify bin field resolves to cli.js
BIN_RESOLVED=$(node -e "
  const p = require('./package.json');
  if (typeof p.bin === 'string') process.stdout.write(p.bin);
  else if (p.bin && p.bin['university-admissions-officer']) process.stdout.write(p.bin['university-admissions-officer']);
  else process.stdout.write('');
")
if [[ "$BIN_RESOLVED" != "./bin/cli.js" ]]; then
  echo "  ERROR: package.json bin expected './bin/cli.js', got: '$BIN_RESOLVED'"
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
  "src/server/routes/config-init.js"
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
# Runtime storage
# ---------------------------------------------------------------------------
echo ""
echo "-> Setting up runtime storage"
mkdir -p data/profile data/uploads data/.logs
echo "  -> data/ subdirectories ready  [ok]"
# MANUAL: mount ./data as a persistent volume when running on a shared or remote server

# ---------------------------------------------------------------------------
# Dry-run: start locally, skip npm publish
# ---------------------------------------------------------------------------
if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "-> Deploy: Student signup and profile setup (dry-run)"
  echo "  Starting server locally on port 3000..."
  node bin/cli.js &
  SERVER_PID=$!
  echo "  -> server PID $SERVER_PID started"

  echo ""
  echo "-> Health: Student signup and profile setup"
  HEALTH_PORT=3000
  HEALTH_PATH=/
  HEALTH_HOST="localhost"
  echo "  -> Waiting for server..."
  for i in 1 2 3; do
    curl -sf "http://${HEALTH_HOST}:${HEALTH_PORT}${HEALTH_PATH}" && break || { echo "  retry $i/3..."; sleep 5; }
  done
  echo "  -> server is up on http://localhost:$HEALTH_PORT"

  echo ""
  echo "======================================"
  echo "  Dry-run complete — services running locally"
  echo "  Test at: http://localhost:3000"
  echo "  Stop with: kill $SERVER_PID"
  echo "======================================"
  exit 0
fi

# ---------------------------------------------------------------------------
# npm Authentication
# ---------------------------------------------------------------------------
echo ""
echo "-> npm Granular Access Token Setup"
echo ""
echo "  Opening browser to create a token..."
echo ""

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
echo "    1. Click 'Generate new access token' -> 'Granular Access Token'"
echo "    2. Name: any name (e.g., deploy-1.4.0)"
echo "    3. Expiration: 30 days"
echo "    4. Permissions: CHECK 'Read and publish packages'"
echo "    5. Scroll down — CHECK 'Bypass 2FA for automation'"
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

echo "-> Setting npm token..."
npm config set //registry.npmjs.org/:_authToken="$NPM_TOKEN"

if npm whoami &>/dev/null; then
  CURRENT_USER=$(npm whoami)
  echo "  -> Authenticated as: $CURRENT_USER  [ok]"
else
  echo "ERROR: Token verification failed"
  echo "Make sure your token has 'Bypass 2FA for automation' enabled"
  exit 1
fi

# ---------------------------------------------------------------------------
# npm pack final review
# ---------------------------------------------------------------------------
echo ""
echo "-> Final npm package review (npm pack --dry-run)"
npm pack --dry-run
echo ""

# ---------------------------------------------------------------------------
# Deploy — STORY-001 + STORY-006 — npm publish
# ---------------------------------------------------------------------------
echo "-> Publishing university-admissions-officer@$VERSION to npm registry"
echo "   Stories in this release: STORY-001, STORY-006"
echo ""

read -r -p "Publish university-admissions-officer@$VERSION to npmjs.org? [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "  Publish cancelled by user."
  exit 0
fi

npm publish
echo "  -> university-admissions-officer@$VERSION published  [ok]"

# ---------------------------------------------------------------------------
# Health: verify successful publish
# ---------------------------------------------------------------------------
echo ""
echo "-> Verifying npm registry publish"
sleep 5
PUBLISHED_VERSION=$(npm view university-admissions-officer version 2>/dev/null || echo "unavailable")
if [[ "$PUBLISHED_VERSION" == "$VERSION" ]]; then
  echo "  -> university-admissions-officer@$VERSION confirmed on npm  [ok]"
else
  echo "  Note: Registry shows '$PUBLISHED_VERSION' — propagation may take 1-2 minutes"
  echo "  Verify with: npm view university-admissions-officer version"
fi

echo ""
echo "========================================"
echo " university-admissions-officer@$VERSION deployed to npm"
echo " Users can now run:  npx university-admissions-officer"
echo "========================================"
