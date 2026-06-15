---
story_id: STORY-003
title: "Data extraction and confidence-scored review"
depends_on: [STORY-002]
spec_done: true
---

## What the user can do

- User can click "Next: Review and extract" on the classification result screen (from STORY-002) and immediately see an extraction-in-progress spinner while Gemini analyzes the document
- User can see every extracted field displayed in a structured review table showing the field name, extracted value, confidence percentage (with a color-coded progress bar), and a brief source excerpt proving the extraction
- User can click "Edit" next to any field to correct the extracted value inline before saving — corrected fields are flagged as `confirmedByStudent: true`
- User can click a trash/delete icon next to any field row to remove that line item from the pending extraction entirely — useful when Gemini extracted a field that does not apply (e.g., a header row mistaken for a course)
- User can click an "Ignore warning" button on any warning shown for a field (e.g., "class rank missing") to suppress that warning without deleting the field — suppressed warnings are stored in the pending extraction and not shown again on reload
- User can click "Save to Profile" to persist all reviewed fields to the appropriate profile JSON section (academic.json, tests.json, achievements.json, or activities.json), with low-confidence fields requiring explicit confirmation first
- User can recover their pending extraction review if the browser was closed mid-flow — on returning to the app, the review screen re-loads from the saved pending extraction file
- User can view saved courses, achievements, and activities in their respective profile detail pages — each item shows a source badge ("From [document name]" for extracted items, "Manually added" for manual entries) so the student knows where the data originated
- User can click [Edit] on any saved course to correct the course name, grade, score, term, or level — the correction is saved immediately and the source metadata is preserved
- User can click [Delete] on any saved course, achievement, or activity to permanently remove it from the profile — a confirmation prompt is shown before deletion

---

## Screens and states

### Screen 1 — Extraction in-progress

**Entry point:** Student clicks "Next: Review and extract" button on the STORY-002 classification result screen. The button triggers `POST /api/documents/{documentId}/extract`.

**What it displays:**
- Full-width spinner (Bootstrap `spinner-border`, size `spinner-border-lg`) centered vertically
- Heading: "Analyzing your document..."
- Sub-text: "This may take up to 30 seconds. Do not close this tab."
- Document filename shown below the sub-text (e.g., "transcript-final.pdf")
- No navigation or other interactive elements during this state

**States:**
- Default: spinner running, polling not required — extraction result returned synchronously in the POST response
- Timeout (>30s): spinner stops, inline error message replaces spinner: "Extraction timed out. Please try again or enter data manually." Two buttons appear: "Try again" (re-calls POST /extract) and "Enter manually" (routes to manual entry form for the document type)
- Rate-limit hit (429): spinner stops, message: "Processing queue is busy. Your document is queued — please wait." Spinner resumes after a 5-second delay and the request is retried once automatically. If the retry also fails, show "Try again" / "Enter manually" buttons.
- Gemini failure (non-timeout server error): spinner stops, message: "Could not analyze this document. Please check the file quality and try again, or enter data manually." Two buttons: "Try again" and "Enter manually"

**Empty state:** Not applicable — screen is only reached when a document is available.

---

### Screen 2 — Extraction review

**Entry point:** Extraction completes successfully (POST /extract returns 200 with extracted fields). Also reached on app reload if a pending extraction file exists for an unreviewed document — student is shown a banner: "You have an unfinished review for [filename]. Continue?"

**SPA routing (STORY-001 integration):** The extraction review screen is a view within the SPA routing system established in STORY-001. The URL hash route is `#review/{documentId}`. The SPA router in `/src/public/js/app.js` must handle this route by rendering the review screen in the main content area without a full page reload. The "Cancel" link routes back to `#documents`. The "View profile" link in the save confirmation toast routes to `#profile/{section}` (e.g., `#profile/academic`). All navigation uses `window.location.hash` assignment — no `<a href>` full reloads.

**Card-as-link UX pattern (applies to dashboard and all section screens touched by this story):** Dashboard section tiles (academics, tests, achievements, activities, impact statements, essays) are rendered as `<a>` elements (or `<div>` with `role="link"`, `tabindex="0"`, and a `click` + `keydown` handler) wrapping the entire card. They navigate to `#section/[name]` (e.g., `#section/academics`, `#section/tests`). There is no separate "[View All]" button — the card itself is the navigation target. Cards must apply `cursor: pointer` on hover via the CSS class `card-link` defined in `/src/public/css/custom.css`. This class sets `cursor: pointer` and adds a subtle hover shadow (`box-shadow: 0 0 0 2px rgba(0,0,0,0.08)`). The `<a>` wrapping element must have `text-decoration: none` and `color: inherit` so card content is unstyled. Keyboard users can Tab to a card and press Enter to navigate. ARIA: the wrapping element carries `aria-label="Go to [section name]"`. This pattern applies consistently to all six section tiles: Academics, Tests, Achievements, Activities, Impact Statements, Essays.

**What it displays:**

Header area:
- Document filename and classified type (e.g., "transcript-final.pdf — Academic Transcript")
- Extraction summary badge: "14 fields extracted" and, if applicable, "3 fields need your attention" (in yellow Bootstrap badge)
- "Save to Profile" button (primary, top-right) — disabled until student has acknowledged all low-confidence fields

Review table (Bootstrap `.table .table-bordered .table-hover`):

| Column | Content |
|---|---|
| Field Name | Human-readable label (e.g., "GPA — Overall") |
| Extracted Value | The value, with inline edit control when "Edit" is clicked |
| Confidence | Color-coded Bootstrap progress bar: green ≥85%, yellow 70–84%, red <70%. Numeric percentage shown above bar. |
| Source Excerpt | Short quoted text from document (≤ 2 sentences). Truncated at 120 chars with "…show more" toggle. |
| Actions | "Edit" button (Bootstrap icon `bi-pencil`). For <70% fields: replaced with "Enter manually" button (Bootstrap icon `bi-keyboard`). "Delete" icon button (Bootstrap icon `bi-trash`, `btn-sm btn-outline-danger`) — always shown, right-most in the cell. |

Confidence color rules (applied as Bootstrap contextual classes):
- `≥ 85`: `text-success`, progress bar `bg-success`
- `70–84`: `text-warning`, progress bar `bg-warning`
- `< 70`: `text-danger`, progress bar `bg-danger`. Row highlighted with `table-danger`.

**Below the table:**
- "Save to Profile" button (Bootstrap `btn-primary btn-lg`)
- "Cancel" link (Bootstrap `btn-link text-muted`) — returns student to the document list without saving; pending extraction file is NOT deleted

**Error state — no fields extracted:**
If Gemini returns an empty `fields` array, the table is replaced with:
- Icon: `bi-exclamation-circle` (Bootstrap warning color)
- Message: "We couldn't extract any data from this document. This may be due to low image quality or an unsupported format."
- Two buttons: "Re-upload document" and "Enter data manually"

**Empty state — pending extraction loaded:** See banner described under Entry point.

---

### Screen 3 — Inline field edit

**Entry point:** Student clicks "Edit" on any field row in the review table.

**What it displays:**
- The "Extracted Value" cell transforms into an inline text input (Bootstrap `form-control`) pre-filled with the current extracted value
- Two inline action buttons replace the "Edit" button: "Save" (Bootstrap `btn-sm btn-success`) and "Cancel" (Bootstrap `btn-sm btn-outline-secondary`)
- Source excerpt remains visible for reference
- Confidence bar remains visible

**On "Save":**
- Input value is validated client-side (non-empty for required fields; numeric for score fields)
- On valid: `PUT /api/documents/{documentId}/extraction-fields/{fieldName}` called with new value
- Row returns to display mode; extracted value cell shows updated value; confidence bar is unchanged; `confirmedByStudent` flag set to `true` in the pending extraction
- On invalid: inline error text appears below the input ("This field cannot be empty" or "Must be a number between 0 and 4.0" etc.)

**On "Cancel":** Input reverts to original extracted value; no API call.

---

### Screen 4 — Low-confidence warning modal

**Entry point:** Student clicks "Save to Profile" when one or more fields have confidence < 70%.

**What it displays:**
Bootstrap modal (`modal-dialog modal-dialog-centered`):
- Title: "Some fields need your attention" (Bootstrap `bi-exclamation-triangle` icon beside title)
- Body: A list of all <70% confidence fields showing:
  - Field name
  - Extracted value (or "No value extracted" if blank)
  - Confidence percentage
  - Source excerpt
  - Per-row action: "Accept this value" toggle or "Skip this field" toggle (default: "Skip this field" — the safer default)
- Footer buttons:
  - "Continue to save" (Bootstrap `btn-primary`) — enabled only when student has explicitly toggled "Accept" or "Skip" for every listed field
  - "Go back and edit" (Bootstrap `btn-outline-secondary`) — closes modal, returns to review table; student can then click "Edit" on individual fields

