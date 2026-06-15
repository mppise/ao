---
story_id: STORY-006
title: "Personal essay draft generation and editing"
depends_on:
  - STORY-004
  - STORY-003a
spec_done: true
---

## What the user can do

- User can click [Generate Essay] on the Personal Statements tile (enabled once profile has at least one achievement or activity) and see a data provenance preview modal listing which profile data will be used before generation begins — with the ability to toggle individual items on or off to control what the AI emphasises.
- User can click [Generate Essay] in the provenance modal to confirm their selection, then see a spinner while the AI creates a 500–650 word Common App personal statement draft grounded in the selected profile data.
- User can read the AI-generated draft in a clearly labeled read-only card ("AI-generated draft — heavily rewrite this in your own voice") with a collapsible "Sources used in this draft" panel that shows exactly which achievements, scores, and impact statements were included, with confidence scores and source document names.
- User can edit the draft in a large textarea directly below the draft card, with a real-time word count and character count showing a "Target: 500–650 words" indicator.
- User can click [Save] to persist their edited personal statement to `essays.json`, see a success toast, and be automatically returned to the Personal Statements list at `/essays`.
- User can click anywhere on the Personal Statements dashboard card (when at least one statement is saved) to navigate to `/essays` — the entire card is a clickable link with `cursor:pointer`, visual shadow feedback on hover, and keyboard accessibility (Tab to focus, Enter to navigate); the [Generate New] button inside the card uses `stopPropagation` so it does not trigger card navigation.

---

## Screens and states

### Screen 1 — Personal Statements tile on the dashboard

**Entry point:** Dashboard view (`/`), loaded on app start. The SPA router renders the dashboard when `window.location.pathname === '/'`.

**Empty state (no saved statements, no profile data):**
```
+---------------------------------------------+
|  bi-journal-text  Personal Statements       |
|                                             |
|  No statements saved yet.                   |
|  Add achievements or activities first.      |
|                                             |
|  [Generate Essay]  (disabled, grey)         |
+---------------------------------------------+
```
The [Generate Essay] button is disabled and shows tooltip "Add at least one achievement or activity to your profile first" when the student has zero achievements and zero activities in their profile.

**Enabled state (profile has >= 1 achievement or activity, no statements saved yet):**
```
+---------------------------------------------+
|  bi-journal-text  Personal Statements       |
|                                             |
|  No statements saved yet.                   |
|                                             |
|  [Generate Essay]  (enabled, primary)       |
+---------------------------------------------+
```

**Populated state (>= 1 saved statement):**
```
+---------------------------------------------+  ← entire card is a clickable <a> or div[role=link]
|  bi-journal-text  Personal Statements       |    href="/essays", aria-label="View all personal statements"
|                                             |    CSS class: card-link
|  2 statements saved                         |    cursor:pointer; hover: elevated box-shadow
|  Last edited: Jun 14, 2026, 11:00 AM        |
|                                             |
|  [Generate New]  (stopPropagation)          |
+---------------------------------------------+
```

The separate "[View All]" button is removed. The entire card navigates to `/essays` when clicked. The [Generate New] button calls `event.stopPropagation()` (and `event.preventDefault()` on any `<a>` wrapper) before executing its own navigation to `/essays/generate`, so clicking it does not trigger card navigation.

Keyboard behaviour: the card wrapper is focusable via Tab (`tabindex="0"` if implemented as a div, or native if `<a>`). Pressing Enter while the card has focus navigates to `/essays` via `history.pushState`. The [Generate New] button is a separate focusable element inside the card and is reachable by Tab after the card itself.

Summary line format: `{n} statement{s} saved` (e.g., "1 statement saved", "2 statements saved"). The `Last edited` line shows the `editedAt` timestamp of the most recently edited statement, formatted as "Jun 14, 2026, 11:00 AM".

Actions:
- [Generate Essay] (empty state) → calls `GET /api/essays/provenance` and opens the data provenance modal (Screen 2a)
- [Generate New] (populated state, inside card) → calls `stopPropagation`, then calls `GET /api/essays/provenance` and opens Screen 2a
- Click on card body (populated state) → navigates to `/essays` via `history.pushState` (Screen 4, no page reload)
- Enter key on focused card → same as click on card body

---

### Screen 2a — Data provenance preview modal (new)

**Entry point:** Student clicks [Generate Essay] or [Generate New] on the dashboard tile. The SPA does NOT yet navigate to `/essays/generate`. Instead, the client calls `GET /api/essays/provenance` and opens a Bootstrap modal (`modal-lg`, ID: `#essayProvenanceModal`). The URL does not change at this stage.

**Loading state:** Modal opens immediately with a spinner in the body and text "Loading your data summary…" while `GET /api/essays/provenance` is in-flight.

**Populated layout:**
```
+---------------------------------------------+
|  Data we'll use for your essay              |
|  ----------------------------------------  |
|  Your essay will be grounded in the data   |
|  below. Toggle off any item you'd like to  |
|  exclude.                                  |
|                                             |
|  [Include all data  ●]  ← master toggle    |
|                                             |
|  ┌ bi-mortarboard  GPA ──────────────────┐  |
|  │  3.9  ·  92% confidence              │  |
|  │  transcript-2026-06-14.pdf           [●]│  |
|  └──────────────────────────────────────┘  |
|                                             |
|  ┌ bi-clipboard-data  Test scores ───────┐  |
|  │  SAT Math: 780  ·  88%  ·  sat.pdf  [●]│  |
|  │  SAT EBRW: 760  ·  88%  ·  sat.pdf  [●]│  |
|  └──────────────────────────────────────┘  |
|                                             |
|  ┌ bi-trophy  Achievements & activities ─┐  |
|  │  Robotics Team Captain  [Manually added] [●]│  |
|  │  AP Chemistry Project   [certificate.pdf][●]│  |
|  └──────────────────────────────────────┘  |
|                                             |
|  ┌ bi-lightning  Impact statements ──────┐  |
|  │  "Leading eight teammates..."         │  |
|  │  (Robotics Team Captain)  [AI-generated][●]│  |
|  └──────────────────────────────────────┘  |
|                                             |
|  3 of 6 data items selected (muted)        |
|  [Cancel]           [Generate Essay]       |
+---------------------------------------------+
```

