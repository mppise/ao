---
story_id: STORY-003a
title: "AI transparency and data provenance display"
depends_on:
  - STORY-003
---

## What the user can do

- User can open the questionnaire modal before generating an impact statement and fill in up to 5 optional text fields (role, challenge, growth, importance, impact) that personalise what the AI will emphasise — all fields are optional and the modal can be submitted empty.
- User can click [Preview AI Reasoning] at any point during questionnaire entry to see a side panel listing exactly which profile data fields will be included in the AI call and which focus-area bullets the AI will emphasise, before any generation happens.
- User can inspect a data-provenance panel on the essay generation screen that shows which profile sections (achievements, activities, GPA, test scores) are being included as source data, with confidence scores and source document badges for each item — and can toggle individual items off to exclude them from the generation.

---

## Screens and states

### Screen 1 — Impact statement questionnaire modal

**Entry point:** Triggered by STORY-004's [Generate] flow immediately after the achievement picker (STORY-004 Screen 2). When the student clicks [Start Questionnaire] in the achievement picker, instead of going directly to AI generation, this modal opens. This modal is new UI introduced by STORY-003a; it replaces the direct jump to generation.

**Context bar (read-only, top of modal body):**
- Achievement name (e.g., "Robotics Team Captain")
- Category badge (e.g., "Extracurricular Activity")
- Duration and hours/week if present (e.g., "2 years · 6 hrs/week")
- These values are read from the in-memory achievement object passed from the picker.

**Modal title:** "Tell us about this experience"

**Subtitle (helper text block, styled `text-muted` `small`):**
> "These questions are optional. The more you share, the more personal your statement will be."

**Form fields (five textareas, all optional):**

| # | Label | Placeholder text | Max chars |
|---|-------|-----------------|-----------|
| 1 | What was your role or biggest contribution? | e.g., I led the mechanical design team and made final calls on build decisions... | 500 |
| 2 | What challenge did you face, and how did you overcome it? | e.g., Our robot kept failing under load — I spent 3 nights debugging the drivetrain... | 500 |
| 3 | What did you learn or how did you grow? | e.g., I discovered I work best when there's real pressure and clear stakes... | 500 |
| 4 | Why was this important to you personally? | e.g., Robotics was the first place I felt like I genuinely belonged... | 500 |
| 5 | What impact did it have — on you, your team, or others? | e.g., We placed 3rd regionally and I realised I could lead under pressure... | 500 |

Each textarea:
- `rows="3"`, resizable vertically by student.
- Live character counter below each field: `{n} / 500` in grey `small` text. Turns `text-warning` at 450 chars, `text-danger` at 500 (hard stop — `maxlength="500"` attribute set).
- No required validation — submitting with all fields empty is valid.

**Modal footer buttons:**
- [Preview AI Reasoning] — secondary button, left-aligned in footer.
- [Skip — Generate Now] — outline button.
- [Continue to Preview] — primary button, right-aligned in footer.

**[Preview AI Reasoning] button behaviour:**
- Calls `POST /api/impact-statements/preview-reasoning` with the current answer field values (empty strings for unfilled fields) and the `achievementId`.
- While in-flight: button shows spinner, label changes to "Loading preview…", button is disabled.
- On success: closes questionnaire modal, opens the reasoning preview side panel (Screen 2) as an off-canvas panel. Questionnaire state (all five answer values) is held in a module-level JS object `currentAnswerSheet` so it survives the modal close and can be reopened.
- On error: button re-enables, inline alert appears below the button row: "Preview failed. You can still continue." Alert is `alert-warning`, dismissible.

**[Skip — Generate Now] button behaviour:**
- Skips the reasoning preview entirely.
- Passes current answer values (even if all empty) directly to the STORY-004 generation flow.
- Closes modal, initiates `POST /api/impact-statements/generate` call, renders the STORY-004 Screen 5 (draft display) directly.

**[Continue to Preview] button behaviour:**
- Equivalent to [Preview AI Reasoning]: calls `POST /api/impact-statements/preview-reasoning`, then transitions to Screen 2.
- Labelled differently to distinguish from the preview-only peek ("Continue" implies commitment to review before generating; "Preview AI Reasoning" is an optional mid-form peek).

**Empty state (all five fields blank when [Continue to Preview] is clicked):**
- Proceeds normally — no validation block.
- The reasoning preview panel (Screen 2) will show the "No answers provided" variant (see Screen 2 below).

**Modal open/close behaviour:**
- Bootstrap `modal` component. Modal ID: `#questionnaireModal`.
- Closing via [×] or clicking the backdrop does NOT trigger generation. Returns student to the achievement picker (STORY-004 Screen 2) with the radio selection still active.
- ESC key closes modal (default Bootstrap behaviour). Returns to achievement picker.
- `data-bs-backdrop="static"` is NOT used — student can dismiss by clicking outside.

---

