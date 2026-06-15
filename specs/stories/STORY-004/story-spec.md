---
story_id: STORY-004
title: "Impact statement generation and refinement"
depends_on:
  - STORY-003
spec_done: true
---

## What the user can do

- User can open the Impact Statements tile on the dashboard, click [Generate], pick an achievement, and work through a 4-step guided questionnaire flow — answering clarifying questions, previewing AI reasoning, receiving a draft, and saving or refining — so that the final statement reflects their own words and intentions rather than an opaque AI output.
- User can answer up to 5 optional guided questions about an achievement (role, challenge, growth, importance, impact), preview a summary of what the AI will emphasize before any text is generated, and choose to adjust their answers before committing to generation.
- User can receive an AI-generated draft that shows its own reasoning ("I emphasized X because you mentioned Y and your profile shows Z"), then edit the draft inline, regenerate it, or go back and adjust their questionnaire answers to steer a new generation.
- User can save a completed statement, then later edit it directly, restart the questionnaire for a fresh generation, or delete it entirely — all from the impact-statements details page.
- User can navigate the Impact Statements details page to see all saved statements with metadata (dates, source, edit history) and manage them without leaving the page.

---

## Screens and states

### Screen 1 — Dashboard tile: Impact Statements

**Entry point:** Main dashboard (`/index.html`), loaded automatically when the app opens.

**Empty state (no achievements in profile at all):**
```
+--------------------------------------------+
| Impact Statements             [bi-lightning]|
| ------------------------------------------ |
|   No impact statements yet.                 |
|   Add achievements or activities first,     |
|   then generate drafts here.                |
|                                             |
|   [Generate]   (disabled, grey)             |
+--------------------------------------------+
```
The [Generate] button is disabled with tooltip: "Add at least one achievement or activity first."

**Populated state (achievements exist, statements may or may not exist):**
```
+--------------------------------------------+
| Impact Statements             [bi-lightning]|
| ------------------------------------------ |
|   2 statements saved                        |
|   1 achievement remaining                   |
|                                             |
|   [Generate]   (active when remaining > 0)  |
+--------------------------------------------+
```
Summary line format: `{n} statement{s} saved`. Second line `{n} achievement{s} remaining` shown only when remaining > 0.

**Card-link behaviour:**
- The entire card is wrapped in an `<a>` (or `<div role="link">`) that navigates to `/impact-statements` via `history.pushState`.
- On hover: `cursor: pointer` and `box-shadow: 0 4px 12px rgba(0,0,0,0.12)`.
- `aria-label="View all impact statements"` on the card element.
- `tabindex="0"` so the card is Tab-reachable.
- `keydown` handler: Enter triggers navigation.
- The [Generate] button inside the card calls `event.stopPropagation()` so clicking it does not also navigate.

**Actions:**
- Click card body (anywhere except [Generate]) → navigates to `/impact-statements` (Screen 6).
- [Generate] → opens Screen 2 (achievement picker modal).

---

### Screen 2 — Achievement picker modal

**Entry point:** Clicking [Generate] on the dashboard tile or [Generate New Statement] on the details page.

**What it displays:**
- Modal title: "Choose an achievement to write about"
- Subtitle: "Select one achievement or activity. We'll guide you through a few questions to shape the statement."
- List of achievements that do NOT yet have an impact statement, fetched from `GET /api/impact-statements/available`.
- Each row: [radio button] [achievement name] — [category badge] [short description truncated to 80 chars].
- [Start Questionnaire] button (disabled until a radio is selected).
- [Cancel] button.

**Empty state (all achievements already have statements):**
```
+-----------------------------------------------+
|  Choose an achievement to write about          |
|  ------------------------------------------   |
|  All achievements have impact statements.      |
|  You can edit existing ones from the list.     |
|                                                |
|  [View All Statements]    [Close]              |
+-----------------------------------------------+
```

**Error state (fetch fails):**
- Inline alert: "Could not load achievements. Check your data directory is accessible."
- [Retry] button re-calls the endpoint.
- [Close] dismisses modal.

**Actions:**
- Select radio → enables [Start Questionnaire].
- Click [Start Questionnaire] → closes modal, opens Screen 3 (questionnaire) with the selected achievement.
- Click [Cancel] → dismisses modal, returns to dashboard.

---

### Screen 3 — Step 1: Clarifying Questions

**Entry point:** After selecting an achievement in Screen 2 and clicking [Start Questionnaire].

**Layout:**
```
[Back to Dashboard]

Step 1 of 4 — Tell us about this experience
Achievement: Robotics Team Captain  (Extracurricular Activity · 6 hrs/wk · 2 years)

+-----------------------------------------------------------+
|  These questions are optional. Answer as much or as       |
|  little as you like — the more detail you give, the       |
|  more specific your statement will be.                    |
+-----------------------------------------------------------+

1. What was your role or biggest contribution?
   [Textarea — placeholder: "e.g., I led the mechanical design team..."]

2. What challenge did you face, and how did you overcome it?
   [Textarea — placeholder: "e.g., Our robot kept failing under load..."]

3. What did you learn or how did you grow?
   [Textarea — placeholder: "e.g., I discovered I work best when..."]

4. Why was this important to you personally?
   [Textarea — placeholder: "e.g., Robotics was the first place I felt..."]

5. What impact did it have — on you, your team, or others?
   [Textarea — placeholder: "e.g., We placed 3rd regionally and..."]

[Preview AI Reasoning]          [Generate Draft →]
```

**Notes:**
- All 5 answer fields are optional — no validation required on this screen.
- Each textarea: no character limit enforced here; maxlength attribute set to 500 chars per field.
- Progress indicator at top: "Step 1 of 4" displayed as a Bootstrap progress bar at 25%.
- The achievement name, category, hours/week, and duration are shown in a summary bar at the top for reference; these are read-only from achievements.json.

