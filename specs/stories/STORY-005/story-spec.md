---
story_id: STORY-005
title: "Profile export (JSON, PDF) and shareable links"
depends_on:
  - STORY-004
spec_done: true
---

## What the user can do

- User can navigate to a dedicated Export page (`/export`) from the Profile Dashboard header "Export" button or from the Settings page — the page renders immediately with three panels: Export JSON, Export PDF, and Share Links.
- User can download a zip archive of their entire profile as structured JSON files — clicking "Download JSON" shows a loading spinner, then triggers a browser file download; success and error states are displayed inline in the panel.
- User can generate a formatted PDF summary of their profile (name, GPA, test scores, achievements, activities, impact statements) — clicking "Download PDF" shows a loading spinner, then triggers a browser file download; success and error states are displayed inline in the panel.
- User can generate a time-limited (1–30 days, default 7) read-only shareable link and copy it to the clipboard to send to recommenders — the link serves a public read-only view of the profile summary from the local app.
- User can view a table of all active shareable links (with expiry date and access count) and revoke any link instantly, making it immediately inaccessible.
- User can use browser back/forward buttons while on the Export page — the SPA router treats `/export` as a first-class route using `pushState`, so back navigates correctly to the previous page.

---

## Screens and states

### Screen 1 — Profile Dashboard (Export entry point)

**Entry point:** User navigates to `/` (or the Profile Dashboard page, established in STORY-004). The Dashboard displays a clickable Export card among the profile section cards.

**What it displays:**
- An Export card rendered as a full-card clickable link using the `card-link` CSS class. The card contains a `bi-download` Bootstrap Icon and the label "Export Profile".
- The card is always visible when the profile has at least one non-empty section (academic, tests, achievements, activities, or impact statements).
- If the profile is completely empty (no data in any section), the Export card is visually dimmed (`opacity: 0.5; pointer-events: none;`) and shows a Bootstrap tooltip on hover/focus: "Add profile data before exporting." The card is not navigable in this state.
- There is no separate "Export" header button. The card itself is the sole entry point from the Dashboard.

**Card-as-link implementation:**
```html
<div
  class="card card-link"
  id="card-export"
  role="button"
  tabindex="0"
  aria-label="Export Profile — go to export page"
  data-navigate="/export"
>
  <div class="card-body text-center">
    <i class="bi bi-download fs-2 mb-2 d-block"></i>
    <span class="card-title h6">Export Profile</span>
  </div>
</div>
```

CSS for `card-link` (add to `src/public/css/app.css`; this class is shared across all card-as-link instances in the app):
```css
.card-link {
  cursor: pointer;
  transition: box-shadow 0.15s ease, transform 0.1s ease;
  text-decoration: none;
  color: inherit;
}
.card-link:hover,
.card-link:focus {
  box-shadow: 0 0.25rem 0.75rem rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
  outline: 2px solid var(--bs-primary);
  outline-offset: 2px;
}
.card-link:active {
  transform: translateY(0);
}
```

**Keyboard accessibility:**
- The card has `tabindex="0"` so Tab moves focus to it.
- Pressing Enter or Space while the card is focused triggers navigation to `/export` (same as click). Implement in `dashboard.js`:
  ```javascript
  document.querySelectorAll('.card-link').forEach(card => {
    card.addEventListener('click', () => navigate(card.dataset.navigate));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        navigate(card.dataset.navigate);
      }
    });
  });
  ```

**Actions:**
- Click or Enter/Space on Export card (enabled) → SPA router navigates to `/export` using `history.pushState({ page: 'export' }, '', '/export')`. The Export page (Screen 2) is rendered in-place; the Dashboard is hidden.
- Click or Enter/Space on Export card (disabled, profile empty) → no navigation; tooltip shown.

**Settings page entry point:** The Settings page (accessible via the `bi-gear` icon in the navbar, URL `/settings`) includes a "Profile Export" section at the bottom with a link button: `[Go to Export Page]`. Clicking it navigates to `/export` via `pushState` the same way as above.

---

### Screen 2 — Export Page (`/export`)

**Entry point:**
- User clicks the enabled Export button on Screen 1 (Dashboard).
- User clicks "Go to Export Page" on the Settings page.
- User loads `http://localhost:3000/export` directly in the browser.

The server serves `index.html` for all routes including `/export`; the SPA router in `app.js` reads `window.location.pathname` on load and renders the Export page if it equals `/export`.

**What it displays:**
A full-page view (not a modal) with a page title "Export Profile" and three side-by-side Bootstrap `card` panels inside a `row g-3`. The page uses the same navbar as all other SPA pages (app logo + gear icon). A `[← Back to Dashboard]` `btn-link` appears above the panels.

```
+----------------------------------------------------------+
|  [bi-mortarboard] Admissions Officer         [bi-gear]   |
+----------------------------------------------------------+
|  [← Back to Dashboard]                                   |
|                                                          |
|  Export Profile                                          |
|                                                          |
|  +------------------+  +-----------------+  +----------+|
|  | [bi-file-zip]    |  | [bi-file-pdf]   |  |[bi-link] ||
|  |                  |  |                 |  |          ||
|  | Download JSON    |  | Download PDF    |  |  Share   ||
|  |                  |  |                 |  |  Link    ||
|  | All profile data |  | Formatted 1-3   |  | Generate ||
|  | as a .zip file.  |  | page summary.   |  | a timed  ||
|  | Full portability.|  | Great for       |  | read-only||
|  |                  |  | advisors.       |  | link.    ||
|  | [Download JSON]  |  | [Download PDF]  |  | [Create] ||
|  +------------------+  +-----------------+  +----------+|
+----------------------------------------------------------+
```