### Screen 2 — Reasoning preview off-canvas panel

**Entry point:** Triggered by [Preview AI Reasoning] or [Continue to Preview] from Screen 1, after a successful call to `POST /api/impact-statements/preview-reasoning`.

**Component:** Bootstrap `offcanvas` component, position `offcanvas-end` (slides in from right). Width: 400 px on desktop, full-width on narrow viewports (<576 px). Offcanvas ID: `#reasoningOffcanvas`.

**Panel header:**
- Title: "Here's what I'll focus on"
- Subtitle (small, muted): "Based on your answers and profile data"
- [×] close button (Bootstrap default offcanvas close).

**Section A — Profile data I'll use:**
- Heading: "Profile data" (`h6`, Bootstrap `text-secondary`)
- Bulleted list (`<ul class="list-unstyled">`) of profile fields the server will include in the AI prompt. Each bullet shows the field label and value:
  - "Name: Robotics Team Captain"
  - "Category: Extracurricular Activity"
  - "Duration: 2 years · 6 hrs/week"
  - "Description: Led a team of 8 students in regional competition"
  - "Role: Captain" (only shown if `role` field is non-null in achievements.json)
- Populated from `data.profileDataUsed` array in the API response. Rendered as plain `<li>` elements.
- If `profileDataUsed` is empty (should not happen in practice — achievement always has at least a name): show "No profile data found for this achievement."

**Section B — What you told me:**
- Heading: "Your answers" (`h6`, Bootstrap `text-secondary`)
- Five rows, one per question field, always shown (even if unanswered):

  | Label | Value display |
  |-------|--------------|
  | Role / contribution | Student's answer text, or "(not answered)" in `text-muted fst-italic` if empty |
  | Challenge faced | Same pattern |
  | What you learned | Same pattern |
  | Why it mattered | Same pattern |
  | Impact | Same pattern |

- Populated from `data.answersReceived` in the API response.

**Section C — Focus areas I'll emphasise:**
- Heading: "I'll emphasise" (`h6`, Bootstrap `text-secondary`)
- Bulleted list of 2–4 focus-area strings from `data.focusAreas`.
- Each bullet prefixed with `bi-arrow-right` Bootstrap Icon (`<i class="bi bi-arrow-right me-1 text-primary"></i>`).
- "No answers provided" variant: when `data.unansweredCount === 5`, replace the bullet list with:
  > "You haven't answered any questions yet. The AI will base the statement entirely on your profile data. Consider going back and adding at least one answer for a more personal result."
  Styled as `alert alert-info` (no icon).

**Footer of offcanvas:**
- [Edit Answers] — secondary button. Closes the offcanvas and re-opens the questionnaire modal (`#questionnaireModal`) with `currentAnswerSheet` values restored into the form fields.
- [Generate Draft] — primary button. Closes offcanvas, triggers `POST /api/impact-statements/generate` with the `achievementId` and `currentAnswerSheet`, proceeds to STORY-004 Screen 5.

**Loading state:** The offcanvas opens immediately when [Preview AI Reasoning] is clicked (before the API call completes) showing a centred spinner in the body area with text "Fetching reasoning preview…". Sections A, B, C are hidden. On API response, spinner is removed and sections render.

**Error state:** If the API call fails after the offcanvas is already open, spinner is replaced with:
> "Could not load the reasoning preview. [Retry] [Continue Anyway]"
- [Retry] re-calls `POST /api/impact-statements/preview-reasoning`.
- [Continue Anyway] closes offcanvas and triggers generation with existing `currentAnswerSheet`.

**Panel close behaviour:**
- Clicking [×] or pressing ESC closes the offcanvas and re-opens `#questionnaireModal` with `currentAnswerSheet` values intact — student is returned to editing their answers, not dropped back to the achievement picker.

---

### Screen 3 — Essay data provenance panel

**Entry point:** Triggered when the student initiates essay generation from the Personal Statements section (STORY-006 flow). Before `POST /api/essays/generate` is called, the app calls `GET /api/essays/provenance` to fetch what profile data will be used, then opens this panel.

**When this panel is NOT shown:** If `GET /api/essays/provenance` fails or returns an empty dataset, skip the panel and proceed directly to generation with a toast: "Showing data source summary failed — generating with all available data."

**Component:** Bootstrap `modal` (full-width on small screens, `modal-lg` on desktop). Modal ID: `#essayProvenanceModal`.

**Modal title:** "Data we'll use for your essay"

**Subtitle (muted):**
> "Your essay will be grounded in the data below. Toggle off any item you'd like to exclude."

**Profile section blocks (one Bootstrap `card` per section with available data):**