**[Preview AI Reasoning] button:**
- Does NOT advance to Step 2.
- Opens a side panel or small modal (not a new screen) showing what the AI has extracted so far from the profile for this achievement, and a live preview of what focus areas it would currently emphasize based on the answers entered so far.
- Panel title: "Here's what I'll focus on — based on your answers so far"
- If no answers filled yet: panel shows "Fill in at least one answer to see a reasoning preview."
- Calling: `POST /api/impact-statements/preview-reasoning` (see Data section).
- [Close] dismisses the panel; student continues editing their answers.

**[Generate Draft] button:**
- Proceeds to Step 2 (Screen 4) without first showing the preview — student can choose to preview or skip straight to generation.
- Sends all answers (even empty ones) to the next step.

**States:**
- Loading state: not applicable (no AI call on this screen until [Preview AI Reasoning] is clicked).
- Preview loading: side panel shows spinner while `POST /api/impact-statements/preview-reasoning` is in flight.
- Preview error: panel shows "Could not generate preview. Try again." with a [Retry] button.

---

### Screen 4 — Step 2: Preview AI Reasoning

**Entry point:** Clicking [Generate Draft] from Screen 3, OR clicking [Review Before Generating] from within the reasoning preview panel.

**Layout:**
```
[← Back: Edit Answers]

Step 2 of 4 — Review what I'll focus on

Achievement: Robotics Team Captain

Profile data I'll use:
  • Name: Robotics Team Captain
  • Category: Extracurricular Activity
  • Duration: 2 years · 6 hrs/week
  • Description: "Led a team of 8 students in regional competition"
  • Role: Captain (from achievements.json)

What you told me:
  • Your role: "I led the mechanical design team and made final calls on build decisions"
  • Challenge: "Our robot kept failing under load — I spent 3 nights debugging the drivetrain"
  • Growth: "I discovered I work best under pressure with clear stakes"
  • [empty fields shown as: (not answered)]

I will emphasize:
  • Your decision-making as team captain under pressure
  • The specific debugging challenge and how you resolved it
  • Personal growth through a high-stakes environment
  • (Impact and personal importance were not answered — less focus there)

[← Go Back to Edit Answers]       [Generate Draft →]
```

**Notes:**
- "Profile data I'll use" is populated server-side at the time of this preview and reflects what will actually be sent to Gemini.
- "What you told me" shows each question label and the student's answer. Unanswered fields show `(not answered)` in grey italic.
- "I will emphasize" is a short list of 2–4 bullets generated by the server based on which answers are non-empty and what profile data is available. These bullets are pre-computed, not a second Gemini call — derived by simple rules: non-empty answers → include as a focus area; profile fields present → note them.
- Progress bar: 50%.
- [Go Back to Edit Answers] returns to Screen 3 with all previously entered answers preserved (passed via in-memory state in app.js; no round-trip to server needed).
- [Generate Draft] calls `POST /api/impact-statements/generate` and advances to Screen 5.

**States:**
- This screen is rendered server-side when `POST /api/impact-statements/preview-reasoning` is called (or constructed client-side from the answers + achievement data already in memory).
- No spinner on this screen — all data is available before the student arrives here.
- If student has answered zero questions: the "I will emphasize" section shows: "You haven't answered any questions yet. The statement will be based on your profile data alone. Consider going back and adding at least one answer for a more personal statement."
- [Generate Draft] is always enabled (even with zero answers) — the student can proceed with profile-only generation.

---

### Screen 5 — Step 3: Draft Statement

**Entry point:** After clicking [Generate Draft] from Screen 4. `POST /api/impact-statements/generate` is called.

**Layout (generating — spinner state):**
```
[← Back to Dashboard]

Step 3 of 4 — Your Draft

Generating your statement...  [spinner]
This takes about 5–10 seconds.

[Cancel]
```

**Layout (draft ready):**
```
[← Back to Dashboard]

Step 3 of 4 — Your Draft
Achievement: Robotics Team Captain

+------------------------------------------------------------------+
|  AI-generated draft                          [bi-robot]          |
|  This is a starting point — rewrite it in your own words.        |
|  ---------------------------------------------------------------- |
|  "Leading eight teammates through months of late-night sessions  |
|   taught you something no competition rulebook prepares you for: |
|   the moment when your design decision is the last variable left.|
|   You spent three nights debugging the drivetrain because you     |
|   were the one who chose the motor. That weight — knowing the    |
|   fix had to come from you — is where you found out what         |
|   captaining actually means."                                     |
|                                                                   |
|  Generated based on: your role as captain, the debugging         |
|  challenge you described, profile data (8 teammates, 2 years)    |
+------------------------------------------------------------------+

Your statement:  (edit below — this is what gets saved)
+------------------------------------------------------------------+
|  [Textarea — pre-filled with AI draft above, fully editable]     |
|  Character count: 0 / 1000                                       |
+------------------------------------------------------------------+

[Edit Draft inline]   [Regenerate]   [Adjust Answers]   [Save As Is]   [Discard]
```

**Button behaviours:**
- [Edit Draft inline]: focuses the textarea; changes button label to [Done Editing].
- [Regenerate]: calls `POST /api/impact-statements/generate` again with the same `achievementId` and `answerSheet`. Spinner shown in the AI draft card while in-flight. Textarea is NOT cleared — student's edits are preserved. On success: AI draft card text updates; textarea is NOT overwritten. Student must manually copy from draft card if desired.
- [Adjust Answers]: navigates back to Screen 3 with all answers pre-filled from the current session. Textarea edits are discarded (not saved). A confirmation dialog appears: "Going back will discard your current draft edits. Continue?" [Yes, Go Back] | [Stay Here].
- [Save As Is]: saves the current textarea content without modification. Same save flow as below.
- [Discard]: shows inline confirmation: "Discard this draft? Your answers and draft will be lost." [Yes, Discard] | [Keep Working]. On confirm: returns to Screen 2 (achievement picker modal); no data saved.

