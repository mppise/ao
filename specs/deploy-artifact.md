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
