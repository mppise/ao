---
story_id: STORY-001
title: "Student signup and profile setup"
depends_on: []
spec_done: true
last_updated: "2026-06-14"
manual_entry_added: true
---

## What the user can do

- User can run `npx ao` from a terminal and see a Welcome screen in their browser at http://localhost:3000 — no prior setup required beyond a valid `.env` with `GEMINI_API_KEY`.
- User can enter their first name (required) and optional last name, then submit — the app validates inline before proceeding.
- User can type or paste an absolute directory path as their data directory, and the app creates that directory on disk (if it does not already exist) and confirms it is writable before proceeding.
- User can see the Profile Dashboard immediately after setup, with all 6 profile sections displayed as empty tiles showing "0 items" or "Empty" — no document upload is needed to reach this state. Each non-empty card shows a "View All" or "Details" button to navigate to a full list view.
- User can close and re-open the app (`npx ao`) and land directly on the Profile Dashboard because the `.env` file already holds `DATA_DIR` and the profile JSON files already exist.
- User can manually add data to their profile without uploading documents. Each section tile (Academic, Tests, Achievements, Activities) shows two action buttons: **[Upload docs]** and **[Add manually]**. Clicking "Add manually" opens a form to enter data directly.
- User can edit or delete any manually entered activity, achievement, or AP/IB exam score from its detail list page. Clicking [Edit] on any card opens a pre-populated modal; clicking [Delete] opens a confirmation modal before removing the record. Both operations update the list and dashboard count immediately without a page reload.
- User can navigate the app using browser back/forward buttons — each screen has a distinct URL in the browser history so standard back/forward navigation works correctly.
- User can click the app name ("Admissions Officer") in the top-left navbar to return to the Profile Dashboard from any screen.
- User can open the Settings page from the navbar gear icon and view or edit configuration values (PORT, DATA_DIR, GEMINI_MODEL, GEMINI_API_KEY), and export the current config to a file.

---

## Screens and states

### Screen 1 — Welcome Screen

**Entry point:** Any browser request to `http://localhost:3000` when `DATA_DIR` is not set in `.env` OR when no `.metadata.json` file exists at `DATA_DIR/.metadata.json`.

**Layout:**

```
+------------------------------------------------------+
|  [AO Logo / Bootstrap Icon bi-mortarboard]           |
|                                                      |
|  Admissions Officer                                  |
|  Your personal college application assistant         |
|                                                      |
|  [ Get Started ]   (btn-primary, large)              |
+------------------------------------------------------+
```

**What user can do:** Click "Get Started" to proceed to the Name Entry form.

**Error state:** If the server fails to start (port 3000 in use), the CLI prints an error to the terminal: "Port 3000 is in use. Set PORT= in .env to use a different port." The browser is not opened.

**No auth required.** This is a single-user local desktop app.

---

### Screen 2 — Name Entry Form

**Entry point:** Clicking "Get Started" on the Welcome Screen. The URL changes to `/onboarding/name` (client-side state; the server still serves `index.html` for all routes, JS handles routing).

**Layout:**

```
+------------------------------------------------------+
|  Step 1 of 2  [======----]  Name                     |
|                                                      |
|  What's your name?                                   |
|                                                      |
|  First name *                                        |
|  [ ________________________________ ]                |
|  (Inline error: "First name is required")            |
|                                                      |
|  Last name  (optional)                               |
|  [ ________________________________ ]                |
|                                                      |
|  [ Continue ]  (btn-primary)                         |
+------------------------------------------------------+
```

**Fields:**
- `firstName`: text input, required. Max 50 characters. Pattern: letters, hyphens, apostrophes, and spaces only — regex `/^[A-Za-z'\- ]{1,50}$/`.
- `lastName`: text input, optional. Same pattern if provided, max 50 characters. Empty string is acceptable.

**Validation:**
- Client-side: on "Continue" click, validate before any API call. Show inline error directly below the field. Do not submit if invalid.
- Server-side: `POST /api/signup` also validates both fields with the same rules. Returns 400 if invalid.

**Actions:**
- Click "Continue" with valid data → proceed to Screen 3 (Directory Selection). Store `firstName` and `lastName` in `localStorage` key `ao_onboarding` as JSON temporarily (not committed to disk yet).
- Click "Continue" with empty first name → inline error "First name is required" appears below the field; form does not advance.
- Click "Continue" with invalid characters → inline error "Name may only contain letters, hyphens, apostrophes, and spaces."

---

### Screen 3 — Data Directory Selection

**Entry point:** Successful name validation on Screen 2. URL: `/onboarding/directory`.

**Layout:**

```
+------------------------------------------------------+
|  Step 2 of 2  [==========]  Data Directory           |
|                                                      |
|  Where should AO store your profile data?            |
|  Choose a folder on your computer.                   |
|                                                      |
|  Directory path *                                    |
|  [ /Users/yourname/ao-profile______________ ]        |
|  (pre-filled with OS home dir + /ao-profile)         |
|                                                      |
|  [bi-info-circle] AO will create this folder if      |
|  it doesn't exist. All data stays on your machine.   |
|                                                      |
|  [ Create Profile ]  (btn-primary)                   |
|  [ Back ]            (btn-link)                      |
|                                                      |
|  -- STATES --                                        |
|  Loading: spinner + "Setting up your profile..."     |
|  Error:   alert-danger "Could not create directory:  |
|           [reason]. Please choose a different path." |
+------------------------------------------------------+
```

**Fields:**
- `dataDir`: text input, required. Must be an absolute path. Pre-filled with `os.homedir() + '/ao-profile'` (server returns this default from `GET /api/onboarding/defaults`).

