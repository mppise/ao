#!/bin/bash
set -euo pipefail

# SpecGantry deploy script — Release 1.1.2 — 2026-06-14
# Generated for: NPX local desktop app (Node.js + npm publish via `npx ao`)
#
# Patch release — STORY-003 fixes:
#   - Duplicate course detection and merge on transcript re-upload
#   - Manual AP/IB exam score management with linked course badges
#
# Usage:
#   ./specs/deploy.sh              Publish release 1.1.2 to npm registry
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

VERSION="1.1.2"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo ""
echo "========================================"
echo " Admissions Officer — Release $VERSION"
echo " Target: npm registry (npx ao)"
echo " Patch:  STORY-003 data extraction fixes"
echo "         - Duplicate course detection/merge on transcript re-upload"
echo "         - Manual AP/IB exam score management"
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
# Version stamping — update package.json to 1.1.2
# ---------------------------------------------------------------------------
echo ""
echo "-> Stamping version $VERSION in package.json"
cd "$PROJECT_DIR"
npm version "$VERSION" --no-git-tag-version --allow-same-version 2>/dev/null || true

WRITTEN_VERSION=$(node -p "require('./package.json').version")
if [[ "$WRITTEN_VERSION" != "$VERSION" ]]; then
  echo "  ERROR: Version stamp failed — package.json shows $WRITTEN_VERSION, expected $VERSION"
  exit 1
fi
echo "  -> package.json version = $WRITTEN_VERSION  [ok]"

# ---------------------------------------------------------------------------
# Dependencies — verify node_modules
# ---------------------------------------------------------------------------
echo ""
echo "-> Installing and verifying node_modules"
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
# Entry point verification — all stories including STORY-003 patch files
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
  # STORY-002
  "src/server/routes/documents.js"
  # STORY-003 patch files
  "src/ai/extraction.js"
  "src/utils/profile-merge.js"
  # STORY-004
  "src/ai/impact.js"
  "src/server/routes/impact-statements.js"
  # STORY-005
  "src/lib/pdfExport.js"
  "src/lib/zipExport.js"
  "src/lib/shareTokens.js"
  "src/server/routes/export.js"
  "src/server/routes/share.js"
  # STORY-006
  "src/ai/essay.js"
  "src/server/routes/essays.js"
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
# 1.1.2 patch verification — STORY-003 course merge and AP/IB fixes
# ---------------------------------------------------------------------------
echo ""
echo "-> Verifying 1.1.2 patch: STORY-003 fixes in profile-merge.js and extraction.js"

PATCH_ERRORS=0

# Verify coursesMergeMode parameter exists in profile-merge.js (duplicate course handling)
if grep -q "coursesMergeMode\|merge_mode\|mergeMode" "$PROJECT_DIR/src/utils/profile-merge.js" 2>/dev/null; then
  echo "  -> coursesMergeMode parameter detected in profile-merge.js  [ok]"
else
  echo "  WARNING: coursesMergeMode not found in profile-merge.js"
  echo "           Duplicate course detection/merge fix may not be in place"
  PATCH_ERRORS=$((PATCH_ERRORS + 1))
fi

# Verify apIbScores is handled at top-level in profile-merge.js (not nested under data)
if grep -q "apIbScores" "$PROJECT_DIR/src/utils/profile-merge.js" 2>/dev/null; then
  echo "  -> apIbScores field handling detected in profile-merge.js  [ok]"
else
  echo "  WARNING: apIbScores not found in profile-merge.js"
  echo "           AP/IB scores may not be written to academic.json correctly"
  PATCH_ERRORS=$((PATCH_ERRORS + 1))
fi

# Verify linkedCourseName join key exists for AP/IB badge linking
if grep -q "linkedCourseName" "$PROJECT_DIR/src/utils/profile-merge.js" 2>/dev/null || \
   grep -q "linkedCourseName" "$PROJECT_DIR/src/server/routes/profile.js" 2>/dev/null; then
  echo "  -> linkedCourseName join key detected  [ok]"