**Section blocks (rendered only when the corresponding data section is non-null and non-empty):**

- **GPA block** (shown only when `data.gpa` is non-null): Card header "GPA" with `bi-mortarboard`. Body shows GPA value, confidence badge (`bg-success` ≥85, `bg-warning` 70–84, `bg-danger` <70, badge text "{n}% confidence"), source document badge (`bg-light text-dark`), and a Bootstrap `form-check form-switch` toggle on the right. Items with confidence ≥70 are `checked` by default; confidence <70 are `unchecked` by default with tooltip "Low confidence — verify before including."

- **Test scores block** (shown only when `data.testScores` is non-null and non-empty): Card header "Test scores" with `bi-clipboard-data`. One row per test entry: test name, score, confidence badge, source badge, toggle. Confidence ≥70: checked by default. Confidence <70: unchecked with tooltip.

- **Achievements & activities block** (shown only when `data.achievements` is non-null and non-empty): Card header "Achievements & activities" with `bi-trophy`. One row per achievement: achievement name, category badge, confidence badge (or `badge bg-secondary "Manually added"` when `confidence` is null), source badge, toggle. All achievements checked by default regardless of confidence (student-confirmed data per STORY-003).

- **Impact statements block** (shown only when `data.impactStatements` is non-null and non-empty): Card header "Impact statements" with `bi-lightning`. One row per statement: linked achievement name (truncated to 60 chars), statement preview text (truncated to 80 chars with "..."), AI-generated badge (`badge bg-info text-dark "AI-generated"` when `aiGenerated: true`, else `badge bg-secondary "Written manually"`), toggle. All checked by default.

**Empty-profile state:** If all four sections are empty or null (no profile data), replace modal body with:
> "Your profile has no data yet. Add documents in the Documents section before generating an essay."
Footer shows only [Close] button. [Generate Essay] is hidden.

**Master "Include all data" toggle:** A `form-check form-switch` at the top of the modal body. Checked when all individual toggles are on. Indeterminate state (HTML `indeterminate` property) when toggles are mixed. Unchecked when all toggles are off. Toggling on: sets all individual toggles to checked. Toggling off: sets all to unchecked.

**Item count label:** Muted small text below the last section block: "{n} of {total} data items selected". Updates in real time as individual toggles change.

**Footer buttons:**
- [Cancel] — outline button. Closes modal without any navigation or API call. Student is returned to wherever they were (dashboard tile or Screen 4).
- [Generate Essay] — primary button. Disabled (with tooltip "Select at least one data item to generate") when 0 items are selected. Enabled when ≥1 item is selected.

**[Generate Essay] click behaviour:**
1. Collect toggle states into a `provenanceSelection` object:
   ```json
   {
     "includeGpa": true,
     "testScoreIds": ["uuid-1", "uuid-2"],
     "achievementIds": ["uuid-3"],
     "impactStatementIds": ["uuid-4"]
   }
   ```
   IDs come from the `id` fields in the provenance API response. `includeGpa` is `true` if the GPA toggle is checked (or false if not present / toggled off).
2. Close modal.
3. Navigate to `/essays/generate` via `history.pushState({ page: 'essays-generate' }, '', '/essays/generate')`.
4. Call `POST /api/essays/generate` with `provenanceSelection` in the request body.
5. Screen 2 (spinner) renders.

**Partial data warning:** If `GET /api/essays/provenance` returned HTTP 200 with a `warnings` array (one or more files unreadable), a non-blocking `alert-warning` banner appears at the top of the modal body: "Some data sections could not be loaded: [warning messages]. Generation will proceed with available data." The modal is otherwise fully functional.

**Error state (provenance fetch fails entirely):**
```
+---------------------------------------------+
|  Data we'll use for your essay              |
|  ----------------------------------------  |
|  Could not load data summary.              |
|                                             |
|  [Retry]     [Generate with all data]      |
+---------------------------------------------+
```
- [Retry] re-calls `GET /api/essays/provenance` and shows the spinner again.
- [Generate with all data] closes the modal, navigates to `/essays/generate`, and calls `POST /api/essays/generate` without a `provenanceSelection` field — the backend uses all available profile data.

---

### Screen 2 — Personal statement generation in progress (`/essays/generate`)

**Entry point:** Student clicks [Generate Essay] in the data provenance modal (Screen 2a) — the modal closes, the URL changes to `/essays/generate` via `history.pushState`, and `POST /api/essays/generate` is called with the `provenanceSelection` payload. The URL can also be entered directly by the student (see SPA routing in Enterprise checks), but no provenance modal is shown on direct load — the page immediately fires `POST /api/essays/generate` without a `provenanceSelection` field.

**Layout:**
```
+---------------------------------------------+
|  [bi-mortarboard] Admissions Officer   [bi-gear]  |
+---------------------------------------------+
|  [← Back to Personal Statements]           |
|  =========================================  |
|  Personal Statements                        |
|                                             |
|  [Spinner animation]                        |
|  Creating your personal statement draft...  |
|  Using your achievements, activities,       |
|  and impact statements.                     |
|                                             |
|  This usually takes 10–20 seconds.          |
+---------------------------------------------+
```

The [← Back to Personal Statements] link navigates to `/essays` via `history.pushState`. Clicking it while generation is in progress shows a confirmation modal: "Generation is in progress. Leaving now will discard the new draft. Leave anyway? [Stay] [Leave]". Clicking [Leave] navigates to `/essays`.

On error (Gemini timeout or API failure after 30 seconds):
```
+---------------------------------------------+
|  bi-exclamation-triangle  Generation failed |
|                                             |
|  We couldn't create your personal statement |
|  draft. Check your internet connection and  |
|  Gemini API key, then try again.            |
|                                             |
|  [Try Again]    [← Back to Personal Statements]  |
+---------------------------------------------+
```
[Try Again] re-fires `POST /api/essays/generate` from the same screen. When [Try Again] is clicked after reaching Screen 2 via Screen 2a, the retry call includes the same `provenanceSelection` that was passed in the original call (held in the module-level `provenanceSelection` variable — see Data and backend). [← Back to Personal Statements] navigates to `/essays`.