**Validation:**
- Client-side: path must not be empty, must start with `/` (macOS/Linux) or a drive letter `C:\` (Windows). Show inline error if not.
- Server-side: `POST /api/signup` validates and attempts directory creation. If the path is a system-protected directory (e.g., `/System`, `/Windows`, `/usr`, `/bin`), returns 403 with `error.code: "PROTECTED_PATH"`.

**Actions:**
- Click "Create Profile" with valid path → `POST /api/signup` is called. Show spinner over the button ("Setting up your profile..."). On success, redirect to Screen 4 (Profile Dashboard).
- Click "Create Profile" with empty path → inline error "A directory path is required."
- Click "Create Profile" and server returns 403 PROTECTED_PATH → alert-danger: "That path is a protected system directory. Please choose a folder in your home directory."
- Click "Create Profile" and server returns 500 (permission error) → alert-danger: "AO could not create or write to that directory. Check folder permissions and try again."
- Click "Back" → return to Screen 2 (Name Entry), `localStorage` values are preserved so fields are pre-filled.
- If `dataDir` already exists and contains a valid `.metadata.json` → server returns 409 with `error.code: "PROFILE_EXISTS"`. Show modal: "A profile already exists at this path. Do you want to open it instead? [Open Existing Profile] [Choose Different Directory]". Clicking "Open Existing Profile" redirects to the Profile Dashboard; clicking "Choose Different Directory" closes the modal.

---

### Screen 4 — Profile Dashboard (Empty State)

**Entry point:** Successful `POST /api/signup`, or on any app launch when `DATA_DIR` is set and `.metadata.json` exists. This is the permanent home screen of the app. URL: `/` (root, served by index.html).

**Layout:**

```
+------------------------------------------------------+
|  [bi-mortarboard] Admissions Officer    [bi-gear]   |
|  Welcome, [firstName]!                               |
+------------------------------------------------------+
|                                                      |
|  Your Profile                                        |
|  [==--------]  Profile 0% complete                   |
|                                                      |
|  +---------------------------+  +---------------+    |
|  | [bi-book]                 |  |[bi-pencil-sq] |    |
|  | Academic                  |  | Tests         |    |
|  | Empty                     |  | Empty         |    |
|  | [Upload] [Add manually]   |  |[Upload][Add]  |    |
|  +---------------------------+  +---------------+    |
|                                                      |
|  +---------------------------+  +---------------+    |
|  | [bi-trophy]               |  |[bi-activity]  |    |
|  | Achievements              |  | Activities    |    |
|  | 0 items                   |  | 0 items       |    |
|  | [Upload] [Add manually]   |  |[Upload][Add]  |    |
|  +---------------------------+  +---------------+    |
|                                                      |
|  +---------------------------+  +---------------+    |
|  | [bi-chat-quote]           |  |[bi-file-text] |    |
|  | Impact Statements         |  | Generated     |    |
|  | Empty                     |  | Essays        |    |
|  | [Generate] (disabled)     |  |[Generate]     |    |
|  |                           |  | (disabled)    |    |
|  +---------------------------+  +---------------+    |
|                                                      |
|  [bi-info-circle] Tip: Upload documents for AI      |
|  extraction, or add entries manually.               |
|                                                      |
+------------------------------------------------------+
```

**Sections displayed (always 6, always shown even when empty):**
1. Academic — icon `bi-book` — shows "Empty" if no academic.json data
2. Tests — icon `bi-pencil-square` — shows "Empty" if no tests.json data
3. Achievements — icon `bi-trophy` — shows "0 items" (count-based)
4. Activities — icon `bi-activity` — shows "0 items" (count-based)
5. Impact Statements — icon `bi-chat-quote` — shows "Empty"
6. Generated Essays — icon `bi-file-text` — shows "Empty"

**Empty state:** Each card shows its icon, section name, empty status label, and action buttons.
- **Sections 1–4 (Academic, Tests, Achievements, Activities):** Two buttons side-by-side:
  - `[Upload docs]` — styled `btn-sm btn-outline-primary` — opens file upload modal (STORY-002)
  - `[Add manually]` — styled `btn-sm btn-outline-secondary` — opens manual entry form
- **Sections 5–6 (Impact Statements, Generated Essays):** Single button:
  - `[Generate]` — styled `btn-sm btn-outline-secondary disabled` with tooltip "Upload documents or add data first to enable this."

**Non-empty state (when a section has at least one item):** In addition to the action buttons, each section card (Sections 1–4) shows a `[View All]` button (`btn-sm btn-link`) below the item count. Clicking "View All" navigates to `/section/[name]` (e.g., `/section/achievements`) using `pushState`. That route renders a full-page list of all saved items in that section. Sections 5–6 show a `[View Details]` button (`btn-sm btn-link`) instead of `[View All]` when they have content. The detail views for sections 5–6 are owned by STORY-004 and STORY-006 respectively; this story establishes the routing entry point only — the routes `/section/impact_statements` and `/section/essays` display a placeholder "No data yet" until those stories are built.

**Onboarding hint:** A persistent `alert-info` banner at the bottom of the dashboard: "[bi-info-circle] Tip: Upload documents for AI extraction, or add entries manually." This banner is hidden once the first entry is added (via upload or manual entry; tracked via `localStorage` key `ao_hint_dismissed`).

**Error state:** If `GET /api/profile/sections` returns an error, show a full-width `alert-danger`: "Could not load your profile. Check that your data directory is accessible." with a [Retry] button that re-calls the endpoint.

---

### Screen 5 — Manual Entry Modals (NEW)

**Entry point:** Clicking "[Add manually]" on a section tile (Academic, Tests, Achievements, or Activities).

**Behavior:** A Bootstrap modal opens with a form tailored to the section. Modal title: "Add to [Section Name]". Three buttons at bottom: "[Save]", "[Cancel]".

**Forms by section:**

#### Academic Manual Entry Form
```
+-----------------------------------------------+
| Add to Academic                         [x]   |
+-----------------------------------------------+
| GPA (e.g., 3.85)                              |
| [ __________________ ]                        |
|                                               |
| GPA Scale (e.g., 4.0)                         |
| [ __________________ ]                        |
|                                               |
| Graduation Year (e.g., 2026)                  |
| [ __________________ ]                        |
|                                               |
| School Name (optional)                        |
| [ __________________ ]                        |
|                                               |
|  [ Save ]  [ Cancel ]                         |
+-----------------------------------------------+
```

#### Tests Manual Entry Form
```
+-----------------------------------------------+
| Add to Tests                            [x]   |
+-----------------------------------------------+
| Test Type *                                   |
| [ Dropdown: SAT / ACT / AP / IB / Other ] |
|                                               |
| Test Name (e.g., "SAT", "AP Biology")         |
| [ __________________ ]                        |
|                                               |
| Score (e.g., "1480" or "5")                   |
| [ __________________ ]                        |
|                                               |
| Test Date (optional)                          |
| [ __________________ ]  (format: MM/DD/YYYY)  |
|                                               |
|  [ Save ]  [ Cancel ]                         |
+-----------------------------------------------+
```

#### Achievements Manual Entry Form
```
+-----------------------------------------------+
| Add to Achievements                     [x]   |
+-----------------------------------------------+
| Award/Honor Title *                           |
| [ __________________ ]                        |
|                                               |
| Issuing Organization (e.g., school name)      |
| [ __________________ ]                        |
|                                               |
| Date Awarded (optional)                       |
| [ __________________ ]  (format: MM/DD/YYYY)  |
|                                               |
| Category (optional)                           |
| [ Dropdown: Academic / Sports / Other ]   |
|                                               |
|  [ Save ]  [ Cancel ]                         |
+-----------------------------------------------+
```

#### Activities Manual Entry Form
```
+-----------------------------------------------+
| Add to Activities                       [x]   |
+-----------------------------------------------+
| Activity Name *                               |
| [ __________________ ]                        |
|                                               |
| Role (e.g., "Member", "President")            |
| [ __________________ ]                        |
|                                               |
| Organization/School                           |
| [ __________________ ]                        |
|                                               |
| Time Commitment (hours per week, optional)    |
| [ __________________ ]                        |
|                                               |
|  [ Save ]  [ Cancel ]                         |
+-----------------------------------------------+
```

**Validation (client-side):**
- Academic: GPA is required, must be numeric, 0–5.0. School name is optional.
- Tests: Test Type and Test Name required. Score required, numeric.
- Achievements: Title required (1–100 chars). Date format validated if provided.
- Activities: Activity Name and Role required.

**Success state:** After clicking [Save], the form closes and the section tile updates to show the new entry count (e.g., "1 item" instead of "Empty"). Show a brief success toast: "✓ Added to [Section]".

**Error state:** On validation error, show inline error message below the invalid field (same style as Sign Up form). Do not close the modal.

---

### Screen 6 — Settings

**Entry point:** Clicking the gear icon in the navbar from any screen. URL: `/settings`.

**Layout:**

```
+------------------------------------------------------+
|  [bi-mortarboard] Admissions Officer    [bi-gear]   |
+------------------------------------------------------+
|  Settings                                            |
|                                                      |
|  Server                                              |
|  +-------------------------------------------------+ |
|  | PORT                                            | |
|  | [ 3000 __________________ ]                     | |
|  | Used when the app starts. Requires restart.     | |
|  +-------------------------------------------------+ |
|                                                      |
|  Data Storage                                        |
|  +-------------------------------------------------+ |
|  | DATA_DIR                                        | |
|  | [ /Users/jane/ao-profile _________________ ]    | |
|  | Read-only — change requires re-running setup.   | |
|  +-------------------------------------------------+ |
|                                                      |
|  AI                                                  |
|  +-------------------------------------------------+ |
|  | GEMINI_MODEL                                    | |
|  | [ gemini-2.0-flash-exp _____________________ ]  | |
|  |                                                 | |
|  | GEMINI_API_KEY                                  | |
|  | [ ●●●●●●●●●●●●●●●●●●●●●●●● ] [Show/Hide]       | |
|  +-------------------------------------------------+ |
|                                                      |
|  [ Save Settings ]   (btn-primary)                   |
|  [ Export Config ]   (btn-outline-secondary)         |
|                                                      |
+------------------------------------------------------+
```

**Fields and behaviours:**

| Field | Editable | Default | Validation |
|-------|----------|---------|------------|
| `PORT` | Yes | `3000` | Integer 1024–65535. Changes written to `.env`; show info banner "Restart `npx ao` to apply port change." |
| `DATA_DIR` | No (read-only display) | Set during setup | Displayed as plain text, not an input. Clicking shows tooltip "Use setup to change data directory." |
| `GEMINI_MODEL` | Yes | `gemini-2.0-flash-exp` | Non-empty string, max 60 chars. Written to `.env`. |
| `GEMINI_API_KEY` | Yes | (from `.env`) | Non-empty string, max 256 chars. Rendered as password field (masked). [Show/Hide] toggle reveals plaintext. Written to `.env`. |

**Actions:**
- Click "Save Settings" → validates PORT (numeric, in range) and GEMINI_MODEL (non-empty). If valid, calls `POST /api/settings`. On success: success toast "Settings saved." If PORT changed: persistent `alert-info` "Port change will take effect after restarting `npx ao`."
- Click "Export Config" → calls `GET /api/settings/export` which triggers a file download of a JSON config snapshot (see endpoint below). GEMINI_API_KEY is redacted as `"[REDACTED]"` in the export.
- Clicking the app name navbar link → navigates back to `/` (Dashboard).

**Empty/error states:**
- If `GET /api/settings` fails: show `alert-danger` "Could not load settings. Check that the `.env` file is accessible." with [Retry] button.
- If `POST /api/settings` fails: show `alert-danger` inline: "Failed to save settings: [reason]."
- If PORT is out of range: inline error below PORT field "Port must be a number between 1024 and 65535."
- If GEMINI_MODEL is blank: inline error "Model name is required."

---

### Screen 7 — Activities Detail Page (Edit/Delete)

**Entry point:** Clicking "View All" on the Activities section tile (from Screen 4 when count > 0). URL: `/section/activities` (pushState).

**Layout:**

```
+------------------------------------------------------+
|  [bi-mortarboard] Admissions Officer    [bi-gear]   |
+------------------------------------------------------+
|  [bi-arrow-left] Back to Dashboard                   |
|                                                      |
|  Activities  (n items)                               |
|  [ Add manually ]  (btn-sm btn-outline-secondary)    |
|                                                      |
|  +------------------------------------------------+  |
|  | Robotics Club                                  |  |
|  | Team Captain · Springfield High · 8 hrs/wk    |  |
|  | Start: Sep 2024  End: Ongoing                  |  |
|  |                    [ Edit ]  [ Delete ]        |  |
|  +------------------------------------------------+  |
|                                                      |
|  +------------------------------------------------+  |
|  | (next activity card...)                        |  |
|  +------------------------------------------------+  |
|                                                      |
+------------------------------------------------------+
```

**What displays per card:**
- `activityName` as card title (bold)
- Subtitle line: `role · organization · hoursPerWeek hrs/wk` (omit any field that is null/empty)
- Date line: `Start: [startDate]  End: [endDate or "Ongoing"]`
- Two action buttons: `[Edit]` (btn-sm btn-outline-primary) and `[Delete]` (btn-sm btn-outline-danger)

**Empty state:** If no activities exist (user navigated here directly), show centered text "No activities yet." with a single `[Add manually]` button.

**[Edit] action:** Opens the Activity Edit Modal (see below) pre-populated with the card's current values. The `id` of the activity is stored as a data attribute on the button (`data-activity-id`).

**[Delete] action:** Opens the Activity Delete Confirmation Modal. Does not delete immediately.

---

#### Activity Edit Modal

**Trigger:** Clicking [Edit] on any activity card.

**Modal title:** "Edit Activity"

```
+-----------------------------------------------+
| Edit Activity                           [x]   |
+-----------------------------------------------+
| Activity Name *                               |
| [ Robotics Club___________________ ]          |
|                                               |
| Role                                          |
| [ Team Captain____________________ ]          |
|                                               |
| Organization                                  |
| [ Springfield High________________ ]          |
|                                               |
| Hours per Week                                |
| [ 8________________________________ ]          |
|                                               |
| Start Date (MM/DD/YYYY)                       |
| [ 09/01/2024______________________ ]          |
|                                               |
| End Date (MM/DD/YYYY, leave blank = Ongoing)  |
| [ ________________________________ ]          |
|                                               |
|  [ Save Changes ]  [ Cancel ]                 |
+-----------------------------------------------+
```

**Fields and pre-population:** All fields are pre-filled with the activity's current values. `endDate` is blank if the activity is ongoing.

**Validation (client-side, before API call):**
- `activityName`: required, 1–100 chars. Error: "Activity name is required."
- `organization`: required, 1–100 chars. Error: "Organization is required."
- `hoursPerWeek`: if provided, numeric 0–100. Error: "Hours per week must be a number between 0 and 100."
- `startDate`: if provided, must be valid MM/DD/YYYY date and not in the future. Error: "Start date must be a valid past date."
- `endDate`: if provided, must be valid MM/DD/YYYY date, not in the future, and on or after startDate. Error: "End date must be on or after start date."

**Validation (server-side):** Same rules enforced in `PUT /api/profile/activities/:id`. Returns 400 VALIDATION_ERROR on failure.

**Save action:** Calls `PUT /api/profile/activities/:id`. On success: closes modal, updates the activity card in-place with new values (no page reload), shows success toast "Activity updated."

**Error state:** If API returns 400 or 500, show `alert-danger` inside the modal (above the form fields): "Could not save changes: [error.message]." Modal stays open.

---

#### Activity Delete Confirmation Modal

**Trigger:** Clicking [Delete] on any activity card.

```
+-----------------------------------------------+
| Delete Activity                         [x]   |
+-----------------------------------------------+
|                                               |
|  Are you sure you want to delete              |
|  "Robotics Club"?                             |
|                                               |
|  This cannot be undone.                       |
|                                               |
|  [ Delete ]  (btn-danger)   [ Cancel ]        |
+-----------------------------------------------+
```

**[Delete] action:** Calls `DELETE /api/profile/activities/:id`. On success: closes modal, removes the card from the list without page reload, shows success toast "Activity deleted." Updates the Activities section count on the dashboard (decrements by 1 via `localStorage` or a re-fetch of `/api/profile/sections`).

**[Cancel] action:** Closes modal, no changes made.

**Error state:** If API returns 500, show `alert-danger` inside the modal: "Could not delete activity. Please try again." Modal stays open; [Delete] button re-enabled.

---

### Screen 8 — Achievements Detail Page (Edit/Delete)

**Entry point:** Clicking "View All" on the Achievements section tile. URL: `/section/achievements` (pushState).

**Layout:** Same pattern as Screen 7 but for achievement cards.

**What displays per card:**
- `title` as card title (bold)
- Subtitle line: `organization · category` (omit if null/empty)
- Date line: `Awarded: [dateAwarded]` (omit if null)
- Two action buttons: `[Edit]` (btn-sm btn-outline-primary) and `[Delete]` (btn-sm btn-outline-danger)

**Empty state:** Centered "No achievements yet." with `[Add manually]` button.

---

#### Achievement Edit Modal

**Trigger:** Clicking [Edit] on any achievement card.

**Modal title:** "Edit Achievement"

```
+-----------------------------------------------+
| Edit Achievement                        [x]   |
+-----------------------------------------------+
| Award/Honor Title *                           |
| [ National Merit Scholar__________ ]          |
|                                               |
| Description (optional)                        |
| [ ________________________________ ]          |
|   (textarea, max 500 chars)                   |
|                                               |
| Category                                      |
| [ Dropdown: Academic / Sports /               |
|             Community / Other    ]            |
|                                               |
| Date Earned (MM/DD/YYYY)                      |
| [ 05/15/2024______________________ ]          |
|                                               |
|  [ Save Changes ]  [ Cancel ]                 |
+-----------------------------------------------+
```

**Fields and pre-population:** All fields are pre-filled with current values.

**Validation (client-side):**
- `title`: required, 1–100 chars. Error: "Title is required."
- `category`: required (must select one of the four options). Error: "Please select a category."
- `description`: optional, max 500 chars. Error if exceeded: "Description must be 500 characters or fewer."
- `dateAwarded`: if provided, must be valid MM/DD/YYYY date and not in the future. Error: "Date must be a valid past date."

**Validation (server-side):** Same rules in `PUT /api/profile/achievements/:id`. Returns 400 VALIDATION_ERROR.

**Save action:** Calls `PUT /api/profile/achievements/:id`. On success: closes modal, updates card in-place, shows toast "Achievement updated."

**Error state:** `alert-danger` inside modal on failure. Modal stays open.

---

#### Achievement Delete Confirmation Modal

**Trigger:** Clicking [Delete] on any achievement card.

```
+-----------------------------------------------+
| Delete Achievement                      [x]   |
+-----------------------------------------------+
|                                               |
|  Are you sure you want to delete              |
|  "National Merit Scholar"?                    |
|                                               |
|  This cannot be undone.                       |
|                                               |
|  [ Delete ]  (btn-danger)   [ Cancel ]        |
+-----------------------------------------------+
```

**[Delete] action:** Calls `DELETE /api/profile/achievements/:id`. On success: removes card, shows toast "Achievement deleted." Decrements dashboard count.

**Error state:** `alert-danger` inside modal on failure. Modal stays open.

---

### Screen 9 — Academics Detail Page — AP/IB Scores (Edit/Delete)

**Entry point:** Clicking "View All" (or "Details") on the Academic section tile (URL: `/section/academic`). This screen shows GPA, courses, and the full list of AP/IB exam scores.

**AP/IB scores sub-section layout (within the Academic detail page):**

```
+------------------------------------------------------+
|  AP / IB Exam Scores                                 |
|  [ Add Score ]  (btn-sm btn-outline-secondary)       |
|                                                      |
|  +------------------------------------------------+  |
|  | AP Biology                                     |  |
|  | Type: AP  Score: 5  Date: 05/2024              |  |
|  |                    [ Edit ]  [ Delete ]        |  |
|  +------------------------------------------------+  |
|                                                      |
|  +------------------------------------------------+  |
|  | IB Mathematics                                 |  |
|  | Type: IB  Score: 7  Date: 11/2024              |  |
|  |                    [ Edit ]  [ Delete ]        |  |
|  +------------------------------------------------+  |
|                                                      |
+------------------------------------------------------+
```

**What displays per score row:**
- `courseName` as title (bold)
- Detail line: `Type: [AP|IB]  Score: [score]  Date: [MM/YYYY]`
- Two action buttons: `[Edit]` (btn-sm btn-outline-primary) and `[Delete]` (btn-sm btn-outline-danger)

**Empty state for scores sub-section:** "No AP/IB scores added yet." with `[Add Score]` button.

**Note on "Add Score":** The [Add Score] button uses the existing Tests manual entry form (Screen 5) opened as a modal, with `testType` pre-selected to "AP" and dropdown locked to AP/IB only. This button is the same as `[Add manually]` on the Tests tile but scoped to AP/IB.

---

#### AP/IB Score Edit Modal

**Trigger:** Clicking [Edit] on any AP/IB score row.

**Modal title:** "Edit Exam Score"

```
+-----------------------------------------------+
| Edit Exam Score                         [x]   |
+-----------------------------------------------+
| Course Name *                                 |
| [ AP Biology_______________________ ]         |
|                                               |
| Exam Type *                                   |
| [ Dropdown: AP / IB             ]             |
|                                               |
| Score *                                       |
| [ 5________________________________ ]         |
| (AP: 1–5, IB: 1–7)                           |
|                                               |
| Date Taken (MM/YYYY, optional)                |
| [ 05/2024_________________________ ]          |
|                                               |
|  [ Save Changes ]  [ Cancel ]                 |
+-----------------------------------------------+
```

**Fields and pre-population:** All fields pre-filled with current values.

**Validation (client-side):**
- `courseName`: required, 1–100 chars. Error: "Course name is required."
- `examType`: required, must be "AP" or "IB". Error: "Please select AP or IB."
- `score`: required, numeric integer. If `examType` is "AP": must be 1–5. If `examType` is "IB": must be 1–7. Error: "Score must be between 1 and 5 for AP" or "Score must be between 1 and 7 for IB."
- `dateTaken`: optional, format MM/YYYY. Must be a valid month/year and not in the future. Error: "Date must be a valid past month and year."

**Validation (server-side):** Same rules in `PUT /api/profile/academic/exam-score/:id`. Returns 400 VALIDATION_ERROR.

**Save action:** Calls `PUT /api/profile/academic/exam-score/:id`. On success: closes modal, updates the score row in-place, shows toast "Exam score updated." If the score row has a linked badge displayed on a course row elsewhere in the Academic detail page, that badge is also updated in-place (re-read from updated data).

**Error state:** `alert-danger` inside modal on failure. Modal stays open.

---

#### AP/IB Score Delete Confirmation Modal

**Trigger:** Clicking [Delete] on any score row.

```
+-----------------------------------------------+
| Delete Exam Score                       [x]   |
+-----------------------------------------------+
|                                               |
|  Are you sure you want to delete the score    |
|  for "AP Biology"?                            |
|                                               |
|  This cannot be undone.                       |
|                                               |
|  [ Delete ]  (btn-danger)   [ Cancel ]        |
+-----------------------------------------------+
```

**[Delete] action:** Calls `DELETE /api/profile/academic/exam-score/:id`. On success: removes the score row from the list, shows toast "Exam score deleted." If any course row in the Academic detail page had a badge linked to this score (e.g., "AP: 5"), that badge is removed from the course row in-place.

**[Cancel] action:** Closes modal, no changes made.

**Error state:** `alert-danger` inside modal on failure.

---

## Data and backend

### JSON files created on signup

All files are written to `DATA_DIR/profile/` and `DATA_DIR/` as described below. The directory structure is:

```
DATA_DIR/
  .metadata.json
  .audit.json
  .logs/
  profile/
    academic.json
    tests.json
    achievements.json
    activities.json
    impact_statements.json
    essays.json