**Block 1 — GPA (shown only if `academic.json` has a gpa field):**
- Card header: "GPA" with `bi-mortarboard` icon
- Body: single row showing:
  - GPA value (e.g., "3.9")
  - Confidence badge: green `badge bg-success` for ≥85, yellow `badge bg-warning` for 70–84, red `badge bg-danger` for <70. Badge text: "{n}% confidence"
  - Source badge: `badge bg-light text-dark` with the source document filename (e.g., "transcript-2026-06-14.pdf")
- Toggle: Bootstrap `form-check form-switch` at the right edge of the row. `checked` by default for items with confidence ≥70. Items with confidence <70 are `unchecked` by default with a tooltip: "Low confidence — verify before including."

**Block 2 — Test scores (shown only if `tests.json` has entries):**
- Card header: "Test scores" with `bi-clipboard-data` icon
- Body: one row per test score entry. Columns: test name (e.g., "SAT Math"), score, confidence badge, source badge, toggle switch.
- All scores with confidence ≥70: checked by default. Scores <70: unchecked by default.

**Block 3 — Achievements (shown only if `achievements.json` has entries):**
- Card header: "Achievements & activities" with `bi-trophy` icon
- Body: one row per achievement. Columns: achievement name, category badge, confidence badge (if `confidence` field exists — achievements manually entered do not have confidence scores; for those, show `badge bg-secondary` "Manually added"), source badge (filename or "Manually added"), toggle switch.
- All achievements: checked by default regardless of confidence (achievements are student-confirmed data at this point in the flow per STORY-003 rules).

**Block 4 — Impact statements (shown only if `impact_statements.json` has saved statements):**
- Card header: "Impact statements" with `bi-lightning` icon
- Body: one row per statement. Columns: achievement name the statement was written about (truncated to 60 chars), statement text preview (truncated to 80 chars appended with "..."), AI-generated badge (`badge bg-info text-dark` "AI-generated" when `aiGenerated: true`, else `badge bg-secondary` "Written manually"), toggle switch.
- All statements: checked by default.

**Empty-section behaviour:** Any block with no data is omitted entirely. If all four blocks are empty (no profile data at all), replace the entire modal body with:
> "Your profile has no data yet. Add documents in the Documents section before generating an essay."
Footer shows only [Close] button. [Generate Essay] is hidden.

**"Select all / Deselect all" control:**
- A single `form-check form-switch` at the top of the modal body: "Include all data" — checked by default when all toggles are on, indeterminate state when mixed, unchecked when all off.
- Toggling it on: checks all individual toggles.
- Toggling it off: unchecks all individual toggles.

**Modal footer:**
- Item count label (muted small text): "{n} of {total} data items selected"
- [Cancel] — outline button. Closes modal, returns to STORY-006 generation entry point without triggering any API call.
- [Generate Essay] — primary button. Disabled when 0 items are selected (tooltip: "Select at least one data item to generate"). Enabled when ≥1 item selected.

**[Generate Essay] click behaviour:**
- Collects the `id` values of all toggled-on items per section into a `provenanceSelection` object:
  ```json
  {
    "includeGpa": true,
    "testScoreIds": ["uuid-1", "uuid-2"],
    "achievementIds": ["uuid-3"],
    "impactStatementIds": ["uuid-4"]
  }
  ```
- Closes modal.
- Passes `provenanceSelection` to `POST /api/essays/generate` as part of the request body.
- STORY-006 spinner screen renders.

**Loading state for the modal itself:** The modal opens immediately when the student clicks [Generate Essay] on the STORY-006 entry screen. A spinner is shown in the body while `GET /api/essays/provenance` is in-flight. Once data arrives, the spinner is replaced by the section blocks.

**Error state (provenance fetch fails):**
- Body shows: "Could not load data summary. [Retry] [Generate with all data]"
- [Retry] re-calls `GET /api/essays/provenance`.
- [Generate with all data] closes modal and triggers `POST /api/essays/generate` without a `provenanceSelection` field — the backend uses all available profile data.

---

### Screen 4 — Inline reasoning display on generated draft (impact statements)

**Entry point:** After STORY-004 Screen 5 renders the AI-generated draft (impact statement), this is an additional UI element appended below the AI draft card. It is not a separate screen — it is a collapsible section within Screen 5.

**Layout (collapsed by default):**
```
+------------------------------------------------------------------+
|  AI-generated draft                          [bi-robot]          |
|  This is a starting point — rewrite it in your own words.        |
|  ---------------------------------------------------------------- |
|  "Leading eight teammates through months of late-night sessions  |
|   taught you something no competition rulebook prepares you for  |
|   ..."                                                            |
|                                                                   |
|  Generated based on: your role as captain, the debugging         |
|  challenge you described, profile data (8 teammates, 2 years)    |
|                                                                   |
|  [bi-chevron-down  Why did the AI focus on this?]  ← toggle link |
+------------------------------------------------------------------+
```

**Collapsed state:** Only the "Generated based on:" one-line `reasoning` text is shown. The [Why did the AI focus on this?] toggle link appears below it.