---

### Screen 3 — Statement draft view and edit (`/essays/{id}/edit`)

**Entry point:**
- Generation completes (auto-navigates here via `history.pushState({ page: 'essay-edit', id: '{id}' }, '', '/essays/{id}/edit')`).
- Student clicks [Edit] from Screen 4 (Personal Statements list).

**Layout:**
```
+---------------------------------------------+
|  [bi-mortarboard] Admissions Officer   [bi-gear]  |
+---------------------------------------------+
|  [← Back to Personal Statements]           |
|  =========================================  |
|  AI-generated Draft                         |
|  ----------------------------------------  |
|  [!] AI-generated draft — heavily rewrite  |
|       this in your own voice.              |
|                                             |
|  [AI draft text displayed here, read-only,  |
|   in a shaded Bootstrap card with no        |
|   textarea — plain text, line breaks        |
|   preserved]                                |
|                                             |
|  [bi-database  Sources used in this draft]  ← toggle link (collapsed by default)
|                                             |
|  =========================================  |
|  Your Edit                                  |
|  ----------------------------------------  |
|  [Large textarea, 20+ rows, Bootstrap       |
|   form-control, prefilled with AI draft     |
|   text for first-time view]                 |
|                                             |
|  Words: 623 / Target: 500–650              |
|  Characters: 3,841                         |
|                                             |
|  [Save]   [Discard Changes]   [Regenerate]  |
+---------------------------------------------+
```

**Sources panel (within the AI draft card, collapsed by default):**

The "Sources used in this draft" toggle link appears below the draft text inside the shaded card. Toggle link uses Bootstrap `collapse`. Icon: `bi-database`. Collapsed text: "Sources used in this draft". Expanded text: "Hide sources". Icon switches between `bi-chevron-down` (collapsed) and `bi-chevron-up` (expanded).

When expanded:
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

Data source: `data.provenanceUsed` from the `POST /api/essays/generate` response, resolved by the server to display names, confidence scores, and source document filenames. The `provenanceUsed` object is stored in the draft object in `essays.json` (see Data and backend).

When `provenanceUsed` is null or the draft was generated without provenance selection (e.g., via direct URL load of `/essays/generate`): the expanded panel shows:
> "All available profile data was used. Select specific items next time using the data source panel."

When the student opens an existing draft from Screen 4 (not freshly generated), `provenanceUsed` is read from the stored draft object in `essays.json`. If the field is absent on older drafts, treat as null and show the fallback message above.

The sources panel is read-only. There are no toggles or actions within it on this screen.

**The [← Back to Personal Statements] link** navigates to `/essays` via `history.pushState`. If there are unsaved changes in the textarea, clicking the back link shows a confirmation: "You have unsaved changes. Leave without saving? [Leave] [Keep editing]".

**Word count color indicators:**
- < 200 words: red text ("Too short")
- 200–499 words: orange text ("Below target")
- 500–650 words: green text ("On target")
- 651–1000 words: orange text ("Above target")
- > 1000 words: red text ("Too long")

**Save button state:**
- Disabled if textarea is empty.
- Enabled at any non-zero word count (student can save even if out of target range — a warning is shown but save proceeds).
- On click: button shows spinner and label "Saving..."; on success, shows success toast and navigates to `/essays` via `history.pushState` (returning the student to the Personal Statements list).

**Discard Changes** reverts the textarea to the last saved `studentEdit` (or the AI draft if no save has been made yet), after a confirmation: "Discard your changes and revert to the last saved version? [Discard] [Keep editing]".

**Regenerate** creates a new AI draft entry. It does NOT overwrite the current draft. Shows confirmation: "Regenerate will create a new draft using your current profile. Your existing draft stays saved. Continue? [Regenerate] [Cancel]". On confirm, navigates to `/essays/generate` (Screen 2a) via `history.pushState` — note: regenerate goes through Screen 2a (provenance modal) so the student can re-customise data selection, not directly to Screen 2.

---

### Screen 3a — Save confirmation (inline behaviour, not a separate screen)

When student clicks [Save] on Screen 3:
1. Button shows spinner: "Saving..."
2. On success:
   - Bootstrap toast appears (top-right, 4 seconds): "Statement saved. bi-check-circle"
   - If saved word count is outside 500–650: a secondary warning toast appears simultaneously: "Note: Your statement is [N] words — Common App target is 500–650. You can continue editing."
   - After both toasts are triggered, the router navigates to `/essays` via `history.pushState`, returning the student to Screen 4.
3. On API error: toast "Failed to save — please try again." No navigation.

---

### Screen 4 — Personal Statements list (`/essays`)

**Entry point:**
- Student clicks the Personal Statements dashboard card (card-as-link pattern — no separate [View All] button).
- Student is returned here after a successful save from Screen 3.
- Student clicks [← Back to Personal Statements] from Screen 3.
- Student loads `http://localhost:3000/essays` directly (server serves `index.html`; SPA router reads `window.location.pathname`).

**Layout:**
```
+---------------------------------------------+
|  [bi-mortarboard] Admissions Officer   [bi-gear]  |
+---------------------------------------------+
|  [← Back to Dashboard]                     |
|  =========================================  |
|  bi-journal-text  Personal Statements       |
|                                             |
|  2 statements saved                         |
|  [Generate New Statement]                   |
|                                             |
|  +---------------------------------------+  |
|  |  Statement #2 (Latest)  [Saved] badge |  |
|  |  Generated: Jun 14, 2026, 11:00 AM    |  |
|  |  Last edited: Jun 14, 2026, 11:20 AM  |  |
|  |  Word count: 623                      |  |
|  |  Preview: "It was the third meeting   |  |
|  |  of the robotics club when I first…"  |  |
|  |  [Edit]  [Delete]                     |  |
|  +---------------------------------------+  |
|  |  Statement #1            [Saved] badge|  |
|  |  Generated: Jun 14, 2026, 10:30 AM    |  |
|  |  Last edited: Jun 14, 2026, 10:45 AM  |  |
|  |  Word count: 598                      |  |
|  |  Preview: "The stack of forms on the  |  |
|  |  counter had been there for weeks…"   |  |
|  |  [Edit]  [Delete]                     |  |
|  +---------------------------------------+  |
+---------------------------------------------+
```

