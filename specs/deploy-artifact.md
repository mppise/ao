# Deploy Artifact — Release 1.4.0
**Date:** 2026-06-15  **Status:** ready
**Target:** npm registry (npx university-admissions-officer)

## Stories in this release

| Story | Title | Language | Build command | Release type |
|-------|-------|----------|---------------|--------------|
| STORY-001 | Student signup and profile setup (enhanced: non-blocking .env initialization) | node | npm install | initial |
| STORY-006 | Personal essay draft generation and editing | node | node bin/cli.js | initial |

## Deployment history

| Story | Release | Date |
|-------|---------|------|
| STORY-001 | 1.0.0 | 2026-06-14 |
| STORY-003 | 1.1.3 | 2026-06-15 |
| STORY-003a | 1.1.3 | 2026-06-15 |
| STORY-004 | 1.1.3 | 2026-06-15 |
| STORY-005 | 1.1.3 | 2026-06-15 |
| STORY-007 | 1.1.3 | 2026-06-15 |
| STORY-002 | 1.1.4 | 2026-06-15 |
| STORY-001 | 1.4.0 | 2026-06-15 |
| STORY-006 | 1.4.0 | 2026-06-15 |

## Deployment order
1. STORY-001 — Student signup and profile setup (no dependencies)
2. STORY-006 — Personal essay draft generation and editing (depends on STORY-004, STORY-003a — both previously deployed)

## Checks

| Check | Result |
|-------|--------|
| Dependency order resolved | pass |
| Runtime profiles read from build-report.yaml | pass |
| build-report.yaml overall_status (STORY-001) | pass |
| build-report.yaml overall_status (STORY-006) | pass |
| Infrastructure target | npm registry |
| Version stamp method | npm version $VERSION --no-git-tag-version (package.json) |
| deploy.sh syntax | pass |
| deploy.sh permissions | pass — executable |

## Environment variables required
None beyond npm authentication token (prompted interactively at publish time).
Dry-run does not require any environment variables.

## Manual steps required
None — all steps are automated. The npm granular access token is prompted interactively at publish time with step-by-step instructions and browser auto-open to npmjs.com/settings.

Script: `specs/deploy.sh`