```

#### `DATA_DIR/.metadata.json`

```json
{
  "schemaVersion": "1.0.0",
  "createdAt": "2026-06-14T10:30:00.000Z",
  "updatedAt": "2026-06-14T10:30:00.000Z",
  "student": {
    "firstName": "Jane",
    "lastName": "Doe",
    "displayName": "Jane Doe"
  }
}
```

Fields:
- `schemaVersion`: string, current data schema version, set to `"1.0.0"` on creation. Used for future migrations.
- `createdAt`: ISO 8601 timestamp, system-generated at signup.
- `updatedAt`: ISO 8601 timestamp, updated on any profile write.
- `student.firstName`: string, 1–50 chars, letters/hyphens/apostrophes/spaces only.
- `student.lastName`: string, 0–50 chars, same pattern. Empty string `""` if not provided.
- `student.displayName`: string, derived: `firstName + " " + lastName` trimmed. Used in UI greetings.

**FERPA note:** No date of birth, address, school ID, or legal identifiers stored here. First name and optional last name only.

#### `DATA_DIR/.audit.json`

```json
{
  "entries": [
    {
      "traceId": "uuid-v4",
      "timestamp": "2026-06-14T10:30:00.000Z",
      "action": "PROFILE_CREATED",
      "affectedFields": ["metadata", "academic", "tests", "achievements", "activities", "impact_statements", "essays"],
      "actor": "system"
    }
  ]
}
```

#### `DATA_DIR/profile/academic.json`

```json
{
  "schemaVersion": "1.0.0",
  "lastUpdated": "2026-06-14T10:30:00.000Z",
  "data": {
    "gpa": null,
    "gpaScale": null,
    "classRank": null,
    "classSize": null,
    "school": null,
    "graduationYear": null,
    "courses": []
  },
  "sources": []
}
```

- `data.*`: all null on init; populated by STORY-003 after extraction.
- `sources`: array of source citation objects (added by STORY-003). Empty array on init.

#### `DATA_DIR/profile/tests.json`

```json
{
  "schemaVersion": "1.0.0",
  "lastUpdated": "2026-06-14T10:30:00.000Z",
  "data": {
    "sat": null,
    "act": null,
    "ap": [],
    "ib": [],
    "other": []
  },
  "sources": []
}
```

The `ap` and `ib` arrays hold exam score objects that are individually editable and deletable by `id`:
```json
{
  "id": "uuid-v4",
  "courseName": "AP Biology",
  "examType": "AP",
  "score": 5,
  "dateTaken": "2024-05",
  "confidence": 100,
  "source": null,
  "excerpt": null,
  "confirmedByStudent": true
}
```

Field notes:
- `id`: uuid-v4, system-generated on creation. Required for PUT/DELETE by ID.
- `courseName`: string, 1–100 chars, required.
- `examType`: "AP" or "IB".
- `score`: integer. AP: 1–5. IB: 1–7.
- `dateTaken`: string in "YYYY-MM" format or null. Derived from MM/YYYY user input. Must be in the past.
- `confidence`, `source`, `excerpt`, `confirmedByStudent`: same semantics as achievements items.

**Dual-storage reality (implemented):** AP/IB exam scores are stored in two locations depending on how they were added:

1. **`academic.json` → top-level `apIbScores[]` array** — written by the existing `POST /api/profile/academic/add-exam-score` endpoint (the manual-entry path from the Tests modal). Each item has an `id` field.
2. **`tests.json` → `data.ap[]` / `data.ib[]` arrays** — written by `profile-merge.js` (STORY-003 extraction path). Each item also has an `id` field.

Both locations are valid and may contain scores simultaneously. All CRUD endpoints for AP/IB scores (`GET /api/profile/academic/exam-scores`, `PUT /api/profile/academic/exam-score/:id`, `DELETE /api/profile/academic/exam-score/:id`) search both storage locations. `PUT` and `DELETE` try `academic.json.apIbScores[]` first, then fall back to `tests.json.data.ap[]`/`tests.json.data.ib[]`. STORY-005 (export) must also read from both locations to get the complete AP/IB score list.

#### `DATA_DIR/profile/achievements.json`

```json
{
  "schemaVersion": "1.0.0",
  "lastUpdated": "2026-06-14T10:30:00.000Z",
  "data": {
    "items": []
  },
  "sources": []
}
```

Each item in `items` (added via manual entry or STORY-003 extraction):
```json
{
  "id": "uuid-v4",
  "title": "",
  "description": "",
  "category": null,
  "dateAwarded": null,
  "organization": null,
  "confidence": null,
  "source": null,
  "excerpt": null,
  "confirmedByStudent": false
}
```

Field notes:
- `id`: uuid-v4, system-generated on creation.
- `title`: string, 1–100 chars, required.
- `description`: string, 0–500 chars, optional.
- `category`: one of ["academic", "sports", "community", "other"] or null.
- `dateAwarded`: ISO 8601 date string (YYYY-MM-DD) or null. Derived from MM/DD/YYYY user input.
- `organization`: string, 0–100 chars, optional.
- `confidence`: integer 0–100 or null. Set to 100 for manual entries.
- `source`: source document filename or null. Null for manual entries.
- `excerpt`: text excerpt from source document or null. Null for manual entries.
- `confirmedByStudent`: boolean. True for manual entries; set by STORY-003 review flow for extracted entries.

#### `DATA_DIR/profile/activities.json`

```json
{
  "schemaVersion": "1.0.0",
  "lastUpdated": "2026-06-14T10:30:00.000Z",
  "data": {
    "items": []
  },
  "sources": []
}
```

Each item in `items` (added via manual entry or STORY-003 extraction):
```json
{
  "id": "uuid-v4",
  "activityName": "",
  "role": null,
  "organization": null,
  "hoursPerWeek": null,
  "startDate": null,
  "endDate": null,
  "confidence": null,
  "source": null,
  "excerpt": null,
  "confirmedByStudent": false
}
```

Field notes:
- `id`: uuid-v4, system-generated on creation.
- `activityName`: string, 1–100 chars, required.
- `role`: string, 0–100 chars, optional.
- `organization`: string, 0–100 chars, required on edit (must not be empty after first save).
- `hoursPerWeek`: numeric 0–100 or null, optional.
- `startDate`: ISO 8601 date string (YYYY-MM-DD) or null. Derived from MM/DD/YYYY user input. Must not be in the future.
- `endDate`: ISO 8601 date string (YYYY-MM-DD) or null. Null means ongoing. Must be on or after `startDate` if provided. Must not be in the future.
- `confidence`, `source`, `excerpt`, `confirmedByStudent`: same semantics as achievements items.

#### `DATA_DIR/profile/impact_statements.json`

```json
{
  "schemaVersion": "1.0.0",
  "lastUpdated": "2026-06-14T10:30:00.000Z",
  "data": {
    "statements": []
  },
  "aiGenerated": true,
  "generatedAt": null
}
```

#### `DATA_DIR/profile/essays.json`

```json
{
  "schemaVersion": "1.0.0",
  "lastUpdated": "2026-06-14T10:30:00.000Z",
  "data": {
    "drafts": []
  },
  "aiGenerated": true,
  "generatedAt": null
}
```

---

### API Endpoints

All responses follow the standard envelope from architecture.md:

```json
{
  "success": true | false,
  "data": { ... } | null,
  "error": null | { "code": "STRING", "message": "Human-readable" },
  "timestamp": "ISO-8601"
}
```

---

#### `GET /api/onboarding/defaults`

Returns server-computed defaults for the onboarding form. Called when Screen 3 loads.

**Request:** none

**Response (200):**
```json
{
  "success": true,
  "data": {
    "suggestedDataDir": "/Users/jane/ao-profile"
  },
  "error": null,
  "timestamp": "2026-06-14T10:30:00.000Z"
}
```

`suggestedDataDir` is computed as `os.homedir() + '/ao-profile'` on the server.

---

#### `GET /api/onboarding/status`

Called on app startup (before any screen renders) to determine whether to show onboarding or the dashboard.

**Request:** none

**Response (200) — onboarding needed:**
```json
{
  "success": true,
  "data": {
    "onboardingComplete": false,
    "reason": "DATA_DIR_NOT_SET"
  },
  "error": null,
  "timestamp": "..."
}
```

`reason` values: `"DATA_DIR_NOT_SET"` (no DATA_DIR in .env), `"PROFILE_NOT_FOUND"` (DATA_DIR set but no `.metadata.json`).

**Response (200) — onboarding complete:**
```json
{
  "success": true,
  "data": {
    "onboardingComplete": true,
    "student": {
      "firstName": "Jane",
      "lastName": "Doe",
      "displayName": "Jane Doe"
    }
  },
  "error": null,
  "timestamp": "..."
}
```

---

#### `POST /api/signup`

Creates the profile directory structure, writes all JSON files, and writes `DATA_DIR` to `.env`.

**Request body:**
```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "dataDir": "/Users/jane/ao-profile"
}
```

**Validation rules (server-side):**
- `firstName`: required, string, 1–50 chars, matches `/^[A-Za-z'\- ]{1,50}$/`
- `lastName`: optional, string, 0–50 chars, matches `/^[A-Za-z'\- ]{0,50}$/` if provided
- `dataDir`: required, non-empty string, must be absolute path (starts with `/` on POSIX, or `[A-Za-z]:\` on Windows). Must NOT match protected paths: `/System`, `/usr`, `/bin`, `/etc`, `/var`, `/Windows`, `C:\Windows`, `C:\Program Files`.

**Success response (201):**
```json
{
  "success": true,
  "data": {
    "dataDir": "/Users/jane/ao-profile",
    "student": {
      "firstName": "Jane",
      "lastName": "Doe",
      "displayName": "Jane Doe"
    },
    "filesCreated": [
      ".metadata.json",
      ".audit.json",
      "profile/academic.json",
      "profile/tests.json",
      "profile/achievements.json",
      "profile/activities.json",
      "profile/impact_statements.json",
      "profile/essays.json"
    ]
  },
  "error": null,
  "timestamp": "..."
}
```

**Error responses:**

| Status | `error.code` | Condition |
|--------|-------------|-----------|
| 400 | `VALIDATION_ERROR` | firstName missing, too long, or invalid characters |
| 400 | `INVALID_PATH` | dataDir empty or not an absolute path |
| 403 | `PROTECTED_PATH` | dataDir matches a system-protected path |
| 409 | `PROFILE_EXISTS` | `.metadata.json` already exists at dataDir |
| 500 | `WRITE_ERROR` | OS permission denied or I/O error creating directory/files |

**Side effects:**
1. Creates `DATA_DIR` directory (recursive mkdir) if it does not exist.
2. Writes all 8 JSON files listed in `filesCreated`.
3. Appends `DATA_DIR=/path` to `/.env` (or updates existing value). Uses file locking during write.
4. Writes first entry to `.audit.json`.

**409 PROFILE_EXISTS detail:** Server returns the existing student name from `.metadata.json` in `data`:
```json
{
  "success": false,
  "data": {
    "existingProfile": {
      "firstName": "Jane",
      "displayName": "Jane Doe",
      "createdAt": "2026-06-14T10:00:00.000Z"
    }
  },
  "error": { "code": "PROFILE_EXISTS", "message": "A profile already exists at this path." },
  "timestamp": "..."
}
```

---

#### `GET /api/profile/sections`

Returns current state of all 6 profile sections. Called when the Profile Dashboard loads. Used to populate section tiles with counts and empty/non-empty status.

**Request:** none

**Response (200):**
```json
{
  "success": true,
  "data": {
    "sections": {
      "academic": {
        "isEmpty": true,
        "summary": null
      },
      "tests": {
        "isEmpty": true,
        "summary": null
      },
      "achievements": {
        "isEmpty": true,
        "count": 0
      },
      "activities": {
        "isEmpty": true,
        "count": 0
      },
      "impact_statements": {
        "isEmpty": true,
        "count": 0
      },
      "essays": {
        "isEmpty": true,
        "count": 0
      }
    },
    "student": {
      "firstName": "Jane",
      "displayName": "Jane Doe"
    },
    "profileCompletionPercent": 0
  },
  "error": null,
  "timestamp": "..."
}
```

`profileCompletionPercent`: integer 0–100. On STORY-001 it is always 0. Computed in later stories as sections gain data.

**Dual-schema detection (implemented):** The reader functions `readSectionAcademic()`, `readSectionTests()`, and `readSectionItems()` in `profile.js` handle two coexisting data layouts in the same JSON files:

- **Manual-entry schema** (written by `POST /api/profile/academic/add` and similar endpoints): data is nested under the `data:` envelope — e.g., `file.data.gpa`, `file.data.school`, `file.data.ap[]`.
- **Extraction schema** (written by `profile-merge.js` from STORY-003): data is written at the top level of the JSON file — e.g., `file.gpa`, `file.schoolName`, `file.courses`, `file.achievements[]`, `file.activities[]`.

Both schemas may coexist in the same file. `readSectionAcademic()` and `readSectionTests()` check the top-level fields first; if found, they build human-readable summary strings via `buildAcademicSummary()` and `buildTestsSummary()` helpers. `readSectionItems()` checks both `file.data.items[]` and top-level arrays. The `summary` field in the response is always a plain string (or null) — never an object — because `app.js` applies `escapeHtml(String(statusLabel))` to prevent `[object Object]` display.

Any future story that reads academic, tests, achievements, or activities data from these JSON files must handle both the `file.data.*` envelope and the top-level `file.*` fields.

**Error responses:**

| Status | `error.code` | Condition |
|--------|-------------|-----------|
| 503 | `DATA_DIR_UNAVAILABLE` | DATA_DIR not set or directory missing/unreadable |
| 500 | `READ_ERROR` | I/O error reading profile JSON files |

---

#### `POST /api/profile/academic/add` (NEW — Manual Entry)

Student manually adds academic data without uploading a document.

**Request body:**
```json
{
  "gpa": "3.85",
  "gpaScale": "4.0",
  "graduationYear": "2026",
  "school": "Springfield High School"
}
```

**Validation (server-side):**
- `gpa`: required, numeric (0–5.0)
- `gpaScale`: optional, numeric (e.g., 4.0, 4.5)
- `graduationYear`: optional, numeric year (e.g., 2026)
- `school`: optional, string (1–100 chars)

**Success response (201):**
```json
{
  "success": true,
  "data": {
    "section": "academic",
    "savedAt": "2026-06-14T10:30:00.000Z"
  },
  "error": null,
  "timestamp": "..."
}
```

**Error responses:**

| Status | `error.code` | Condition |
|--------|-------------|-----------|
| 400 | `VALIDATION_ERROR` | GPA invalid, not numeric, out of range |
| 500 | `WRITE_ERROR` | Failed to write academic.json |

**Side effects:**
1. Appends/updates `academic.json` with the manually entered data.
2. Sets `confirmedByStudent: true` for all fields (since they were entered manually).
3. Sets confidence to 100 for all fields (manual entry = high confidence).
4. Adds entry to `.audit.json` with action "ACADEMIC_ADDED_MANUAL".

---

#### `POST /api/profile/tests/add` (NEW — Manual Entry)

Student manually adds test scores without uploading a document.

**Request body:**
```json
{
  "testType": "SAT",
  "testName": "SAT",
  "score": "1480",
  "testDate": "05/01/2024"
}
```

**Validation (server-side):**
- `testType`: required, one of ["SAT", "ACT", "AP", "IB", "Other"]
- `testName`: required, string (1–50 chars)
- `score`: required, numeric
- `testDate`: optional, date format MM/DD/YYYY

**Success response (201):** Same envelope as `/academic/add`, with `section: "tests"`.

---

#### `POST /api/profile/achievements/add` (NEW — Manual Entry)

Student manually adds an achievement without uploading a certificate.

**Request body:**
```json
{
  "title": "National Merit Scholar",
  "organization": "Springfield High School",
  "dateAwarded": "05/15/2024",
  "category": "academic"
}
```

**Validation (server-side):**
- `title`: required, string (1–100 chars)
- `organization`: optional, string (1–100 chars)
- `dateAwarded`: optional, date format MM/DD/YYYY
- `category`: optional, one of ["academic", "sports", "community", "other"]

**Success response (201):** Same envelope, with `section: "achievements"`.

---

#### `POST /api/profile/activities/add` (NEW — Manual Entry)

Student manually adds an activity without uploading documentation.

**Request body:**
```json
{
  "activityName": "Robotics Club",
  "role": "Team Captain",
  "organization": "Springfield High School",
  "hoursPerWeek": "8"
}
```

**Validation (server-side):**
- `activityName`: required, string (1–100 chars)
- `role`: optional, string (1–100 chars)
- `organization`: optional, string (1–100 chars)
- `hoursPerWeek`: optional, numeric (0–100)

**Success response (201):** Same envelope, with `section: "activities"`.

---

#### `GET /api/profile/activities` (List)

Returns all activity items.

**Request:** none

**Response (200):**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid-v4",
        "activityName": "Robotics Club",
        "role": "Team Captain",
        "organization": "Springfield High School",
        "hoursPerWeek": 8,
        "startDate": "2024-09-01",
        "endDate": null
      }
    ],
    "count": 1
  },
  "error": null,
  "timestamp": "..."
}
```

**Error responses:**

| Status | `error.code` | Condition |
|--------|-------------|-----------|
| 500 | `READ_ERROR` | Failed to read activities.json |

---

#### `PUT /api/profile/activities/:id` (Edit)

Updates a single activity by ID.

**URL parameter:** `id` — uuid-v4 matching an existing item in activities.json.

**Request body:**
```json
{
  "activityName": "Robotics Club",
  "role": "President",
  "organization": "Springfield High School",
  "hoursPerWeek": "10",
  "startDate": "09/01/2024",
  "endDate": ""
}
```

**Validation (server-side):**
- `activityName`: required, string, 1–100 chars.
- `organization`: required, string, 1–100 chars.
- `hoursPerWeek`: optional, numeric 0–100.
- `startDate`: optional, format MM/DD/YYYY, must be valid date not in the future.
- `endDate`: optional, format MM/DD/YYYY. If provided, must be valid date not in the future and on or after `startDate`. Empty string treated as null (ongoing).
- `role`: optional, string, 0–100 chars.

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid-v4",
    "updatedAt": "2026-06-14T11:00:00.000Z"
  },
  "error": null,
  "timestamp": "..."
}
```

**Error responses:**

| Status | `error.code` | Condition |
|--------|-------------|-----------|
| 400 | `VALIDATION_ERROR` | Any field fails validation |
| 404 | `NOT_FOUND` | No activity with that `id` exists |
| 500 | `WRITE_ERROR` | Failed to write activities.json |

**Side effects:** Updates the item in activities.json. Writes audit entry `ACTIVITY_EDITED` to `.audit.json`.

---

#### `DELETE /api/profile/activities/:id`

Removes a single activity by ID.

**URL parameter:** `id` — uuid-v4.

**Request:** no body.

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "deletedId": "uuid-v4",
    "remainingCount": 2
  },
  "error": null,
  "timestamp": "..."
}
```