Preview text: first 120 characters of `studentEdit`, truncated with "…" if longer. If `studentEdit` equals `aiDraft` (never been edited), prefix with italicised "(AI draft)" before the preview text.

[← Back to Dashboard] navigates to `/` via `history.pushState`. Browser back button also navigates correctly because all prior transitions used `pushState`.

**[Generate New Statement] button:**
- Visible at all times on this screen.
- Disabled with tooltip "Add at least one achievement or activity first" if profile has zero achievements and zero activities.
- Enabled otherwise — clicking calls `GET /api/essays/provenance` and opens Screen 2a (provenance modal). Does NOT navigate to `/essays/generate` directly.

**Empty state (no statements):**
```
+---------------------------------------------+
|  [← Back to Dashboard]                     |
|  Personal Statements                        |
|                                             |
|  No statements saved yet.                   |
|  Click [Generate New Statement] to create   |
|  your first draft.                          |
|                                             |
|  [Generate New Statement]                   |
+---------------------------------------------+
```

**Delete behaviour:** Clicking [Delete] shows a Bootstrap modal: "Delete this personal statement? This cannot be undone. [Delete] [Cancel]". On confirm, calls `DELETE /api/essays/{id}`, removes the card from the list without page reload, shows toast: "Statement deleted."

**Edit behaviour:** Clicking [Edit] navigates to `/essays/{id}/edit` (Screen 3) via `history.pushState({ page: 'essay-edit', id: '{id}' }, '', '/essays/{id}/edit')`. The AI draft card shows the original `aiDraft` text. The textarea is prefilled with `studentEdit` (the last saved student version). The sources panel uses `provenanceUsed` from the stored draft object.

---

## Data and backend

### Data entities

**essays.json** — stored at `{DATA_DIR}/profile/essays.json`

Top-level structure:
```json
{
  "schemaVersion": "1.1.0",
  "lastUpdated": "2026-06-14T10:30:00.000Z",
  "data": {
    "drafts": [ ... ]
  }
}
```

Each draft object in `drafts`:

| Field | Type | Required | Validation |
|---|---|---|---|
| `id` | string (UUID v4) | yes | system-generated; format: `[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}` |
| `aiDraft` | string | yes | non-empty; system-generated from Gemini; max 10,000 characters |
| `studentEdit` | string | yes (after save) | non-empty; max 10,000 characters; student-supplied text |
| `wordCount` | integer | yes | computed from `studentEdit` on save; words split on whitespace |
| `generatedAt` | string (ISO 8601) | yes | system-generated timestamp of AI generation |
| `editedAt` | string (ISO 8601) | yes | system-generated timestamp of last student save |
| `status` | string enum | yes | must be one of: `"draft"`, `"saved"` |
| `provenanceUsed` | object or null | no | echoed from `POST /api/essays/generate` response; null if generation was done without provenance selection. See structure below. |

`provenanceUsed` structure (when non-null):
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
Any section within `provenanceUsed` may be `null` if that data type was not selected or not available.

`status` transitions:
- `"draft"` — AI draft generated, student has not yet saved an edit.
- `"saved"` — student has clicked Save at least once.

---

### API endpoints

#### `GET /api/essays/provenance`

Fetch the profile data available for inclusion in an essay, with confidence scores and source documents. Called before `POST /api/essays/generate` to populate Screen 2a.

**Defined in STORY-003a.** STORY-006 calls this endpoint but does not own it. Full endpoint spec is in `/specs/stories/STORY-003a/story-spec.md → Endpoint 2`.

**Request:** No body, no query params.

**Success response (200):** Returns `data` with four optional sections: `gpa`, `testScores`, `achievements`, `impactStatements`. Each section is non-null only when data exists. See STORY-003a spec for full response shape.

**Partial success:** HTTP 200 with a `warnings` array when one or more data files are unreadable. Client renders available sections and shows a non-blocking warning banner.

**Error cases:**
- HTTP 500: one or more files unreadable and no data available. Client shows modal error state with [Retry] and [Generate with all data].

---

#### `POST /api/essays/generate`

Trigger the AI to generate a new personal statement draft from the student's current profile data, optionally scoped to a specific provenance selection.

**Request body:**
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

`provenanceSelection` is optional. When absent or null, the server uses all available profile data (backwards-compatible default behaviour).

Field rules for `provenanceSelection` (server-side, permissive):
- `includeGpa`: optional boolean. If absent or non-boolean, treated as `true`.
- `testScoreIds`, `achievementIds`, `impactStatementIds`: optional arrays of UUID v4 strings. Server silently skips any ID that does not resolve to a record in the relevant JSON file. Empty array means none of that type will be included.

**Server action:**
1. If `provenanceSelection` is provided: read only the specified items from disk (the IDs listed in each `*Ids` array). If `includeGpa` is false, omit GPA from the prompt. If `provenanceSelection` is absent, read all data as before.
2. Validate: if the resolved set of achievements + activities is 0 (either because none exist or because none were selected), return 400 with error code `INSUFFICIENT_PROFILE_DATA`.
3. Build Gemini prompt using only the resolved data (see AI Integration section).
4. Call Gemini with 30-second timeout.
5. Validate response is 500–650 words. If not, retry once with adjusted prompt instruction. If still out of range, accept as-is.
6. Create a new draft object with `status: "draft"`, `id: uuid()`, `generatedAt: now()`, `aiDraft: <response>`, `studentEdit: <response>` (prefilled), `wordCount: 0`, `editedAt: now()`, `provenanceUsed: <resolved display data>` (see below).
7. Append to `drafts` array in `essays.json`. If file does not exist, create it.
8. Return the new draft object including `provenanceUsed`.