**Expanded state (after clicking toggle):**
```
+------------------------------------------------------------------+
|  ...draft card content above...                                  |
|                                                                   |
|  Generated based on: your role as captain, the debugging         |
|  challenge you described, profile data (8 teammates, 2 years)    |
|                                                                   |
|  [bi-chevron-up  Why did the AI focus on this?]  ← toggle link  |
|                                                                   |
|  ┌ What I used from your profile ───────────────────────────── ┐ |
|  │  • Name: Robotics Team Captain                              │ |
|  │  • Duration: 2 years · 6 hrs/week                          │ |
|  │  • Role: Captain                                           │ |
|  └──────────────────────────────────────────────────────────── ┘ |
|                                                                   |
|  ┌ What I emphasised ─────────────────────────────────────────┐  |
|  │  • Decision-making as team captain under pressure          │  |
|  │  • Specific debugging challenge and resolution             │  |
|  └──────────────────────────────────────────────────────────── ┘  |
+------------------------------------------------------------------+
```

**Data source:** `data.profileDataUsed` and `data.focusAreas` from the `POST /api/impact-statements/generate` response. `data.reasoning` populates the "Generated based on:" line.

**Toggle behaviour:** Bootstrap `collapse` component. Toggle link text switches between "Why did the AI focus on this?" (collapsed) and "Hide reasoning" (expanded). Icon switches between `bi-chevron-down` and `bi-chevron-up`.

**If `reasoning` is null:** Hide the "Generated based on:" line entirely. Toggle link still appears — expanded view shows only the profile data and focus areas sections.

**If `focusAreas` is empty:** The "What I emphasised" sub-block is omitted.

**If `profileDataUsed` is empty:** The "What I used from your profile" sub-block is omitted.

**If both are empty and `reasoning` is null:** The entire reasoning section (toggle link + collapsible) is not rendered.

---

### Screen 5 — Inline provenance citations on generated essay draft

**Entry point:** After STORY-006 renders the AI-generated essay draft card, this is an additional element within that card — not a new screen.

**What it displays:**
Below the essay draft text (within the AI draft card), a collapsible "Sources used" section:

```
+------------------------------------------------------------------+
|  AI-generated draft                          [bi-robot]          |
|  Heavily rewrite this in your own voice.                         |
|  ---------------------------------------------------------------- |
|  [Essay text — 500–650 words]                                    |
|                                                                   |
|  [bi-database  Sources used in this draft]  ← toggle link       |
+------------------------------------------------------------------+
```

**Expanded sources panel:**
```
┌ Sources used in this draft ────────────────────────────────── ┐
│  GPA                                                           │
│    3.9  ·  92% confidence  ·  transcript-2026-06-14.pdf       │
│                                                                │
│  Test scores                                                   │
│    SAT Math: 780  ·  88% confidence  ·  sat-results.pdf       │
│    SAT EBRW: 760  ·  88% confidence  ·  sat-results.pdf       │
│                                                                │
│  Achievements & activities                                     │
│    Robotics Team Captain  ·  Extracurricular  ·  Manually added│
│    AP Chemistry Project   ·  Academic         ·  certificate.pdf│
│                                                                │
│  Impact statements used                                        │
│    "Leading eight teammates..."  (Robotics Team Captain)      │
└────────────────────────────────────────────────────────────── ┘
```

**Data source:** The `provenanceSelection` object that was passed to `POST /api/essays/generate` is echoed back in the response as `data.provenanceUsed`. The server resolves each ID to its display name, confidence score, and source document. This is what populates the sources panel.

**Structure of `data.provenanceUsed` (from API response):**
```json
{
  "gpa": { "value": "3.9", "confidence": 92, "source": "transcript-2026-06-14.pdf" },
  "testScores": [
    { "id": "uuid-1", "name": "SAT Math", "score": "780", "confidence": 88, "source": "sat-results.pdf" }
  ],
  "achievements": [
    { "id": "uuid-3", "name": "Robotics Team Captain", "category": "Extracurricular Activity", "source": "Manually added" }
  ],
  "impactStatements": [
    { "id": "uuid-4", "achievementName": "Robotics Team Captain", "preview": "Leading eight teammates..." }
  ]
}
```

**Toggle behaviour:** Bootstrap `collapse`. Toggle link text switches between "Sources used in this draft" (collapsed) and "Hide sources" (expanded).

**If `provenanceUsed` is null or empty (generation proceeded without provenance selection):**
- Toggle link still appears.
- Expanded panel shows: "All available profile data was used. Select specific items next time using the data source panel."

---

## Data and backend

### Client-side state