**Behavior:**
- Fields where student chose "Skip this field": excluded from the saved profile entirely. They remain in the pending extraction file so the student can revisit later.
- Fields where student chose "Accept this value": saved with `confirmedByStudent: true` and the original (low) confidence score.

---

### Screen 5 — Save confirmation

**Entry point:** After "Continue to save" is clicked in the modal (or "Save to Profile" when no low-confidence fields exist).

**What it displays:**
- Bootstrap toast notification (bottom-right, auto-dismisses after 5 seconds):
  - Icon: `bi-check-circle-fill text-success`
  - Message: "Data saved to your [section] profile" (e.g., "Data saved to your Academic profile")
  - Subtitle: "12 fields saved. 2 fields skipped."
- Student is redirected to the profile section view for the saved section (e.g., `/profile/academic`) after toast dismisses — or a "View profile" link in the toast body for immediate navigation

**Error state:** If the `/review` API call fails:
- Toast shows with `bi-x-circle-fill text-danger`
- Message: "Save failed. Please try again."
- Student remains on the review screen; "Save to Profile" button re-enabled

---

### Screen 6 — Academics detail page: courses list with edit/delete

**Entry point:** Student navigates to `#section/academics` from the dashboard (card-as-link pattern).

**What it displays:**

The Academics detail page shows the following sections in order:
1. GPA summary (overall, by term if available)
2. Class rank and graduation year
3. Courses list (the primary new surface in this story)
4. AP/IB Scores (from `apIbScores` — may be empty)

**Courses list:**
- Section heading: "Courses" with a count badge (e.g., "14 courses")
- Each course is rendered as a Bootstrap list-group item (`list-group-item list-group-item-action`)
- Per-course display:
  - Course name (bold, e.g., "AP Calculus BC")
  - Grade badge (Bootstrap `badge` — `bg-success` for A grades, `bg-primary` for B, `bg-warning text-dark` for C, `bg-danger` for D/F; grey `bg-secondary` if grade is null)
  - Level badge (e.g., "AP", "Honors", "Regular") — small Bootstrap badge `bg-light text-dark border`
  - Score (numeric, shown as grey text if present, omitted if null)
  - Term (grey small text, e.g., "Fall 2022")
  - Source badge: Bootstrap `badge bg-info text-dark` reading "From [documentName]" for extracted items, or Bootstrap `badge bg-light text-muted border` reading "Manually added" for manual entries — sourced from the `source.documentName` field
  - [Edit] button (Bootstrap `btn-sm btn-outline-secondary`, icon `bi-pencil`) — opens inline edit form (see Screen 7)
  - [Delete] button (Bootstrap `btn-sm btn-outline-danger`, icon `bi-trash`) — triggers delete confirmation inline

**Empty state — no courses:**
If `academic.json → courses` is an empty array:
- Show a Bootstrap alert (`alert-info`): "No courses added yet. Upload a transcript to extract courses automatically, or add them manually."
- Button: "Add course manually" — opens Screen 7 in create mode with all fields blank

**Delete confirmation inline:**
Clicking [Delete] on a course replaces that list-group row with an inline confirmation:
- Text: "Delete [course name]? This cannot be undone."
- "Confirm delete" button (`btn-sm btn-danger`) — calls `DELETE /api/profile/academic/course/:id`
- "Cancel" button (`btn-sm btn-outline-secondary`) — restores the original row display

**On delete success:**
- Row is removed from the list immediately (no page reload)
- Bootstrap toast (bottom-right): "Course deleted."

**On delete error:**
- Row is restored; Bootstrap toast (bottom-right, danger): "Could not delete course. Please try again."

---

### Screen 7 — Inline course edit form

**Entry point:** Student clicks [Edit] on a course row in Screen 6, or "Add course manually."

**What it displays:**
The course list-group item expands into an inline form (Bootstrap collapse or DOM replacement) with the following fields:

| Field | Input type | Validation |
|---|---|---|
| Course name | `<input type="text">` | Required. Non-empty string, max 200 chars. |
| Grade | `<input type="text">` | Optional. Max 5 chars (e.g., "A+", "B-", "98"). Blank is allowed. |
| Score | `<input type="number">` | Optional. Float 0–100; null if blank. |
| Term | `<input type="text">` | Optional. Max 50 chars (e.g., "Fall 2022"). Blank is allowed. |
| Level | `<select>` | Options: AP, IB, Honors, Dual Enrollment, Regular, Other. Required — defaults to "Regular". |

Pre-filled with the course's existing values in edit mode; blank in create mode.

Form action buttons (shown below the fields):
- "Save" (`btn-sm btn-primary`) — validates client-side, calls `PUT /api/profile/academic/course/:id` (edit) or `POST /api/profile/academic/course` (create)
- "Cancel" (`btn-sm btn-outline-secondary`) — collapses the form, restores original row display; no API call

**Client-side validation:**
- Course name non-empty: inline error below field: "Course name is required."
- Score out of range: inline error: "Score must be a number between 0 and 100."
- Level unselected: default to "Regular" — no error needed

**On save success (edit):**
- Form collapses; course row updates in place with new values and updated source badge
- Source badge: extracted items retain "From [documentName]"; updated items do NOT change the source badge — the source metadata is preserved regardless of edits

**On save success (create):**
- New course row appears at the bottom of the list
- Source badge shows "Manually added"

**On save error:**
- Inline error below the Save button: "Could not save. Please try again."
- Form stays open so student can retry

---

### Screen 8 — Achievements and activities source badges (existing list screens)

**Entry point:** Student navigates to `#section/achievements` or `#section/activities` (both implemented in STORY-001 but amended here).

**What changes:**
STORY-001 already provides edit/delete for achievements and activities. This story adds source badges to each item in those lists.

**Source badge display (same rules as courses):**
- Extracted items: Bootstrap badge `bg-info text-dark` reading "From [documentName]"
- Manual items: Bootstrap badge `bg-light text-muted border` reading "Manually added"
- Badge placement: displayed below the item title, before any action buttons
- Badge sourced from `source.documentName` on the achievement or activity object; if `source` field is absent (legacy items pre-dating this story), display "Manually added" as the default

**Edit behavior for extracted achievements/activities (existing forms in STORY-001):**
- Editing an extracted item (e.g., correcting an award name) does NOT change or remove the source badge — the `source` field is preserved in the JSON even after edits
- The item's `confirmedByStudent` flag is set to `true` on any edit
- No other behavior changes to the STORY-001 edit/delete forms

---

## Data and backend

### Data entities

#### Pending extraction file
**File:** `/DATA_DIR/uploads/{documentId}.extraction.json`
Written immediately when extraction completes; deleted after successful save to profile.

```json
{
  "documentId": "string — UUID from STORY-002 upload",
  "documentFilename": "string",
  "documentType": "string — one of: transcript | test_result | certificate | activity",
  "extractedAt": "string — ISO 8601 timestamp",
  "fields": [
    {
      "name": "string — field key (e.g., gpa_overall)",
      "label": "string — display label (e.g., GPA — Overall)",
      "value": "string | number | null",
      "confidence": "integer — 0 to 100",
      "excerpt": "string — ≤ 300 chars, quoted text from document proving the extraction",
      "warnings": ["string — list of ambiguity warnings from Gemini, may be empty array"],
      "ignoredWarnings": ["string — warnings the student has explicitly suppressed; subset of warnings array"],
      "confirmedByStudent": "boolean — false until student edits or explicitly accepts",
      "skipped": "boolean — true if student chose Skip in the low-confidence modal",
      "deleted": "boolean — true if student clicked the trash icon to remove this field from the pending set"
    }
  ]
}
```

#### Profile section files (persisted after Save)

**File:** `/DATA_DIR/profile/academic.json`

