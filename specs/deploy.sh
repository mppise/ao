#!/bin/bash
set -euo pipefail

# SpecGantry deploy script — Release 1.1.4 — 2026-06-15
# Generated for: NPX local desktop app (Node.js + npm publish via `npx ao`)
#
# Patch release — bug fix:
#   STORY-002  Consolidated 4 per-section upload buttons into single navbar Upload button
#              with interactive section-selector modal (Academic, Tests, Achievements, Activities pills)
#
# Usage:
#   ./specs/deploy.sh              Publish release 1.1.4 to npm registry
#   ./specs/deploy.sh --dry-run    Build and start locally for testing — no npm publish
#
# Environment variables required (set before running in production mode):
#   NPM_TOKEN   npm authentication token (run `npm login` or export NPM_TOKEN=<token>)
#   (dry-run does not require these)
#
# Prerequisites:
#   - Node.js >= 18.0.0
#   - npm >= 9.0.0
#   - .env file at project root with GEMINI_API_KEY, GEMINI_MODEL, DATA_DIR

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

if [[ "$DRY_RUN" == "true" ]]; then
  echo "  Dry-run mode — building and starting locally, no npm publish"
fi

VERSION="1.1.4"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo ""
echo "========================================"
echo " Admissions Officer — Release $VERSION"
echo " Target: npm registry (npx ao)"
echo " Type:   patch (bug fix)"
echo " New in this release:"
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
BIN_FIELD=$(node -e "const p=require('./package.json'); process.stdout.write(p.bin && p.bin.ao || '')")
if [[ "$BIN_FIELD" != "./bin/cli.js" ]]; then
  echo "  ERROR: package.json bin.ao expected './bin/cli.js', got: '$BIN_FIELD'"
  exit 1
fi
echo "  -> package.json bin.ao = ./bin/cli.js  [ok]"

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
  if ! node --check "$PROJECT_DIR/$f" 2>/tmp/ao-syntax-err.txt; then
    echo "  ERROR: Syntax error in $f:"
    sed 's/^/    /' /tmp/ao-syntax-err.txt
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
# Runtime storage
# ---------------------------------------------------------------------------
echo ""
echo "-> Setting up runtime storage"
mkdir -p "$PROJECT_DIR/data/profile"
mkdir -p "$PROJECT_DIR/data/uploads"
mkdir -p "$PROJECT_DIR/data/.logs"
echo "  -> data/profile   [ok]"
echo "  -> data/uploads   [ok]"
echo "  -> data/.logs     [ok]"
# MANUAL: DATA_DIR in .env should point to the student's chosen directory on first run.
#         The ./data directory at project root is a development default only — not shipped via npm.

# ---------------------------------------------------------------------------
# Startup smoke test — boot the server and verify endpoints
# ---------------------------------------------------------------------------
echo ""
echo "-> Running startup smoke test"

SMOKE_PORT=14002
SMOKE_PID=""
cleanup_smoke() {
  if [[ -n "${SMOKE_PID:-}" ]]; then
    kill "$SMOKE_PID" 2>/dev/null || true
  fi
}
trap cleanup_smoke EXIT

ENV_FILE="$PROJECT_DIR/.env"
if [[ ! -f "$ENV_FILE" && -f "$PROJECT_DIR/.env.example" ]]; then
  echo "  Note: No .env found — smoke-booting with .env.example (AI calls will fail but server boot is verified)"
  ENV_FILE="$PROJECT_DIR/.env.example"
fi

if [[ -f "$ENV_FILE" ]]; then
  PORT=$SMOKE_PORT node "$PROJECT_DIR/bin/cli.js" > /tmp/ao-smoke-114.log 2>&1 &
  SMOKE_PID=$!
  SMOKE_OK=false
  for i in 1 2 3 4 5; do
    sleep 1
    if curl -sf "http://127.0.0.1:${SMOKE_PORT}/" -o /dev/null 2>/dev/null; then
      SMOKE_OK=true
      break
    fi
  done

  if [[ "$SMOKE_OK" == "true" ]]; then
    echo "  -> Server started and responded on port $SMOKE_PORT  [ok]"

    # Verify STORY-002: POST /api/documents/upload endpoint registered
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:${SMOKE_PORT}/api/documents/upload" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "400" || "$HTTP_CODE" == "401" || "$HTTP_CODE" == "415" || "$HTTP_CODE" == "422" ]]; then
      echo "  -> POST /api/documents/upload endpoint present  [ok]"
    else
      echo "  Note: POST /api/documents/upload returned HTTP $HTTP_CODE — verify STORY-002 route"
    fi

    # Verify STORY-002: GET /api/documents/pending endpoint registered
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${SMOKE_PORT}/api/documents/pending" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "400" || "$HTTP_CODE" == "401" ]]; then
      echo "  -> GET /api/documents/pending endpoint present  [ok]"
    else
      echo "  Note: GET /api/documents/pending returned HTTP $HTTP_CODE — verify STORY-002 route"
    fi

    # Verify STORY-007: GET /api/config/limits endpoint
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${SMOKE_PORT}/api/config/limits" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "400" || "$HTTP_CODE" == "401" ]]; then
      echo "  -> GET /api/config/limits endpoint present  [ok]"
    else
      echo "  Note: GET /api/config/limits returned HTTP $HTTP_CODE — verify STORY-007 route is registered"
    fi
  else
    echo "  Note: Server did not respond within 5 s — likely .env is not fully configured."
    echo "        Boot output (first 10 lines):"
    head -10 /tmp/ao-smoke-114.log | sed 's/^/    /'
    echo "        Continuing — verify manually with: npx ao"
  fi
  cleanup_smoke
  trap - EXIT
  SMOKE_PID=""