**Save flow (triggered by [Save As Is] or after inline edit):**
- Validates textarea: not empty (1 char min after trim), not over 1000 chars.
- Empty: inline error below textarea — "Statement cannot be empty."
- Too long: inline error — "Statement is too long (max 1000 characters)."
- Valid: calls `POST /api/impact-statements/save`.
- On success: Bootstrap toast (bottom-right): "Impact statement saved." Redirects to Screen 6 (details list) after 1.5 seconds.
- On error: toast (danger): "Save failed. Check your data directory and try again." Textarea content preserved.

**Generation error state:**
- AI draft card shows: "Draft generation failed. You can still write your own statement below."
- [Regenerate] button remains active.
- Textarea is enabled and empty.
- [Save As Is] is still functional (student writes from scratch).

**Progress bar:** 75%.

---

### Screen 6 — Impact Statements details page (Step 4: Refinement)

**Entry point:** Clicking anywhere on the Impact Statements dashboard card (card-link), after saving a statement, or after deleting all statements.

**SPA route:** `/impact-statements`
- Activated via `history.pushState('/impact-statements', '', '/impact-statements')`.
- Dashboard section hidden, impact-statements section shown. No full-page reload.
- `window.onpopstate` restores dashboard view when URL returns to `/`.
- Express catch-all route serves `index.html` for any GET not matching `/api/`, so direct navigation to `http://localhost:3000/impact-statements` works.

**Layout (statements exist):**
```
[bi-arrow-left Back to Dashboard]

Impact Statements
[+ Generate New Statement]   (shown only when remaining achievements > 0)

+-------------------------------------------------------------------+
| Robotics Team Captain                   Extracurricular Activity  |
| Created: Jun 14, 2026 · Last edited: Jun 14, 2026 10:35 AM       |
| Generated from: 3 of 5 questions answered                         |
| "Leading eight teammates through months of late-night sessions    |
|  taught you something no competition rulebook prepares you..."    |
|                                                                   |
|   [bi-pencil Edit]  [bi-arrow-repeat Regenerate with New Answers]  [bi-trash Delete]|
+-------------------------------------------------------------------+
| AP Chemistry Project                    Academic                  |
| Created: Jun 12, 2026 · Last edited: Jun 14, 2026 09:00 AM       |
| Generated from: profile data only                                 |
| "When your hypothesis turned out wrong, you spent three days..."  |
|                                                                   |
|   [bi-pencil Edit]  [bi-arrow-repeat Regenerate with New Answers]  [bi-trash Delete]|
+-------------------------------------------------------------------+
```

**"Generated from" line rules:**
- Count of non-empty answers provided: "{n} of 5 questions answered" if n > 0.
- If no answers were provided: "profile data only".
- If statement was written from scratch (aiGenerated: false): "written manually".

**Statement preview:** truncated to 200 chars at the last word boundary before 200 chars, appended with "...".

**Date format:** `MMM D, YYYY h:mm A` (e.g., `Jun 14, 2026 10:35 AM`).

**Button behaviours on each card:**
- [Edit]: expands the card inline (Screen 7 behaviour, below).
- [Regenerate with New Answers]: opens Screen 3 with the same achievement pre-selected and the last `answerSheet` pre-filled (loaded from the statement record). Asks for confirmation: "This will start a new draft. Your current statement is preserved until you save a new one." [Continue] | [Cancel].
- [Delete]: shows inline confirmation row replacing action buttons: "Delete this statement? [Confirm Delete] [Cancel]". On confirm: calls `DELETE /api/impact-statements/{id}`, removes card from DOM, shows toast "Statement deleted." On cancel: restores [Edit] [Regenerate with New Answers] [Delete] buttons.

**Empty state:**
```
+-------------------------------------------------------------------+
|  No impact statements saved yet.                                  |
|  [Generate New Statement]                                         |
+-------------------------------------------------------------------+
```

**[Generate New Statement] button:**
- Shown only when `available.length > 0`.
- Opens Screen 2 (achievement picker modal).
- Hidden (not disabled) when all achievements have statements.

---

### Screen 7 — Inline edit on details page

**Entry point:** Clicking [Edit] on any card in Screen 6.

**Behaviour:** Inline expansion — the card expands in place. URL does not change.

**Expanded card layout:**
```
+-------------------------------------------------------------------+
| Editing: Robotics Team Captain          Extracurricular Activity  |
| Created: Jun 14, 2026 · Last edited: Jun 14, 2026 10:35 AM       |
| +---------------------------------------------------------------+ |
| | [Textarea — pre-filled with full saved text, fully editable]  | |
| | Character count: 247 / 1000                                   | |
| +---------------------------------------------------------------+ |
|                                [Save Changes]  [Cancel]           |
+-------------------------------------------------------------------+
```

- No AI draft card shown (editing existing statement, not generating).
- Textarea pre-filled with full saved text (not truncated).
- Character count updates live.
- Only one card in edit mode at a time. If [Edit] is clicked on a second card while one is open, the current card collapses (discards edits) before expanding the new one.
- [Save Changes] disabled when textarea text is unchanged from saved value.
- Validation: same as Screen 5 (empty blocked, over 1000 chars blocked, inline errors).
- [Save Changes]: calls `PUT /api/impact-statements/:id`. On success: collapses card, updates displayed text in-place, updates "Last edited" timestamp, shows toast "Statement updated."
- [Cancel]: collapses card, restores original text. No API call.

---

## Data and backend

### Data entities

**File:** `/DATA_DIR/profile/impact_statements.json`