**`currentAnswerSheet` (module-level object in `/src/public/js/app.js`):**
```js
{
  achievementId: "uuid-v4",       // set when achievement is selected in picker
  role: "",                       // populated from questionnaire textarea #1
  challenge: "",                  // populated from questionnaire textarea #2
  growth: "",                     // populated from questionnaire textarea #3
  importance: "",                 // populated from questionnaire textarea #4
  impact: ""                      // populated from questionnaire textarea #5
}
```
- Initialised to empty strings when the achievement picker fires.
- Updated on every `input` event on each textarea (live sync — not debounced, as there is no API call on input).
- Reset to empty strings when the questionnaire modal is closed via [×]/ESC/backdrop (student aborted) or after `POST /api/impact-statements/save` completes (statement was saved, flow is done).
- NOT persisted to `localStorage` in this story (v1 trade-off — state is lost on browser close mid-questionnaire).

**`reasoningPreviewCache` (module-level object in `/src/public/js/app.js`):**
```js
{
  achievementId: "uuid-v4",
  fetchedAt: "ISO 8601 datetime",   // JS Date.toISOString()
  data: { /* full API response data object */ }
}
```
- Populated when `POST /api/impact-statements/preview-reasoning` returns successfully.
- TTL: 5 minutes (300 seconds). If `Date.now() - Date.parse(fetchedAt) > 300000`, cache is stale and a fresh API call is made.
- Cache is keyed implicitly on `achievementId` — if the user opens a different achievement, the cache is overwritten.
- Cache is cleared (set to `null`) when the questionnaire modal resets (on [×]/ESC close or flow completion).
- Purpose: prevents redundant API calls if the student opens and closes the reasoning preview panel multiple times without changing their answers.

**`provenanceSelection` (module-level object in `/src/public/js/app.js`):**
```js
{
  includeGpa: true,
  testScoreIds: ["uuid-1", "uuid-2"],
  achievementIds: ["uuid-3"],
  impactStatementIds: ["uuid-4"]
}
```
- Built from the toggle states in Screen 3 (essay provenance modal) when [Generate Essay] is clicked.
- Passed to `POST /api/essays/generate` as part of the request body.
- Not cached — rebuilt fresh each time the modal opens.

### No new JSON files

STORY-003a introduces no new persistent data files. All transparency data is:
1. Computed server-side on-the-fly from existing JSON files (`achievements.json`, `academic.json`, `tests.json`, `achievements.json`, `impact_statements.json`).
2. Returned in API responses and held in client-side module-level variables for the lifetime of the generation flow.
3. Stored in `impact_statements.json` as part of the existing `generatedFrom` object (already specced in STORY-004) — this story surfaces that stored data in the UI but does not change the schema.

---

## API integration

All responses use the standard envelope defined in architecture.md:
```json
{
  "success": true | false,
  "data": { ... } | null,
  "error": null | { "code": "ERROR_CODE", "message": "Human-readable message" },
  "timestamp": "ISO 8601"
}
```

### Endpoint 1 — POST /api/impact-statements/preview-reasoning

Already specced in STORY-004. This story adds no new parameters. The endpoint is called from two new entry points introduced here:
1. [Preview AI Reasoning] button in the questionnaire modal (Screen 1).
2. [Continue to Preview] button in the questionnaire modal (Screen 1).

**Request body (unchanged from STORY-004 spec):**
```json
{
  "achievementId": "uuid-v4",
  "studentAnswers": {
    "role": "string or empty string",
    "challenge": "string or empty string",
    "growth": "string or empty string",
    "importance": "string or empty string",
    "impact": "string or empty string"
  }
}
```

**Response fields consumed by this story's UI:**

| Field | Used in |
|-------|---------|
| `data.profileDataUsed` | Section A of reasoning offcanvas (Screen 2) |
| `data.answersReceived` | Section B of reasoning offcanvas (Screen 2) |
| `data.focusAreas` | Section C of reasoning offcanvas (Screen 2) |
| `data.unansweredCount` | Determines "No answers provided" variant in Screen 2 |

**Expected response time:** <500ms (no Gemini call — pure server-side computation). If the call takes >2 seconds, show a timeout-style inline warning in the offcanvas body: "Preview is taking longer than expected…" — do not abort automatically.

**Error handling in this story's context:**
- HTTP 400 `MISSING_FIELD`: Should not occur if client builds the request correctly. If it does, treat as a generic error — show offcanvas error state (see Screen 2 error state).
- HTTP 404 `ACHIEVEMENT_NOT_FOUND`: Show offcanvas error state. The [Continue Anyway] fallback allows generation to proceed without the preview.
- Network error / timeout: Show offcanvas error state. Same fallback.

---

### Endpoint 2 — GET /api/essays/provenance

**New endpoint** introduced by STORY-003a. No backend changes are needed per the story constraints — this endpoint aggregates already-available data from existing JSON files on disk and requires no new file writes or schema changes.

**Method:** GET  
**Path:** `/api/essays/provenance`  
**Request:** No body, no query params.