**Loading state (per panel):** When a download button is clicked, the button is immediately replaced with a Bootstrap spinner inside that card: `<span class="spinner-border spinner-border-sm" role="status"></span> Preparing...`. The other two panels remain fully interactive.

**Actions and outcomes:**
- Click "Download JSON" → button shows spinner; backend call to `POST /api/export/json`; on success, browser download triggers for the zip file; card transitions to inline success state (Screen 3). On error, card transitions to inline error state (Screen 3 error).
- Click "Download PDF" → button shows spinner; backend call to `POST /api/export/pdf`; on success, browser download triggers for the PDF; card transitions to inline success state (Screen 4). On error, card transitions to inline error state (Screen 4 error).
- Click "Create" → the Share Links panel expands in-place (the card grows, no page navigation) to show the link generation sub-panel (Screen 5). The other two cards remain visible above it.
- Click `[← Back to Dashboard]` → `history.pushState({ page: 'dashboard' }, '', '/')` is called; the SPA router renders the Dashboard and hides the Export page.
- Browser back button → the browser navigates back to the previous `pushState` entry (Dashboard or Settings). The SPA router's `popstate` listener handles this and re-renders the appropriate page.

**Empty state:** If `GET /api/profile/summary` returns all sections empty, show a `alert-warning` banner at the top of the Export page: "Your profile is empty — add data before exporting. [Go to Dashboard]". The Download JSON and Download PDF buttons remain visible but are disabled. The Share Link panel Create button is also disabled.

---

### Screen 3 — JSON Export Success/Error State (inline in Export page JSON card)

**Entry point:** `POST /api/export/json` resolves (success or error).

**Success state (replaces the Download JSON button):**
```
+------------------+
| [bi-check-circle]|  (text-success icon)
|                  |
| Ready to         |
| download:        |
| ao-profile-      |
| Jane-20260614.zip|
|                  |
| [Download Again] |
+------------------+
```
- Filename shown uses student's first name and today's date in `YYYYMMDD` format.
- "Download Again" button re-triggers the same download without a new server call (uses the same blob URL cached in memory for the session).

**Error state (replaces the Download JSON button):**
```
+------------------+
| [bi-exclamation] |  (text-danger icon)
|                  |
| Export failed.   |
| Check disk space |
| and try again.   |
|                  |
| [Try Again]      |
+------------------+
```
- Specific error message is shown based on the `error.code` from the API response: `ZIP_FAILED` → "Check disk space and try again."; `PROFILE_EMPTY` → "Profile is empty — add data first."; `DATA_DIR_MISSING` → "Data directory is not configured. Restart AO and complete setup."; any other → "Export failed. Please try again."
- "Try Again" button restores the card to its initial state (Download JSON button) and the user can retry.

---

### Screen 4 — PDF Export Success/Error State (inline in Export page PDF card)

**Entry point:** `POST /api/export/pdf` resolves (success or error).

**Success state (replaces the Download PDF button):**
```
+-----------------+
| [bi-check-circle]|  (text-success icon)
|                  |
| Ready to         |
| download:        |
| ao-profile-      |
| Jane-20260614.pdf|
|                  |
| [Download Again] |
+-----------------+
```

**Error state (replaces the Download PDF button):**
```
+-----------------+
| [bi-exclamation] |  (text-danger icon)
|                  |
| PDF generation   |
| failed.          |
| Try again or     |
| use JSON export. |
|                  |
| [Try Again]      |
+-----------------+
```
- Specific error message: `PDF_FAILED` → "PDF generation failed. Try again or use JSON export."; `PROFILE_EMPTY` → "Profile is empty — add data first."; any other → "PDF export failed. Please try again."
- "Try Again" restores the card to its initial state.

---

### Screen 5 — Share Link Sub-panel (expanded within Export page Share card)

**Entry point:** User clicks "Create" in the Share Link card on Screen 2. The card expands in-place — no page navigation, no modal.

**What it displays (expanded card content):**
```
+----------------------------------------------------------+
|  [bi-link]  Share Link                                   |
|                                                          |
|  Link expires after:  [7 days v]  (dropdown)             |
|                                                          |
|  [Generate Link]                                         |
|                                                          |
|  ---- After generation: ----                             |
|                                                          |
|  http://localhost:3000/share/a1b2c3d4...  [bi-clipboard] |
|  "Copied!" (tooltip appears on clipboard click)          |
|                                                          |
|  This link expires on: 2026-06-21 at 10:30 AM           |
|  Anyone with this link can view your profile summary.    |
|                                                          |
|  [View Active Links]  [Close]                            |
+----------------------------------------------------------+
```

**Expiry dropdown options:** 1 day, 3 days, 7 days (default), 14 days, 30 days.

**Actions:**
- Select expiry duration from dropdown → no server call yet; just updates the duration selection.
- Click "Generate Link" → button shows spinner; calls `POST /api/share/generate` with selected duration; on success, link URL appears below with copy button and expiry timestamp. Button label changes to "Generate Another Link".
- Click clipboard icon next to link URL → copies URL to clipboard using `navigator.clipboard.writeText()`; Bootstrap tooltip showing "Copied!" appears for 2 seconds then disappears.
- Click "View Active Links" → the card content transitions to the Active Links sub-panel (Screen 6).
- Click "Close" → the card collapses back to its original three-button state (Create button visible again).

**Error state:** If `POST /api/share/generate` fails, show below the Generate button: "Could not generate link. Please try again." in a Bootstrap `alert-danger` div. The Generate button re-enables immediately.

---

### Screen 6 — Active Links Sub-panel (within Export page Share card)

**Entry point:** User clicks "View Active Links" from Screen 5.