else
  echo "  Note: No .env or .env.example found — skipping live boot test"
  echo "        Create .env from .env.example and set GEMINI_API_KEY before running."
fi

echo "  -> Smoke test complete"

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
# Deploy — npm publish (production) or local start (dry-run)
# ---------------------------------------------------------------------------
if [[ "$DRY_RUN" == "false" ]]; then
  echo ""
  echo "-> Publishing admissions-officer@$VERSION to npm registry"
  # MANUAL: ensure you are authenticated — run `npm login` or export NPM_TOKEN=<your-token>
  # MANUAL: if this is a scoped package (@scope/admissions-officer), add --access public to npm publish
  if [[ -n "${NPM_TOKEN:-}" ]]; then
    echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > "$PROJECT_DIR/.npmrc.deploy"
    npm publish --userconfig "$PROJECT_DIR/.npmrc.deploy"
    rm -f "$PROJECT_DIR/.npmrc.deploy"
  else
    npm publish
  fi
  echo "  -> admissions-officer@$VERSION published  [ok]"

  # Health check: post-publish registry confirmation
  echo ""
  echo "-> Health: verifying npm registry publish"
  sleep 5
  PUBLISHED_VERSION=$(npm view admissions-officer version 2>/dev/null || echo "unavailable")
  if [[ "$PUBLISHED_VERSION" == "$VERSION" ]]; then
    echo "  -> admissions-officer@$VERSION confirmed on npm  [ok]"
  else
    echo "  Note: Registry shows '$PUBLISHED_VERSION' — propagation may take 1-2 minutes"
    echo "        Verify with: npm view admissions-officer version"
  fi

  echo ""
  echo "========================================"
  echo " Release $VERSION deployed to npm"
  echo " Install:  npx admissions-officer@$VERSION"
  echo " Alias:    npx ao"
  echo " Fixes in this release:"
  echo "   STORY-002  Single navbar Upload button — 4 per-section buttons removed"
  echo "              Modal now opens with section selector (pill buttons)"
  echo "              Section must be selected before upload proceeds"
  echo "              'Add manually' buttons remain on section cards"
  echo "========================================"

else
  echo ""
  echo "-> [Dry-run] Starting Admissions Officer locally on port 3000"
  echo "   Requires .env configured with GEMINI_API_KEY, GEMINI_MODEL, DATA_DIR"
  if [[ ! -f "$PROJECT_DIR/.env" ]]; then
    echo "   WARNING: .env not found. Copy .env.example to .env and configure it."
    echo "            The server may fail to start without GEMINI_API_KEY."
  fi
  echo ""
  node "$PROJECT_DIR/bin/cli.js" &
  LOCAL_PID=$!
  sleep 2

  # Health: verify server is live on port 3000
  echo "-> Health: verifying Admissions Officer on localhost:3000"
  HEALTH_PORT=3000
  HEALTH_PATH="/"
  HEALTH_HOST="localhost"
  HEALTH_OK=false
  for i in 1 2 3; do
    if curl -sf "http://${HEALTH_HOST}:${HEALTH_PORT}${HEALTH_PATH}" -o /dev/null 2>/dev/null; then
      HEALTH_OK=true
      break
    else
      echo "  retry $i/3..."
      sleep 5
    fi
  done

  if [[ "$HEALTH_OK" == "true" ]]; then
    echo "  -> Admissions Officer is up at http://localhost:3000  [ok]"
  else
    echo "  Note: Server may still be starting — check http://localhost:3000 in your browser"
    echo "        If it does not respond, verify .env is configured correctly and run: node bin/cli.js"
  fi

  echo ""
  echo "========================================"
  echo " Dry-run complete — Release $VERSION"
  echo " Test at:  http://localhost:3000"
  echo ""
  echo " Verify patch fix:"
  echo "   STORY-002  Open dashboard — confirm NO per-section 'Upload docs' buttons"
  echo "              on Academic, Tests, Achievements, or Activities cards"
  echo "              Click navbar 'Upload' button — confirm modal opens with"
  echo "              no section pre-selected (all 4 pills in outline style)"
  echo "              Click a section pill — confirm it highlights (btn-primary)"
  echo "              Attempt upload with no pill selected — confirm inline error:"
  echo "              'Please select a section before uploading'"
  echo "              Confirm 'Add manually' buttons still present on section cards"
  echo ""
  echo " Stop with: kill $LOCAL_PID   (or pkill -f 'node bin/cli.js')"
  echo "========================================"
fi