```json
{
  "gpa": {
    "overall": {
      "value": 3.9,
      "scale": 4.0,
      "confidence": 92,
      "source": "transcript-final.pdf",
      "sourceUploadedAt": "2026-06-14T10:00:00Z",
      "excerpt": "Cumulative GPA: 3.90 / 4.00",
      "confirmedByStudent": false,
      "savedAt": "2026-06-14T10:30:00Z"
    },
    "byTerm": [
      {
        "term": "Fall 2024",
        "value": 3.85,
        "confidence": 88,
        "source": "transcript-final.pdf",
        "sourceUploadedAt": "2026-06-14T10:00:00Z",
        "excerpt": "Fall 2024: 3.85",
        "confirmedByStudent": false,
        "savedAt": "2026-06-14T10:30:00Z"
      }
    ]
  },
  "gpaScale": {
    "value": 4.0,
    "confidence": 95,
    "source": "transcript-final.pdf",
    "sourceUploadedAt": "2026-06-14T10:00:00Z",
    "excerpt": "Scale: 4.00",
    "confirmedByStudent": false,
    "savedAt": "2026-06-14T10:30:00Z"
  },
  "classRank": {
    "rank": 15,
    "classSize": 320,
    "confidence": 80,
    "source": "transcript-final.pdf",
    "sourceUploadedAt": "2026-06-14T10:00:00Z",
    "excerpt": "Class Rank: 15 / 320",
    "confirmedByStudent": false,
    "savedAt": "2026-06-14T10:30:00Z"
  },
  "graduationYear": {
    "value": 2026,
    "confidence": 97,
    "source": "transcript-final.pdf",
    "sourceUploadedAt": "2026-06-14T10:00:00Z",
    "excerpt": "Expected Graduation: June 2026",
    "confirmedByStudent": false,
    "savedAt": "2026-06-14T10:30:00Z"
  },
  "schoolName": {
    "value": "Lincoln High School",
    "confidence": 99,
    "source": "transcript-final.pdf",
    "sourceUploadedAt": "2026-06-14T10:00:00Z",
    "excerpt": "Lincoln High School — Official Transcript",
    "confirmedByStudent": false,
    "savedAt": "2026-06-14T10:30:00Z"
  },
  "courses": [
    {
      "id": "string — UUID assigned by backend on save (e.g., 'c1a2b3c4-...')",
      "name": "AP Calculus BC",
      "grade": "A+",
      "score": 98,
      "term": "Fall 2022",
      "level": "AP",
      "confidence": 91,
      "source": {
        "type": "extracted",
        "documentId": "abc-123",
        "documentName": "transcript-final.pdf",
        "extractedAt": "2026-06-14T10:30:00Z"
      },
      "sourceUploadedAt": "2026-06-14T10:00:00Z",
      "excerpt": "AP Calculus BC ... A+",
      "confirmedByStudent": false,
      "savedAt": "2026-06-14T10:30:00Z"
    }
  ],
  "apIbScores": [],
  "disciplinaryNotes": {
    "value": null,
    "confidence": null,
    "source": null,
    "sourceUploadedAt": null,
    "excerpt": null,
    "confirmedByStudent": false,
    "savedAt": null
  },
  "apIbScores": []
}
```

`apIbScores` is always initialized as an empty array when `academic.json` is first created. It is NOT populated during transcript extraction — AP and IB exams are taken separately from regular coursework and results arrive via a separate score report document. In STORY-003, the extraction review screen shows this field as a template row with label "AP / IB Exam Scores" and value "(none yet — add via manual entry or upload your AP/IB score report)". The student can manually add entries or leave it empty; downstream stories (STORY-004, STORY-005) must handle an empty `apIbScores` array gracefully.

When manually populated (future: by the student directly or via a separate score report upload), each entry in `apIbScores` has this shape:

```json
{
  "courseName": "AP Calculus BC",
  "examScore": 5,
  "scoreDate": "2023-05-01",
  "confirmedByStudent": true,
  "savedAt": "2026-06-14T10:30:00Z"
}
```

Fields:
- `courseName`: string — name of the AP or IB course/exam (e.g., "AP Calculus BC", "IB Physics HL")
- `examScore`: integer — AP score 1–5 or IB score 1–7
- `scoreDate`: ISO 8601 date string (YYYY-MM-DD) or null if unknown
- `confirmedByStudent`: always `true` for manually entered records
- `savedAt`: ISO 8601 timestamp

```json
```

**File:** `/DATA_DIR/profile/tests.json`

The `sat` and `act` keys are objects with a `score` sub-object and a `dateTaken` field. This ensures display code can always read `sat.score.total` and `sat.dateTaken` without type-checking. Storing scores as a flat `[object Object]` is a known bug — the structured schema below prevents it.

```json
{
  "sat": {
    "score": {
      "math": 780,
      "ebrw": 760,
      "total": 1540
    },
    "dateTaken": "2025-10-04",
    "confidence": 94,
    "source": "sat-score-report.pdf",
    "sourceUploadedAt": "2026-06-14T10:00:00Z",
    "excerpt": "Total Score: 1540 | Math: 780 | EBRW: 760 | Test Date: October 2025",
    "confirmedByStudent": false,
    "savedAt": "2026-06-14T10:30:00Z"
  },
  "act": null,
  "ap": [
    {
      "examName": "AP Computer Science A",
      "score": 5,
      "dateTaken": "2025-05-01",
      "confidence": 97,
      "source": "ap-score-report.pdf",
      "sourceUploadedAt": "2026-06-14T10:00:00Z",
      "excerpt": "AP Computer Science A: 5",
      "confirmedByStudent": false,
      "savedAt": "2026-06-14T10:30:00Z"
    }
  ],
  "ib": [],
  "other": []
}
```

**File:** `/DATA_DIR/profile/achievements.json`

Each achievement item uses `title` (the award name) and `description` (a free-text summary assembled from extracted fields). This ensures downstream stories (STORY-004 impact statement, STORY-005 export) can reliably read `achievement.title` and `achievement.description` without field-name mismatches that cause empty sections on the dashboard.

```json
{
  "achievements": [
    {
      "id": "string — UUID assigned by backend on save",
      "title": "National Merit Semifinalist",
      "description": "Awarded by National Merit Scholarship Corporation on September 15, 2025.",
      "awardName": "National Merit Semifinalist",
      "issuingOrganization": "National Merit Scholarship Corporation",
      "dateAwarded": "2025-09-15",
      "category": "academic",
      "confidence": 95,
      "source": {
        "type": "extracted",
        "documentId": "abc-123",
        "documentName": "merit-certificate.pdf",
        "extractedAt": "2026-06-14T10:30:00Z"
      },
      "sourceUploadedAt": "2026-06-14T10:00:00Z",
      "excerpt": "National Merit Scholarship Corporation ... awarded to ... September 15, 2025",
      "confirmedByStudent": false,
      "savedAt": "2026-06-14T10:30:00Z"
    }
  ]
}
```

**File:** `/DATA_DIR/profile/activities.json`

Each activity item uses `title` (the activity name) and `description` (assembled from role, hours, and duration). This ensures downstream stories can reliably read `activity.title` and `activity.description` without empty-section bugs.

```json
{
  "activities": [
    {
      "id": "string — UUID assigned by backend on save",
      "title": "Robotics Club",
      "description": "Team Captain at Lincoln High School Robotics Club. 8 hours/week, September 2023 – June 2026.",
      "activityName": "Robotics Club",
      "role": "Team Captain",
      "hoursPerWeek": 8,
      "duration": "September 2023 – June 2026",
      "dateStart": "2023-09-01",
      "dateEnd": null,
      "organization": "Lincoln High School",
      "confidence": 88,
      "source": {
        "type": "extracted",
        "documentId": "abc-123",
        "documentName": "robotics-participation.pdf",
        "extractedAt": "2026-06-14T10:30:00Z"
      },
      "sourceUploadedAt": "2026-06-14T10:00:00Z",
      "excerpt": "Robotics Club, Team Captain, 8 hours/week",
      "confirmedByStudent": false,
      "savedAt": "2026-06-14T10:30:00Z"
    }
  ]
}
```

---

### API endpoints

#### POST /api/documents/{documentId}/extract

Triggers Gemini Vision extraction on the already-uploaded document. The document file is read from `/DATA_DIR/uploads/{documentId}` (file path and type from STORY-002 metadata). The classified `documentType` is read from the STORY-002 classification result stored at `/DATA_DIR/uploads/{documentId}.classification.json`.

**Request:**
```
POST /api/documents/abc-123/extract
Content-Type: application/json
Body: {} (empty — documentId in path is sufficient)
```

**Processing:**
1. Read classification metadata from `/DATA_DIR/uploads/{documentId}.classification.json`
2. Read the uploaded file bytes from disk
3. Select Gemini prompt template based on `documentType`
4. Call Gemini Vision API (model from `process.env.GEMINI_MODEL`) with document bytes + prompt
5. Parse Gemini JSON response into normalized fields array
6. Write pending extraction to `/DATA_DIR/uploads/{documentId}.extraction.json`
7. Return response

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "documentId": "abc-123",
    "documentType": "transcript",
    "extractedAt": "2026-06-14T10:30:00Z",
    "fields": [
      {
        "name": "gpa_overall",
        "label": "GPA — Overall",
        "value": "3.9",
        "confidence": 92,
        "excerpt": "Cumulative GPA: 3.90 / 4.00",
        "warnings": [],
        "confirmedByStudent": false,
        "skipped": false
      }
    ]
  },
  "error": null,
  "timestamp": "2026-06-14T10:30:00Z"
}
```

**Error responses:**

| Condition | HTTP status | `error.code` | `error.message` |
|---|---|---|---|
| documentId not found | 404 | `DOCUMENT_NOT_FOUND` | "Document not found" |
| Classification not found | 422 | `CLASSIFICATION_MISSING` | "Document has not been classified yet" |
| Gemini timeout (>30s) | 504 | `EXTRACTION_TIMEOUT` | "Extraction timed out. Please try again." |
| Gemini rate limit | 429 | `RATE_LIMITED` | "Too many requests. Please wait and try again." |
| Gemini API error | 502 | `AI_EXTRACTION_FAILED` | "Could not analyze document. Check file quality or enter data manually." |
| Empty extraction | 200 | — | fields array is empty; success: true; UI handles empty state |

---

#### GET /api/documents/{documentId}/extraction-preview

Returns the pending extraction if it exists (for browser-refresh recovery).

**Request:**
```
GET /api/documents/abc-123/extraction-preview
```

**Success response (200) — pending extraction exists:**
```json
{
  "success": true,
  "data": {
    "documentId": "abc-123",
    "documentFilename": "transcript-final.pdf",
    "documentType": "transcript",
    "extractedAt": "2026-06-14T10:30:00Z",
    "fields": [ /* same shape as extract response */ ]
  },
  "error": null,
  "timestamp": "2026-06-14T10:35:00Z"
}
```

**Success response (200) — no pending extraction:**
```json
{
  "success": true,
  "data": null,
  "error": null,
  "timestamp": "2026-06-14T10:35:00Z"
}
```

UI checks `data === null` and skips recovery banner.

---

#### PUT /api/documents/{documentId}/extraction-fields/{fieldName}

Updates a single field's value, `confirmedByStudent` flag, or ignored warnings in the pending extraction file. All three operations use this endpoint to minimize API surface.

**Request — edit value:**
```
PUT /api/documents/abc-123/extraction-fields/gpa_overall
Content-Type: application/json