**Server behaviour:**
1. Read `academic.json` → extract `gpa`, `confidence`, `source` (source document filename).
2. Read `tests.json` → extract each test entry: `id`, `name`, `score`, `confidence`, `source`.
3. Read `achievements.json` → extract each entry: `id`, `name`, `category`, `confidence` (may be absent for manually entered achievements — set to `null`), `source` (document filename or `"Manually added"` if no source).
4. Read `impact_statements.json` → extract each statement: `id`, `linkedAchievementName`, `statement` (for preview — truncated to 80 chars server-side), `aiGenerated`.
5. Return all four sections. Sections with no data are returned as `null` (not empty array — lets the client distinguish "no file" from "file exists but empty").

**Response (HTTP 200):**
```json
{
  "success": true,
  "data": {
    "gpa": {
      "value": "3.9",
      "confidence": 92,
      "source": "transcript-2026-06-14.pdf"
    },
    "testScores": [
      {
        "id": "uuid-1",
        "name": "SAT Math",
        "score": "780",
        "confidence": 88,
        "source": "sat-results.pdf"
      },
      {
        "id": "uuid-2",
        "name": "SAT EBRW",
        "score": "760",
        "confidence": 88,
        "source": "sat-results.pdf"
      }
    ],
    "achievements": [
      {
        "id": "uuid-3",
        "name": "Robotics Team Captain",
        "category": "Extracurricular Activity",
        "confidence": null,
        "source": "Manually added"
      }
    ],
    "impactStatements": [
      {
        "id": "uuid-4",
        "linkedAchievementName": "Robotics Team Captain",
        "preview": "Leading eight teammates through months of late...",
        "aiGenerated": true
      }
    ]
  },
  "error": null,
  "timestamp": "2026-06-15T10:00:00.000Z"
}
```

**Null sections:** If `academic.json` does not exist or has no `gpa` field, `data.gpa` is `null`. If `tests.json` does not exist or has no entries, `data.testScores` is `null`. Same for the other sections. The client renders a section block only when the corresponding field is non-null and non-empty.

**Error cases:**

| Condition | HTTP status | Code | Message |
|-----------|-------------|------|---------|
| `academic.json` unreadable (exists but corrupted) | 500 | `FILE_READ_ERROR` | "Could not read academic data." |
| `tests.json` unreadable | 500 | `FILE_READ_ERROR` | "Could not read test score data." |
| `achievements.json` unreadable | 500 | `FILE_READ_ERROR` | "Could not read achievements data." |
| `impact_statements.json` unreadable | 500 | `FILE_READ_ERROR` | "Could not read impact statements data." |

Note: If one file is unreadable but others are fine, the server still returns HTTP 200 with the successfully-read sections present and the failed section set to `null`, plus a top-level `warnings` array:
```json
{
  "success": true,
  "data": { "gpa": null, "testScores": [...], "achievements": [...], "impactStatements": null },
  "warnings": ["Could not read academic data.", "Could not read impact statements data."],
  "error": null,
  "timestamp": "..."
}
```
The client displays a non-blocking `alert-warning` banner at the top of the provenance modal: "Some data sections could not be loaded: [warning messages]. Generation will proceed with available data."

---

### Endpoint 3 — POST /api/essays/generate (modified request shape)

**Existing endpoint** (defined in STORY-006). STORY-003a adds `provenanceSelection` as an optional field in the request body. Backend already exists — no backend changes required; the field is additive and the backend must accept it without breaking existing behaviour when it is absent.

**Modified request body:**
```json
{
  "provenanceSelection": {
    "includeGpa": true,
    "testScoreIds": ["uuid-1", "uuid-2"],
    "achievementIds": ["uuid-3"],
    "impactStatementIds": ["uuid-4"]
  }
}
```

When `provenanceSelection` is absent or null: backend uses all available profile data (existing behaviour preserved).

**Modified response shape** — adds `provenanceUsed` to `data`:
```json
{
  "success": true,
  "data": {
    "draft": "...",
    "wordCount": 572,
    "provenanceUsed": {
      "gpa": { "value": "3.9", "confidence": 92, "source": "transcript-2026-06-14.pdf" },
      "testScores": [
        { "id": "uuid-1", "name": "SAT Math", "score": "780", "confidence": 88, "source": "sat-results.pdf" }
      ],
      "achievements": [
        { "id": "uuid-3", "name": "Robotics Team Captain", "category": "Extracurricular Activity", "source": "Manually added" }
      ],
      "impactStatements": [
        { "id": "uuid-4", "achievementName": "Robotics Team Captain", "preview": "Leading eight teammates..." }
      ]
    }
  },
  "error": null,
  "timestamp": "..."
}
```

`provenanceUsed` echoes back exactly what was included in the generation (resolved to display values by the server). The client uses this to render Screen 5 (essay sources panel).

---

## Enterprise checks

**Auth:** Authenticated users only. All three endpoints require a valid session established by STORY-001. No valid session → redirect to `/`. No role differentiation. Same auth model as all other story endpoints.