**What it displays (inside Share card):**
```
+----------------------------------------------------------+
|  Active shareable links (2)            [← Back]          |
|                                                          |
|  +------------------------------------------------------+|
|  | Link (truncated)         | Expires     | Views | Act ||
|  +------------------------------------------------------+|
|  | localhost:3000/share/a1b | Jun 21 2026 |  42   |[Rev]||
|  | localhost:3000/share/c3d | Jun 28 2026 |   5   |[Rev]||
|  +------------------------------------------------------+|
|                                                          |
|  No expired links to show.                               |
+----------------------------------------------------------+
```

Table columns: Link (first 30 chars + "..."), Expires (human-readable date), Views (accessCount), Action (Revoke button).

**Empty state:** "You have no active shareable links." with `[← Back]` link above the message.

**Loading state:** When this sub-panel opens, it shows a spinner while `GET /api/share/list` is in flight: `<span class="spinner-border spinner-border-sm"></span> Loading links...`.

**Error state:** If `GET /api/share/list` fails, show: `alert-danger` "Could not load shareable links. [Retry]". Retry re-calls the endpoint.

**Actions:**
- Click "Revoke" on a row → button shows spinner; calls `DELETE /api/share/[token]`; on success, row fades out and is removed. A Bootstrap `alert-success` appears at the top of the sub-panel: "Link revoked." that auto-dismisses after 3 seconds. If the table becomes empty, empty state is shown.
- Revoke failure → inline `alert-danger` in the row: "Could not revoke. Try again." Revoke button re-enables.
- Click `[← Back]` → sub-panel returns to Screen 5 (Share Link generation view).

---

### Screen 7 — Public Shareable Link View (separate page, no nav)

**Entry point:** A recipient opens `http://localhost:3000/share/[token]` in their browser.

**What it displays:** A standalone read-only HTML page (no app nav, no login, no export/edit buttons). Layout:

```
+----------------------------------------------------------+
|  Admissions Officer — Student Profile Summary            |
+----------------------------------------------------------+
|  Jane Doe                                                |
|  Profile generated: June 14, 2026                        |
|                                                          |
|  ACADEMIC SUMMARY                                        |
|  GPA: 3.9 | School: Lincoln High School                  |
|  Courses: AP Calculus, AP Chemistry, AP English Lit...   |
|                                                          |
|  TEST SCORES                                             |
|  SAT: 1480 | ACT: 33                                     |
|                                                          |
|  ACHIEVEMENTS (top 10)                                   |
|  - National Merit Semifinalist                           |
|  - Science Olympiad Regional Champion (2025)             |
|  ...                                                     |
|                                                          |
|  ACTIVITIES                                              |
|  - Debate Club, President (3 years)                      |
|  ...                                                     |
|                                                          |
|  IMPACT STATEMENTS (top 5)                               |
|  "Led a team of 12 in regional Science Olympiad..."      |
|  ...                                                     |
|                                                          |
|  --------------------------------------------------------|
|  Generated by Admissions Officer | June 14, 2026         |
|  This is a read-only view. Link expires June 21, 2026.   |
+----------------------------------------------------------+
```

**No download, no edit, no copy-data controls are shown on this page.**

**Expired token state:** Full-page message:
```
+----------------------------------------------------------+
|  This link has expired.                                  |
|  The profile owner's shareable link is no longer active. |
+----------------------------------------------------------+
```
HTTP response code: 410 Gone.

**Revoked token state:** Full-page message:
```
+----------------------------------------------------------+
|  This link is no longer available.                       |
|  The profile owner has deactivated this link.            |
+----------------------------------------------------------+
```
HTTP response code: 410 Gone.

**Never-existed token state:** Full-page message:
```
+----------------------------------------------------------+
|  Link not found.                                         |
+----------------------------------------------------------+
```
HTTP response code: 404 Not Found.

---

## Data and backend

### Data entities

#### Profile source files (read-only during export)

Files read from `DATA_DIR/profile/`:

| File | Purpose |
|---|---|
| `academic.json` | GPA, school name, courses list |
| `tests.json` | Test name, score, date (relative), subject scores |
| `achievements.json` | Title, description, year, category |
| `activities.json` | Name, role, duration, description |
| `impact_statements.json` | Text, linked achievement/activity ID, status (draft/approved) |
| `essays.json` | Essay text, prompt, status — included in JSON export only |
| `.metadata.json` | Student first name, profile creation date — included in JSON export |
| `.audit.json` | Audit trail — EXCLUDED from all exports |

#### Share tokens file

**File:** `DATA_DIR/.shares.json`

**Structure:**
```json
{
  "tokens": [
    {
      "token": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      "createdAt": "2026-06-14T10:30:00.000Z",
      "expiresAt": "2026-06-21T10:30:00.000Z",
      "accessCount": 42,
      "lastAccessedAt": "2026-06-14T12:00:00.000Z",
      "revoked": false
    }
  ]
}
```

**Field definitions:**

| Field | Type | Required | Validation |
|---|---|---|---|
| `token` | string | yes | 32-char lowercase hex, generated via `crypto.randomBytes(16).toString('hex')` |
| `createdAt` | ISO 8601 string | yes | System-generated at creation time |
| `expiresAt` | ISO 8601 string | yes | `createdAt` + duration in days; must be 1–30 days after `createdAt` |
| `accessCount` | integer | yes | Starts at 0; incremented on every `GET /share/[token]` that returns 200 |
| `lastAccessedAt` | ISO 8601 string or null | yes | null until first access; updated on every successful view |
| `revoked` | boolean | yes | false at creation; set to true on `DELETE /api/share/[token]` |

**Writes:** Use file locking (same pattern as other profile JSON writes per architecture guardrails). On write failure, return 500 and do not partially update the file.

---

### API endpoints

#### POST /api/export/json

Zips the profile JSON files and returns the zip as a file attachment.

**Auth:** Local only — no auth token required (running on localhost). Request must originate from `127.0.0.1` or `::1`; reject all other origins with 403.

