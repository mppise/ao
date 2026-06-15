# Deploy Artifact — Release 1.1.4
**Date:** 2026-06-15  **Status:** ready
**Target:** NPX local desktop app (Node.js + npm publish via `npx ao`)

## Stories in this release

| Story | Title | Language | Build command | Release type |
|-------|-------|----------|---------------|--------------|
| STORY-002 | Document upload and AI classification | node | node bin/cli.js | patch |

## Deployment history

| Story | Release | Date |
|-------|---------|------|
| STORY-001 | 1.0.0 | 2026-06-14 |
| STORY-002 | 1.1.4 | 2026-06-15 |
| STORY-003 | 1.1.3 | 2026-06-15 |
| STORY-003a | 1.1.3 | 2026-06-15 |
| STORY-004 | 1.1.3 | 2026-06-15 |
| STORY-005 | 1.1.3 | 2026-06-15 |
| STORY-006 | 1.1.3 | 2026-06-15 |
| STORY-007 | 1.1.3 | 2026-06-15 |

## Deployment order
1. STORY-002 — Document upload and AI classification

(STORY-001 already deployed at 1.0.0; STORY-002 dependency on STORY-001 is satisfied)

## Checks

| Check | Result |
|-------|--------|
| Dependency order resolved | ✓ |
| Runtime profiles read from build-report.yaml | ✓ |
| build-report.yaml overall_status | ✓ pass |
| Infrastructure target | NPX local desktop app (Node.js + npm publish) |
| Version stamp method | npm version $VERSION --no-git-tag-version (package.json) |
| deploy.sh syntax | ✓ |
| deploy.sh permissions | ✓ executable |

## Environment variables required
- `NPM_TOKEN` — npm authentication token for registry publish (production only; dry-run does not require it)

## Manual steps required
- Ensure npm authentication before publish: run `npm login` or export `NPM_TOKEN=<your-token>`
- If this is a scoped package (`@scope/admissions-officer`), add `--access public` to the `npm publish` command
- `DATA_DIR` in `.env` should point to the student's chosen directory on first run; `./data` at project root is a development default only and is not shipped via npm

Script: `specs/deploy.sh`