**Schema:**
```json
{
  "schemaVersion": "2.0.0",
  "lastUpdated": "2026-06-14T10:30:00.000Z",
  "data": {
    "statements": [
      {
        "id": "string (UUID v4, system-generated)",
        "linkedAchievementId": "string (UUID v4, references achievements.json)",
        "linkedAchievementName": "string (denormalized copy at generation time — max 200 chars)",
        "linkedAchievementCategory": "string (one of the category enum values below)",
        "statement": "string (student's final saved text — required, 1–1000 chars)",
        "aiDraft": "string (original AI-generated text — stored for audit; null if student wrote from scratch)",
        "aiGenerated": "boolean (true if AI generation was called; false if student wrote entirely manually)",
        "editedByStudent": "boolean (true if statement differs from aiDraft at time of save)",
        "generatedFrom": {
          "studentAnswers": {
            "role": "string or null",
            "challenge": "string or null",
            "growth": "string or null",
            "importance": "string or null",
            "impact": "string or null"
          },
          "profileDataUsed": ["array of strings — field names from achievements.json that were included in the prompt"],
          "focusAreas": ["array of strings — the 'I will emphasize' bullets from Step 2"]
        },
        "editHistory": [
          {
            "editedAt": "ISO 8601 datetime",
            "previousText": "string (the statement text before this edit)"
          }
        ],
        "reasoning": "string (the 'Generated based on' explanation text returned by Gemini — stored as-is)",
        "createdAt": "ISO 8601 datetime (system-generated)",
        "lastEditedAt": "ISO 8601 datetime (updated on every save/update)"
      }
    ]
  }
}
```

**Field validation rules:**
- `id`: UUID v4, required, system-generated, never user-supplied.
- `linkedAchievementId`: UUID v4, required, must reference a valid entry in achievements.json at save time. If achievement is later deleted, statement is orphaned but not auto-deleted.
- `linkedAchievementName`: string, required, max 200 chars, copied from achievements.json at generation time.
- `linkedAchievementCategory`: string, required, one of: `"Academic"`, `"Extracurricular Activity"`, `"Award"`, `"Test Score"`, `"Other"`.
- `statement`: string, required, min 1 char after trim, max 1000 chars.
- `aiDraft`: string or null, stored as-is from Gemini response.
- `aiGenerated`: boolean, required.
- `editedByStudent`: boolean, required; true if `statement` !== `aiDraft` at save time.
- `generatedFrom.studentAnswers`: object, required; all 5 fields present; value is string (may be empty string) or null if field was not answered.
- `generatedFrom.profileDataUsed`: array of strings, required; may be empty array.
- `generatedFrom.focusAreas`: array of strings, required; may be empty array.
- `editHistory`: array, required, initialized as `[]` on create; each entry appended on every PUT update.
- `reasoning`: string or null; stored from Gemini response; null if generation failed or student wrote manually.
- `createdAt`: ISO 8601, system-generated.
- `lastEditedAt`: ISO 8601, system-generated on every save and update.

**Source data read at generation time (from achievements.json — established by STORY-003, read-only in this story):**
```json
{
  "id": "uuid",
  "name": "Robotics Team Captain",
  "category": "Extracurricular Activity",
  "description": "Led a team of 8 students in regional competition.",
  "startYear": 2024,
  "endYear": 2026,
  "role": "Captain",
  "hoursPerWeek": 6
}
```

---

### API endpoints

All responses use the standard envelope:
```json
{
  "success": true | false,
  "data": { ... } | null,
  "error": null | { "code": "ERROR_CODE", "message": "Human-readable message" },
  "timestamp": "ISO 8601"
}
```

---

#### GET /api/impact-statements/available

Returns achievements without a saved statement and a summary of those that do.

**Request:** No body, no params.

**Response (HTTP 200):**
```json
{
  "success": true,
  "data": {
    "available": [
      {
        "id": "uuid-achievement-1",
        "name": "Robotics Team Captain",
        "category": "Extracurricular Activity",
        "description": "Led a team of 8 students...",
        "role": "Captain",
        "hoursPerWeek": 6,
        "yearsInvolved": 2
      }
    ],
    "alreadyHaveStatements": [
      {
        "id": "uuid-achievement-2",
        "name": "AP Chemistry Project",
        "statementId": "uuid-statement-2"
      }
    ],
    "totalAchievements": 3,
    "totalStatements": 1
  },
  "error": null,
  "timestamp": "..."
}
```

**Error cases:**
- `achievements.json` unreadable → HTTP 500, code `FILE_READ_ERROR`, message "Could not read achievements data."
- `impact_statements.json` unreadable → HTTP 500, code `FILE_READ_ERROR`, message "Could not read impact statements data."

---

#### POST /api/impact-statements/preview-reasoning

Computes what the AI will focus on, given the student's current answers and the achievement profile data. Does NOT call Gemini — purely server-side computation.

**Request body:**
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

**Validation:**
- `achievementId`: required, UUID v4, must exist in achievements.json.
- `studentAnswers`: required object; all 5 keys required; values are strings (empty string is valid).

**Server behaviour:**
1. Read achievement from achievements.json.
2. Identify which profile fields are present and non-empty.
3. Identify which student answer fields are non-empty.
4. Derive focus areas using this rule: for each non-empty answer field, add a focus area bullet; for achievement profile fields (role, hoursPerWeek, description), note them as "profile data used."
5. Return structured preview. No Gemini call.

**Response (HTTP 200):**
```json
{
  "success": true,
  "data": {
    "achievementName": "Robotics Team Captain",
    "profileDataUsed": [
      "Name: Robotics Team Captain",
      "Category: Extracurricular Activity",
      "Duration: 2 years · 6 hrs/week",
      "Description: Led a team of 8 students in regional competition",
      "Role: Captain"
    ],
    "answersReceived": {
      "role": "I led the mechanical design team and made final calls on build decisions",
      "challenge": "Our robot kept failing under load...",
      "growth": "",
      "importance": "",
      "impact": ""
    },
    "focusAreas": [
      "Your decision-making as team captain under pressure",
      "The specific debugging challenge and how you resolved it",
      "Profile data: 8 teammates, 2 years, 6 hrs/week"
    ],
    "unansweredCount": 3
  },
  "error": null,
  "timestamp": "..."
}
```

**Error cases:**
- `achievementId` missing → HTTP 400, code `MISSING_FIELD`, message "achievementId is required."
- `achievementId` not found → HTTP 404, code `ACHIEVEMENT_NOT_FOUND`, message "Achievement not found."
- `studentAnswers` missing or not an object → HTTP 400, code `MISSING_FIELD`, message "studentAnswers is required."

