---
story_id: STORY-007
title: "Configurable word limits & college guideline presets"
depends_on: []
---

## What the user can do

- User can open a Settings panel from the dashboard, select a college preset (Common App, Coalition App, or Custom), and immediately see the word/character limits for impact statements, essays, and questionnaire fields update to that preset's values — so they know exactly what constraints their target college requires.
- User can manually override any individual min or max value within the Custom preset — typing a number into an editable field — and save those custom limits independently of the built-in presets.
- User can view the current active limits displayed as a contextual banner on the impact statement generation screen and the essay generation screen, before they trigger any AI generation, so they can calibrate their expectations for output length.
- User can save their settings and trust they will persist across sessions — closing and reopening the app restores the same preset and custom values they configured previously.

---

## Screens and states

### Screen 1 — Dashboard: Settings entry point

**Entry point:** Main dashboard (`/index.html`), loaded on app open.

**What it displays:**
- A "Settings" link or gear icon in the top navigation bar (Bootstrap navbar, rightmost item).
- Label: "Settings" with Bootstrap Icon `bi-gear`.
- No indicator on the dashboard tile itself — settings are global, not per-section.

**What the user can do:**
- Click "Settings" in the navbar → navigates to the Settings panel (Screen 2) via `history.pushState('/settings', '', '/settings')`.

**No empty / error states for this entry point** — the link is always present and always functional.

---

### Screen 2 — Settings panel

**Entry point:** Clicking "Settings" in the navbar from any view. SPA route: `/settings`.

**Layout:**