**Resolving `provenanceUsed`:** After reading the selected items from disk, the server assembles a `provenanceUsed` object that maps each selected item to its display name, confidence score, and source document. This mirrors the shape returned by `GET /api/essays/provenance` but filtered to only the selected items. If `provenanceSelection` was absent, `provenanceUsed` is `null` in the response (not an object listing all data — the client treats null as "all data used").

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid-v4",
    "aiDraft": "...",
    "studentEdit": "...",
    "wordCount": 0,
    "generatedAt": "2026-06-14T10:30:00.000Z",
    "editedAt": "2026-06-14T10:30:00.000Z",
    "status": "draft",
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
  "timestamp": "2026-06-14T10:30:00.000Z"
}
```

When `provenanceSelection` was absent, `provenanceUsed` is `null` in the response.

**Error responses:**
- `400 INSUFFICIENT_PROFILE_DATA` — "Add at least one achievement or activity to your profile before generating a personal statement." Also returned when a `provenanceSelection` is provided but resolves to zero achievements/activities.
- `504 GEMINI_TIMEOUT` — "Personal statement generation timed out after 30 seconds. Please try again."
- `502 GEMINI_API_ERROR` — "The AI service returned an error. Check your API key and try again."
- `500 FILE_WRITE_ERROR` — "Failed to save the generated draft to disk."

---

#### `POST /api/essays/save`

Save a student-edited personal statement (transitions a draft from `"draft"` to `"saved"` status).

> Note: For editing an existing saved statement, use `PUT /api/essays/{id}` instead.

**Request body:**
```json
{
  "id": "uuid-v4",
  "studentEdit": "Student's edited personal statement text here..."
}
```

**Validation (server-side):**
- `id`: required; must be a UUID v4 that exists in `essays.json`; if not found, return 404.
- `studentEdit`: required; non-empty string; max 10,000 characters (if exceeded, return 400 with `ESSAY_TOO_LONG`).

**Server action:**
1. Load `essays.json`.
2. Find draft by `id`.
3. Compute `wordCount` = number of whitespace-delimited tokens in `studentEdit`.
4. Update draft: `studentEdit`, `wordCount`, `editedAt: now()`, `status: "saved"`. The `provenanceUsed` field is NOT changed by save — it stays as set at generation time.
5. Write file with lock.
6. Return updated draft.

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid-v4",
    "aiDraft": "...",
    "studentEdit": "...",
    "wordCount": 623,
    "generatedAt": "2026-06-14T10:30:00.000Z",
    "editedAt": "2026-06-14T11:00:00.000Z",
    "status": "saved",
    "provenanceUsed": { "..." }
  },
  "error": null,
  "timestamp": "2026-06-14T11:00:00.000Z"
}
```

**Error responses:**
- `400 MISSING_FIELDS` — `id` or `studentEdit` not provided.
- `400 ESSAY_TOO_LONG` — `studentEdit` exceeds 10,000 characters.
- `404 DRAFT_NOT_FOUND` — No draft with that `id` exists.
- `500 FILE_WRITE_ERROR` — Disk write failure.

---

#### `GET /api/essays`

Return all saved drafts (sorted by `generatedAt` descending — most recent first).

**Request:** No body. No query parameters.

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "drafts": [
      {
        "id": "uuid-v4",
        "aiDraft": "...",
        "studentEdit": "...",
        "wordCount": 623,
        "generatedAt": "2026-06-14T10:30:00.000Z",
        "editedAt": "2026-06-14T11:00:00.000Z",
        "status": "saved",
        "provenanceUsed": { "..." }
      }
    ],
    "total": 1
  },
  "error": null,
  "timestamp": "2026-06-14T11:00:00.000Z"
}
```

If `essays.json` does not exist: return `data: { drafts: [], total: 0 }` (not a 404).

---

#### `GET /api/essays/{id}`

Return a single draft by ID.

**URL parameter:** `id` — UUID v4.

**Success response (200):** Same structure as a single element in `GET /api/essays`, wrapped in `data: { draft: { ... } }`.

**Error responses:**
- `404 DRAFT_NOT_FOUND`

---

#### `PUT /api/essays/{id}`

Update an existing saved personal statement's `studentEdit`.

**URL parameter:** `id` — UUID v4 of the draft to update.

**Request body:**
```json
{
  "studentEdit": "Updated personal statement text..."
}
```

**Validation (server-side):**
- `id`: must exist in `essays.json`; if not found, return 404.
- `studentEdit`: required; non-empty string; max 10,000 characters.

**Server action:**
1. Load `essays.json`, find by `id`.
2. Update `studentEdit`, `wordCount` (recomputed), `editedAt: now()`.
3. `status` remains `"saved"`. `provenanceUsed` is NOT changed.
4. Write file with lock.
5. Return updated draft.

**Success response (200):** Same structure as `POST /api/essays/save` success.

**Error responses:**
- `400 MISSING_FIELDS`, `400 ESSAY_TOO_LONG`, `404 DRAFT_NOT_FOUND`, `500 FILE_WRITE_ERROR`.

---

#### `DELETE /api/essays/{id}`

Delete a single personal statement draft permanently.

**URL parameter:** `id` — UUID v4.

**Server action:**
1. Load `essays.json`.
2. Find draft by `id`. If not found, return 404.
3. Remove from `drafts` array.
4. Update `lastUpdated`.
5. Write file with lock.
6. Return success with deleted `id`.

**Success response (200):**
```json
{
  "success": true,
  "data": { "deletedId": "uuid-v4" },
  "error": null,
  "timestamp": "2026-06-14T11:00:00.000Z"
}
```

**Error responses:**
- `404 DRAFT_NOT_FOUND`
- `500 FILE_WRITE_ERROR`

---

## AI integration

**Trigger:** Student clicks [Generate Essay] in the data provenance modal (Screen 2a) and confirms their provenance selection, or clicks [Generate with all data] in the Screen 2a error state, or confirms [Regenerate] from the confirmation modal on Screen 3. This fires `POST /api/essays/generate`.

**Input to Gemini:** The server assembles a payload from the data files, filtered by `provenanceSelection` when provided:
- If `provenanceSelection.achievementIds` is provided: read only those achievement IDs from `achievements.json`. Otherwise, read all achievements.
- If `provenanceSelection.impactStatementIds` is provided: read only those statement IDs from `impact_statements.json`. Otherwise, read all statements.
- If `provenanceSelection.includeGpa` is false: omit GPA from the prompt. Otherwise, include `academic.json → gpa`.
- If `provenanceSelection.testScoreIds` is provided: read only those test score IDs from `tests.json`. If empty array, omit all test scores.
- If `provenanceSelection` is absent: read all data as before (same behaviour as original spec).

Fields included per data type (unchanged from original):
- Achievements: `name`, `description`, `date`, first `impact_statement` if present.
- Activities: `name`, `role`, `description`, `hoursPerWeek`, `weeksPerYear`.
- Academic: `gpa`, `testScores`, `courses` (AP/IB/Honors with grades).
- Impact statements: all `statement` strings linked to their parent achievement or activity `name`.

If any file is absent or a specified ID does not resolve, that item is silently omitted from the prompt.

**Size limit:** The assembled profile text passed to Gemini must not exceed 8,000 characters. If it does, truncate by: first drop course list (keep only top 5 by grade), then drop activity descriptions (keep name + role only). Log a warning but proceed.

**Prompt template:**

```
You are helping a high-school senior write their Common App personal statement.
Your job is to write a FIRST DRAFT (500–650 words) that uses ONLY the data provided below.