{
  "value": "3.95",
  "confirmedByStudent": true
}
```

**Request — ignore a warning:**
```
PUT /api/documents/abc-123/extraction-fields/class_rank
Content-Type: application/json

{
  "ignoreWarning": "Class size not found in document"
}
```
The backend appends the warning string to `ignoredWarnings[]` in the extraction field. It does NOT remove the string from `warnings[]` — `ignoredWarnings` is a separate suppression list. The UI hides any warning whose text appears in `ignoredWarnings`.

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "fieldName": "gpa_overall",
    "value": "3.95",
    "confirmedByStudent": true
  },
  "error": null,
  "timestamp": "2026-06-14T10:32:00Z"
}
```

**Error responses:**

| Condition | HTTP status | `error.code` | `error.message` |
|---|---|---|---|
| documentId not found | 404 | `DOCUMENT_NOT_FOUND` | "Document not found" |
| No pending extraction | 404 | `EXTRACTION_NOT_FOUND` | "No pending extraction found for this document" |
| fieldName not in extraction | 404 | `FIELD_NOT_FOUND` | "Field not found in extraction" |
| value is empty string | 422 | `VALIDATION_ERROR` | "Field value cannot be empty" |
| ignoreWarning is not a non-empty string | 422 | `VALIDATION_ERROR` | "ignoreWarning must be a non-empty string" |

---

#### DELETE /api/documents/{documentId}/extraction-fields/{fieldName}

Marks a field as `deleted: true` in the pending extraction file. The field is excluded from the review table immediately and excluded from `POST /review` save processing. The field is not physically removed from the JSON so that an undo path can be added in a future release.

**Request:**
```
DELETE /api/documents/abc-123/extraction-fields/disciplinary_notes
```

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "fieldName": "disciplinary_notes",
    "deleted": true
  },
  "error": null,
  "timestamp": "2026-06-14T10:33:00Z"
}
```

**Error responses:**

| Condition | HTTP status | `error.code` | `error.message` |
|---|---|---|---|
| documentId not found | 404 | `DOCUMENT_NOT_FOUND` | "Document not found" |
| No pending extraction | 404 | `EXTRACTION_NOT_FOUND` | "No pending extraction found for this document" |
| fieldName not in extraction | 404 | `FIELD_NOT_FOUND` | "Field not found in extraction" |

---

#### POST /api/documents/{documentId}/review

Student submits the final confirmed/edited extraction. Persists fields to the appropriate profile JSON section(s). Deletes the pending extraction file on success.

**Request:**
```
POST /api/documents/abc-123/review
Content-Type: application/json

{
  "fields": [
    {
      "name": "gpa_overall",
      "value": "3.9",
      "confirmedByStudent": false,
      "skipped": false
    },
    {
      "name": "class_rank",
      "value": "15 of 320",
      "confirmedByStudent": true,
      "skipped": false
    },
    {
      "name": "disciplinary_notes",
      "value": null,
      "confirmedByStudent": false,
      "skipped": true
    }
  ]
}
```

**Processing:**
1. Read pending extraction from `/DATA_DIR/uploads/{documentId}.extraction.json`
2. Merge student's field decisions (skipped, confirmedByStudent, value overrides) onto pending extraction
3. Filter out fields where `deleted: true` or `skipped: true`
4. **Transform and validate extracted fields into profile schema** (see Field Mapping Table below) — this step is mandatory and must run before any disk write
5. Determine target profile file from `documentType` (transcript → academic.json; test_result → tests.json; certificate → achievements.json; activity → activities.json)
6. Acquire file lock on target profile JSON
7. Merge transformed fields into profile JSON (see schema above)
8. Append audit log entry to `/DATA_DIR/.audit.json`
9. Release file lock
10. Delete `/DATA_DIR/uploads/{documentId}.extraction.json`
11. Return response

---

#### PUT /api/profile/academic/course/:id

Updates a single saved course in `academic.json`. The `:id` must match a course's `id` field. The `source` object on the course is preserved unchanged — student edits do not reset source tracking.

**Request:**
```
PUT /api/profile/academic/course/c1a2b3c4-0001-0000-0000-000000000001
Content-Type: application/json

{
  "name": "AP Calculus BC",
  "grade": "A",
  "score": 97,
  "term": "Fall 2022",
  "level": "AP"
}
```

**Validation (server-side):**

| Field | Rule |
|---|---|
| `name` | Required. Non-empty string. Max 200 chars. |
| `grade` | Optional. String or null. Max 5 chars. |
| `score` | Optional. Float 0–100 or null. Reject if not a number and not null. |
| `term` | Optional. String or null. Max 50 chars. |
| `level` | Required. One of: "AP", "IB", "Honors", "Dual Enrollment", "Regular", "Other". Reject if not in list. |
| `:id` path param | Must be a valid UUID. Reject with 400 if not. |

**Processing:**
1. Read `academic.json` from `DATA_DIR`
2. Find course in `courses` array where `course.id === id`
3. If not found: return 404
4. Merge supplied fields onto the found course; preserve `id`, `source`, `confidence`, `excerpt`, `sourceUploadedAt`, `savedAt` (original)
5. Set `confirmedByStudent: true` on the updated course
6. Set `updatedAt: <ISO 8601 timestamp>` on the course
7. Write file with lock; append audit log entry
8. Return updated course

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "id": "c1a2b3c4-0001-0000-0000-000000000001",
    "name": "AP Calculus BC",
    "grade": "A",
    "score": 97,
    "term": "Fall 2022",
    "level": "AP",
    "confirmedByStudent": true,
    "updatedAt": "2026-06-14T11:00:00Z"
  },
  "error": null,
  "timestamp": "2026-06-14T11:00:00Z"
}
```

**Error responses:**

| Condition | HTTP status | `error.code` | `error.message` |
|---|---|---|---|
| `:id` not a valid UUID | 400 | `INVALID_ID` | "Invalid course ID format" |
| Course not found | 404 | `COURSE_NOT_FOUND` | "Course not found" |
| `name` is empty | 422 | `VALIDATION_ERROR` | "Course name is required" |
| `score` out of range | 422 | `VALIDATION_ERROR` | "Score must be a number between 0 and 100" |
| `level` not in allowed list | 422 | `VALIDATION_ERROR` | "Level must be one of: AP, IB, Honors, Dual Enrollment, Regular, Other" |
| File lock timeout | 503 | `FILE_LOCK_TIMEOUT` | "Could not save — please try again" |

---

#### DELETE /api/profile/academic/course/:id

Permanently removes a course from the `courses` array in `academic.json`. This is a hard delete — the course is removed from the array, not soft-deleted.

**Request:**
```
DELETE /api/profile/academic/course/c1a2b3c4-0001-0000-0000-000000000001
```

**Processing:**
1. Read `academic.json`
2. Find course where `course.id === id`; if not found, return 404
3. Remove the course from the `courses` array
4. Write file with lock
5. Append audit log entry: `{ action: "course_deleted", courseId: id, courseName: course.name, timestamp }`
6. Return success

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "id": "c1a2b3c4-0001-0000-0000-000000000001",
    "deleted": true
  },
  "error": null,
  "timestamp": "2026-06-14T11:01:00Z"
}
```

**Error responses:**

| Condition | HTTP status | `error.code` | `error.message` |
|---|---|---|---|
| `:id` not a valid UUID | 400 | `INVALID_ID` | "Invalid course ID format" |
| Course not found | 404 | `COURSE_NOT_FOUND` | "Course not found" |
| File lock timeout | 503 | `FILE_LOCK_TIMEOUT` | "Could not delete — please try again" |

---

#### POST /api/profile/academic/course

Creates a new course entry in `academic.json` with `source.type = "manual"`. Used when student adds a course via "Add course manually" in Screen 6.

**Request:**
```
POST /api/profile/academic/course
Content-Type: application/json