```
[bi-arrow-left Back to Dashboard]

Settings
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Word Limits & College Guidelines
────────────────────────────────────────────────────────
Select preset:
  [Common App] [Coalition App] [Custom]    ← Bootstrap btn-group, one active at a time

Current limits:

  Impact Statements
    Min characters:  [____100____]   Max characters:  [____1000___]
    (≈ 20 words min — ≈ 200 words max)

  Essays
    Min words:       [____500____]   Max words:       [____650____]

  Questionnaire Fields
    Min characters:  [____100____]   Max characters:  [____500____]

[Save Settings]                           Last saved: Jun 15, 2026 10:30 AM
                                          (hidden until first save)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Preset button behaviour:**

Clicking "Common App" → fills fields with:
- Impact statements: min 100, max 1000 (characters)
- Essays: min 500, max 650 (words)
- Questionnaire fields: min 100, max 500 (characters)

Clicking "Coalition App" → fills fields with:
- Impact statements: min 100, max 1000 (characters)
- Essays: min 500, max 650 (words)
- Questionnaire fields: min 100, max 500 (characters)

Note: Common App and Coalition App share identical defaults in v1. Both are included so the user has a label that matches their target platform. Future presets with different values (e.g., UC application short answers at 350 words) can be added without schema changes.

Clicking "Custom" → all fields become editable; values remain whatever they were last (either a previously saved custom config or the defaults loaded on page open).

**Field editability rules:**
- All presets (Common App, Coalition App, Custom): all numeric input fields are **editable**. No `readonly` attribute is applied to any input. User may type freely in any tab.
- If the user modifies values while a named preset tab (Common App or Coalition App) is active and the values diverge from that preset's canonical values, a customization badge appears on the active preset button (e.g., "Common App (customized)") and the effective preset written to `limits.json` is `"custom"` — not `"common_app"` or `"coalition_app"`.
- The customization badge is cleared after a successful save that restores canonical preset values, or when the user switches to the Custom tab.

**Numeric input field constraints (applied via HTML attributes and server-side validation):**
- All min fields: `type="number"`, `min="0"`, `max="9999"`, `step="1"`, integer only.
- All max fields: `type="number"`, `min="1"`, `max="9999"`, `step="1"`, integer only.
- Client-side constraint: max must be ≥ min + 1. Violating this shows inline error below the field pair: "Max must be greater than min."

**[Save Settings] button:**
- Always visible.
- Disabled state: when no unsaved changes exist (fields match the last loaded/saved config). Enabled when any field value differs from the last loaded state.
- On click: calls `POST /api/config/limits`. See Data section.
- Success: button returns to disabled state; "Last saved: [timestamp]" line updates in-place. Bootstrap toast (bottom-right, success): "Settings saved."
- Error: Bootstrap toast (danger): "Could not save settings. Check your data directory." Fields are not reset — user can retry.

**Loading state (on page entry):**
- Page calls `GET /api/config/limits` on mount.
- While in-flight: fields show placeholder dashes `———`; preset buttons disabled; [Save Settings] disabled.
- On success: fields populated, correct preset button highlighted active, controls enabled.
- On error: inline alert at top of panel: "Could not load current settings. Showing defaults." — fields populated with hardcoded defaults (defined in Section 3). Controls enabled. [Save Settings] functional (will create config file on first successful save).

**"Last saved" line:**
- Hidden (`display: none`) if config file has never been written (i.e., GET returns `source: "defaults"`).
- Shown with formatted timestamp if config file exists.

**Unsaved changes guard:**
- If user navigates away (clicks "Back to Dashboard" or any nav link) with unsaved changes, show a browser `confirm()` dialog: "You have unsaved settings changes. Leave without saving?" [OK to leave] [Cancel to stay].
- On OK: navigate away, discard changes.
- On Cancel: stay on Settings panel.

**Empty state:** Not applicable — the panel always shows fields (either from config file or defaults).

**Per-field inline errors apply in all tabs** — any tab where max ≤ min shows the inline error and disables [Save Settings].

---

### Screen 3 — Impact statement generation: limit banner

**Entry point:** Impact statement generation flow (STORY-004, Screen 3 — Clarifying Questions step).

**What it displays:**
A non-interactive info banner between the achievement summary bar and the first question:

```
+--------------------------------------------------------+
| bi-info-circle  Generating within Common App limits    |
|  Impact statement: 100 – 1000 characters               |
|                                          [Change limits]|
+--------------------------------------------------------+
```

- Banner background: Bootstrap `alert alert-info` (light blue).
- Preset label shown in banner: `"common_app"` → "Common App limits"; `"coalition_app"` → "Coalition App limits"; `"custom"` → "your custom limits". If the effective preset is `"custom"` because values were modified from a named preset tab, the banner reads "Custom (based on Common App)" or "Custom (based on Coalition App)" as appropriate — the prior base preset is stored in the config's `basePreset` field (optional; omit if not present, fall back to "your custom limits").
- "[Change limits]" link navigates to `/settings` via `history.pushState`.
- Banner is shown on Screen 3 (Clarifying Questions) and remains visible through Screen 4 (Preview AI Reasoning). It is not shown on Screen 5 (Draft Statement) — by that point generation has occurred.

**Loading / error state:** If `GET /api/config/limits` fails when the impact statement screen loads, banner is omitted silently. The impact statement flow is not blocked.

---

### Screen 4 — Essay generation: limit banner

**Entry point:** Essay draft generation screen (STORY-006). Displayed before the user clicks [Generate Essay Draft].

**What it displays:**
Same structure as Screen 3 banner, but for essay limits:

```
+--------------------------------------------------------+
| bi-info-circle  Generating within Common App limits    |
|  Essay: 500 – 650 words                                |
|                                          [Change limits]|
+--------------------------------------------------------+
```

- Banner shown above the [Generate Essay Draft] button, below the essay prompt/topic selection area.
- "[Change limits]" navigates to `/settings`.
- Same loading/error fallback as Screen 3: if config fetch fails, banner is omitted; essay generation is not blocked.

---

## Data and backend

### Data entity — limits.json

**File location:** `/src/config/limits.json`

Note: This file lives in `/src/config/`, not in `DATA_DIR`. It is a config file for the application, not student profile data. It is part of the application installation and is written at runtime by the settings endpoint. On a fresh install (file absent), the server falls back to hardcoded defaults (see below).

**Full schema:**

```json
{
  "schemaVersion": "1.0.0",
  "preset": "common_app",
  "lastUpdated": "2026-06-15T10:30:00.000Z",
  "limits": {
    "impactStatements": {
      "unit": "characters",
      "min": 100,
      "max": 1000
    },
    "essays": {
      "unit": "words",
      "min": 500,
      "max": 650
    },
    "questionnaireFields": {
      "unit": "characters",
      "min": 100,
      "max": 500
    }
  }
}
```

**Field definitions:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `schemaVersion` | string | yes | Fixed value `"1.0.0"` — written by server, never user-supplied |
| `preset` | string | yes | One of: `"common_app"`, `"coalition_app"`, `"custom"` |
| `lastUpdated` | string | yes | ISO 8601 datetime, system-generated on every write |
| `limits.impactStatements.unit` | string | yes | Fixed value `"characters"` — not user-configurable in v1 |
| `limits.impactStatements.min` | integer | yes | 0 ≤ min ≤ 9998; min < max |
| `limits.impactStatements.max` | integer | yes | 1 ≤ max ≤ 9999; max > min |
| `limits.essays.unit` | string | yes | Fixed value `"words"` — not user-configurable in v1 |
| `limits.essays.min` | integer | yes | 0 ≤ min ≤ 9998; min < max |
| `limits.essays.max` | integer | yes | 1 ≤ max ≤ 9999; max > min |
| `limits.questionnaireFields.unit` | string | yes | Fixed value `"characters"` — not user-configurable in v1 |
| `limits.questionnaireFields.min` | integer | yes | 0 ≤ min ≤ 9998; min < max |
| `limits.questionnaireFields.max` | integer | yes | 1 ≤ max ≤ 9999; max > min |

**Hardcoded defaults (used when `limits.json` is absent or unreadable):**

```json
{
  "preset": "common_app",
  "limits": {
    "impactStatements": { "unit": "characters", "min": 100, "max": 1000 },
    "essays":           { "unit": "words",      "min": 500, "max": 650  },
    "questionnaireFields": { "unit": "characters", "min": 100, "max": 500 }
  }
}
```

These defaults are defined as a constant object in `/src/config/limitsDefaults.js` and imported by both the route handler and any module that needs fallback values. They are **never** loaded from disk when the file is absent — they are code constants.

**Preset canonical value reference** (client-side reference only — used to detect value divergence and display the customization badge):

| Preset | impactStatements min | impactStatements max | essays min | essays max | questionnaireFields min | questionnaireFields max |
|--------|---------------------|---------------------|-----------|-----------|------------------------|------------------------|
| common_app | 100 | 1000 | 500 | 650 | 100 | 500 |
| coalition_app | 100 | 1000 | 500 | 650 | 100 | 500 |

These values are defined in `/src/config/limitsDefaults.js` as `PRESET_VALUES` and used by the client to determine whether displayed values match the canonical preset. They are **not** enforced server-side — the server applies the same `_validateCustomLimits` path for all presets. If the submitted values diverge from the canonical preset values, the client must send `preset: "custom"` and the server writes whatever valid values are submitted.

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

#### GET /api/config/limits

Returns the current limits configuration. Called on Settings panel mount, impact statement generation screen mount, and essay generation screen mount.

**Request:** No body, no params.

**Server behaviour:**
1. Attempt to read `/src/config/limits.json`.
2. If file exists and is valid JSON: parse and return contents.
3. If file does not exist: return hardcoded defaults with `source: "defaults"`.
4. If file exists but JSON parse fails: log warning, return hardcoded defaults with `source: "defaults"`.

**Response (HTTP 200 — config file exists):**
```json
{
  "success": true,
  "data": {
    "source": "file",
    "preset": "common_app",
    "lastUpdated": "2026-06-15T10:30:00.000Z",
    "limits": {
      "impactStatements": { "unit": "characters", "min": 100, "max": 1000 },
      "essays":           { "unit": "words",      "min": 500, "max": 650  },
      "questionnaireFields": { "unit": "characters", "min": 100, "max": 500 }
    }
  },
  "error": null,
  "timestamp": "2026-06-15T10:35:00.000Z"
}
```

**Response (HTTP 200 — no config file, returning defaults):**
```json
{
  "success": true,
  "data": {
    "source": "defaults",
    "preset": "common_app",
    "lastUpdated": null,
    "limits": {
      "impactStatements": { "unit": "characters", "min": 100, "max": 1000 },
      "essays":           { "unit": "words",      "min": 500, "max": 650  },
      "questionnaireFields": { "unit": "characters", "min": 100, "max": 500 }
    }
  },
  "error": null,
  "timestamp": "2026-06-15T10:35:00.000Z"
}
```

**Error cases:** This endpoint does not return an error — it always falls back to defaults on any read failure. File-system errors are logged server-side (to `/DATA_DIR/.logs/`) but not surfaced to the client.

---

#### POST /api/config/limits

Saves new limits configuration to `/src/config/limits.json`. Called when user clicks [Save Settings].

**Request body:**
```json
{
  "preset": "custom",
  "limits": {
    "impactStatements": { "min": 150, "max": 800 },
    "essays":           { "min": 400, "max": 700 },
    "questionnaireFields": { "min": 50,  "max": 400 }
  }
}
```

Note: `unit` fields are not sent by client — server sets them to their fixed values.

**Request body for a built-in preset with unmodified canonical values:**
```json
{
  "preset": "common_app",
  "limits": {
    "impactStatements": { "min": 100, "max": 1000 },
    "essays":           { "min": 500, "max": 650  },
    "questionnaireFields": { "min": 100, "max": 500 }
  }
}
```

**Request body for a built-in preset tab with customized values (client detects divergence and sends `preset: "custom"`):**
```json
{
  "preset": "custom",
  "limits": {
    "impactStatements": { "min": 100, "max": 1000 },
    "essays":           { "min": 500, "max": 500  },
    "questionnaireFields": { "min": 100, "max": 500 }
  }
}
```

**Validation (server-side):**

| Field | Rule | Error code | Error message |
|-------|------|-----------|---------------|
| `preset` | required, one of `"common_app"`, `"coalition_app"`, `"custom"` | `INVALID_PRESET` | "preset must be one of: common_app, coalition_app, custom." |
| `limits` | required object with exactly three keys: `impactStatements`, `essays`, `questionnaireFields` | `MISSING_FIELD` | "limits object with impactStatements, essays, and questionnaireFields is required." |
| each `min` | required, integer (no decimals), 0 ≤ min ≤ 9998 | `VALIDATION_ERROR` | "min must be an integer between 0 and 9998." |
| each `max` | required, integer, 1 ≤ max ≤ 9999 | `VALIDATION_ERROR` | "max must be an integer between 1 and 9999." |
| min < max | max must be strictly greater than min for each section | `VALIDATION_ERROR` | "[section] max must be greater than min." (e.g., "essays max must be greater than min.") |
**Server behaviour:**
1. Validate `preset` and `limits` structure.
2. Validate each min/max pair regardless of preset value — all presets go through `_validateCustomLimits`.
3. Build the full `limits.json` object: add `schemaVersion: "1.0.0"`, `lastUpdated: now()`, fix `unit` fields.
4. Acquire file lock on `/src/config/limits.json`.
5. Write file (create if not exists, overwrite if exists).
6. Release lock.
7. Return success with the saved object.

**Response (HTTP 200):**
```json
{
  "success": true,
  "data": {
    "preset": "custom",
    "lastUpdated": "2026-06-15T10:30:00.000Z",
    "limits": {
      "impactStatements": { "unit": "characters", "min": 150, "max": 800 },
      "essays":           { "unit": "words",      "min": 400, "max": 700 },
      "questionnaireFields": { "unit": "characters", "min": 50,  "max": 400 }
    }
  },
  "error": null,
  "timestamp": "2026-06-15T10:30:00.000Z"
}
```

**Error cases:**

| Condition | HTTP status | Code | Message |
|-----------|-------------|------|---------|
| `preset` missing or invalid | 400 | `INVALID_PRESET` | "preset must be one of: common_app, coalition_app, custom." |
| `limits` missing | 400 | `MISSING_FIELD` | "limits object with impactStatements, essays, and questionnaireFields is required." |
| Any `min` is not an integer or out of range | 400 | `VALIDATION_ERROR` | "[section] min must be an integer between 0 and 9998." |
| Any `max` is not an integer or out of range | 400 | `VALIDATION_ERROR` | "[section] max must be an integer between 1 and 9999." |
| max ≤ min for any section | 400 | `VALIDATION_ERROR` | "[section] max must be greater than min." |
| File write failure | 500 | `FILE_WRITE_ERROR` | "Could not save settings. Check your data directory." |

---

### File placement and server startup

**Config loader behaviour at startup** (`/src/config/index.js` or equivalent):
1. Attempt to read `/src/config/limits.json`.
2. If absent: initialize an in-memory defaults object from `/src/config/limitsDefaults.js`. Do not create the file — let the user's first save create it.
3. If present but invalid JSON: log error to console (`[WARN] limits.json is malformed — using defaults`); proceed with in-memory defaults.
4. Expose a `getLimits()` function that returns current in-memory limits (updated on each successful `POST /api/config/limits`).

The `getLimits()` function is used server-side by any route that needs to reference current limits. In v1, limits are informational only — no generation endpoint enforces them. The function is available for future enforcement.

**File locking:** Same mechanism used throughout the project (consistent with architecture.md JSON data file handling guardrail). Acquire lock before write, release after flush.

**No audit log entry** for config saves — limits.json is a config file, not student profile data. Audit log (`.audit.json`) is reserved for profile data changes.

---

## AI integration

N/A — no AI in this story. The settings panel reads and writes a JSON config file. No Gemini calls are made. The limit values are surfaced as informational display on generation screens only — no AI prompt is modified by this story. Future enhancement (enforcing limits in prompts) is out of scope for v1.

---

## Enterprise checks

**Auth:** Authenticated users only — consistent with all other screens. No valid session → redirect to `/`. The settings panel is user-global (one config file for the local install); there is no per-user settings separation in v1. All `/api/config/limits` endpoints require a valid session.

**Input validation:**
- Client-side: numeric input fields have `type="number"`, `min="0"`, `max="9999"`, `step="1"` HTML attributes. Real-time inline error shown when max ≤ min ("Max must be greater than min."). [Save Settings] button disabled when client-side validation fails.
- Server-side (authoritative): all fields re-validated on `POST /api/config/limits` per the rules in Section 3. Non-integer values (decimals, strings, null) rejected with HTTP 400. Fields outside range rejected. All presets go through the same validation path — no server-side canonical override.

**Error states:**

| Failure mode | What the user sees |
|---|---|
| `GET /api/config/limits` fails on Settings panel open | Inline alert at top of panel: "Could not load current settings. Showing defaults." Fields populated with hardcoded defaults. Controls enabled. |
| `POST /api/config/limits` fails | Bootstrap danger toast: "Could not save settings. Check your data directory." Fields not reset. User can retry. |
| `GET /api/config/limits` fails on impact statement or essay screen | Limit banner is omitted silently. Generation flow is not blocked. |
| Client-side max ≤ min | Inline error below field pair: "Max must be greater than min." [Save Settings] disabled. |
| Server-side validation error | Bootstrap danger toast with the specific error message returned by the server (e.g., "essays max must be greater than min."). |

**Data safety:**
- Closing the browser on the Settings panel with unsaved changes: changes are lost (fields were only in DOM state). The `limits.json` file on disk is unchanged. On next open, the panel loads the last saved config (or defaults). The unsaved-changes browser `confirm()` guard gives the user a chance to stay and save.
- Mid-write crash (file write partially complete): file locking prevents partial writes from being read as valid JSON. On next load, if the file is malformed, the server falls back to defaults and logs a warning. The user can re-save from the Settings panel to restore a valid file.
- No student profile data is involved in this story — no risk of losing achievements, statements, or essays.

**Rate limiting / abuse:**
- `GET /api/config/limits`: no rate limiting. It is a trivial file read called 2–3 times per session. No abuse vector.
- `POST /api/config/limits`: no rate limiting. It writes a tiny JSON file with no AI calls or external services involved. No abuse vector beyond disk I/O.

**AI fallback:** N/A — no AI in this story.

---

## Acceptance criteria

1. Opening the Settings panel (`/settings`) for the first time (no `limits.json` file on disk) shows "Common App" preset selected (active button highlight), all fields populated with the default values (impact statements: 100–1000 chars, essays: 500–650 words, questionnaire: 100–500 chars), and the "Last saved" line is hidden.

2. With "Common App" or "Coalition App" preset selected, all numeric input fields are editable — clicking into any field places a cursor and allows typing. No `readonly` attribute is present.

3. With a named preset tab active (Common App or Coalition App), changing a field value so that it diverges from that preset's canonical values causes a customization badge to appear on the active preset button (e.g., "Common App (customized)"); when [Save Settings] is clicked, the effective preset sent to the server is `"custom"`.

4. Changing the essays max field to a value less than or equal to essays min (in any tab) shows an inline error "Max must be greater than min." immediately below the essays field pair, and disables the [Save Settings] button.

5. Correcting the invalid field (setting max > min) clears the inline error and re-enables [Save Settings].

6. Clicking [Save Settings] with valid Custom values calls `POST /api/config/limits`, receives HTTP 200, shows a Bootstrap success toast "Settings saved.", updates the "Last saved: [timestamp]" line in place, and leaves [Save Settings] disabled (no unsaved changes).

7. After a successful save, closing the Settings panel and reopening it (navigating away and back) calls `GET /api/config/limits`, returns `source: "file"`, and the panel displays the previously saved preset and values — not the hardcoded defaults.

8. Closing and restarting the application (stopping and re-running `npx ao`) and then opening Settings shows the same preset and values saved in the previous session — confirming persistence across application restarts.

9. Opening the impact statement generation screen (STORY-004 Screen 3 — Clarifying Questions) shows a blue info banner reading "Generating within Common App limits — Impact statement: 100 – 1000 characters" (or equivalent for the active preset/custom values). The banner includes a "[Change limits]" link.

10. Clicking "[Change limits]" on the impact statement screen navigates to `/settings` via `history.pushState` without a full page reload.

11. Opening the essay generation screen (STORY-006) before clicking [Generate Essay Draft] shows a blue info banner reading "Generating within Common App limits — Essay: 500 – 650 words" (or the active preset/custom values).

12. If `GET /api/config/limits` returns an error when the impact statement or essay screen loads, no error is shown to the user and the generation flow proceeds normally — the limit banner is simply absent.

13. Submitting `POST /api/config/limits` with `preset: "custom"` and valid custom values (e.g., `essays.max: 500` when essays.min is `400`) results in HTTP 200 with exactly those values written to `limits.json` — the server does not override submitted limit values for any preset.

14. Submitting `POST /api/config/limits` with `preset: "custom"` and `essays.min: 700, essays.max: 600` (max < min) returns HTTP 400 with `code: "VALIDATION_ERROR"` and `message: "essays max must be greater than min."` — no file write occurs.

15. Submitting `POST /api/config/limits` with a non-integer value for any limit field (e.g., `essays.min: "five hundred"`) returns HTTP 400 with `code: "VALIDATION_ERROR"` and an appropriate message — no file write occurs.

16. When the Settings panel has unsaved changes (user modified a field but did not click [Save Settings]) and the user clicks "Back to Dashboard", a browser `confirm()` dialog appears: "You have unsaved settings changes. Leave without saving?" — clicking OK navigates away; clicking Cancel stays on the Settings panel.

17. Navigating directly to `http://localhost:3000/settings` in the browser serves `index.html` and renders the Settings panel — not a 404.