**Input validation:**

Client-side:
- Questionnaire textareas: `maxlength="500"` attribute enforced by browser. Character counter provides visual feedback. No required-field validation at all — all fields are optional.
- Essay provenance modal: [Generate Essay] button disabled at 0 selected items (DOM-enforced via `disabled` attribute). Toggle states are boolean only — no user text input in this modal.

Server-side (authoritative):
- `POST /api/impact-statements/preview-reasoning`: unchanged from STORY-004 spec. `achievementId` required and UUID v4. `studentAnswers` required object with all 5 keys. Values truncated server-side to 500 chars if over limit (silent truncation — prevents prompt bloat).
- `GET /api/essays/provenance`: no user input — read-only file aggregation. No server-side input validation needed.
- `POST /api/essays/generate` with `provenanceSelection`: `provenanceSelection` is optional. If present, all IDs within it must be strings. Server silently ignores invalid UUIDs (does not error — resolves what it can, skips what it cannot find). `includeGpa` must be boolean; if non-boolean, server treats as `true` (permissive default).

**Error states (user-visible messages):**

| Failure mode | Where shown | User-visible message |
|---|---|---|
| Preview-reasoning API call fails from questionnaire modal | Inline alert below modal footer buttons | "Preview failed. You can still continue." (dismissible `alert-warning`) |
| Preview-reasoning API call fails after offcanvas is open | Offcanvas body replaces spinner | "Could not load the reasoning preview. [Retry] [Continue Anyway]" |
| Provenance fetch fails when essay modal opens | Modal body | "Could not load data summary. [Retry] [Generate with all data]" |
| One data file unreadable during provenance fetch | Non-blocking banner in modal | "Some data sections could not be loaded: [reason]. Generation will proceed with available data." |
| Zero items selected in provenance modal | [Generate Essay] button tooltip | "Select at least one data item to generate" (button remains `disabled`) |
| Reasoning offcanvas: preview takes >2s | Offcanvas body, below spinner | "Preview is taking longer than expected…" |