**Request body:** none (Content-Type does not need to be set).

**Process:**
1. Read `DATA_DIR/profile/` directory.
2. Collect files: `academic.json`, `tests.json`, `achievements.json`, `activities.json`, `impact_statements.json`, `essays.json`, `.metadata.json`. Skip any that do not exist (do not error on missing files).
3. Exclude `.audit.json` always.
4. Create in-memory zip using the `archiver` npm package (`archiver` with `zip` format).
5. Add each collected file to the zip under the path `profile/[filename]`.
6. Add a top-level `README.txt` to the zip containing: "This archive was generated by Admissions Officer. It contains your structured profile data as JSON files. You can re-import this into a new AO instance or open any file in a text editor. Original uploaded documents are not included — access them from your data directory."
7. Pipe the archive to the HTTP response.

**Response headers:**
```
Content-Type: application/zip
Content-Disposition: attachment; filename="ao-profile-[firstName]-[YYYYMMDD].zip"
```
`firstName` is read from `.metadata.json → firstName`; if not present, use `"profile"` as fallback.
`YYYYMMDD` is today's date (server-side `new Date()` formatted).

**Success:** HTTP 200, zip file streamed as body.

**Error responses:**

| Condition | HTTP code | error.code | error.message |
|---|---|---|---|
| DATA_DIR not configured | 500 | `DATA_DIR_MISSING` | `"Data directory is not configured."` |
| DATA_DIR/profile/ does not exist | 404 | `PROFILE_NOT_FOUND` | `"No profile data found to export."` |
| All profile files missing | 404 | `PROFILE_EMPTY` | `"Profile is empty — add data before exporting."` |
| Zip creation I/O error | 500 | `ZIP_FAILED` | `"Could not create zip archive. Check disk space."` |
| Origin not localhost | 403 | `FORBIDDEN` | `"Export is only available from localhost."` |

Error responses use the standard JSON envelope:
```json
{
  "success": false,
  "data": null,
  "error": { "code": "ZIP_FAILED", "message": "Could not create zip archive. Check disk space." },
  "timestamp": "2026-06-14T10:30:00Z"
}
```

---

#### POST /api/export/pdf

Generates a PDF from profile data and returns it as a file attachment.

**Auth:** Localhost-only (same check as `/api/export/json`).

**Request body:** none.

**Process:**
1. Read all profile JSON files (same set as JSON export, minus `essays.json` and `.metadata.json` schema details — PDFs do not include essay text or internal metadata).
2. Instantiate a `PDFDocument` from the `pdfkit` npm package.
3. Build the PDF using the layout defined in the PDF Generation section below.
4. Pipe the PDF stream to the HTTP response.

**Response headers:**
```
Content-Type: application/pdf
Content-Disposition: attachment; filename="ao-profile-[firstName]-[YYYYMMDD].pdf"
```

**Success:** HTTP 200, PDF streamed as body.

**Error responses:**

| Condition | HTTP code | error.code | error.message |
|---|---|---|---|
| DATA_DIR not configured | 500 | `DATA_DIR_MISSING` | `"Data directory is not configured."` |
| Profile not found / empty | 404 | `PROFILE_EMPTY` | `"No profile data found to export."` |
| PDF generation library error | 500 | `PDF_FAILED` | `"Could not generate PDF. Try again or use JSON export."` |
| Origin not localhost | 403 | `FORBIDDEN` | `"Export is only available from localhost."` |

---

#### POST /api/share/generate

Creates a new shareable link token.

**Auth:** Localhost-only.

**Request body (JSON):**
```json
{
  "durationDays": 7
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `durationDays` | integer | yes | Min: 1, Max: 30. If missing or out of range, return 400. |

**Process:**
1. Validate `durationDays` is an integer between 1 and 30 inclusive.
2. Generate token: `crypto.randomBytes(16).toString('hex')` — produces a 32-char lowercase hex string.
3. Compute `expiresAt`: current UTC time + `durationDays` days.
4. Read `DATA_DIR/.shares.json` (create with empty `tokens: []` array if file does not exist).
5. Append new token object: `{ token, createdAt: now, expiresAt, accessCount: 0, lastAccessedAt: null, revoked: false }`.
6. Write updated `.shares.json` back to disk with file locking.
7. Return the full link URL.

**Response body (success):**
```json
{
  "success": true,
  "data": {
    "token": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    "url": "http://localhost:3000/share/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    "expiresAt": "2026-06-21T10:30:00.000Z",
    "durationDays": 7
  },
  "error": null,
  "timestamp": "2026-06-14T10:30:00Z"
}
```

**Error responses:**

| Condition | HTTP code | error.code | error.message |
|---|---|---|---|
| `durationDays` missing | 400 | `INVALID_DURATION` | `"durationDays is required."` |
| `durationDays` not integer | 400 | `INVALID_DURATION` | `"durationDays must be an integer."` |
| `durationDays` < 1 or > 30 | 400 | `INVALID_DURATION` | `"durationDays must be between 1 and 30."` |
| File write failure | 500 | `SHARE_WRITE_FAILED` | `"Could not save shareable link. Try again."` |
| Origin not localhost | 403 | `FORBIDDEN` | `"Share management is only available from localhost."` |

---

#### GET /share/[token]

Serves the public read-only profile view HTML page. This is a page route, not an API route — it returns HTML, not JSON.

**Auth:** None — this endpoint is public (by design; it is a share link).

**Route file:** `src/server/routes/share.js` (separate from API routes).

**Process:**
1. Extract `token` from URL param.
2. Read `DATA_DIR/.shares.json`. If file does not exist, treat as 404.
3. Find entry where `entry.token === token`.
4. If no entry found → respond 404 with the "Link not found" HTML page.
5. If `entry.revoked === true` → respond 410 with the "Link is no longer available" HTML page.
6. If `new Date() > new Date(entry.expiresAt)` → respond 410 with the "Link has expired" HTML page. Do NOT auto-delete expired entries (student may want to see them in the management view).
7. If valid: read profile JSON files, render and return the public profile summary HTML page. Increment `accessCount` and update `lastAccessedAt` in `.shares.json` (fire-and-forget write — do not fail the request if the counter write fails).

**Success:** HTTP 200, HTML body (the public profile view defined in Screen 7).

**Error pages:** Plain HTML, Bootstrap 5 styled, no app navigation, with message appropriate to the state.

---

#### GET /api/share/list

Returns all token entries (active, expired, and revoked) for the student's management view.

**Auth:** Localhost-only.

**Request:** No body, no params.

**Process:**
1. Read `DATA_DIR/.shares.json`. If file does not exist, return empty list.
2. Return all token entries. The client filters to show only non-revoked, non-expired ones in the table; expired and revoked are shown separately (or omitted — client decides).

**Response body (success):**
```json
{
  "success": true,
  "data": {
    "tokens": [
      {
        "token": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        "url": "http://localhost:3000/share/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        "createdAt": "2026-06-14T10:30:00.000Z",
        "expiresAt": "2026-06-21T10:30:00.000Z",
        "accessCount": 42,
        "lastAccessedAt": "2026-06-14T12:00:00.000Z",
        "revoked": false
      }
    ]
  },
  "error": null,
  "timestamp": "2026-06-14T10:30:00Z"
}
```

`url` is constructed server-side as `http://localhost:3000/share/[token]`.