---

## Known risks

1. **Config file location in `/src/config/`:** This directory is inside the application source tree, not in `DATA_DIR`. On a fresh `npx` invocation, the `npx` cache creates a temporary copy of the package, meaning writes to `/src/config/limits.json` may not persist if the npx cache is cleared. Mitigation for v1: document this behaviour in the README. Future fix: move `limits.json` to `DATA_DIR` so it lives in the user's chosen persistent directory. This spec uses `/src/config/limits.json` per the architecture amendment's specification — if the build agent encounters persistence issues in testing, move the file to `DATA_DIR/config/limits.json` and update the route path accordingly.

2. **No per-user limits isolation:** A single `limits.json` file applies to all users of the local install. In v1, the app is single-user (one student per `npx` invocation), so this is not a problem. If multi-user is added later, the config endpoint will need a `userId` dimension.

3. **Limits are informational, not enforced:** The AI prompt templates (in STORY-004 and STORY-006) are not modified by this story. Generated content may exceed the configured limits. Students must manually check and trim. This is by design for v1 — if users expect automatic enforcement, the mismatch may cause confusion. Mitigation: the banner explicitly says "Generating within [preset] limits" — making clear it is the target, not an enforced cap.

---

## Change history

| Release | Date | Summary | Type |
|---------|------|---------|------|
| 1.1.2 | 2026-06-15 | Initial spec authored | feature |
| 1.1.3 | 2026-06-15 | Gap merged: unlock preset editing — removed readonly enforcement from Common App/Coalition App inputs; all presets now editable with customization badge and divergence detection; server no longer overrides limit values for named presets | gap-merge |