**Error responses:**

| Status | `error.code` | Condition |
|--------|-------------|-----------|
| 404 | `NOT_FOUND` | No activity with that `id` exists |
| 500 | `WRITE_ERROR` | Failed to write activities.json |

**Side effects:** Removes the item from activities.json items array. Writes audit entry `ACTIVITY_DELETED` to `.audit.json`.

---

#### `GET /api/profile/achievements` (List)

Returns all achievement items.

**Request:** none

**Response (200):**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid-v4",
        "title": "National Merit Scholar",
        "description": "",
        "category": "academic",
        "dateAwarded": "2024-05-15",
        "organization": "National Merit Scholarship Corporation"
      }
    ],
    "count": 1
  },
  "error": null,
  "timestamp": "..."
}
```

**Error responses:**

| Status | `error.code` | Condition |
|--------|-------------|-----------|
| 500 | `READ_ERROR` | Failed to read achievements.json |

---

#### `PUT /api/profile/achievements/:id` (Edit)

Updates a single achievement by ID.

**URL parameter:** `id` — uuid-v4.

**Request body:**
```json
{
  "title": "National Merit Scholar",
  "description": "Awarded for top PSAT scores nationwide.",
  "category": "academic",
  "dateAwarded": "05/15/2024"
}
```

**Validation (server-side):**
- `title`: required, string, 1–100 chars.
- `category`: required, one of ["academic", "sports", "community", "other"].
- `description`: optional, string, 0–500 chars.
- `dateAwarded`: optional, format MM/DD/YYYY. Must be a valid date not in the future.

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid-v4",
    "updatedAt": "2026-06-14T11:00:00.000Z"
  },
  "error": null,
  "timestamp": "..."
}
```