**Error responses:**

| Condition | HTTP code | error.code | error.message |
|---|---|---|---|
| Origin not localhost | 403 | `FORBIDDEN` | `"Share management is only available from localhost."` |

File-not-found is not an error — returns empty `tokens: []`.

---

#### DELETE /api/share/[token]

Revokes a shareable link.

**Auth:** Localhost-only.

**URL param:** `token` — the 32-char hex token to revoke.

**Process:**
1. Read `DATA_DIR/.shares.json`. If file does not exist, return 404.
2. Find entry where `entry.token === token`.
3. If no entry found → 404.
4. If `entry.revoked === true` → return 200 (idempotent — already revoked).
5. Set `entry.revoked = true`. Write updated file back with file locking.
6. Return success.

**Response body (success):**
```json
{
  "success": true,
  "data": { "token": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4", "revoked": true },
  "error": null,
  "timestamp": "2026-06-14T10:30:00Z"
}
```

**Error responses:**

| Condition | HTTP code | error.code | error.message |
|---|---|---|---|
| Token not found | 404 | `TOKEN_NOT_FOUND` | `"Shareable link not found."` |
| File write failure | 500 | `SHARE_WRITE_FAILED` | `"Could not revoke link. Try again."` |
| Origin not localhost | 403 | `FORBIDDEN` | `"Share management is only available from localhost."` |

---

## AI integration

N/A — no AI in this story.

Export (JSON and PDF) is a deterministic read-and-render operation. The shareable link generation uses `crypto.randomBytes`. No Gemini API calls are made in this story.

---

## Enterprise checks