{
  "name": "English 101",
  "grade": "A-",
  "score": null,
  "term": "Spring 2025",
  "level": "Regular"
}
```

**Processing:**
1. Validate all fields (same rules as PUT above)
2. Generate a new UUID for `id`
3. Set `source: { type: "manual", documentId: null, documentName: null, extractedAt: null }`
4. Set `confidence: 100`, `confirmedByStudent: true`, `excerpt: ""`, `savedAt: <ISO 8601>`
5. Append course to `academic.json → courses` array with lock
6. Append audit log entry
7. Return created course

**Success response (201):**
```json
{
  "success": true,
  "data": {
    "id": "new-uuid-here",
    "name": "English 101",
    "grade": "A-",
    "score": null,
    "term": "Spring 2025",
    "level": "Regular",
    "source": { "type": "manual", "documentId": null, "documentName": null, "extractedAt": null },
    "confidence": 100,
    "confirmedByStudent": true,
    "savedAt": "2026-06-14T11:05:00Z"
  },
  "error": null,
  "timestamp": "2026-06-14T11:05:00Z"
}
```

**Error responses:** Same validation errors as PUT.

---

**Note on achievements and activities CRUD:** Edit and delete endpoints for achievements and activities are defined in STORY-001 (`PUT /api/profile/achievements/:id`, `DELETE /api/profile/achievements/:id`, `PUT /api/profile/activities/:id`, `DELETE /api/profile/activities/:id`). This story does not add new endpoints for those — it only extends the data schema to include a `source` object and `id` field on each item. The extraction save path (`POST /api/documents/{documentId}/review`) must populate `source` and `id` on every achievement and activity it writes. The STORY-001 PUT/DELETE endpoints must preserve the `source` field on any item they update (do not overwrite or drop it).

---

#### Field Mapping Table

This table defines how flat extraction field names from Gemini map to the nested profile JSON schema. The backend transformation in step 4 must apply these mappings. Incorrect mapping is the root cause of `[object Object]` display bugs, empty section bugs, and missing test scores.

**Transcript (academic.json):**

| Extraction field name | Profile JSON path | Type transformation |
|---|---|---|
| `school_name` | `schoolName.value` | string |
| `gpa_overall` | `gpa.overall.value` | `parseFloat(value)` — reject if NaN |
| `gpa_scale` | `gpaScale.value` | `parseFloat(value)` — default 4.0 if null |
| `class_rank` | `classRank.rank` and `classRank.classSize` | Parse "15 of 320" → `{ rank: 15, classSize: 320 }`. If only one number, set `rank = parseInt(value)`, `classSize = null`. |
| `graduation_year` | `graduationYear.value` | `parseInt(value)` — reject if not 4-digit year |
| `disciplinary_notes` | `disciplinaryNotes.value` | string or null |
| `courses` | `courses` (array) | Parse JSON array from value if value is a string; validate each element has `name` (string), `grade` (string or null), `score` (number or null), `term` (string or null), `level` (string or null). Every course on the transcript must be included — no filtering. |

**Test result (tests.json):**

| Extraction field name | Profile JSON path | Type transformation |
|---|---|---|
| `sat_math` | `sat.score.math` | `parseInt(value)` — valid range 200–800; reject outside range |
| `sat_ebrw` | `sat.score.ebrw` | `parseInt(value)` — valid range 200–800; reject outside range |
| `sat_total` | `sat.score.total` | `parseInt(value)` — valid range 400–1600; reject outside range. If missing, compute from math + ebrw if both present. |
| `sat_date` | `sat.dateTaken` | ISO 8601 string (YYYY-MM-DD). Set `sat.confidence`, `sat.source`, `sat.sourceUploadedAt`, `sat.excerpt`, `sat.confirmedByStudent`, `sat.savedAt` from the highest-confidence SAT field |
| `act_english` | `act.score.english` | `parseInt(value)` — valid range 1–36 |
| `act_math` | `act.score.math` | `parseInt(value)` — valid range 1–36 |
| `act_reading` | `act.score.reading` | `parseInt(value)` — valid range 1–36 |
| `act_science` | `act.score.science` | `parseInt(value)` — valid range 1–36 |
| `act_composite` | `act.score.composite` | `parseInt(value)` — valid range 1–36. If missing, compute average of four section scores. |
| `act_date` | `act.dateTaken` | ISO 8601 string |
| `ap_scores` | `ap` (array) | Parse JSON array from value; each element must have `examName` (string), `score` (int 1–5), `date` (ISO 8601 or null) |
| `ib_scores` | `ib` (array) | Parse JSON array; each element: `subject` (string), `level` ("HL"/"SL"), `score` (int 1–7), `date` (ISO 8601 or null) |

**Transcript — course items (academic.json → courses):**

In addition to the per-field mappings, the backend must also assign the following system-generated fields to every item it writes:

| System field | Value | Notes |
|---|---|---|
| `id` | `crypto.randomUUID()` | UUID generated per item at write time |
| `source.type` | `"extracted"` | Always `"extracted"` for items written by extraction |
| `source.documentId` | The `documentId` from the extraction request | |
| `source.documentName` | The `documentFilename` from the extraction metadata | |
| `source.extractedAt` | ISO 8601 timestamp of extraction | |

**Certificate/Achievement (achievements.json):**

| Extraction field name | Profile JSON path | Type transformation |
|---|---|---|
| `award_name` | `achievements[n].awardName` AND `achievements[n].title` | string — both fields set to same value |
| `issuing_organization` | `achievements[n].issuingOrganization` | string |
| `date_awarded` | `achievements[n].dateAwarded` | ISO 8601 string or null |
| `award_category` | `achievements[n].category` | must be one of: "academic", "sports", "arts", "community_service", "leadership", "stem", "other" — default "other" if invalid |
| `recipient_name` | DISCARD — never written to profile JSON (FERPA) | — |
| (assembled) | `achievements[n].description` | Backend assembles: `"${awardName} awarded by ${issuingOrganization} on ${dateAwarded}."` — null parts omitted |
| (system) | `achievements[n].id` | UUID, generated per item |
| (system) | `achievements[n].source` | `{ type: "extracted", documentId, documentName, extractedAt }` |

**Activity (activities.json):**

| Extraction field name | Profile JSON path | Type transformation |
|---|---|---|
| `activity_name` | `activities[n].activityName` AND `activities[n].title` | string — both fields set to same value |
| `role` | `activities[n].role` | string or null |
| `organization` | `activities[n].organization` | string |
| `hours_per_week` | `activities[n].hoursPerWeek` | `parseFloat(value)` or null |
| `duration` | `activities[n].duration` | string or null |
| `date_start` | `activities[n].dateStart` | ISO 8601 string or null |
| `date_end` | `activities[n].dateEnd` | ISO 8601 string or null |
| (assembled) | `activities[n].description` | Backend assembles: `"${role ? role + ' at ' : ''}${organization}${activityName}. ${hoursPerWeek ? hoursPerWeek + ' hours/week, ' : ''}${duration || ''}."` — null parts omitted |
| (system) | `activities[n].id` | UUID, generated per item |
| (system) | `activities[n].source` | `{ type: "extracted", documentId, documentName, extractedAt }` |

**Validation errors during transformation:** If a required field fails type conversion (e.g., `gpa_overall` is not a parseable number), that specific field is excluded from the save and a warning is appended to the response's `data.transformWarnings[]` array. The save proceeds for all other fields. The student is shown: "1 field could not be saved due to a format error — check your data and re-enter manually if needed." with the field names listed.

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "documentId": "abc-123",
    "profileSection": "academic",
    "fieldsSaved": 12,
    "fieldsSkipped": 2,
    "fieldsDeleted": 1,
    "transformWarnings": [],
    "savedAt": "2026-06-14T10:35:00Z"
  },
  "error": null,
  "timestamp": "2026-06-14T10:35:00Z"
}
```

`transformWarnings` is an array of strings listing fields that failed type transformation and were excluded from the save (e.g., `["gpa_overall: could not parse '3.9O' as a number — check for OCR error"]`). Empty array when all fields transform cleanly.

**Error responses:**

| Condition | HTTP status | `error.code` | `error.message` |
|---|---|---|---|
| documentId not found | 404 | `DOCUMENT_NOT_FOUND` | "Document not found" |
| No pending extraction | 404 | `EXTRACTION_NOT_FOUND` | "No pending extraction to save" |
| File lock timeout | 503 | `FILE_LOCK_TIMEOUT` | "Could not save — please try again" |
| Low-confidence field not acknowledged | 422 | `UNACKNOWLEDGED_LOW_CONFIDENCE` | "All fields with confidence below 70 must be accepted or skipped before saving" |

---

## AI integration

### Trigger

Student clicks "Next: Review and extract" on the classification result screen. The frontend calls `POST /api/documents/{documentId}/extract`. The backend calls the Gemini Vision API.