---

#### POST /api/impact-statements/generate

Calls Gemini to generate a draft impact statement using the student's answers and profile data.

**Request body:**
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

**Validation:**
- `achievementId`: required, UUID v4, must match an entry in achievements.json.
- `studentAnswers`: required object; all 5 keys required; empty strings are valid.

**Server behaviour:**
1. Read achievement data from achievements.json.
2. Call `POST /api/impact-statements/preview-reasoning` logic internally to derive `profileDataUsed` and `focusAreas` (no external HTTP call — shared function).
3. Build prompt (see AI Integration section).
4. Call Gemini API with 30-second timeout.
5. Parse response: extract `statement`, `reasoning`, `confidence`, `focusAreas` from JSON response.
6. Return structured result.

**Response (HTTP 200):**
```json
{
  "success": true,
  "data": {
    "achievementId": "uuid-achievement-1",
    "achievementName": "Robotics Team Captain",
    "draft": "Leading eight teammates through months of late-night sessions...",
    "reasoning": "Generated based on: your role as captain, the debugging challenge you described, profile data (8 teammates, 2 years)",
    "confidence": 87,
    "focusAreas": [
      "Decision-making as team captain under pressure",
      "Specific debugging challenge and resolution"
    ],
    "wordCount": 147,
    "profileDataUsed": [
      "Name: Robotics Team Captain",
      "Duration: 2 years · 6 hrs/week",
      "Role: Captain"
    ]
  },
  "error": null,
  "timestamp": "..."
}
```

**Error cases:**
- `achievementId` missing → HTTP 400, code `MISSING_FIELD`, message "achievementId is required."
- `achievementId` not found → HTTP 404, code `ACHIEVEMENT_NOT_FOUND`, message "Achievement not found."
- `studentAnswers` missing → HTTP 400, code `MISSING_FIELD`, message "studentAnswers is required."
- Gemini timeout (>30s) → HTTP 504, code `AI_TIMEOUT`, message "Draft generation timed out. Try again."
- Gemini API error → HTTP 502, code `AI_ERROR`, message "Draft generation failed. You can still write your own statement."
- Gemini response fails word-count validation (< 50 words) → HTTP 502, code `AI_ERROR`, message "Generated draft was too short. Try regenerating."
- Rate limit exceeded → HTTP 429, code `RATE_LIMITED`, message "Too many requests. Please wait a moment and try again."

---

#### POST /api/impact-statements/save

Saves a new impact statement. Creates `impact_statements.json` if it does not exist.

**Request body:**
```json
{
  "achievementId": "uuid-v4",
  "statement": "Student's final text (1–1000 chars)",
  "aiDraft": "The original AI-generated draft text, or null",
  "aiGenerated": true,
  "editedByStudent": true,
  "generatedFrom": {
    "studentAnswers": {
      "role": "string or empty string",
      "challenge": "string or empty string",
      "growth": "string or empty string",
      "importance": "string or empty string",
      "impact": "string or empty string"
    },
    "profileDataUsed": ["array of strings"],
    "focusAreas": ["array of strings"]
  },
  "reasoning": "string or null"
}
```

**Validation (server-side):**
- `achievementId`: required, UUID v4, must exist in achievements.json.
- `statement`: required, string, min 1 char after trim, max 1000 chars.
- `aiDraft`: optional, string or null.
- `aiGenerated`: required, boolean.
- `editedByStudent`: required, boolean.
- `generatedFrom`: required object with `studentAnswers` (object, all 5 keys), `profileDataUsed` (array), `focusAreas` (array).
- `reasoning`: optional, string or null.
- Duplicate check: if a statement already exists for this `achievementId`, return HTTP 409.

**Server behaviour:**
1. Validate all fields.
2. Check for duplicate.
3. Read existing `impact_statements.json` or create empty structure.
4. Acquire file lock.
5. Append new statement record with UUID, timestamps, empty `editHistory`.
6. Write file, release lock.
7. Append to audit log: action `impact_statement_created`.

**Response (HTTP 201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid-new-statement",
    "achievementId": "uuid-achievement-1",
    "achievementName": "Robotics Team Captain",
    "createdAt": "2026-06-14T10:30:00.000Z"
  },
  "error": null,
  "timestamp": "..."
}
```

**Error cases:**
- Duplicate: HTTP 409, code `DUPLICATE_STATEMENT`, message "An impact statement already exists for this achievement. Use PUT to update it."
- Statement empty after trim: HTTP 400, code `VALIDATION_ERROR`, message "Statement cannot be empty."
- Statement too long: HTTP 400, code `VALIDATION_ERROR`, message "Statement exceeds 1000 characters."
- File write failure: HTTP 500, code `FILE_WRITE_ERROR`, message "Could not save statement. Check your data directory."

---

#### GET /api/impact-statements

Returns all saved impact statements.

**Request:** No body, no params.

**Response (HTTP 200):**
```json
{
  "success": true,
  "data": {
    "statements": [
      {
        "id": "uuid-statement-1",
        "linkedAchievementId": "uuid-achievement-1",
        "linkedAchievementName": "Robotics Team Captain",
        "linkedAchievementCategory": "Extracurricular Activity",
        "statement": "Leading eight teammates...",
        "aiGenerated": true,
        "editedByStudent": true,
        "generatedFrom": {
          "studentAnswers": { "role": "...", "challenge": "...", "growth": "", "importance": "", "impact": "" },
          "profileDataUsed": ["Name: Robotics Team Captain", "Duration: 2 years"],
          "focusAreas": ["Decision-making under pressure"]
        },
        "reasoning": "Generated based on: your role as captain...",
        "editHistory": [],
        "createdAt": "2026-06-14T10:30:00.000Z",
        "lastEditedAt": "2026-06-14T10:35:00.000Z"
      }
    ],
    "total": 1
  },
  "error": null,
  "timestamp": "..."
}
```

**Empty state:** HTTP 200, `statements: []`, `total: 0`.

**Error cases:**
- File unreadable: HTTP 500, code `FILE_READ_ERROR`, message "Could not read impact statements."

---

#### PUT /api/impact-statements/:id

Updates an existing statement's text. Appends to editHistory.

**Request params:** `:id` — statement UUID.

**Request body:**
```json
{
  "statement": "Revised text (1–1000 chars)"
}
```

**Validation:**
- `:id`: must match an existing statement.
- `statement`: required, string, 1–1000 chars after trim.

**Server behaviour:**
1. Find statement by ID.
2. Validate new text.
3. Acquire file lock.
4. Append entry to `editHistory`: `{ editedAt: now, previousText: current statement }`.
5. Update `statement` and `lastEditedAt`. Set `editedByStudent: true`.
6. Write file, release lock.
7. Append to audit log: action `impact_statement_updated`.

**Response (HTTP 200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid-statement-1",
    "lastEditedAt": "2026-06-14T11:00:00.000Z"
  },
  "error": null,
  "timestamp": "..."
}
```