**Error responses:**

| Status | `error.code` | Condition |
|--------|-------------|-----------|
| 400 | `VALIDATION_ERROR` | Any field fails validation |
| 404 | `NOT_FOUND` | No achievement with that `id` exists |
| 500 | `WRITE_ERROR` | Failed to write achievements.json |

**Side effects:** Updates the item in achievements.json. Writes audit entry `ACHIEVEMENT_EDITED`.

---

#### `DELETE /api/profile/achievements/:id`

Removes a single achievement by ID.

**Request:** no body.

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "deletedId": "uuid-v4",
    "remainingCount": 0
  },
  "error": null,
  "timestamp": "..."
}
```

**Error responses:**

| Status | `error.code` | Condition |
|--------|-------------|-----------|
| 404 | `NOT_FOUND` | No achievement with that `id` exists |
| 500 | `WRITE_ERROR` | Failed to write achievements.json |

**Side effects:** Removes the item from achievements.json items array. Writes audit entry `ACHIEVEMENT_DELETED`.

---

#### `GET /api/profile/academic/exam-scores` (List)

Returns all AP and IB exam scores, merged from both storage locations.

**Request:** none

**Response (200):**
```json
{
  "success": true,
  "data": {
    "ap": [
      {
        "id": "uuid-v4",
        "courseName": "AP Biology",
        "examType": "AP",
        "score": 5,
        "dateTaken": "2024-05"
      }
    ],
    "ib": [],
    "count": 1
  },
  "error": null,
  "timestamp": "..."
}
```

**Implementation note:** The response merges scores from two sources into unified `ap` and `ib` arrays: `academic.json.apIbScores[]` (manual-entry path) and `tests.json.data.ap[]`/`tests.json.data.ib[]` (extraction path). Items from both sources are included. The Academic detail page uses this endpoint — not the section data from `GET /api/profile/sections` — to obtain IDs needed for Edit/Delete buttons.

**Error responses:**

| Status | `error.code` | Condition |
|--------|-------------|-----------|
| 500 | `READ_ERROR` | Failed to read academic.json or tests.json |

---

#### `PUT /api/profile/academic/exam-score/:id` (Edit)

Updates a single AP or IB exam score by ID.

**URL parameter:** `id` — uuid-v4 matching an item in `tests.json` `ap` or `ib` array.

**Request body:**
```json
{
  "courseName": "AP Biology",
  "examType": "AP",
  "score": "5",
  "dateTaken": "05/2024"
}
```

**Validation (server-side):**
- `courseName`: required, string, 1–100 chars.
- `examType`: required, one of ["AP", "IB"].
- `score`: required, integer. If examType is "AP": 1–5. If "IB": 1–7. Error: `SCORE_OUT_OF_RANGE`.
- `dateTaken`: optional, format MM/YYYY. Must be a valid month/year in the past. Stored as "YYYY-MM".

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid-v4",
    "updatedAt": "2026-06-14T11:00:00.000Z"
  },
  "error": null,
  "timestamp": "..."
}
```