### Input

- Document file bytes (PDF or image) read from disk
- Classified document type from `/DATA_DIR/uploads/{documentId}.classification.json`
- The Gemini model is read from `process.env.GEMINI_MODEL` — never hardcoded

For PDF documents: text is first extracted using `pdf-parse` and passed as text content. For images: file bytes are passed directly as Gemini Vision inline image data (`inlineData` with appropriate MIME type).

### Expected output schema

Gemini must return a JSON object matching this schema exactly:

```json
{
  "documentType": "transcript | test_result | certificate | activity",
  "overallConfidence": 0,
  "fields": [
    {
      "name": "string — camelCase or snake_case field key, no spaces",
      "label": "string — human-readable display label",
      "value": "string | number | null — null if field not found in document",
      "confidence": "integer — 0 to 100",
      "excerpt": "string — verbatim 1–2 sentence quote from document proving this field. Empty string if field not found.",
      "warnings": ["string — any ambiguity, OCR uncertainty, or handwritten text flag"]
    }
  ]
}
```

### Prompt templates

All prompts share a common prefix and a document-type-specific field list section.

**Common prefix (used in all prompts):**

```
You are a document data extraction assistant for a student profile application. Your task is to extract specific structured data from the student document provided.

CRITICAL RULES — follow exactly:
1. Extract ONLY facts that are explicitly visible in the document. Do NOT infer, calculate, or assume any value.
2. For every extracted field, provide a verbatim excerpt (1–2 sentences) from the document as proof.
3. For every field, provide a confidence score from 0 to 100 reflecting how certain you are the extracted value is correct:
   - 90–100: Text is clear, unambiguous, machine-printed
   - 70–89: Text is legible but slightly degraded or somewhat ambiguous
   - 50–69: Text is partially unclear, handwritten, or the value required interpretation
   - 0–49: Text is very unclear, possibly wrong due to OCR error, or highly uncertain
4. If a field is NOT present in the document, return value: null, confidence: 0, excerpt: "".
5. If any section of the document appears handwritten, blurry, or unclear, add a warning in the warnings array for affected fields.
6. Never invent or hallucinate data. If you are unsure, lower the confidence score and add a warning.
7. Return ONLY valid JSON matching the schema below. No markdown. No explanation text.

Return this JSON structure:
{
  "documentType": "{{DOCUMENT_TYPE}}",
  "overallConfidence": <integer 0–100 reflecting overall document readability>,
  "fields": [
    {
      "name": "<field_key>",
      "label": "<Human Readable Label>",
      "value": <extracted value or null>,
      "confidence": <0–100>,
      "excerpt": "<verbatim quote from document>",
      "warnings": []
    }
  ]
}
```

---

**Transcript prompt (documentType = "transcript"):**

```
{{COMMON_PREFIX with documentType = "transcript"}}

Extract the following fields from this academic transcript. Each field must follow the rules above.

Fields to extract:
1. name: "school_name", label: "School Name" — The full name of the school or institution issuing the transcript.
2. name: "gpa_overall", label: "GPA — Overall" — The cumulative or overall GPA as a decimal number (e.g., 3.90). Note: "1.5O" may be an OCR error for "1.50" — include a warning if digits and letters look similar.
3. name: "gpa_scale", label: "GPA Scale" — The scale used (e.g., 4.0, 4.5, 5.0, 100.0).
4. name: "class_rank", label: "Class Rank" — The student's rank and class size (e.g., "15 of 320"). If only rank is shown, return just the rank with a warning that class size is unknown.
5. name: "graduation_year", label: "Graduation Year" — The expected or actual graduation year as a 4-digit integer.
6. name: "disciplinary_notes", label: "Disciplinary / Attendance Notes" — Any notes on absences, suspensions, or disciplinary actions. Return null if no such section exists.
7. name: "courses", label: "Courses and Grades" — Return as a JSON array containing EVERY course listed on the transcript. This is critical: do not omit any course. Each element is an object with these fields:
   - "name": full course name as printed (e.g., "AP Calculus BC", "English 101", "Honors Biology") — required string
   - "grade": letter grade earned (e.g., "A+", "A", "B+", "B", "C", "D", "F") — string or null if not shown; add a warning if grade is missing
   - "score": numeric score or points if shown on the transcript (e.g., 98, 87.5) — number or null if not shown
   - "term": semester or term when the course was taken (e.g., "Fall 2022", "Spring 2023", "2022-2023") — string or null if not shown
   - "level": course level designation (e.g., "AP", "IB", "Honors", "Regular", "Dual Enrollment") — infer from the course name prefix or transcript labels; return "Regular" if no special designation is apparent; null only if truly indeterminate

For the courses field, format the value as a JSON array (not a string). Confidence applies to the overall course list legibility. If a section of the transcript is blurry or cut off, add a warning on the courses field noting that some courses may have been missed.

Example courses value:
[
  {"name": "AP Calculus BC", "grade": "A+", "score": 98, "term": "Fall 2022", "level": "AP"},
  {"name": "English 101", "grade": "B+", "score": null, "term": "Spring 2023", "level": "Regular"},
  {"name": "Honors Biology", "grade": "A", "score": 94, "term": "Fall 2022", "level": "Honors"}
]
```

---

**Test result prompt (documentType = "test_result"):**

```
{{COMMON_PREFIX with documentType = "test_result"}}

First determine which exam this score report is for. Look for exam name, logo, or header text. Then extract the relevant fields below.

If this is an SAT score report, extract:
1. name: "sat_math", label: "SAT Math Score" — Integer, 200–800.
2. name: "sat_ebrw", label: "SAT Evidence-Based Reading & Writing Score" — Integer, 200–800.
3. name: "sat_total", label: "SAT Total Score" — Integer, 400–1600.
4. name: "sat_date", label: "SAT Test Date" — ISO 8601 date string (YYYY-MM-DD). If only month/year given, use the first of the month.

If this is an ACT score report, extract:
1. name: "act_english", label: "ACT English Score" — Integer, 1–36.
2. name: "act_math", label: "ACT Math Score" — Integer, 1–36.
3. name: "act_reading", label: "ACT Reading Score" — Integer, 1–36.
4. name: "act_science", label: "ACT Science Score" — Integer, 1–36.
5. name: "act_composite", label: "ACT Composite Score" — Integer, 1–36.
6. name: "act_date", label: "ACT Test Date" — ISO 8601 date string.

If this is an AP score report, extract one or more entries:
name: "ap_scores", label: "AP Exam Scores" — Array of objects: [{ "examName": "<string>", "score": <1–5 integer>, "date": "<YYYY-MM-DD>" }].

If this is an IB score report, extract:
name: "ib_scores", label: "IB Subject Scores" — Array of objects: [{ "subject": "<string>", "level": "HL or SL", "score": <1–7 integer>, "date": "<YYYY-MM-DD>" }].

If the exam type cannot be determined, extract:
name: "other_exam", label: "Other Exam Results" — Object: { "examName": "<string>", "results": "<string>", "date": "<YYYY-MM-DD or null>" }.

For all fields, apply the common rules (excerpt, confidence, warnings).
```

---

**Certificate/Achievement prompt (documentType = "certificate"):**

```
{{COMMON_PREFIX with documentType = "certificate"}}

Extract the following fields from this award, certificate, or honor document:

1. name: "award_name", label: "Award / Honor Name" — Full name of the award or recognition.
2. name: "issuing_organization", label: "Issuing Organization" — Name of the entity granting the award.
3. name: "date_awarded", label: "Date Awarded" — ISO 8601 date string. If only year is shown, return "<YYYY>-01-01" with a warning.
4. name: "award_category", label: "Category" — Best-fit category from this list ONLY: "academic", "sports", "arts", "community_service", "leadership", "stem", "other". Do NOT invent new categories.
5. name: "recipient_name", label: "Recipient Name" — The name of the student receiving the award as it appears on the document.

Note: Do NOT store recipient_name in the student profile (FERPA constraint). Extract it only so the student can verify this document belongs to them. The backend will discard this field before persisting.
```

---

**Activity/Participation prompt (documentType = "activity"):**

```
{{COMMON_PREFIX with documentType = "activity"}}

Extract the following fields from this activity participation document, letter, or certificate:

1. name: "activity_name", label: "Activity Name" — Full name of the club, sport, program, or activity.
2. name: "role", label: "Role" — The student's role (e.g., "Participant", "Team Captain", "President", "Volunteer"). If not stated, return null.
3. name: "organization", label: "Organization / School" — Name of the organizing body or school.
4. name: "hours_per_week", label: "Hours per Week" — Numeric value. If stated as a range (e.g., "5–8 hours"), return the lower bound as a number and add a warning. If not stated, return null.
5. name: "duration", label: "Duration / Date Range" — Free-text date range as it appears in the document (e.g., "September 2023 – June 2026"). If not stated, return null.
6. name: "date_start", label: "Start Date" — ISO 8601 date string parsed from duration, or null.
7. name: "date_end", label: "End Date" — ISO 8601 date string parsed from duration, or null if ongoing.
```