**Error cases:**
- ID not found: HTTP 404, code `NOT_FOUND`, message "Statement not found."
- Statement empty: HTTP 400, code `VALIDATION_ERROR`, message "Statement cannot be empty."
- Statement too long: HTTP 400, code `VALIDATION_ERROR`, message "Statement exceeds 1000 characters."

---

#### DELETE /api/impact-statements/:id

Deletes a saved impact statement.

**Request params:** `:id` — statement UUID.

**Request body:** None.

**Server behaviour:**
1. Find statement by ID.
2. Acquire file lock.
3. Remove the record from `statements` array.
4. Write file, update `lastUpdated`, release lock.
5. Append to audit log: action `impact_statement_deleted`, include `achievementId` that was unlinked.

**Response (HTTP 200):**
```json
{
  "success": true,
  "data": {
    "deleted": true,
    "id": "uuid-statement-1"
  },
  "error": null,
  "timestamp": "..."
}
```

**Error cases:**
- ID not found: HTTP 404, code `NOT_FOUND`, message "Statement not found."
- File write failure: HTTP 500, code `FILE_WRITE_ERROR`, message "Could not delete statement."

---

## AI integration

**Trigger:** Student completes Screen 4 (Step 2 review) and clicks [Generate Draft]. This fires `POST /api/impact-statements/generate` from the server to Gemini.

**Input sent to Gemini:**
- Achievement name, category, description, role, hoursPerWeek, duration (from achievements.json).
- Student's answers to all 5 questions (non-empty answers only included as named values; empty answers omitted from prompt).
- Derived focus areas (computed server-side before the Gemini call).

**Prompt template** (implemented in `/src/ai/impact.js`):

```
You are helping a high school student articulate one of their achievements for their college application. You are acting as a collaborative writing partner, not a ghostwriter.

Achievement profile data:
- Name: {{achievementName}}
- Category: {{achievementCategory}}
- Description: {{achievementDescription}}
{{#if role}}- Role: {{role}}{{/if}}
{{#if hoursPerWeek}}- Hours per week: {{hoursPerWeek}}{{/if}}
{{#if duration}}- Duration: {{duration}}{{/if}}

The student answered the following questions about this experience:
{{#if answers.role}}- Their role / biggest contribution: "{{answers.role}}"{{/if}}
{{#if answers.challenge}}- Challenge they faced and overcame: "{{answers.challenge}}"{{/if}}
{{#if answers.growth}}- What they learned / how they grew: "{{answers.growth}}"{{/if}}
{{#if answers.importance}}- Why it was important to them: "{{answers.importance}}"{{/if}}
{{#if answers.impact}}- Impact it had: "{{answers.impact}}"{{/if}}
{{#if noAnswers}}The student did not answer the questions — use only the achievement profile data above.{{/if}}

Focus areas to emphasize (based on their answers and profile):
{{#each focusAreas}}- {{this}}{{/each}}

Your task: Write a short paragraph (100–200 words) that helps the student articulate what this experience meant to them.

Rules:
1. Use second person ("You", "Your") — speak directly to the student.
2. Reference at least two specific details from the achievement profile or their answers (e.g., if hours per week is 6, say "six hours a week"; if there are 8 team members, say "eight teammates").
3. Sound like a thoughtful 17-year-old reflecting out loud — not a guidance counselor.
4. Do NOT use: "I learned the importance of teamwork", "I grew as a person", "This experience taught me valuable life lessons", "I am a lifelong learner", "stepping outside my comfort zone", or any close paraphrase.
5. Focus on one specific moment, decision, or tension — not a general summary.
6. End with a question or open thought, not a conclusion ("You still wonder whether...", "It made you ask...").
7. Only use facts from the achievement profile data and the student's answers. Do not invent any details not present above.

After the paragraph, output a separate JSON block (delimited by ```json and ```) with this exact schema:
{
  "reasoning": "one sentence explaining what you emphasized and why (max 150 chars)",
  "confidence": 0-100 integer representing how grounded the statement is in supplied data,
  "focusAreas": ["list of 2–4 strings — the specific themes you actually emphasized"]
}

Output format:
[The paragraph — no label, no quotes around it]

```json
{ "reasoning": "...", "confidence": 87, "focusAreas": ["...", "..."] }
```
```

**Handling missing fields in prompt:** `{{#if field}}` blocks are omitted entirely when the value is absent or empty — never send "null" or "N/A".

**`{{#if noAnswers}}`** is set to true when all 5 answer fields are empty strings.

**Expected output from Gemini:**
- A plain-text paragraph (100–200 words).
- Followed by a ```json block containing `reasoning` (string, max 150 chars), `confidence` (integer 0–100), and `focusAreas` (array of 2–4 strings).

**Server-side parsing of Gemini output:**
1. Split response at the first ` ```json ` delimiter.
2. Part before delimiter = `draft` text; trim whitespace.
3. Part after delimiter = JSON; parse with `JSON.parse()`.
4. If JSON parse fails: treat `reasoning` as null, `confidence` as null, `focusAreas` as []. Still return the draft text.
5. If `draft` is empty string: HTTP 502 `AI_ERROR`.
6. If `draft` word count < 50: HTTP 502 `AI_ERROR`, message "Generated draft was too short. Try regenerating."
7. If `draft` word count > 400: trim to the first 300 words and log a warning.