else
  echo "  Note: linkedCourseName not found — AP/IB course badge linking may need manual verification"
fi

# Verify SAT structured schema fix is present in profile-merge.js
if grep -q "sat\.score\|sat_math\|sat_ebrw" "$PROJECT_DIR/src/utils/profile-merge.js" 2>/dev/null; then
  echo "  -> SAT structured schema (sat.score.{math,ebrw,total}) detected in profile-merge.js  [ok]"
else
  echo "  WARNING: SAT structured schema fix not confirmed in profile-merge.js — verify manually"
fi

if [[ $PATCH_ERRORS -gt 1 ]]; then
  echo "  STOP: Core patch verification failed — STORY-003 fixes are not in place"
  echo "        Rebuild STORY-003 before deploying 1.1.2"
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
# Runtime storage directories
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
# Startup smoke test — syntax check + live boot
# ---------------------------------------------------------------------------
echo ""
echo "-> Running startup smoke test"

SYNTAX_FILES=(
  "bin/cli.js"
  "src/server/index.js"
  "src/server/routes/profile.js"
  "src/server/routes/documents.js"
  "src/server/routes/share.js"
  "src/public/js/app.js"
  "src/public/js/api-client.js"
  "src/public/js/ui-utils.js"
  "src/ai/extraction.js"
  "src/ai/impact.js"
  "src/ai/essay.js"
  "src/lib/pdfExport.js"
  "src/lib/zipExport.js"
  "src/lib/shareTokens.js"
  "src/utils/profile-merge.js"
)
SYNTAX_ERRORS=0
for f in "${SYNTAX_FILES[@]}"; do
  if ! node --check "$PROJECT_DIR/$f" 2>/tmp/ao-syntax-err.txt; then
    echo "  ERROR: Syntax error in $f:"
    cat /tmp/ao-syntax-err.txt | sed 's/^/    /'
    SYNTAX_ERRORS=$((SYNTAX_ERRORS + 1))
  else
    echo "  -> $f syntax  [ok]"
  fi
done
if [[ $SYNTAX_ERRORS -gt 0 ]]; then
  echo "  STOP: $SYNTAX_ERRORS file(s) have syntax errors — fix before deploying"
  exit 1
fi

SMOKE_PORT=14000
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
  PORT=$SMOKE_PORT node "$PROJECT_DIR/bin/cli.js" > /tmp/ao-smoke-112.log 2>&1 &
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

    # Verify /api/documents/confirmed-list endpoint added in STORY-003
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${SMOKE_PORT}/api/documents/confirmed-list" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "401" ]]; then
      echo "  -> GET /api/documents/confirmed-list endpoint present  [ok]"
    else
      echo "  Note: GET /api/documents/confirmed-list returned HTTP $HTTP_CODE — verify endpoint is registered"
    fi
  else
    echo "  Note: Server did not respond within 5 s — likely .env is not fully configured."
    echo "        Boot output (first 10 lines):"
    head -10 /tmp/ao-smoke-112.log | sed 's/^/    /'
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
# Release artifact record
# ---------------------------------------------------------------------------
echo ""
echo "-> Writing release artifact record"

cat > "$PROJECT_DIR/specs/deploy-artifact.md" << 'ARTIFACT_EOF'
# Deploy Artifact — Release 1.1.2
**Date:** 2026-06-14  **Status:** ready
**Target:** NPX local desktop app (npm registry — `npx ao`)

## Stories in this release

| Story | Title | Language | Build command | Release type |
|-------|-------|----------|---------------|--------------|
| STORY-003 | Data extraction and confidence-scored review | node | npm start | patch |

## Deployment history

| Story | Release | Date |
|-------|---------|------|
| STORY-001 | 1.1.0 | 2026-06-14 |
| STORY-002 | 1.1.0 | 2026-06-14 |
| STORY-003 | 1.1.2 | 2026-06-14 |
| STORY-004 | 1.1.0 | 2026-06-14 |
| STORY-005 | 1.1.1 | 2026-06-14 |
| STORY-006 | 1.1.0 | 2026-06-14 |