**Data safety:**
- Mid-questionnaire browser close: `currentAnswerSheet` is in-memory only and is lost. No data is saved — the student has not yet generated or saved anything. On return, the achievement still has no statement. The student starts the questionnaire fresh. Acceptable for v1.
- Mid-provenance-modal browser close: No data is saved (modal is pre-generation only). Student returns to the essay entry point and the provenance modal reopens fresh on next [Generate Essay] click. No state loss.
- Essay provenance `provenanceSelection` is in-memory only — not persisted. If the student closes the browser after the modal is submitted but before the essay is saved (STORY-006's save flow), they lose their selection. The essay itself may or may not have been saved depending on STORY-006's save logic.

**Rate limiting / abuse:**
- `POST /api/impact-statements/preview-reasoning`: No Gemini call — no rate limiting required. The call is cheap (file read + computation).
- `GET /api/essays/provenance`: No Gemini call — no rate limiting required.
- `POST /api/essays/generate`: Rate limiting is STORY-006's responsibility. STORY-003a does not modify the rate limit behaviour.
- `POST /api/impact-statements/generate`: Rate limiting per STORY-004 (10 calls/minute). STORY-003a does not change this.

**AI fallback:**
- Impact statement flow: Student can click [Skip — Generate Now] to bypass the questionnaire entirely and proceed with an empty `studentAnswers` object. The AI generates based on profile data alone. Student can also write their own statement from scratch without using AI at all (see STORY-004 fallback).
- Essay flow: If the provenance modal fails to load, [Generate with all data] bypasses the selection and generates with all profile data. Student can still generate an essay without provenance selection.
- In both flows: the transparency/provenance layer is a UX enhancement. Its failure never blocks the student from completing the core task.

---

## AI integration

**STORY-003a contains no new AI calls.** All Gemini API calls are made in STORY-004 (`POST /api/impact-statements/generate`) and STORY-006 (`POST /api/essays/generate`). This story provides UI and API plumbing to surface the inputs and outputs of those calls to the student.

**`POST /api/impact-statements/preview-reasoning`:** Does not call Gemini. Computes reasoning preview server-side from existing profile data and student answers using conditional rule logic. No prompt template required.

**`GET /api/essays/provenance`:** Does not call Gemini. Aggregates data from local JSON files.

N/A — no AI in this story beyond surfacing data from AI calls that belong to other stories.

---

## Acceptance criteria

1. Clicking [Start Questionnaire] in the impact statement achievement picker (STORY-004 Screen 2) opens the questionnaire modal with the selected achievement's name, category, and duration shown in a read-only context bar at the top of the modal body.

2. All five questionnaire textarea fields accept text input and display a live character counter (`{n} / 500`) that updates on each keystroke. No field shows a validation error when empty.

3. Submitting the questionnaire with all five fields empty (clicking [Continue to Preview] or [Skip — Generate Now]) does not show any validation error — the modal either transitions to the reasoning preview or proceeds to generation without blocking.

4. Clicking [Preview AI Reasoning] when at least one answer field has text calls `POST /api/impact-statements/preview-reasoning` and opens the reasoning offcanvas panel showing three sections: "Profile data", "Your answers" (with "(not answered)" in grey italic for empty fields), and "I'll emphasise" (with 2–4 focus-area bullets prefixed by `bi-arrow-right` icons).

5. Clicking [Preview AI Reasoning] when all five answer fields are empty opens the reasoning offcanvas panel and shows an `alert-info` block in the "I'll emphasise" section reading "You haven't answered any questions yet. The AI will base the statement entirely on your profile data." — no focus-area bullet list is shown.

6. Clicking [×] or pressing ESC on the reasoning offcanvas closes the offcanvas and re-opens the questionnaire modal with all previously entered answer text still populated in the form fields (not reset).

7. If `POST /api/impact-statements/preview-reasoning` returns an error, the offcanvas body (or the questionnaire modal inline alert, depending on which button was used) shows the appropriate error state with [Retry] and [Continue Anyway]/[Continue] options; the student is never blocked from proceeding to generation.

8. Clicking [Generate Draft] from the reasoning offcanvas closes the offcanvas and initiates `POST /api/impact-statements/generate` with the `currentAnswerSheet` values — the STORY-004 spinner screen renders and the questionnaire modal does not reappear.

9. After the impact statement AI draft card renders (STORY-004 Screen 5), a "Generated based on: …" reasoning line appears below the draft text, followed by a collapsible "Why did the AI focus on this?" toggle link that expands to show "What I used from your profile" and "What I emphasised" sub-sections populated from `data.profileDataUsed` and `data.focusAreas` in the generate API response.

10. When `data.reasoning` is null in the generate API response, the "Generated based on:" line is not rendered. When `data.focusAreas` is empty, the "What I emphasised" sub-section is not rendered. Neither absence breaks the draft card layout.

11. Clicking [Generate Essay] in the STORY-006 flow opens the essay data provenance modal (before any Gemini call is made), displaying a spinner while `GET /api/essays/provenance` is in-flight, then rendering section cards (GPA, Test scores, Achievements, Impact statements) with toggle switches for all items that exist in the student's profile.

12. Items with confidence ≥70 are checked by default in the provenance modal; items with confidence <70 are unchecked by default and show a tooltip "Low confidence — verify before including." Manually added achievements show a `badge bg-secondary` "Manually added" badge and are checked by default.

13. The "Include all data" master toggle in the provenance modal checks all individual toggles when turned on and unchecks all when turned off. The [Generate Essay] button is disabled (with tooltip) when zero items are selected, and enabled when one or more items are selected. The item count label updates in real time as toggles change.

14. Clicking [Generate Essay] with items selected passes a `provenanceSelection` object (with `includeGpa`, `testScoreIds`, `achievementIds`, `impactStatementIds`) to `POST /api/essays/generate`; clicking [Cancel] closes the modal and does NOT call the generate endpoint.

15. After the essay AI draft card renders (STORY-006), a collapsible "Sources used in this draft" toggle link appears within the draft card; when expanded, it shows the resolved display names, confidence scores, and source document filenames for each included item, sourced from `data.provenanceUsed` in the generate API response.

16. If `GET /api/essays/provenance` returns a partial success (some files unreadable), the modal renders with the available sections and a non-blocking `alert-warning` banner listing which sections could not be loaded; [Generate Essay] remains available for the sections that did load.

17. If `GET /api/essays/provenance` fails entirely, the modal shows an error state with [Retry] and [Generate with all data] buttons; clicking [Generate with all data] proceeds to essay generation without `provenanceSelection`, and the "Sources used" panel after generation shows "All available profile data was used."

18. `POST /api/impact-statements/preview-reasoning` returns HTTP 200 within 500ms under normal conditions (verified by timing the response in the browser network panel — no Gemini call should be made).

19. The `reasoningPreviewCache` client-side object stores the last preview API response and reuses it (without making another API call) if [Preview AI Reasoning] is clicked again within 5 minutes with the same `achievementId` and unchanged answer fields. A new API call IS made if the cache is stale (>5 minutes old).

20. The questionnaire modal closes without triggering any generation when closed via [×], ESC, or backdrop click; `currentAnswerSheet` is reset to empty strings and the student is returned to the achievement picker with their radio selection intact.

---

## Change history

| Release | Date | Summary | Type |
|---------|------|---------|------|
| 1.1.2 | 2026-06-15 | Initial spec authored — questionnaire modal, reasoning offcanvas, essay provenance modal, inline reasoning display, inline provenance citations, GET /api/essays/provenance endpoint, provenanceSelection on POST /api/essays/generate | feature |