**Error responses:**

| Status | `error.code` | Condition |
|--------|-------------|-----------|
| 400 | `VALIDATION_ERROR` | Any field fails validation |
| 400 | `SCORE_OUT_OF_RANGE` | Score outside allowed range for examType |
| 404 | `NOT_FOUND` | No exam score with that `id` found in academic.json.apIbScores[], tests.json.data.ap[], or tests.json.data.ib[] |
| 500 | `WRITE_ERROR` | Failed to write academic.json or tests.json |

**Side effects:** Searches for the score by `id` in `academic.json.apIbScores[]` first; if not found, searches `tests.json.data.ap[]` then `tests.json.data.ib[]`. Updates the item in-place in whichever file it is found. If `examType` changes (e.g., AP → IB) and the item is in `tests.json`, moves it from the `ap` array to the `ib` array within that file. Writes audit entry `EXAM_SCORE_EDITED`.

---

#### `DELETE /api/profile/academic/exam-score/:id`

Removes a single AP or IB exam score by ID.

**Request:** no body.

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "deletedId": "uuid-v4",
    "remainingCount": 0
  },
  "error": null,
  "timestamp": "..."
}
```

**Error responses:**

| Status | `error.code` | Condition |
|--------|-------------|-----------|
| 404 | `NOT_FOUND` | No exam score with that `id` exists |
| 500 | `WRITE_ERROR` | Failed to write tests.json |

**Side effects:** Searches for the score by `id` in `academic.json.apIbScores[]` first; if not found, searches `tests.json.data.ap[]` then `tests.json.data.ib[]`. Removes the item from whichever file and array it is found in. Writes audit entry `EXAM_SCORE_DELETED`.

---

#### `GET /api/settings`

Returns current settings from `.env` for display in the Settings screen.

**Request:** none

**Response (200):**
```json
{
  "success": true,
  "data": {
    "port": 3000,
    "dataDir": "/Users/jane/ao-profile",
    "geminiModel": "gemini-2.0-flash-exp",
    "geminiApiKeySet": true
  },
  "error": null,
  "timestamp": "..."
}
```

Notes:
- `geminiApiKeySet`: boolean — true if `GEMINI_API_KEY` is non-empty in `.env`. The actual key value is returned separately only when the Settings screen explicitly requests it via `GET /api/settings/key`.
- `dataDir` is included for display but is not editable via `POST /api/settings`.

#### `GET /api/settings/key`

Returns the raw `GEMINI_API_KEY` value for display in the masked input when user clicks "Show". Separate endpoint to avoid leaking the key in normal settings load.

**Response (200):**
```json
{
  "success": true,
  "data": { "geminiApiKey": "AIzaSy..." },
  "error": null,
  "timestamp": "..."
}
```

**Error (500)** if `.env` is unreadable.

---

#### `POST /api/settings`

Saves editable settings back to `.env`.

**Request body:**
```json
{
  "port": 3000,
  "geminiModel": "gemini-2.0-flash-exp",
  "geminiApiKey": "AIzaSy..."
}
```

**Validation (server-side):**
- `port`: required, integer, 1024–65535.
- `geminiModel`: required, string, 1–60 chars.
- `geminiApiKey`: required, string, 1–256 chars. (Sending the current masked value unchanged is handled by the frontend sending the actual key only if the user edited it; if unchanged, the field is omitted from the request body. Server treats absent `geminiApiKey` as "do not update".)

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "saved": ["port", "geminiModel", "geminiApiKey"],
    "portChanged": false
  },
  "error": null,
  "timestamp": "..."
}
```

`portChanged: true` when the PORT value actually changed (frontend uses this to show the restart banner).

**Error responses:**

| Status | `error.code` | Condition |
|--------|-------------|-----------|
| 400 | `VALIDATION_ERROR` | port out of range, geminiModel empty |
| 500 | `WRITE_ERROR` | Failed to write `.env` |

**Side effects:** Updates matching key-value pairs in `.env` using a line-by-line read-modify-write. File locking during write (same pattern as `POST /api/signup`).

---

#### `GET /api/settings/export`

Returns a downloadable config snapshot. Triggers file download in browser.

**Response:** HTTP 200 with headers:
```
Content-Type: application/json
Content-Disposition: attachment; filename="ao-config-export-2026-06-14.json"
```

**Response body:**
```json
{
  "exportedAt": "2026-06-14T10:30:00.000Z",
  "appVersion": "1.0.0",
  "config": {
    "port": 3000,
    "dataDir": "/Users/jane/ao-profile",
    "geminiModel": "gemini-2.0-flash-exp",
    "geminiApiKey": "[REDACTED]"
  }
}
```

`GEMINI_API_KEY` is always redacted as `"[REDACTED]"` in the export — never exported in plaintext.

---

## AI integration

N/A — no AI in this story. All operations are local file I/O and form handling. No Gemini API calls are made during signup or profile initialization.

---

## Enterprise checks

**Auth:** No authentication required. This is a single-user local desktop app. No login, no session tokens. All API endpoints are open on localhost. Access is implicitly restricted by OS-level network binding (localhost only — server must bind to `127.0.0.1`, not `0.0.0.0`).

**Input validation:**
- Client-side: inline validation on form submit for all fields:
  - Signup form: firstName, lastName, dataDir. Errors shown inline below each field.
  - Manual entry modals: section-specific fields (GPA, test scores, achievement titles, etc.). Errors shown inline.
  - Edit modals: all editable fields validated client-side before PUT call. Inline errors shown below the invalid field inside the modal.
- Server-side: All endpoints re-validate fields independent of client. Server is the source of truth. Both layers required.
- Server-side validation rules explicitly documented in the endpoint section above.
- Manual entry endpoints (`/academic/add`, `/tests/add`, `/achievements/add`, `/activities/add`) validate all fields and reject invalid data with 400 VALIDATION_ERROR.
- Edit endpoints (`PUT /api/profile/activities/:id`, `PUT /api/profile/achievements/:id`, `PUT /api/profile/academic/exam-score/:id`) apply the same validation rules as their corresponding add endpoints. Score range for AP/IB is validated server-side with distinct error code `SCORE_OUT_OF_RANGE`.
- Delete endpoints return 404 NOT_FOUND if the `id` does not exist — client shows error toast "Item not found. It may have already been deleted."

**Error states:**
- Empty firstName → inline error below field (Screen 2)
- Invalid name characters → inline error below field (Screen 2)
- Empty or relative dataDir → inline error below field (Screen 3)
- Protected path → `alert-danger` on Screen 3 (non-dismissible until path changes)
- Write permission denied → `alert-danger` on Screen 3 with actionable message
- Profile already exists at path → modal with two actionable choices (Screen 3)
- Profile dashboard load failure → full-width `alert-danger` with [Retry] button (Screen 4)
- Server not reachable → Screen 3 shows `alert-danger`: "Cannot reach the AO server. Make sure `npx ao` is still running."
- Settings load failure → `alert-danger` on Screen 6 with [Retry] button
- Settings save failure → `alert-danger` on Screen 6 with the error reason
- PORT out of range → inline error below PORT field on Screen 6
- Edit modal save failure (API 400/500) → `alert-danger` inside the modal, above form fields. Modal stays open so user can correct or retry.
- Edit modal validation failure (client-side) → inline error below the offending field. Save button does not call API.
- Delete confirmation failure (API 500) → `alert-danger` inside the confirmation modal. [Delete] button re-enabled so user can retry.
- Delete 404 NOT_FOUND → error toast "Item not found. It may have already been deleted." Modal closes; list is refreshed.
- AP/IB score out of range → inline error inside edit modal "Score must be between 1 and 5 for AP" or "Score must be between 1 and 7 for IB."
- Browser navigates to unknown route → server returns `index.html` and JS router falls through to Dashboard (if onboarding complete) or Welcome (if not). No 404 is shown to the user.