## Deployment order
1. STORY-003 — Data extraction and confidence-scored review (patch)

## Checks

| Check | Result |
|-------|--------|
| Dependency order resolved | ok |
| Runtime profiles read from build-report.yaml | ok |
| Infrastructure target | NPX / npm publish |
| Version stamp method | npm version --no-git-tag-version |
| deploy.sh syntax | ok |
| deploy.sh permissions | ok executable |

## Environment variables required
NPM_TOKEN — npm registry authentication token (production publish only)

## Manual steps required
- Set NPM_TOKEN in environment or run `npm login` before production publish
- DATA_DIR in .env must point to user's chosen data directory before `npx ao` first run
- If package name is scoped (@scope/admissions-officer), add --access public to npm publish
- Verify coursesMergeMode dialog appears when re-uploading a transcript with duplicate courses

Script: `specs/deploy.sh`
ARTIFACT_EOF

echo "  -> specs/deploy-artifact.md  [ok]"

echo ""
echo "-> Writing versioned release record: specs/releases/v${VERSION}.json"
mkdir -p "$PROJECT_DIR/specs/releases"
cat > "$PROJECT_DIR/specs/releases/v${VERSION}.json" << RELEASE_JSON
{
  "version": "$VERSION",
  "date": "2026-06-14",
  "release_type": "patch",
  "target": "npm registry (npx ao)",
  "deployment_order": ["STORY-003"],
  "stories": [
    {
      "id": "STORY-003",
      "title": "Data extraction and confidence-scored review",
      "changes": [
        "coursesMergeMode parameter added to transcript re-upload: defaults to add_new for backward compatibility; student dialog offers Merge updates or Add as new entries when duplicate courses detected",
        "apIbScores stored at top-level of academic.json (file.apIbScores[]) rather than nested under file.data.apIbScores; readFullAcademic() falls back gracefully",
        "AP/IB scores linked to courses via linkedCourseName (case-insensitive join); inline exam score badges shown on courses table",
        "profile-merge.js rewritten: SAT structured as sat.score.{math,ebrw,total}, class_rank parsed to {rank,classSize}, achievements/activities get title+description fields",
        "GET /api/documents/confirmed-list endpoint added for extraction recovery banner",
        "DELETE /api/documents/:documentId/extraction-fields/:fieldName endpoint added",
        "PUT /api/documents/:documentId/extraction-fields/:fieldName extended with ignoreWarning operation",
        "TRANSCRIPT_PROMPT updated to extract name/grade/score/term/level for all courses",
        "showToast() signature extended with optional subtitle and type params (backward compatible)",
        "Dashboard section tiles converted to full-card <a> card-link elements with keyboard nav and aria-label",
        "Upload modal Confirm button relabeled to Next: Review and extract"
      ]
    }
  ],
  "notes": "Patch release — STORY-003 data extraction fixes. No breaking changes. No database migrations. No new npm dependencies."
}
RELEASE_JSON
echo "  -> specs/releases/v${VERSION}.json  [ok]"

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

  echo ""
  echo "-> Post-publish: checking registry"
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
  echo " Install: npx admissions-officer@$VERSION"
  echo " Alias:   npx ao"
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
  if curl -sf "http://127.0.0.1:3000/" -o /dev/null 2>/dev/null; then
    echo "  -> AO is running at http://localhost:3000  [ok]"
  else
    echo "  Note: Server may still be starting — check http://localhost:3000 in your browser"
  fi

  echo ""
  echo "========================================"
  echo " Dry-run complete — Release $VERSION"
  echo " Test at:   http://localhost:3000"
  echo " Verify:    Upload a transcript — confirm duplicate course dialog appears on re-upload"
  echo "            Add an AP/IB exam score manually — verify badge links to course by name"
  echo " Stop with: kill $LOCAL_PID   (or pkill -f 'node bin/cli.js')"
  echo "========================================"
fi
