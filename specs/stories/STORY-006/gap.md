# Gap: STORY-006

## Changes

- 2026-06-15 Enhancement: Personal essay generation should use full profile data (courses with grades, AP/IB scores, test scores, achievements, activities, impact statements) instead of only GPA from transcript. The Gemini prompt needs to include all profile sections when assembling the essay generation payload.

## Files affected

- `/Users/mangeshpise/Code/AO/src/ai/essay.js` — `assembleProfileData` rewritten to correctly read all four profile sections (academic, tests, achievements, activities, impact_statements) from both merged-schema (top-level arrays) and init-schema (data wrapper). Courses now rendered as `Name (Level) — Grade` strings in the prompt. Test scores now read SAT/ACT/AP/IB from merged flat schema. Achievements/activities now read from `{ achievements: [] }` / `{ activities: [] }` top-level arrays.
- `/Users/mangeshpise/Code/AO/src/server/routes/essays.js` — `GET /api/essays/provenance` test scores and achievements sections updated to support merged schema with same synthetic IDs as `assembleProfileData` uses for filtering. `_resolveProvenanceUsed` updated to match same schema resolution.

## Side-effects on other stories

None

## Recommended spec update

The "AI integration" section (lines 693–791 in story-spec.md) already documents that the payload should include courses, test scores, achievements, activities, and impact statements. The gap is a **bug fix to the implementation** — the code must now correctly read and include all these data types in the Gemini prompt, not just GPA. The spec text does not need updating; the build should align the implementation with the existing spec. Specifically:

- Ensure `academic.json → courses` (AP/IB/Honors with grades) are included in the prompt
- Ensure `tests.json → testScores` (SAT/ACT) are included
- Ensure `achievements.json` and `activities.json` items are fully resolved with names, descriptions, and linked impact statements
- The Gemini prompt template (lines 714–751) already references `{{courses}}`, `{{testScores}}`, `{{achievements}}`, `{{activities}}`, and `{{impactStatements}}` — verify each is populated from the student's profile data before the AI call