RULES:
- Use ONLY achievements, activities, and experiences listed below. Do NOT invent, assume, or hallucinate any detail not explicitly provided.
- Write in first person, as the student.
- Sound like a thoughtful 17-year-old reflecting honestly, NOT like a guidance counselor or a corporate bio.
- BANNED phrases (never use these or close variants): "lifelong learner", "passionate about", "I have always been", "dedicated to excellence", "I am committed to", "making a difference", "giving back to the community", "pursuit of knowledge", "I strive to".
- Open with a specific, concrete hook — a moment, a detail, or a scene from ONE of the listed achievements or activities. No generic opening.
- Weave in at least 3 specific achievements or activities by name and detail. Use exact names as provided below.
- Reference impact statements to show reflection on what was learned or felt — these are the student's own words about why something mattered.
- End with a forward-looking sentence or two about what the student wants to carry forward (values, goals, direction) — grounded in what was described.
- Do NOT use bullet points. Flowing paragraphs only.
- Do NOT add a title or heading. Start directly with the hook sentence.
- Target: between 500 and 650 words. Count carefully.

STUDENT PROFILE DATA:
---
Academic:
GPA: {{gpa}}
Test scores: {{testScores}}
Notable courses: {{courses}}

Achievements:
{{achievements}}

Activities:
{{activities}}

Impact statements:
{{impactStatements}}
---