**How output maps to UI (Screen 5):**
- `data.draft` → AI draft card text (read-only) and textarea pre-fill.
- `data.reasoning` → "Generated based on:" line shown below the AI draft card.
- `data.confidence` → not displayed to student (stored in response, included in saved record via `generatedFrom` if desired — but not shown in UI).
- `data.focusAreas` → stored in `generatedFrom.focusAreas` when statement is saved.

**Fallback behaviour:**
- Gemini timeout (>30s): Screen 5 shows "Draft generation timed out. You can write your own statement below." Textarea empty and enabled. [Regenerate] active.
- Gemini API error: same fallback message. [Save As Is] still works on a manually written statement.
- Student can always write from scratch and save without any AI generation. No mandatory AI gate.

---

## Enterprise checks

**Auth:** Authenticated users only. STORY-001 establishes session handling. No valid session → redirect to `/`. All impact-statement endpoints require a valid session cookie. No role differentiation.

**Input validation:**
- Client-side: textarea character counter updates live; [Save] button disabled at 0 chars or >1000 chars. These are UX conveniences only.
- Server-side (authoritative): all POST and PUT endpoints re-validate `statement` (min 1 char after trim, max 1000 chars), `achievementId` existence, all required boolean flags, and the structure of `generatedFrom`. Non-string `statement` values rejected with HTTP 400.
- `studentAnswers` fields: strings only; server strips to 500 chars max per field if longer (silently truncates — no error). This prevents oversized prompts.

**Error states:**
- Gemini timeout on generate: Screen 5 draft card shows timeout message; textarea enabled; no toast (inline card message is sufficient).
- Gemini API error: same as timeout.
- File write failure on save: Bootstrap danger toast "Save failed. Check your data directory and try again." Textarea content preserved.
- File read failure on list load: Screen 6 shows inline alert "Could not load statements. Check your data directory." with [Retry] button.
- Delete failure: Inline alert on deleted row: "Delete failed. Try again." Row is not removed from DOM.
- 404 on edit/delete (stale data): Toast "This statement no longer exists. Refreshing list." Reload Screen 6.
- Preview reasoning failure: Side panel on Screen 3 shows "Could not generate preview. Try again." with [Retry] button. Does not block proceeding to [Generate Draft].

**Data safety:**
- Mid-questionnaire browser close (Screens 3–4): No data lost — nothing has been saved yet. Student sees the achievement still has no statement on return.
- Mid-generation browser close (Screen 5, spinner state): Generation was server-side. Statement not yet saved. On return, student can re-enter the questionnaire.
- Mid-edit browser close (Screen 5, textarea edits): Textarea contents are lost (not persisted to localStorage in this story). Acceptable trade-off for v1. Student can regenerate.
- Mid-save browser close: HTTP request may or may not complete. File locking prevents partial writes. Student should verify on return.

**Rate limiting / abuse:**
- `POST /api/impact-statements/generate` is the primary abuse candidate (Gemini API call per request).
- Enforce: maximum 10 calls per minute (consistent with architecture.md Gemini rate limit guardrail).
- Server-side in-memory counter; resets on server restart.
- Returns HTTP 429 with `RATE_LIMITED` if exceeded.
- `POST /api/impact-statements/preview-reasoning` does NOT call Gemini — no rate limiting required.
- `POST /api/impact-statements/save`, `PUT`, `DELETE`: local file writes; no rate limiting required.

**AI fallback:** If Gemini is unavailable, student can still write their own statement from scratch. Screen 5 textarea is accessible even after generation failure. No mandatory AI gate before saving.

---

## Acceptance criteria