**Data safety:** The onboarding is a two-step form. Student name is stored in `localStorage` key `ao_onboarding` after Screen 2 is validated, so pressing "Back" from Screen 3 restores the name fields. No data is written to disk until "Create Profile" is clicked and `POST /api/signup` succeeds. If the browser is closed mid-onboarding (between Screens 1–3), no partial data is on disk. `localStorage` may retain the entered name; on next launch `GET /api/onboarding/status` determines whether to show onboarding or dashboard.

For edit/delete operations: the user can close the edit modal at any point before clicking [Save Changes] — no changes are written. For delete: the confirmation modal requires an explicit [Delete] click; closing the modal or clicking [Cancel] makes no changes. If the browser is closed during an active edit-modal session (before [Save Changes]), no partial write occurs — data on disk remains as it was.

**Rate limiting / abuse:** `POST /api/signup` is called once per profile setup — not a candidate for abuse. No rate limiting required for this endpoint. `GET /api/profile/sections` is called on each dashboard load — add a simple 60-requests-per-minute limit using an in-memory counter (resets on server restart) to prevent pathological scripted access.

**AI fallback:** N/A — no AI in this story.

**Export page (STORY-005 boundary note):** The full export feature (JSON/PDF profile export and shareable links) is owned by STORY-005. STORY-001 is responsible only for the Settings screen "Export Config" button (`GET /api/settings/export`), which exports the app configuration file (not the student profile). Any navigation to `/export` is out of scope for STORY-001 — that route will be established in STORY-005. If the user somehow navigates to `/export` before STORY-005 is built, the JS router should display a placeholder: "Export is not available yet. Complete earlier steps first."

---

## Acceptance criteria

1. Running `npx ao` opens `http://localhost:3000` in the default browser and displays the Welcome Screen with the "Get Started" button within 3 seconds of the command executing.
2. Clicking "Get Started" shows the Name Entry form (Screen 2). Clicking "Continue" with an empty first name shows the inline error "First name is required" and does not advance the form.
3. Clicking "Continue" with a first name containing digits or special characters (e.g., "Jane123") shows the inline error "Name may only contain letters, hyphens, apostrophes, and spaces."
4. Entering a valid first name (e.g., "Jane") and clicking "Continue" advances to the Directory Selection screen (Screen 3) with the path field pre-filled with the OS home directory + `/ao-profile`.
5. Entering a protected path (e.g., `/usr/bin`) on Screen 3 and clicking "Create Profile" shows an `alert-danger` message identifying the path as protected.
6. Entering a valid writable path and clicking "Create Profile" calls `POST /api/signup`, creates the directory on disk, and writes all 8 JSON files (`metadata.json`, `.audit.json`, and 6 profile section files).
7. After successful signup, the browser redirects to the Profile Dashboard showing all 6 section tiles (Academic, Tests, Achievements, Activities, Impact Statements, Generated Essays), each showing "Empty" or "0 items."
8. The student's first name appears in the dashboard greeting (e.g., "Welcome, Jane!").
9. Running `npx ao` a second time (with `DATA_DIR` already set and `.metadata.json` present) skips onboarding entirely and loads the Profile Dashboard directly.
10. If the user selects a `dataDir` that already contains a valid AO profile, a modal appears offering "Open Existing Profile" or "Choose Different Directory" — the form does not silently overwrite the existing profile.
11. The Profile Dashboard's "Generate" buttons for Impact Statements and Generated Essays are visually disabled and show a tooltip "Upload documents or add data first to enable this."
12. The onboarding hint banner ("[bi-info-circle] Tip: Upload documents for AI extraction, or add entries manually.") is visible on the Profile Dashboard immediately after signup.
13. (NEW) Each data section tile (Academic, Tests, Achievements, Activities) shows two action buttons: `[Upload docs]` and `[Add manually]`, both clickable on the empty state.
14. (NEW) Clicking `[Add manually]` on the Academic tile opens a modal with fields for GPA, GPA Scale, Graduation Year, and School Name. Entering a valid GPA and clicking "Save" calls `POST /api/profile/academic/add`, closes the modal, and updates the tile to show "Empty" → "1 item".
15. (NEW) Clicking `[Add manually]` on the Tests tile opens a modal with fields for Test Type (dropdown), Test Name, Score, and Test Date. Entering valid data and clicking "Save" calls `POST /api/profile/tests/add` and updates the tile count.
16. (NEW) Similar modals exist for Achievements and Activities, with section-specific fields. Clicking "Save" calls the corresponding endpoint and updates the section tile.
17. (NEW) Manual entry fields validate client-side before API call (e.g., GPA must be numeric, within 0–5.0). Invalid input shows inline error below the field; the Save button does not trigger an API call.
18. Manual entry endpoints return 400 VALIDATION_ERROR if server-side validation fails. Frontend shows `alert-danger` with the error message.
19. (SPA routing) Clicking "Get Started", "Continue", "Back", and "Create Profile" each push a new entry into browser history. Pressing the browser back button from Screen 3 returns to Screen 2 with the previously entered name still populated in the fields.
20. (SPA routing) Pressing browser back from the Dashboard (when arrived via onboarding) does not re-enter onboarding — the router detects that onboarding is complete and redirects forward to `/`.
21. (SPA routing) Navigating directly to `/onboarding/name` or `/onboarding/directory` in the URL bar renders the correct screen (server serves `index.html` for all routes; JS router handles the path).
22. (Home link) Clicking the "Admissions Officer" app name in the navbar from the Settings page navigates to the Profile Dashboard at `/` without a full page reload.
23. (Settings screen) Clicking the gear icon in the navbar opens the Settings screen at `/settings` showing PORT, DATA_DIR (read-only), GEMINI_MODEL, and GEMINI_API_KEY (masked) fields.
24. (Settings screen) DATA_DIR field on the Settings screen is read-only — clicking it shows a tooltip and no text cursor appears in the field.
25. (Settings screen) Entering PORT value 999 (below 1024) on the Settings screen and clicking "Save Settings" shows inline error "Port must be a number between 1024 and 65535" and does not call `POST /api/settings`.
26. (Settings screen) Entering a valid PORT (e.g., 8080) and clicking "Save Settings" calls `POST /api/settings`, saves to `.env`, and shows success toast "Settings saved." and a persistent info banner "Port change will take effect after restarting `npx ao`."
27. (Settings screen) GEMINI_API_KEY field renders as a masked password input by default. Clicking "Show" reveals the plaintext key; clicking "Hide" masks it again.
28. (Settings screen) Clicking "Export Config" triggers a file download named `ao-config-export-[YYYY-MM-DD].json` containing PORT, DATA_DIR, GEMINI_MODEL, and `"[REDACTED]"` for GEMINI_API_KEY.
29. (View All) After manually adding at least one item to the Achievements section, the Achievements tile shows a "View All" link. Clicking it navigates to `/section/achievements` using pushState and renders a list of all achievement items without a full page reload.
30. (View All) Sections with zero items do not show a "View All" or "View Details" button — only the action buttons ([Upload docs], [Add manually]) are shown.
31. (Activities Edit) Navigating to `/section/activities` with at least one activity shows each activity in a card with [Edit] and [Delete] buttons. Clicking [Edit] opens a modal pre-populated with that activity's current values: activityName, role, organization, hoursPerWeek, startDate, endDate.
32. (Activities Edit save) Changing the role to "President" in the edit modal and clicking [Save Changes] calls `PUT /api/profile/activities/:id`, closes the modal, and updates the activity card in-place to show the new role — no page reload occurs.
33. (Activities Edit validation) Clearing the Activity Name field in the edit modal and clicking [Save Changes] shows the inline error "Activity name is required" and does not call the API.
34. (Activities Delete) Clicking [Delete] on an activity card opens a confirmation modal showing the activity name. Clicking [Cancel] closes the modal with no changes. Clicking [Delete] in the modal calls `DELETE /api/profile/activities/:id`, removes the card from the list, shows the toast "Activity deleted", and decrements the Activities count on the dashboard.
35. (Achievements Edit) Navigating to `/section/achievements` with at least one achievement shows each achievement card with [Edit] and [Delete] buttons. Clicking [Edit] opens a modal pre-populated with title, description, category, and dateAwarded.
36. (Achievements Edit save) Changing the category in the edit modal and clicking [Save Changes] calls `PUT /api/profile/achievements/:id`, updates the card in-place, and shows the toast "Achievement updated."
37. (Achievements Edit validation) Submitting the achievements edit modal with an empty title shows the inline error "Title is required" without calling the API. Submitting with no category selected shows "Please select a category."
38. (Achievements Delete) Clicking [Delete] on an achievement card, confirming, calls `DELETE /api/profile/achievements/:id`, removes the card, shows the toast "Achievement deleted", and decrements the Achievements dashboard count.
39. (AP/IB Score Edit) The Academic detail page at `/section/academic` shows all AP and IB scores with [Edit] and [Delete] buttons on each row. Clicking [Edit] opens the Edit Exam Score modal pre-populated with courseName, examType, score, and dateTaken.
40. (AP/IB Score Edit save) Changing score from 4 to 5 on an AP score and clicking [Save Changes] calls `PUT /api/profile/academic/exam-score/:id`, updates the score row in-place, and shows the toast "Exam score updated."
41. (AP/IB Score validation — range) Entering score 6 for an AP exam in the edit modal and clicking [Save Changes] shows the inline error "Score must be between 1 and 5 for AP." Entering score 8 for an IB exam shows "Score must be between 1 and 7 for IB." Neither error triggers an API call.
42. (AP/IB Score Delete) Clicking [Delete] on an AP/IB score row and confirming calls `DELETE /api/profile/academic/exam-score/:id`, removes the score row, shows the toast "Exam score deleted." Any badge linked to that score on a course row is also removed from the display.
43. (Edit modal pre-population) All edit modals (activities, achievements, AP/IB scores) must show the current saved values in their respective input fields immediately upon opening — no empty or default values.
44. (Back navigation from detail pages) Clicking the "Back to Dashboard" link on Screens 7, 8, and 9 returns to the Profile Dashboard at `/` using pushState without a full page reload. Browser back button achieves the same result.
45. (Consistency — delete with error) If `DELETE /api/profile/activities/:id` returns 500, the confirmation modal stays open, shows `alert-danger` inside: "Could not delete activity. Please try again." The [Delete] button is re-enabled.