---

### How output maps to UI

Each element in the returned `fields` array maps directly to one row in the extraction review table:
- `label` → "Field Name" column
- `value` → "Extracted Value" column (displayed as-is; student can override)
- `confidence` → rendered as Bootstrap progress bar with color coding
- `excerpt` → "Source Excerpt" column (truncated to 120 chars with "show more")
- `warnings` → displayed below the excerpt as small amber text with `bi-exclamation-triangle` icon, followed by an "Ignore" button (`btn-sm btn-link text-muted`, Bootstrap icon `bi-eye-slash`) — clicking Ignore calls `PUT /api/documents/{documentId}/extraction-fields/{fieldName}` with `{ "ignoreWarning": "<warning text>" }` to suppress that specific warning string in the pending extraction file; the warning is removed from the UI immediately. Suppressed warnings are stored in the field's `ignoredWarnings: ["string"]` array in the extraction JSON.

### Fallback

If the Gemini API call fails (timeout, network error, or 5xx):
1. Backend returns HTTP 504 or 502 with `error.code = EXTRACTION_TIMEOUT` or `AI_EXTRACTION_FAILED`
2. Backend retries once with the same prompt (after a 2-second delay) before returning an error
3. Frontend replaces the spinner with an error state: "Could not analyze this document."
4. Two buttons are shown: "Try again" (re-calls POST /extract) and "Enter data manually" (opens a type-specific manual entry form for the document type)
5. Manual entry form pre-populates with empty fields and allows student to type values — saved via `POST /api/documents/{documentId}/review` with all `confirmedByStudent: true` and `confidence: 100` (student-asserted)

If the Gemini call succeeds but returns an empty `fields` array:
- Frontend shows the empty-extraction state described in Screen 2
- Student is offered the same "Enter data manually" path

---

## Enterprise checks

**Auth:** This story runs in a local desktop app with no multi-user authentication. All API endpoints are accessible without a session token (single-user local app). If a future auth layer is added, these endpoints must require a valid session. For now: no auth enforcement, but endpoints must validate that `documentId` exists in `DATA_DIR` to prevent path traversal. Document IDs and course/achievement/activity IDs are UUIDs; reject any path param containing `..`, `/`, or `\` with 400.

**Input validation (server-side):**

| Field | Rule |
|---|---|
| `documentId` (path param) | Must be a valid UUID (regex: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`). Reject with 400 otherwise. |
| `value` in PUT /extraction-fields | Must not be an empty string. Must not exceed 2000 characters. |
| `fields` array in POST /review | Must be an array. Each element must have `name` (non-empty string), `skipped` (boolean), `confirmedByStudent` (boolean). |
| Low-confidence fields in POST /review | Any field with `confidence < 70` in the pending extraction that is neither `skipped: true` nor `confirmedByStudent: true` is rejected with 422 `UNACKNOWLEDGED_LOW_CONFIDENCE`. |
| `name` in PUT/POST /api/profile/academic/course | Required. Non-empty string. Max 200 chars. |
| `score` in PUT/POST /api/profile/academic/course | Optional. Float 0–100 or null. Reject strings that cannot be parsed. |
| `level` in PUT/POST /api/profile/academic/course | Must be one of: "AP", "IB", "Honors", "Dual Enrollment", "Regular", "Other". Reject any other string. |
| `:id` in course PUT/DELETE | Must be a valid UUID. Reject with 400 otherwise. |

Client-side validation:
- Inline edit field: non-empty required; numeric type checked for score fields (SAT, ACT, GPA) — `isNaN(parseFloat(value))` check
- "Save to Profile" button disabled until all `<70%` confidence fields have been explicitly accepted or skipped in the modal

**Error states:**

| Failure | User sees |
|---|---|
| Gemini timeout | Spinner stops; error text + "Try again" + "Enter manually" buttons |
| Gemini 429 rate limit | Spinner continues for 5s; one automatic retry; if still 429, show "Processing queue is busy" with retry button |
| Gemini 5xx | Spinner stops; error text + retry + manual entry |
| Empty extraction | Table replaced with empty-extraction state + manual entry path |
| PUT field update fails | Inline error text below the edit input: "Could not save change. Please try again." |
| POST review (save) fails | Toast with danger color; student stays on review screen; button re-enabled |
| documentId path traversal | 400 returned; no error detail exposed; logged to audit log |
| PUT /api/profile/academic/course/:id validation error | Inline error below the relevant form field in Screen 7; form stays open |
| PUT /api/profile/academic/course/:id server error | Inline error below Save button: "Could not save. Please try again." |
| DELETE /api/profile/academic/course/:id server error | Inline error replaces delete confirmation: "Could not delete. Please try again." — original row restored |
| Course not found (404 on edit/delete) | Inline error: "This course no longer exists. Refresh the page." |

**Data safety:** Pending extraction is written to disk (`{documentId}.extraction.json`) immediately when extraction completes — before the response is sent to the browser. If the browser closes between extraction and review, the data is not lost. On next app load, the frontend calls `GET /api/documents/{documentId}/extraction-preview` for any document with `classified: true` but no corresponding profile section data — if a pending extraction exists, a recovery banner is shown.

If the browser closes mid-review after the student has edited some fields (PUT calls already made), those edits are persisted in the pending extraction file. The student sees their edits when they return.

If the browser closes after "Save to Profile" is clicked but before the POST /review response is received: the server may have already written the profile. On next load, the profile section will contain the saved data. The pending extraction file will have been deleted if save succeeded. If the save was incomplete (mid-write crash), the audit log entry will be absent — the frontend should check profile data existence to determine state. No duplicate-save guard is needed in v1 (student would simply see the data already populated).

**Rate limiting / abuse:** Gemini API calls are limited to 10 extraction requests per minute per the free tier guardrail from architecture.md. The backend tracks extraction call timestamps in memory (process-lifetime, not persisted). If the 10/minute limit is reached, the backend queues the request and returns a 429 with `error.message = "Too many requests. Please wait and try again."` The frontend shows a retry button; it does not auto-retry without user action (per architecture.md guardrail: "Never retry failed Gemini calls automatically without user consent"). Exception: the single automatic retry on first failure (see Fallback above) is the only automatic retry allowed.

**AI fallback:** If Gemini is unavailable, the student can complete the full task manually via the "Enter data manually" form. This form collects the same fields as the extraction taxonomy, allows student to type values, and saves via `POST /api/documents/{documentId}/review` with all fields set to `confirmedByStudent: true`, `confidence: 100`, and `excerpt: ""`. The profile is fully usable without any AI extraction.

---

## Acceptance criteria