1. Clicking [Generate] on the Impact Statements dashboard tile when the profile has no achievements shows the [Generate] button disabled with tooltip "Add at least one achievement or activity first."
2. Clicking [Generate] when at least one achievement has no statement opens Screen 2 (achievement picker modal) listing only achievements without a saved statement. The button label reads "Start Questionnaire."
3. Selecting an achievement and clicking [Start Questionnaire] opens Screen 3 (Step 1: Clarifying Questions) showing all 5 optional question fields, the achievement summary bar at the top, and a progress bar at 25%.
4. All 5 question fields in Screen 3 accept text without any required-field validation error — the student can proceed to [Generate Draft] with all fields empty.
5. Clicking [Preview AI Reasoning] on Screen 3 with at least one answer filled opens a side panel showing "Profile data I'll use", "What you told me", and "I will emphasize" bullets — without navigating away or calling Gemini.
6. Clicking [Preview AI Reasoning] with no answers filled shows the panel message "Fill in at least one answer to see a reasoning preview."
7. Clicking [Generate Draft] from Screen 3 advances to Screen 4 (Step 2: Preview AI Reasoning) showing the same three sections (profile data, student answers with "(not answered)" for empty fields, and focus area bullets). Progress bar is at 50%.
8. Clicking [Go Back to Edit Answers] from Screen 4 returns to Screen 3 with all previously entered answers still populated in the fields.
9. Clicking [Generate Draft] from Screen 4 shows Screen 5 with a spinner and "Generating your statement... this takes about 5–10 seconds." The [Cancel] button is the only active control during generation.
10. Within 30 seconds of clicking [Generate Draft], Screen 5 either displays the AI draft card with generated text and a "Generated based on:" reasoning line, or shows a generation failure message with an empty enabled textarea.
11. The AI draft card on Screen 5 is labeled "AI-generated draft — This is a starting point — rewrite it in your own words." and includes a "Generated based on:" line referencing at least one specific detail from the achievement or the student's answers.
12. The textarea on Screen 5 is pre-filled with the AI draft and is fully editable; the student can delete all text and type from scratch.
13. Clicking [Regenerate] on Screen 5 re-calls `POST /api/impact-statements/generate` with the same answers, updates the AI draft card on success, and does NOT overwrite the student's textarea edits.
14. Clicking [Adjust Answers] on Screen 5 shows a confirmation dialog "Going back will discard your current draft edits. Continue?" [Yes, Go Back] | [Stay Here]. Clicking [Yes, Go Back] returns to Screen 3 with answers pre-filled; clicking [Stay Here] dismisses the dialog.
15. Clicking [Discard] on Screen 5 shows inline confirmation "Discard this draft? Your answers and draft will be lost." [Yes, Discard] | [Keep Working]. Confirming returns to Screen 2 with no data saved.
16. Clicking [Save As Is] with an empty textarea shows inline error "Statement cannot be empty." and does not call `POST /api/impact-statements/save`.
17. Clicking [Save As Is] with valid text (1–1000 chars) calls `POST /api/impact-statements/save`, shows toast "Impact statement saved." and redirects to Screen 6 after 1.5 seconds.
18. The saved statement in Screen 6 shows the achievement name, category, "Generated from: X of 5 questions answered" (or "profile data only" if no answers given), a 200-char truncated preview, and three buttons: [Edit], [Regenerate with New Answers], [Delete].
19. Clicking [Regenerate with New Answers] on a saved statement card opens a confirmation prompt, then on confirm opens Screen 3 with the last `answerSheet` pre-filled.
20. Clicking [Edit] on a saved statement card expands the card inline with the full statement text in a textarea; [Save Changes] calls `PUT /api/impact-statements/:id` and updates the displayed text and "Last edited" timestamp without a page reload.
21. The PUT update appends a record to `editHistory` in `impact_statements.json` with `editedAt` and `previousText`.
22. Clicking [Delete] on a statement card shows inline confirmation "Delete this statement? [Confirm Delete] [Cancel]"; [Confirm Delete] calls `DELETE /api/impact-statements/:id`, removes the card, and shows toast "Statement deleted."
23. If Gemini generation fails (timeout or API error), Screen 5 shows the failure message with an empty enabled textarea and active [Regenerate] button; the student can write from scratch and save successfully without any AI involvement.
24. Attempting to generate for an achievement that already has a saved statement (direct API call) returns HTTP 409 with code `DUPLICATE_STATEMENT`.
25. Clicking anywhere on the Impact Statements dashboard card (except [Generate]) navigates to `/impact-statements` via `history.pushState` without a full page reload; the [Generate] button calls `event.stopPropagation()` and opens Screen 2 instead.
26. Direct navigation to `http://localhost:3000/impact-statements` loads `index.html` and renders the details view — not a 404.
27. The `impact_statements.json` schema stores `generatedFrom` (with `studentAnswers`, `profileDataUsed`, `focusAreas`), `reasoning`, and `editHistory` on every saved statement.
28. `POST /api/impact-statements/preview-reasoning` returns focus area bullets computed entirely server-side without calling Gemini, and returns HTTP 200 within 500ms.
29. After 10 `POST /api/impact-statements/generate` calls within one minute, the 11th call returns HTTP 429 with code `RATE_LIMITED`.
30. When an orphaned statement (achievement deleted) appears in Screen 6, it is displayed with "[Achievement removed]" prefix in grey italic before the achievement name, and the statement text remains editable.

---

## Known risks

1. **Gemini hallucination:** Model generates details not present in the achievement or student answers. Mitigation: prompt explicitly instructs model to use only supplied data (rule 7 in prompt template). Manual testing with 5 real achievement records required before story marked built. If model invents details not in prompt, prompt must be revised.

2. **Generic/cliche output:** Model produces guidance-counselor-style text. Mitigation: prompt explicitly bans named clichés and requires second-person voice, a specific moment, and an open-ended ending. Test with 5 achievement descriptions; if 2+ outputs contain banned phrases, revise prompt.

3. **JSON parse failure in Gemini response:** Model returns the paragraph but omits or malforms the ```json block. Mitigation: server handles parse failure gracefully — draft text is still returned; `reasoning`, `confidence`, and `focusAreas` default to null/empty. User experience is not broken.

4. **Questionnaire state lost on browser close:** Mid-questionnaire answers are held in memory (app.js) and are lost if the browser closes. Mitigation: acceptable for v1. Future enhancement: persist answer draft to localStorage keyed by achievementId.

5. **Impact statement linked to deleted achievement:** Student deletes an achievement after creating a statement. Statement is orphaned. Mitigation: statements are NOT auto-deleted. Screen 6 displays orphaned statements with "[Achievement removed]" indicator. Text remains editable and exportable.

6. **File locking race on rapid double-save:** Rapid double-click on [Save As Is] could send two concurrent save requests. Mitigation: disable [Save As Is] immediately on first click; re-enable only after server responds.

---

## Change history

| Release | Date | Summary | Type |
|---------|------|---------|------|
| 1.0.0 | 2026-06-14 | Initial spec authored | feature |
| 1.0.0 | 2026-06-14 | Added details page at /impact-statements with SPA routing, inline edit on cards, View All pattern, dashboard summary text, back navigation, and 9 new acceptance criteria | fix |
| 1.0.0 | 2026-06-14 | Card-as-link pattern: replaced [View All] button with clickable card; added card-link CSS class, hover shadow, aria-label, keyboard (Tab/Enter) access, stopPropagation on [Generate]; updated Screen 1, criteria 16, 25, 26 | fix |
| 1.1.2 | 2026-06-14 | REDESIGN: Replaced single-click generate with 4-step consultative flow (questionnaire → AI reasoning preview → draft → refinement); added answerSheet, generatedFrom, reasoning, editHistory to data model; added POST /preview-reasoning endpoint; rewrote AI prompt to accept student answers and output JSON reasoning block; added [Regenerate with New Answers] action; expanded acceptance criteria from 26 to 30 | feature |