---

## Known risks

1. **File system permissions:** The user may select a directory they do not have write access to (e.g., a network share, an external drive with read-only mount). Mitigation: `POST /api/signup` performs a test write (create and delete a temp file) before writing actual profile files. If test write fails, return `500 WRITE_ERROR` with a clear message.

2. **Invalid or dangerous directory paths:** User may type `/` (root), `/System` (macOS), or a path inside an existing application. Mitigation: Server-side blocklist of protected prefixes (documented in endpoint spec). Client-side shows a warning if path is unusually short (fewer than 5 characters).

3. **Profile already exists at path:** User reruns setup with a path that already has a profile. Mitigation: 409 PROFILE_EXISTS response and modal UI — no silent overwrite. See Screen 3 conflict handling.

4. **`.env` write failure:** Writing `DATA_DIR` to `.env` may fail if the project directory is read-only (e.g., installed globally via npm to a system path). Mitigation: If `.env` write fails, return `500 WRITE_ERROR` and instruct user in the error message: "Could not update .env. Please add `DATA_DIR=/your/chosen/path` manually to the .env file in AO's installation directory."

5. **Port conflict:** Port 3000 in use by another process. Mitigation: CLI reads `PORT` from `.env` (default 3000); if bind fails, print clear terminal error and exit with code 1. Do not silently fall back to a random port without notifying the user.

---

## Frontend implementation

### File locations (per architecture.md guardrail)

- `src/public/index.html` — single HTML file, all screens rendered by JS
- `src/public/js/app.js` — main application logic, screen routing
- `src/public/js/api-client.js` — fetch() wrappers for all API calls
- `src/public/js/ui-utils.js` — DOM manipulation, form validation helpers
- `src/public/css/custom.css` — Bootstrap theme overrides

### HTML structure (index.html skeleton)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Admissions Officer</title>
  <link rel="stylesheet" href="/css/bootstrap.min.css">
  <link rel="stylesheet" href="/css/bootstrap-icons.css">
  <link rel="stylesheet" href="/css/custom.css">
</head>
<body>
  <!-- Navbar (hidden during onboarding, visible on dashboard) -->
  <nav id="app-navbar" class="navbar navbar-dark bg-primary d-none">
    <div class="container-fluid">
      <a href="/" id="nav-home" class="navbar-brand" onclick="event.preventDefault(); appNavigate('/')">
        <i class="bi bi-mortarboard"></i> Admissions Officer
      </a>
      <a href="/settings" id="nav-settings" class="text-white" onclick="event.preventDefault(); appNavigate('/settings')">
        <i class="bi bi-gear"></i>
      </a>
    </div>
  </nav>

  <!-- Screen container — JS swaps content here -->
  <main id="app-screen" class="container py-5"></main>

  <script src="/js/api-client.js"></script>
  <script src="/js/ui-utils.js"></script>
  <script src="/js/app.js"></script>
</body>
</html>
```

### JS routing logic (app.js)

On DOM load, `app.js` calls `GET /api/onboarding/status`:
- If `onboardingComplete: false` → render Welcome Screen into `#app-screen`.
- If `onboardingComplete: true` → show navbar, render Profile Dashboard.

Screens are rendered by template functions that return HTML strings inserted via `innerHTML`. No frameworks.

**SPA routing — browser history support:**

Screen transitions must use `history.pushState` to update the URL and record an entry in the browser's history stack. `window.addEventListener('popstate', ...)` handles browser back/forward events and re-renders the appropriate screen. The server must serve `index.html` for all unknown paths so that direct URL navigation (or F5 refresh) works.

Route map:
| URL path | Screen rendered |
|----------|-----------------|
| `/` | Profile Dashboard (if onboarding complete) or Welcome Screen |
| `/onboarding/name` | Name Entry Form (Screen 2) |
| `/onboarding/directory` | Data Directory Selection (Screen 3) |
| `/settings` | Settings Screen (Screen 6) |
| `/section/activities` | Activities Detail Page (Screen 7) |
| `/section/achievements` | Achievements Detail Page (Screen 8) |
| `/section/academic` | Academic Detail Page (Screen 9 — includes AP/IB scores) |

Navigation rules:
- Clicking "Get Started" on Welcome → `pushState('/onboarding/name')`, render Screen 2.
- Clicking "Continue" (valid) on Screen 2 → `pushState('/onboarding/directory')`, render Screen 3.
- Clicking "Back" on Screen 3 → `pushState('/onboarding/name')`, render Screen 2.
- After successful `POST /api/signup` → `pushState('/')`, render Dashboard.
- Clicking app name in navbar → `pushState('/')`, render Dashboard.
- Clicking gear icon in navbar → `pushState('/settings')`, render Settings Screen.
- Browser back from Screen 3 → `popstate` fires, route to `/onboarding/name` → render Screen 2. `localStorage` values are restored into the form.
- Browser back from Dashboard (if arrived from onboarding) → `popstate` fires, route to `/onboarding/directory`. Because `DATA_DIR` is already set, `GET /api/onboarding/status` would return `onboardingComplete: true`; detect this and redirect forward to `/` automatically to prevent re-onboarding.

`popstate` handler pseudo-code:
```js
window.addEventListener('popstate', (e) => {
  const path = window.location.pathname;
  router(path);
});

function router(path) {
  if (path === '/settings') { renderSettings(); return; }
  // check onboarding status first
  getOnboardingStatus().then(status => {
    if (!status.onboardingComplete) {
      if (path === '/onboarding/directory') renderDirectoryScreen();
      else renderNameScreen();
    } else {
      renderDashboard(status.student);
    }
  });
}
```

### Form validation (ui-utils.js)

`validateField(inputEl, rules)` — validates a single input against a rules object:
```js
{ required: true, maxLength: 50, pattern: /^[A-Za-z'\- ]{1,50}$/, patternMessage: "..." }
```
Returns `{ valid: boolean, message: string }`. Caller adds/removes Bootstrap `is-invalid` class and populates `.invalid-feedback` sibling element.

### API client (api-client.js)

All functions return `{ success, data, error, timestamp }` matching the server envelope. Network errors (fetch throws) are caught and normalized:
```js
async function signup(firstName, lastName, dataDir) { ... }
async function getOnboardingStatus() { ... }
async function getOnboardingDefaults() { ... }
async function getProfileSections() { ... }
// Activities
async function getActivities() { ... }
async function addActivity(payload) { ... }
async function updateActivity(id, payload) { ... }
async function deleteActivity(id) { ... }
// Achievements
async function getAchievements() { ... }
async function addAchievement(payload) { ... }
async function updateAchievement(id, payload) { ... }
async function deleteAchievement(id) { ... }
// AP/IB Exam Scores
async function getExamScores() { ... }
async function addTestScore(payload) { ... }
async function updateExamScore(id, payload) { ... }
async function deleteExamScore(id) { ... }
```

### State management

During onboarding: `localStorage.setItem('ao_onboarding', JSON.stringify({ firstName, lastName }))`. Cleared after successful signup (after dashboard loads).

Dashboard state: fetched fresh from `GET /api/profile/sections` on each load. Not cached in localStorage (profile data lives on disk, localStorage is not the source of truth).

### Bootstrap classes used

| Element | Classes |
|---------|---------|
| Welcome screen card | `card shadow-sm p-5 text-center mx-auto` (max-width 480px) |
| Onboarding form | `card shadow-sm p-4 mx-auto` (max-width 480px) |
| Progress bar | `progress-bar bg-primary` |
| Section tiles | `card h-100 text-center p-3 shadow-sm` |
| Section grid | `row row-cols-2 g-3` |
| Empty state label | `text-muted small` |
| Onboarding hint | `alert alert-info d-flex align-items-center` |
| Error alerts | `alert alert-danger` |
| Primary button | `btn btn-primary` |
| Disabled generate button | `btn btn-outline-secondary disabled` |

---

## Change history

| Release | Date | Summary | Type |
|---------|------|---------|------|
| 1.0.0 | 2026-06-14 | Initial spec authored | feature |
| 1.0.0 | 2026-06-14 | Bug-fix pass: SPA routing with browser history support; home link on app name; Settings screen (PORT/DATA_DIR/GEMINI_MODEL/GEMINI_API_KEY/export config); export page boundary note (STORY-005); View All / View Details buttons on non-empty section cards; 12 new acceptance criteria | fix |
| 1.1.2 | 2026-06-14 | Bug-fix pass: full CRUD (edit + delete) for Activities, Achievements, and AP/IB Exam Scores. Added Screens 7/8/9, edit/delete modals with pre-population and inline validation, 6 new API endpoints (PUT/DELETE for activities, achievements, exam-score), tests.json schema extended with per-item id and ib array, activities/achievements item schemas extended with startDate/endDate/description/category fields, 15 new acceptance criteria (31–45), enterprise checks updated for edit/delete error states and data safety, api-client.js updated with 8 new functions. | fix |
| 1.1.2 | 2026-06-15 | Gap merged: GET /api/profile/sections now handles dual schema — manual-entry data nested under file.data.* and extraction data at top level file.* (written by profile-merge.js). Added dual-schema detection note to Data and backend section and GET /api/profile/sections endpoint. Summary field is always a plain string. | gap-merge |
| 1.1.2 | 2026-06-15 | Gap merged: AP/IB exam scores stored in two locations — academic.json.apIbScores[] (manual entry via add-exam-score endpoint) and tests.json.data.ap[]/ib[] (STORY-003 extraction). All CRUD endpoints search both locations; GET merges both into unified response. Updated tests.json schema, GET/PUT/DELETE exam-score endpoint docs, and error tables to reflect dual-storage reality. | gap-merge |