1. Clicking "Next: Review and extract" on the classification result screen calls `POST /api/documents/{documentId}/extract` and displays the extraction-in-progress spinner with the message "Analyzing your document..."
2. On successful extraction, the review table renders with one row per extracted field, each showing: field name, extracted value, a Bootstrap progress bar colored green/yellow/red based on confidence threshold, and a source excerpt from the document
3. Fields with confidence ≥ 85 are shown in green and can be saved directly without additional confirmation
4. Fields with confidence 70–84 are shown in yellow; the "Save to Profile" button is disabled until the student has seen these rows (scrolled past or interacted with the table — tracked in JS by intersection observer or explicit "I've reviewed" acknowledgment)
5. Fields with confidence < 70 are shown in red; clicking "Save to Profile" opens the low-confidence modal listing all such fields; the modal requires the student to explicitly toggle "Accept" or "Skip" for each field before "Continue to save" is enabled
6. Clicking "Edit" on any field transforms the value cell into an editable input pre-filled with the current value; clicking "Save" in edit mode calls `PUT /api/documents/{documentId}/extraction-fields/{fieldName}` and updates the pending extraction file on disk
7. Clicking "Save to Profile" (after all low-confidence fields are handled) calls `POST /api/documents/{documentId}/review`; on success, the appropriate profile JSON section (academic.json, tests.json, achievements.json, or activities.json) contains all non-skipped fields with `value`, `confidence`, `source`, `excerpt`, and `confirmedByStudent` populated
8. Every persisted field includes the source document filename, upload timestamp, confidence score, and verbatim source excerpt — verifiable by reading the profile JSON file directly
9. If extraction returns an empty fields array, the review table is replaced with an empty-extraction error state offering "Re-upload document" and "Enter data manually" options
10. If Gemini times out (no response within 30 seconds), the spinner stops and the user sees "Extraction timed out" with "Try again" and "Enter manually" buttons — no silent failure
11. If the browser is closed after extraction completes but before saving, reopening the app and navigating to the document shows a recovery banner: "You have an unfinished review for [filename]. Continue?" — clicking it loads the full review screen with all previously edited field values intact
12. The pending extraction file (`{documentId}.extraction.json`) is deleted from disk upon successful `POST /review` response — confirmed by verifying the file no longer exists after save
13. Fields with `skipped: true` are absent from the saved profile JSON — they are not written as null, they are simply omitted
14. Manually entered values (via "Enter data manually" form) are saved with `confirmedByStudent: true`, `confidence: 100`, and `excerpt: ""` — and are indistinguishable in structure from AI-extracted confirmed fields
15. Clicking the trash icon next to a field row calls `DELETE /api/documents/{documentId}/extraction-fields/{fieldName}`; the row is removed from the review table immediately; the field is not included when "Save to Profile" is submitted; `deleted: true` is present in the pending extraction JSON
16. Clicking "Ignore" on a warning suppresses that warning string from the UI and calls `PUT /api/documents/{documentId}/extraction-fields/{fieldName}` with `{ ignoreWarning: "..." }`; the warning does not re-appear on browser reload because `ignoredWarnings` is persisted in the extraction file
17. After "Save to Profile" succeeds, the dashboard and profile sections correctly show the saved data — SAT scores display as integers (e.g., "1540"), not as `[object Object]`; achievements and activities sections show item titles; academic section shows GPA value
18. SAT data saved to tests.json has the shape `sat.score.{ math, ebrw, total }` and `sat.dateTaken` (ISO 8601 string) — verifiable by reading tests.json directly after save
19. Class rank saved to academic.json has the shape `classRank.{ rank: <integer>, classSize: <integer or null> }` — verifiable by reading academic.json directly after save
20. Each achievement saved to achievements.json has both `awardName` and `title` fields set to the same string, and a `description` field containing a human-readable summary
21. Each activity saved to activities.json has both `activityName` and `title` fields set to the same string, and a `description` field containing a human-readable summary
22. The extraction review screen is reachable via the SPA hash route `#review/{documentId}` without a full page reload; the SPA router renders the review content in the main content area
23. If a field value fails type transformation during POST /review (e.g., GPA cannot be parsed as a number), the response includes a non-empty `transformWarnings` array naming the field; the save succeeds for all other fields; the UI shows a warning message listing which fields were not saved
24. The Gemini transcript extraction prompt returns a `courses` field as a JSON array containing every course listed on the transcript; each element has `name`, `grade`, `score`, `term`, and `level` fields; no courses are omitted; if grade or score is absent for a course that row shows null with a warning rather than being skipped
25. Course `level` is populated for every course row — "AP", "IB", "Honors", "Dual Enrollment", "Regular", or null only when truly indeterminate; it is never an empty string
26. The saved `academic.json` `courses` array preserves all five fields (`name`, `grade`, `score`, `term`, `level`) for every course; a spot-check against the source transcript must show zero courses missing from the saved array
27. `academic.json` contains an `apIbScores` field initialized as an empty array `[]` when first created from transcript extraction; it is never null and never omitted from the file
28. The extraction review screen shows an "AP / IB Exam Scores" informational row with the label and the message "(none yet — add via manual entry or upload your AP/IB score report)"; this row has no confidence bar and no trash icon — it is display-only
29. Dashboard section tiles (academics, tests, achievements, activities, impact statements, essays) are rendered as clickable `<a>` elements with `cursor: pointer`; clicking anywhere on the tile navigates to the corresponding `#section/[name]` hash route without a full page reload
30. There is no separate "[View All]" button on any dashboard section tile; the entire card is the navigation target
31. Dashboard tiles are keyboard-navigable: Tab selects a tile, Enter activates navigation; each tile carries `aria-label="Go to [section name]"` on its wrapping element
32. Every course saved to `academic.json` from extraction has an `id` field (UUID), and a `source` object with `{ type: "extracted", documentId, documentName, extractedAt }` — verifiable by reading the JSON file after save
33. The Academics detail page (`#section/academics`) renders a courses list; each course row displays a source badge — "From [documentName]" for extracted courses and "Manually added" for manual entries — sourced from `source.documentName`
34. Clicking [Edit] on a course row in the Academics detail page opens an inline form pre-filled with the course's name, grade, score, term, and level; clicking Save calls `PUT /api/profile/academic/course/:id` and the row updates in place with the new values
35. Editing an extracted course does not change the source badge — the source metadata is preserved in the JSON after PUT
36. Clicking [Delete] on a course row shows an inline confirmation prompt; confirming calls `DELETE /api/profile/academic/course/:id`; the row is removed from the list immediately; a "Course deleted." toast appears
37. Clicking Cancel on the delete confirmation restores the original course row without any API call
38. Adding a course via "Add course manually" calls `POST /api/profile/academic/course`; the new course appears at the bottom of the list with a "Manually added" source badge; the item in `academic.json` has `source.type = "manual"` and `confidence: 100`
39. Every achievement saved from extraction has an `id` (UUID) and a `source` object; the Achievements list page shows a source badge per item consistent with the badge rules in Screen 8
40. Every activity saved from extraction has an `id` (UUID) and a `source` object; the Activities list page shows a source badge per item consistent with the badge rules in Screen 8
41. Editing an extracted achievement or activity via STORY-001 edit forms does not remove or overwrite the `source` field — reading the JSON after edit shows `source` intact with `type: "extracted"`
42. A `PUT /api/profile/academic/course/:id` request with an empty `name` field returns 422 with `error.code = "VALIDATION_ERROR"` and `error.message = "Course name is required"` — the inline form shows this error below the name field
43. A `DELETE /api/profile/academic/course/:id` request for a non-existent course returns 404; the UI shows "This course no longer exists. Refresh the page."

---

## Known risks

1. **Hallucination** — Gemini invents a GPA or test score not visible in the document. Mitigation: every field requires a non-empty `excerpt`; backend validates that `excerpt` is present for any field with `confidence >= 70`; if excerpt is missing for a high-confidence field, confidence is overridden to 50 server-side and a warning is added. Test suite: 5 real sample documents, manual verification that GPA and test score fields match document text with 100% accuracy required before shipping.

2. **OCR misreads** — Blurry text leads to wrong extraction (e.g., "3.50" read as "3.5O"). Mitigation: Gemini prompt instructs model to flag OCR ambiguities in `warnings`; student sees the excerpt and can spot misreads; "Edit" is always available; manual entry is always available as fallback.

3. **Gemini timeouts on large documents** — A 20-page transcript with dense tables may exceed 30 seconds. Mitigation: 30-second timeout enforced on the backend `fetch` call to Gemini; on timeout, backend retries once; if still timeout, returns 504 and student is offered manual entry. Architecture preference: "document upload → AI extraction in <30 seconds" — flag if consistently exceeded.

4. **Rate limiting** — Gemini free tier limits may be hit if student uploads multiple documents rapidly. Mitigation: backend tracks request count in memory; if limit reached, returns 429 immediately rather than forwarding to Gemini; student sees queued message; manual retry required (no automatic retry without user action per architecture guardrail).

5. **Data loss on browser close** — Student edits fields, closes browser before clicking Save. Mitigation: each "Edit → Save" action calls `PUT /extraction-fields/{fieldName}` immediately, persisting to the pending extraction file on disk. As long as individual field edits are saved before browser close, data is preserved and recoverable.

6. **Profile field merge conflicts** — Student extracts from two transcripts; both write to `academic.json`. Mitigation: fields are written with source document name; if a field already exists in the profile JSON (e.g., `gpa_overall` already set from a prior extraction), the backend appends the new extraction as an additional source entry under `gpa.sources[]` rather than overwriting. The UI shows multiple source values and asks the student which to use as canonical. (Implementation detail: `academic.json` gpa field becomes `{ canonical: {...}, sources: [{...}, {...}] }` if more than one source exists — the build agent must implement this merge strategy.)

---

## Change history

| Release | Date | Summary | Type |
|---|---|---|---|
| 1.0.0 | 2026-06-14 | Initial spec written | feature |
| 1.0.0 | 2026-06-14 | Bug-fix pass: add delete/ignore-warning UX, fix data persistence (tests.json flat value bug, empty achievements/activities), define field mapping transformation table, add SPA routing integration, add 10 new acceptance criteria | fix |
| 1.0.0 | 2026-06-14 | Comprehensive course extraction: courses array now captures grade, score, term, and level for every course; TRANSCRIPT_PROMPT updated accordingly | feature |
| 1.0.0 | 2026-06-14 | Add apIbScores field to academic.json: empty array initialized on extraction, display-only template row in review screen, manual-entry shape documented | feature |
| 1.0.0 | 2026-06-14 | Card-as-link UX: dashboard section tiles are now full-card <a> links; remove [View All] button; add cursor:pointer, aria-label, keyboard nav; 3 acceptance criteria added | feature |
| 1.1.2 | 2026-06-14 | Bug-fix pass: add full CRUD for extracted courses (PUT/DELETE/POST /api/profile/academic/course/:id), source tracking (source object with type/documentId/documentName/extractedAt on courses, achievements, activities), id field on all array items, source badges on Academics/Achievements/Activities detail pages, Screens 6–8, 12 new acceptance criteria | fix |