**Auth:** The Export modal and all `/api/export/*` and `/api/share/*` management endpoints are accessible only from localhost (`127.0.0.1` or `::1`). The middleware checks `req.socket.remoteAddress` on every request to these routes and returns 403 if the request is not from loopback. The public `GET /share/[token]` page is intentionally open to any network address (it is meant to be accessed by advisors who may be on a different machine, as long as the app's port is accessible — though in practice, the app binds to `localhost:3000`, limiting external access unless the student explicitly forwards the port).

**Input validation:**
- Server-side: `durationDays` on `POST /api/share/generate` is validated as integer, 1–30.
- Token param on `GET /share/[token]` and `DELETE /api/share/[token]` is validated to match the pattern `/^[a-f0-9]{32}$/`; any request with a non-matching token returns 400 before touching the file system.
- Client-side: The expiry dropdown only presents valid options (1, 3, 7, 14, 30 days); the value is re-validated server-side regardless.

**Error states:**
- JSON zip creation failure → inline error in Export modal JSON card; student sees "Check disk space and try again."
- PDF generation failure → inline error in Export modal PDF card; student sees "PDF generation failed. Try again or use JSON export."
- Share generate failure → inline error below Generate button in Shareable Link panel.
- Revoke failure → inline Bootstrap `alert-danger` row in Active Links table; row is not removed until server confirms success.
- Expired token (public view) → 410 HTML page: "This link has expired."
- Revoked token (public view) → 410 HTML page: "This link is no longer available."
- Unknown token (public view) → 404 HTML page: "Link not found."

**Data safety:** Export endpoints are stateless — they read files and stream output. If the student closes the browser mid-download, the partial file is abandoned on the client side; the server-side profile data is untouched. Share token creation writes to `.shares.json` atomically (write to temp file, rename) — if the app crashes mid-write, the original `.shares.json` is preserved. The `accessCount` increment on `GET /share/[token]` is fire-and-forget; if it fails, the view still succeeds and the count may be slightly under-counted — this is acceptable.

**Rate limiting / abuse:** `POST /api/share/generate` is limited to 20 calls per 5 minutes per IP (enforce in middleware using an in-memory counter reset every 5 minutes). `GET /share/[token]` (public) is limited to 60 requests per minute per IP to prevent scraping. These limits are enforced in the Express middleware layer (`src/server/middleware/rateLimit.js`). A student generating many links rapidly will see a 429 response: `{ "error": { "code": "RATE_LIMITED", "message": "Too many requests. Please wait and try again." } }`.

**AI fallback:** N/A — no AI in this story.

---

## PDF generation

**Library:** `pdfkit` (npm package `pdfkit`). Install as production dependency.

**File:** `src/lib/pdfExport.js` — exports a single async function `generateProfilePDF(profileData)` that returns a `PDFDocument` stream.

**PDF layout (page size: Letter, margins: 72pt all sides):**

```
Page 1
------
[Header]
  Font: Helvetica-Bold, 20pt
  Text: Student's first name (from .metadata.json → firstName)
  Below: "Admissions Officer — Profile Summary" in Helvetica, 12pt, gray (#666666)
  Horizontal rule (drawn line, full width)

[Academic Summary]
  Section heading: Helvetica-Bold, 14pt, dark (#222222)
  Body: Helvetica, 11pt
  - "GPA: [gpa]" (from academic.json → gpa)
  - "School: [school]" (from academic.json → schoolName, if present)
  - "Courses: [comma-separated list]" (from academic.json → courses[], max 10 courses listed; if more: "...and N more")

[Test Scores]
  Section heading: Helvetica-Bold, 14pt
  Body: Helvetica, 11pt
  - One line per test entry from tests.json: "[testName]: [score]" (e.g., "SAT: 1480")
  - If tests.json is empty or missing: "No test scores recorded."

[Achievements] (max 10 entries)
  Section heading: Helvetica-Bold, 14pt
  Each entry: bullet "• [title] — [description, truncated to 120 chars]"
  If more than 10: "...and N more achievements in your full profile."
  If empty: "No achievements recorded."

Page 2 (if content overflows, pdfkit handles automatic page breaks)
------
[Activities]
  Section heading: Helvetica-Bold, 14pt
  Each entry: "• [name], [role] ([duration])"
  Max 10 entries. If more: "...and N more."
  If empty: "No activities recorded."

[Impact Statements] (max 5 entries, status === 'approved' preferred; fall back to 'draft' if fewer than 5 approved)
  Section heading: Helvetica-Bold, 14pt
  Each entry: indented block quote: "\"[text truncated to 300 chars]\""
  If empty: "No impact statements recorded."

[Footer — every page]
  Bottom of page, centered, Helvetica, 9pt, gray (#999999)
  "Generated by Admissions Officer | [Month DD, YYYY]"
  "This is a summary — full profile data available as JSON export."
```

**What is excluded from PDF:**
- Home address, date of birth, phone number, email address, parents' names.
- Exact upload timestamps (do not print "Added 2026-06-01T10:30:00Z"; do not print any upload dates at all).
- School ID, student ID numbers.
- `.audit.json` data — never included.
- Essay text from `essays.json` — not included in PDF (essays are personal; student shares separately).
- Confidence scores and source document citations — internal metadata, not shown.
- Raw JSON field names or technical identifiers.

**Filename:** `ao-profile-[firstName]-[YYYYMMDD].pdf` where `firstName` is from `.metadata.json → firstName` (fallback: `"profile"`) and `YYYYMMDD` is the server's current date.

---

## Frontend implementation

**Files to create or modify:**

| File | Change |
|---|---|
| `src/public/js/export.js` | New file: all export page logic — rendering, button handlers, share sub-panels |
| `src/public/js/app.js` | Extend: add `/export` route to SPA router (see routing spec below) |
| `src/public/index.html` | Add Export card (card-link pattern) to Dashboard section (navigates to `/export` on click/Enter/Space); add export page HTML section (hidden by default); add Settings page "Profile Export" section |
| `src/server/routes/export.js` | New file: `/api/export/json` and `/api/export/pdf` handlers |
| `src/server/routes/share.js` | New file: `/api/share/generate`, `/api/share/list`, `DELETE /api/share/[token]`, and `GET /share/[token]` page handler |
| `src/lib/pdfExport.js` | New file: PDF generation logic using pdfkit |
| `src/lib/zipExport.js` | New file: zip creation logic using archiver |
| `src/lib/shareTokens.js` | New file: token CRUD operations on `.shares.json` |
| `src/server/middleware/rateLimit.js` | New or extend: rate limiting for share and export endpoints |
| `src/public/share.html` | New file: public read-only profile view template (server renders it with profile data injected) |

**SPA routing integration:**

The app uses STORY-001's `pushState`-based SPA router in `app.js`. The router maintains a mapping of path → render function. Add the `/export` route:

```javascript
// In app.js router map
const routes = {
  '/': renderDashboard,
  '/onboarding/name': renderOnboardingName,
  '/onboarding/directory': renderOnboardingDirectory,
  '/settings': renderSettings,
  '/export': renderExportPage,      // NEW — STORY-005
  // section routes added by other stories
};

// In app.js navigate function
function navigate(path) {
  history.pushState({ page: path }, '', path);
  renderRoute(path);
}

// popstate listener (already present from STORY-001)
window.addEventListener('popstate', (e) => {
  renderRoute(window.location.pathname);
});

// On initial load
renderRoute(window.location.pathname);
```

`renderExportPage()` is defined in `export.js` and called by the router. It shows the `#export-page` section in `index.html` and hides all other page sections. It also calls `initExportPage()` to wire up event listeners and check profile emptiness.

**Export card on Dashboard (card-as-link, navigates to `/export`):**

The Dashboard uses a card-as-link pattern — the entire Export card is clickable, not a separate button inside a header bar. There is no standalone `btn-export` button on the Dashboard. The card HTML is defined in Screen 1. Key implementation notes:
- `dashboard.js` calls `GET /api/profile/summary` on load. If all sections are empty, the `#card-export` element receives `style="opacity:0.5; pointer-events:none;"` and its `tabindex` is set to `-1` to remove it from tab order. The Bootstrap tooltip is initialised with `trigger: 'hover focus'`.
- If any section is non-empty, the card is fully interactive: `tabindex="0"`, `pointer-events` unset, no tooltip.
- The `card-link` CSS class (defined in `src/public/css/app.css`) provides hover/focus shadow, lift transform, and visible focus outline — see Screen 1 for the full CSS definition.
- Click and keyboard (Enter/Space) handlers are wired in `dashboard.js` via the shared `card-link` event delegation pattern (see Screen 1 for the JavaScript snippet).

**Export page section in index.html (hidden by default):**

```html
<section id="export-page" class="page-section" style="display:none;" aria-label="Export Profile">
  <div class="container py-4">
    <a href="/" id="btn-export-back" class="btn btn-link ps-0 mb-3">
      <i class="bi bi-arrow-left me-1"></i> Back to Dashboard
    </a>
    <h2 class="mb-4">Export Profile</h2>
    <div id="export-empty-warning" class="alert alert-warning d-none" role="alert">
      Your profile is empty — add data before exporting.
      <a href="/" class="alert-link ms-2">Go to Dashboard</a>
    </div>
    <div class="row g-3" id="export-panels">
      <!-- JSON card, PDF card, Share card injected by export.js -->
    </div>
  </div>
</section>
```

All three panel cards are rendered by `export.js` via `innerHTML` into `#export-panels` so card state can be fully managed in JavaScript without DOM fragmentation.

**Page sections architecture:** Every page in the SPA is a `<section class="page-section">` inside `index.html`. Only one is visible at a time. The router calls `document.querySelectorAll('.page-section').forEach(s => s.style.display = 'none')` before showing the target section.

**Clipboard copy implementation:**

```javascript
async function copyToClipboard(text, btnEl) {
  try {
    await navigator.clipboard.writeText(text);
    const tooltip = bootstrap.Tooltip.getInstance(btnEl) || new bootstrap.Tooltip(btnEl, { title: 'Copied!', trigger: 'manual' });
    tooltip.show();
    setTimeout(() => tooltip.hide(), 2000);
  } catch (e) {
    // Fallback: select a hidden input containing the URL
    const input = document.getElementById('share-url-input');
    input.select();
    document.execCommand('copy');
  }
}
```

**Active links table:** Built dynamically by `export.js` after `GET /api/share/list`. Each row's Revoke button calls `deleteShareToken(token)` which fires `DELETE /api/share/[token]` and removes the row from the DOM on success. If the response is not 200, shows a row-level `alert-danger` span.

**Expiry duration picker:**
```html
<select id="share-duration" class="form-select w-auto">
  <option value="1">1 day</option>
  <option value="3">3 days</option>
  <option value="7" selected>7 days</option>
  <option value="14">14 days</option>
  <option value="30">30 days</option>
</select>
```

**Bootstrap 5 and Bootstrap Icons usage:**
- All card, button, table, alert, spinner, and tooltip components use Bootstrap 5 classes — no custom CSS for layout.
- All icons use `<i class="bi bi-[icon-name]">` syntax.
- Key icons: `bi-download` (Export card on Dashboard — inside the card-link card body), `bi-file-zip` (JSON card on Export page), `bi-file-pdf` (PDF card on Export page), `bi-link-45deg` (Share card on Export page), `bi-clipboard` (copy button), `bi-check-circle-fill text-success` (success state), `bi-exclamation-triangle-fill text-danger` (error state), `bi-trash` (Revoke button), `bi-arrow-left` (Back to Dashboard link).
- Loading spinner in buttons: `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>` inserted before button text.

**Accessibility:**
- The export page `<section>` has `aria-label="Export Profile"`.
- Buttons have `aria-label` attributes.
- The Active Links table has `<th scope="col">` headers.
- Export download triggers use `<a download>` element (created programmatically and clicked) for semantic correctness.
- When a button transitions to loading state, its `aria-disabled="true"` attribute is set.

---

## Error handling

| Scenario | Where shown | User message | Recovery action |
|---|---|---|---|
| ZIP creation fails (disk full, I/O error) | Inside JSON card on Export page | "Export failed. Check disk space and try again." | "Try Again" button re-fires `POST /api/export/json` |
| PDF generation fails (pdfkit crash) | Inside PDF card on Export page | "PDF generation failed. Try again or use JSON export." | "Try Again" re-fires `POST /api/export/pdf`; user can also use JSON export as fallback |
| Export request times out (>30s, no response) | Inside relevant card on Export page | "Export timed out. Check your system and try again." | "Try Again" button re-enables; 30-second client-side timeout using `AbortController` |
| Share token generation fails (file write error) | Below Generate button in Share sub-panel | "Could not generate link. Please try again." | Generate button re-enables immediately |
| Share token revoke fails (file write error) | Inline in the table row | "Could not revoke this link. Please try again." | Revoke button re-enables; row stays in table |
| `GET /api/share/list` fails | Inside Active Links sub-panel | "Could not load shareable links." + [Retry] button | Retry button re-calls the endpoint |
| Expired token (public view) | Full-page standalone HTML | "This link has expired. The profile owner's shareable link is no longer active." | None — advise recipient to contact the student for a new link |
| Revoked token (public view) | Full-page standalone HTML | "This link is no longer available. The profile owner has deactivated this link." | None |
| Unknown/malformed token (public view) | Full-page standalone HTML | "Link not found." | None |
| Rate limit exceeded on share generate | Below Generate button in Share sub-panel | "Too many requests. Please wait and try again." | User waits; button re-enables after 30 seconds (client-side timer) |
| Profile completely empty when Export page loads | Warning banner at top of Export page | "Your profile is empty — add data before exporting. [Go to Dashboard]" | All export/create buttons disabled; user clicks Go to Dashboard |
| DATA_DIR not configured (any export action) | Warning banner at top of Export page | "Data directory is not configured. Please restart AO and complete setup." | All export/create buttons disabled |
| SPA route `/export` loaded but `app.js` router not initialised | Export page section remains hidden | (no visible error — blank page) | Fixed by ensuring `renderRoute(window.location.pathname)` is called on `DOMContentLoaded` in `app.js` |

---

## Acceptance criteria

1. Navigating to `http://localhost:3000/export` directly in the browser renders the Export page with three visible panels (Download JSON, Download PDF, Share Link) — the page is not blank and no JavaScript console errors are thrown.

2. The Profile Dashboard displays an Export card with the `card-link` CSS class. Clicking the card (or pressing Enter/Space when the card is focused) navigates to `/export` via `pushState`. The URL in the browser address bar changes to `http://localhost:3000/export`, the Export page is rendered, and the Dashboard is hidden. No full page reload occurs. There is no separate "Export" button in the header.

2a. The Export card shows a visible focus outline when tabbed to via keyboard. Pressing Enter or Space while it is focused triggers navigation to `/export` identically to a click. The card does not navigate when `pointer-events: none` is applied (empty profile state).

2b. When the profile is completely empty, the Export card on the Dashboard is visually dimmed (`opacity: 0.5`) and is not keyboard-focusable (`tabindex="-1"`). Attempting to hover over it shows the tooltip "Add profile data before exporting."

3. Clicking the browser back button from the Export page navigates back to the Dashboard (`/`). The Dashboard renders correctly. No full page reload occurs.

4. The Settings page (`/settings`) contains a "Profile Export" section with a `[Go to Export Page]` button. Clicking it navigates to `/export` via `pushState`.

5. Clicking "Download JSON" on the Export page shows a spinner inside the JSON card button, calls `POST /api/export/json`, and — on success — triggers a browser file download of `ao-profile-[firstName]-[YYYYMMDD].zip`. The zip contains all non-empty profile JSON files (`academic.json`, `tests.json`, `achievements.json`, `activities.json`, `impact_statements.json`, `essays.json`, `.metadata.json`) and a `README.txt`. The `.audit.json` file is not included.

6. Clicking "Download PDF" on the Export page shows a spinner inside the PDF card button, calls `POST /api/export/pdf`, and — on success — triggers a browser file download of `ao-profile-[firstName]-[YYYYMMDD].pdf`. The PDF displays student name, GPA, test scores (up to all entries), achievements (up to 10), activities (up to 10), and impact statements (up to 5). The PDF does not contain home address, date of birth, or any upload timestamps.

7. If `POST /api/export/json` returns a non-200 status, the JSON card displays an error message appropriate to the `error.code` (`ZIP_FAILED`, `PROFILE_EMPTY`, or `DATA_DIR_MISSING`) and a "Try Again" button. Clicking "Try Again" restores the Download JSON button. The other two panels remain interactive.

8. If `POST /api/export/pdf` returns a non-200 status, the PDF card displays an error message appropriate to the `error.code` and a "Try Again" button. Clicking "Try Again" restores the Download PDF button. The other two panels remain interactive.

9. Clicking "Create" in the Share Link card expands the card in-place to show the Share Link sub-panel with an expiry dropdown and "Generate Link" button. No navigation or modal is used.

10. Selecting an expiry duration and clicking "Generate Link" shows a spinner, calls `POST /api/share/generate`, and — on success — displays the full URL `http://localhost:3000/share/[32-char-hex-token]` and the expiry date below it.

11. Clicking the clipboard icon next to the generated link copies the URL to the clipboard and shows a "Copied!" Bootstrap tooltip for 2 seconds.

12. Clicking "View Active Links" shows a loading spinner, calls `GET /api/share/list`, and renders a table of active (non-revoked, non-expired) links with columns: truncated URL, expiry date, access count, and a Revoke button. If no links exist, the empty state message is shown.

13. Clicking "Revoke" on a link shows a spinner in the button, calls `DELETE /api/share/[token]`, removes the row from the table on success with a brief success alert, and visiting that link's URL subsequently returns HTTP 410 with the message "This link is no longer available."

14. Visiting a valid, non-expired, non-revoked `http://localhost:3000/share/[token]` URL in a browser returns HTTP 200 and displays a read-only profile summary page containing the student's name, GPA, test scores, achievements, activities, and impact statements. No download, edit, or export controls are present on this page.

15. Visiting a shareable link after its `expiresAt` timestamp has passed returns HTTP 410 and displays the message "This link has expired."

16. Requests to `/api/export/*` and `/api/share/*` management endpoints from any IP other than `127.0.0.1` or `::1` return HTTP 403. The public `GET /share/[token]` page is not subject to the localhost restriction.

17. The token value in `.shares.json` is a 32-character lowercase hexadecimal string generated using `crypto.randomBytes(16)`.

18. When the profile is completely empty, the Export page shows a warning banner and disables the Download JSON, Download PDF, and Create buttons.

---

## Change history

| Release | Date | Summary | Type |
|---|---|---|---|
| 1.0.0 | 2026-06-14 | Initial spec authored | feature |
| 1.0.0 | 2026-06-14 | Bug-fix pass: replaced Export modal with dedicated `/export` SPA page; added SPA routing integration (`pushState`/`popstate`); added Settings page entry point; added loading spinners and per-card error states with specific error codes; added export timeout handling via `AbortController`; added Active Links loading/error states; updated all acceptance criteria (18 total) to verify page renders, navigation, spinner behaviour, and error recovery | fix |
| 1.0.0 | 2026-06-14 | Amendment: replaced separate Dashboard Export header button with full-card clickable Export card using `card-link` CSS class; defined hover/focus/active CSS for `card-link` in `app.css`; added keyboard accessibility (Tab focus, Enter/Space to navigate); added `data-navigate` attribute pattern; updated Frontend implementation section; added acceptance criteria 2a and 2b; removed `btn-export` button reference | feature |