Write the personal statement draft now. Only output the essay text — no preamble, no explanation, no word count at the end.
```

**Variable substitution:**

- `{{gpa}}` — `academic.json → gpa` if included by provenance selection, else "Not provided"
- `{{testScores}}` — formatted as "SAT: 1480, ACT: 32" for selected test scores, or "Not provided" if no test scores were selected or available
- `{{courses}}` — comma-separated list of course names, max 10 (from `academic.json`, included regardless of `provenanceSelection` since courses are not individually toggleable)
- `{{achievements}}` — formatted as:
  ```
  - [Name]: [description]. Impact: "[impact_statement]"
  ```
  One per line for each selected achievement. If no impact statement, omit the Impact field.
- `{{activities}}` — formatted as:
  ```
  - [Name] ([role]): [description]. [hoursPerWeek] hrs/wk, [weeksPerYear] wks/yr.
  ```
  One per line for each selected activity.
- `{{impactStatements}}` — formatted as:
  ```
  - "[statement]" (about: [parentName])
  ```
  One per line for each selected impact statement.

**Expected output schema:**

Gemini must return plain text only (no JSON). The response is the essay body directly. Backend validates:
- Word count: count whitespace-delimited tokens. Accept if >= 400 words (below 400 is considered a failure; above 400 but below 500, or above 650, accept and show to student with word count warning).
- If word count < 400: retry once with the same prompt plus appended instruction: "The previous draft was too short. Write a complete 500–650 word version."
- If still < 400 after retry: return a `502 GEMINI_API_ERROR` with message "The AI returned an incomplete draft. Please try again."

**How output maps to UI:**
- `aiDraft` field in the draft object = the raw Gemini response text.
- `studentEdit` field is prefilled with `aiDraft` text when the student first opens the editing screen (so the textarea starts with the AI draft, ready to edit).
- The read-only AI draft card always shows `aiDraft` (the original, unchanged Gemini output).
- The textarea shows `studentEdit` (the student's working copy).
- `provenanceUsed` in the draft object populates the "Sources used in this draft" collapsible panel in Screen 3.

**Fallback:**
- If Gemini returns a 4xx/5xx error or the request times out after 30 seconds: show Screen 2 error state (see Screens and States). Student can click [Try Again] which re-fires `POST /api/essays/generate` with the same `provenanceSelection` (held in the module-level `provenanceSelection` variable). The `essays.json` file is NOT written if generation fails — no partial draft is saved.
- The provenance modal (Screen 2a) can be bypassed via [Generate with all data] when it fails to load. In that case `provenanceSelection` is not sent and the AI uses all available profile data.

---

## Enterprise checks

**Auth:** This app has no user authentication system (local desktop app). All routes are accessible to whoever runs the app locally. No redirect logic needed. No session or JWT required.

**Input validation:**
- Client-side: [Save] button is disabled if textarea is empty. Word count warning shown but does not block save. [Generate Essay] button in the provenance modal is disabled when 0 items are selected (enforced via `disabled` attribute).
- Server-side (all enforced regardless of client):
  - `POST /api/essays/save` and `PUT /api/essays/{id}`: `studentEdit` must be non-empty string, max 10,000 characters.
  - `DELETE /api/essays/{id}`: `id` must match UUID v4 format and exist in the file.
  - `POST /api/essays/generate`: profile data presence check (achievements + activities resolved from selection >= 1). `provenanceSelection` is optional; server silently skips any unresolvable IDs.
  - `GET /api/essays/provenance`: no user input — read-only.

**Error states:**
- Provenance fetch fails (Screen 2a): modal shows "Could not load data summary" with [Retry] and [Generate with all data]. Student is never blocked from generating.
- Provenance fetch partial (some files unreadable): non-blocking `alert-warning` banner in modal. [Generate Essay] remains available.
- Zero items selected in provenance modal: [Generate Essay] button disabled with tooltip; no API call made.
- Gemini timeout (> 30s): Screen 2 error state with [Try Again] button and [← Back to Personal Statements] link.
- Gemini API error (bad key, quota exceeded): same error screen, message advises checking API key.
- `INSUFFICIENT_PROFILE_DATA` from generate endpoint when provenance selection resolves to zero achievements/activities: Screen 2 error state with message "None of the selected items could be found. Please go back and re-select your data."
- Disk write failure: toast "Failed to save — check that your data directory is writable." No data is partially written.
- Profile has no achievements or activities: [Generate Essay] / [Generate New Statement] button disabled; if called via direct API, returns 400 with descriptive message.
- Statement too long on save (> 10,000 characters): server returns 400; client shows inline error below textarea: "Statement is too long to save. Please shorten it."
- Network/fetch error from client: generic toast "Something went wrong. Please refresh and try again."
- Direct URL load of `/essays/{id}/edit` for a non-existent ID: SPA router calls `GET /api/essays/{id}`, receives 404, renders an error panel: "Statement not found. [← Back to Personal Statements]".

**Data safety:**
- If the student closes the browser mid-edit (before clicking Save), unsaved changes in the textarea are lost. The `aiDraft` and any previously saved `studentEdit` remain in `essays.json` on disk — nothing is permanently lost, only the unsaved edits since last save.
- To mitigate loss: the client writes a `localStorage` key `ao_essay_pending_{id}` with the textarea content on every `input` event (debounced to 2 seconds). On page load for Screen 3, if a pending key exists for that draft `id`, the textarea is restored from localStorage and a banner shown: "You have unsaved changes from a previous session. [Restore] [Discard]".
- If the browser is closed while Screen 2a is open (provenance modal): no data is saved. Student returns to the essay entry point and the modal opens fresh on next [Generate Essay] click. No state loss.
- `provenanceSelection` (module-level variable) is in-memory only — not persisted. If the student closes the browser after the modal closes but before essay generation completes, the selection is lost. The server has already received it and uses it for generation; however, if generation was incomplete (no response), the draft is not saved and the next generation will re-open the provenance modal fresh.

**Rate limiting / abuse:**
- `POST /api/essays/generate` is a candidate for abuse (Gemini API costs per token). Limit: 5 generation requests per 60-minute rolling window per app session (tracked in server memory, reset on server restart). If limit exceeded, return `429 RATE_LIMIT_EXCEEDED` with message "You've generated 5 personal statements in the past hour. Please wait before generating again."
- `GET /api/essays/provenance`: No Gemini call — no rate limiting required.
- No rate limiting on save, update, list, or delete endpoints.

**AI fallback:** If the AI service is unavailable, the student cannot auto-generate a draft, but they can still:
1. Navigate to `/essays` to view and edit any previously saved personal statement.
2. Manually type a statement in the textarea (the editing UI is always accessible for existing drafts via `/essays/{id}/edit`).
3. There is no manual "start from blank" creation flow in this story — generation is required for creating new drafts. The [Generate New Statement] button leads only to the provenance modal and then to AI generation.

**SPA routing:** The server must serve `index.html` for all of these routes (Express wildcard or catch-all): `/`, `/essays`, `/essays/generate`, `/essays/:id/edit`. The SPA router in `app.js` reads `window.location.pathname` on load and renders the correct view. `history.pushState` and `history.replaceState` are used for all in-app navigation. The browser back button fires a `popstate` event that the SPA router handles to re-render the correct view without a page reload. Note: Screen 2a is a modal overlay — it does not change the URL.

---

## Acceptance criteria

1. The Personal Statements dashboard card shows "N statements saved" (not "essays") when at least one statement exists. The entire card is rendered as a clickable element with CSS class `card-link`, `cursor:pointer`, and `aria-label="View all personal statements"`. There is no separate "[View All]" button.
2. Clicking anywhere on the Personal Statements dashboard card (in its populated state) navigates to `/essays` via `history.pushState` — no full-page reload occurs, the browser back button returns to the dashboard correctly, and the card is also keyboard-navigable (Tab to focus, Enter to activate).
3. The Personal Statements list at `/essays` (Screen 4) renders a card for each saved statement, showing: statement number, [Saved] badge, generated timestamp, last-edited timestamp, word count, 120-character preview of `studentEdit`, and [Edit] / [Delete] buttons.
4. Clicking [Edit] from Screen 4 navigates to `/essays/{id}/edit` via `history.pushState`, loads the AI draft in the read-only card and the last-saved `studentEdit` in the textarea.
5. After clicking [Save] on Screen 3 and the API call succeeds, the router navigates to `/essays` (Screen 4) — the student is returned to the Personal Statements list, not left on the edit screen.
6. Clicking [Generate Essay] on the dashboard tile (when at least one achievement or activity exists) calls `GET /api/essays/provenance`, opens the data provenance modal (Screen 2a), and does NOT immediately navigate to `/essays/generate` or call `POST /api/essays/generate`.
7. The data provenance modal (Screen 2a) shows a spinner in the body while `GET /api/essays/provenance` is in-flight. Once data arrives, section cards render for each non-null, non-empty data section (GPA, Test scores, Achievements, Impact statements).
8. Items with confidence ≥70 are checked by default in the provenance modal; items with confidence <70 are unchecked by default and show a tooltip "Low confidence — verify before including." Manually added achievements show a `badge bg-secondary "Manually added"` badge and are checked by default.
9. The "Include all data" master toggle checks all individual toggles when switched on and unchecks all when switched off. The item count label ("{n} of {total} data items selected") updates in real time as individual toggles change.
10. The [Generate Essay] button in the provenance modal is disabled (with tooltip "Select at least one data item to generate") when zero items are selected, and becomes enabled as soon as at least one toggle is checked.
11. Clicking [Generate Essay] in the provenance modal with items selected closes the modal, navigates to `/essays/generate` via `history.pushState`, and calls `POST /api/essays/generate` with a `provenanceSelection` body containing `includeGpa`, `testScoreIds`, `achievementIds`, and `impactStatementIds` fields reflecting exactly the checked toggles.
12. Clicking [Cancel] in the provenance modal closes the modal without any navigation or API call. The student remains on the dashboard or Screen 4.
13. If `GET /api/essays/provenance` returns HTTP 200 with a `warnings` array, a non-blocking `alert-warning` banner appears at the top of the provenance modal listing the unloaded sections. [Generate Essay] remains enabled for available sections.
14. If `GET /api/essays/provenance` fails entirely, the modal body shows "Could not load data summary" with [Retry] and [Generate with all data] buttons. Clicking [Generate with all data] navigates to `/essays/generate` and calls `POST /api/essays/generate` without a `provenanceSelection` field.
15. Clicking [Generate Essay] or [Generate New Statement] and confirming through the provenance modal shows the spinner screen at `/essays/generate` with text "Creating your personal statement draft..." and navigates to `/essays/{id}/edit` when the AI response arrives.
16. The AI-generated draft is visibly labeled with the exact text "AI-generated draft — heavily rewrite this in your own voice" in a Bootstrap `alert-warning` block above the draft card.
17. The generated draft card on Screen 3 contains a "Sources used in this draft" collapse toggle (icon: `bi-database`). When expanded, it lists the display names, confidence scores, and source document filenames for each item included in generation, sourced from `data.provenanceUsed` in the generate response. The toggle text switches between "Sources used in this draft" and "Hide sources".
18. When a draft was generated without provenance selection (e.g., [Generate with all data] fallback or direct URL load of `/essays/generate`), the expanded sources panel shows: "All available profile data was used. Select specific items next time using the data source panel."
19. The `provenanceUsed` field is stored in the draft object in `essays.json` and is returned in `GET /api/essays/{id}` and `GET /api/essays` responses. Loading an existing draft from Screen 4 shows the same sources panel populated from the stored `provenanceUsed`.
20. The generated personal statement references at least one specific achievement or activity by name from the student's selected data — not a generic statement. (Manual spot-check with a test profile containing named achievements.)
21. The generated text does not contain any banned phrases: "lifelong learner", "passionate about", "I have always been", "dedicated to excellence", "I am committed to", "making a difference", "giving back to the community", "pursuit of knowledge", "I strive to". (Automated string-match check during testing.)
22. The textarea on Screen 3 updates word count and character count in real-time on every `input` event with no perceptible lag. Word count indicator turns green when count is 500–650 inclusive and shows "On target".
23. Clicking [Delete] on a statement in Screen 4 and confirming the modal calls `DELETE /api/essays/{id}`, removes the card from the list without a page reload, and shows a Bootstrap toast "Statement deleted."
24. If [Generate Essay] or [Generate New Statement] is clicked when the profile has zero achievements and zero activities, the button is disabled (no API call is made) and a tooltip reads "Add at least one achievement or activity to your profile first."
25. If Gemini returns an error or times out after 30 seconds, Screen 2 shows the error state with text "We couldn't create your personal statement draft." and a [Try Again] button. [Try Again] re-fires `POST /api/essays/generate` with the same `provenanceSelection` from the previous attempt. No partial draft is written to `essays.json`.
26. If the student saves a personal statement with a word count outside 500–650, a secondary warning toast appears: "Note: Your statement is [N] words — Common App target is 500–650." The save still succeeds and the student is returned to `/essays`.
27. Unsaved textarea content is stored in `localStorage` (key: `ao_essay_pending_{id}`) on each input event (debounced 2s) and restored with a banner on next visit to that draft's edit screen.
28. Clicking [← Back to Personal Statements] on Screen 2 or Screen 3, and the [← Back to Dashboard] link on Screen 4, all navigate using `history.pushState` — browser back/forward buttons work correctly throughout the flow.
29. If the student clicks [← Back to Personal Statements] from Screen 3 while there are unsaved changes, a confirmation modal appears: "You have unsaved changes. Leave without saving? [Leave] [Keep editing]". Clicking [Leave] navigates to `/essays`; [Keep editing] dismisses the modal.
30. Clicking [Regenerate] on Screen 3 and confirming the modal navigates back through Screen 2a (provenance modal) — not directly to the spinner — so the student can re-customise their data selection before regenerating.

---

## Change history

| Release | Date | Summary | Type |
|---|---|---|---|
| 1.0.0 | 2026-06-14 | Initial spec authored | feature |
| 1.0.0 | 2026-06-14 | Renamed "Essays" to "Personal Statements" throughout; added /essays details page (Screen 4) with View All pattern; added return-to-list after save; added SPA pushState navigation for all routes; dashboard tile shows summary + View All; updated acceptance criteria for details page, navigation, delete, and edit flows | fix |
| 1.0.0 | 2026-06-14 | Card-as-link UX: replaced [View All] button on dashboard card with clickable card (card-link CSS class, aria-label, keyboard accessible, cursor:pointer + hover shadow); [Generate New] button uses stopPropagation; acceptance criteria #1 and #2 updated to match | fix |
| 1.1.2 | 2026-06-15 | Integrated STORY-003a transparency layer: added Screen 2a (data provenance modal before generation); updated [Generate Essay] and [Generate New] entry points to open provenance modal first; updated POST /api/essays/generate to accept optional provenanceSelection body and return provenanceUsed in response; added provenanceUsed field to draft schema in essays.json; added "Sources used in this draft" collapsible panel to Screen 3 AI draft card; updated [Regenerate] to route back through Screen 2a; added GET /api/essays/provenance reference endpoint; added acceptance criteria 6–14, 17–19, 30; renumbered remaining criteria; updated depends_on to include STORY-003a | feature |
