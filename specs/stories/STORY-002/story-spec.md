---
story_id: STORY-002
title: "Document upload and AI classification"
depends_on:
  - STORY-001
spec_done: true
---

## What the user can do

- User can click "Upload docs" on any of the four section tiles (Academic, Tests, Achievements, Activities) on the Profile Dashboard and be presented with a styled file picker that accepts PDF and image files only.
- User can select a PDF or image file (JPG, PNG, WEBP) from their file system and submit it — the UI immediately shows a processing spinner with the filename while the server uploads and classifies the document via Gemini Vision.
- User can see the classification result on a dedicated preview screen: the detected document type (e.g., "SAT Score Report"), the category it belongs to (e.g., "Tests"), a confidence percentage, and a short text excerpt from the document so they can verify it is the right file.
- User can click "Confirm" to save the classification result and move on (the file is persisted in `/DATA_DIR/uploads/` and metadata written to `documents.json`), or click "Try Another" to discard and upload a different file.
- User can see an appropriate error message and a clear recovery path when the file is unsupported, too large, or when Gemini fails to classify the document — including a manual assignment option when confidence is below 50%.

---

## Screens and states

### Screen flow

```
Profile Dashboard
  → (click "Upload docs" on a tile)
  → Screen 1: Upload Modal (file picker)
  → (user selects file and clicks "Upload")
  → Screen 2: Processing State (spinner, in-modal)
  → Screen 3: Classification Result (in-modal)
  → (click "Confirm") → back to Profile Dashboard (tile updates)
  → (click "Try Another") → back to Screen 1 (same modal, file cleared)
```

The upload flow is entirely contained within a Bootstrap modal overlay on top of the Profile Dashboard. The student never navigates away from `/` (the dashboard page).

**SPA routing integration (STORY-001):** The Profile Dashboard uses STORY-001's `pushState`-based SPA router. The upload modal is launched by JavaScript event handlers bound to the `[Upload docs]` buttons on the dashboard — no `href` navigation occurs. Opening the modal does NOT push a new history entry. Closing the modal (Confirm, Try Another, or [X]) returns to the dashboard state in-place. The modal's open/closed state is managed in DOM only (`modal.show()` / `modal.hide()` via Bootstrap JS), not in the URL. After `POST /api/documents/confirm` succeeds, the frontend calls `GET /api/profile/sections` (same call the dashboard uses on load) and updates the affected section tile count in place — no `pushState` call, no page reload.

---

### Screen 1 — Upload Modal (file picker)

**Entry point:** Student clicks "Upload docs" button (`btn-outline-primary`) on any section tile on the Profile Dashboard.

**What it displays:**

```
+--------------------------------------------------------------+
|  [X]                    Upload a Document                    |
+--------------------------------------------------------------+
|                                                              |
|  Section: Academic                    (pre-selected, badge)  |
|                                                              |
|  Drag and drop your file here, or click to browse            |
|                                                              |
|  +--------------------------------------------------+        |
|  |  [bi-cloud-upload]                               |        |
|  |                                                  |        |
|  |  Drop PDF or image here                          |        |
|  |  PDF, JPG, PNG, WEBP — max 20 MB                 |        |
|  |  [ Browse files ]   (btn-outline-secondary sm)   |        |
|  +--------------------------------------------------+        |
|  (hidden <input type="file"> accepts=".pdf,.jpg,.jpeg,       |
|   .png,.webp")                                               |
|                                                              |
|  Selected file: (empty state — no file shown)               |
|                                                              |
|  [ Cancel ]  (btn-outline-secondary)   [ Upload ] (btn-primary, disabled until file selected)
+--------------------------------------------------------------+
```

**Section pre-selection:** The modal receives the source section as a data attribute from the clicked tile (`data-section="academic"`). The section name is displayed as a `badge bg-secondary` pill. The student cannot change the section in this modal — section reassignment is handled post-classification if the AI result differs (see Screen 3).

**File selection:**
- Clicking "Browse files" or clicking anywhere inside the dashed drop zone triggers the hidden file input.
- Drag-and-drop: dragging a file over the drop zone adds CSS class `drag-over` (border becomes `border-primary`, background `bg-light`). Dropping a valid file populates the selected file area. Dropping an invalid type shows an inline error (see error states below).
- Once a file is selected, the drop zone is replaced by a selected-file display:

```
|  [bi-file-earmark-pdf] transcript_2026.pdf    32 KB   [bi-x-circle remove]  |
```

- The "Upload" button becomes `btn-primary` (enabled) once a valid file is selected.

**Error states (inline, inside modal):**
- Unsupported file type (e.g., `.docx`, `.exe`): red `alert-danger` below the drop zone — "This file type is not supported. Please upload a PDF, JPG, PNG, or WEBP file."
- File too large (> 20 MB): red `alert-danger` — "This file is too large (max 20 MB). Please compress or crop the document and try again."
- No file selected and "Upload" clicked: inline error "Please select a file before uploading."

**Actions:**
- "Upload" (enabled): triggers `POST /api/documents/upload`, modal transitions to Screen 2.
- "Cancel": closes modal, no data written.
- [X] (close): same as Cancel.

---

### Screen 2 — Processing State (spinner, in-modal)

**Entry point:** Student clicks "Upload" with a valid file selected.

**What it displays:**

```
+--------------------------------------------------------------+
|  [X disabled]           Upload a Document                    |
+--------------------------------------------------------------+
|                                                              |
|  [bi-arrow-clockwise spinning, large, text-primary]          |
|                                                              |
|  Analyzing your document...                                  |
|  transcript_2026.pdf                                         |
|                                                              |
|  This usually takes 5–15 seconds.                            |
|                                                              |
|  [ Cancel ]  (btn-outline-secondary, disabled)               |
+--------------------------------------------------------------+
```

- Modal close [X] and Cancel are both disabled during processing to prevent partial uploads.
- File name is shown so the student knows which file is being processed.
- No progress bar (Gemini processing is not streaming-capable at this stage). A CSS spinner (`spinner-border text-primary`) is shown.
- If processing exceeds 30 seconds, the UI does not auto-cancel; it continues showing the spinner. The server enforces a 45-second timeout on the Gemini call (see backend section).

**This screen has no student actions.** It is a waiting state only.

---

### Screen 3 — Classification Result Preview

**Entry point:** Server returns a successful `POST /api/documents/upload` response.

**Happy path — high confidence (>= 50%):**

```
+--------------------------------------------------------------+
|  [X]              Document Classified                        |
+--------------------------------------------------------------+
|                                                              |
|  [bi-check-circle-fill text-success, large]                 |
|                                                              |
|  [bi-info-circle text-primary]                               |
|  "This looks like an SAT Score Report. Recommended type:     |
|   SAT Score Report (87% confident)"                          |
|  (alert-info, small, mb-2)                                   |
|                                                              |
|  We found:                                                   |
|  SAT Score Report                                            |   ← bold, large
|  Category: Tests                   Confidence: 87%           |
|                                                              |
|  Preview (from your document):                               |
|  +--------------------------------------------------+        |
|  | "College Board · SAT · Score Report              |        |
|  |  Test Date: March 2026                           |        |
|  |  Total Score: [redacted until STORY-003]"        |        |
|  +--------------------------------------------------+        |
|  (bg-light p-2 rounded font-monospace text-sm max 300 chars) |
|                                                              |
|  Wrong category? Assign manually:                            |
|  [ Academic ] [ Tests ] [ Achievements ] [ Activities ]      |
|  (btn-outline-secondary sm, active section highlighted)      |
|                                                              |
|  [ Try Another ]  (btn-outline-secondary)   [ Confirm ]  (btn-success)
+--------------------------------------------------------------+
```

The recommendation message is rendered verbatim from the Gemini `recommendation` field (see AI integration section). It appears as an `alert-info` banner above the type/category display. It is always shown when `recommendation` is a non-empty string.

**Low-confidence path (< 50%):**

```
|  [bi-exclamation-triangle-fill text-warning, large]         |
|                                                              |
|  [bi-info-circle text-warning]                               |
|  "This might be an Award Certificate, but we're not          |
|   confident. Recommended type: Award Certificate (32%)"      |
|  (alert-warning, small, mb-2)                                |
|                                                              |
|  We're not sure what this document is.                       |
|  Best guess: Award Certificate (32% confidence)             |
|                                                              |
|  Preview (from your document):                               |
|  [ ... excerpt ... ]                                         |
|                                                              |
|  Please assign this document to a section manually:          |
|  [ Academic ] [ Tests ] [ Achievements ] [ Activities ]      |
|  (one must be selected before Confirm is enabled)           |
|                                                              |
|  [ Try Another ]  (btn-outline-secondary)   [ Confirm ]  (btn-primary, disabled until section selected)
```

**Unrecognized document (Gemini returns "Unrecognized Document"):**
- Same as low-confidence path. Manual section assignment is required.
- Text reads: "We couldn't identify this document type. Please assign it to a section manually."

**Category mismatch notice:**
- If the AI-classified category differs from the section tile the student clicked (e.g., student clicked "Academic" tile but document classified as "Tests"), a `alert-warning` notice appears: "This looks like it belongs in Tests, not Academic. We've updated the section — or choose a different one below." The section buttons are updated to reflect the AI suggestion.

**Fields displayed:**
- Recommendation banner — `alert-info` (>= 50% confidence) or `alert-warning` (< 50%) showing the Gemini `recommendation` string verbatim. Always shown when classification returns a non-empty `recommendation`. If `recommendation` is empty (e.g., Unrecognized Document), the banner is omitted.
- Detected type (e.g., "SAT Score Report") — `h5 fw-bold`
- Category (e.g., "Tests") — `text-muted`
- Confidence percentage — shown as text ("87% confident") for >= 50%; for < 50% shown with warning styling
- Text excerpt from document — max 300 characters, truncated with "..." if longer. Font: monospace. Background: `bg-light`.
- Manual section assignment buttons — 4 pills for Academic, Tests, Achievements, Activities. Active/selected section shown with `btn-primary`, others `btn-outline-secondary`.

**Actions:**
- "Confirm": calls `POST /api/documents/confirm` with `documentId` and final `category` + `type` (either AI result or manually overridden). On success: modal closes, Profile Dashboard tile for the confirmed section increments its count (re-fetches from `GET /api/profile/sections`). Onboarding hint banner is dismissed (`localStorage` key `ao_hint_dismissed` set to `true`).
- "Try Another": discards the uploaded file from `/DATA_DIR/uploads/` (calls `DELETE /api/documents/:id`), resets modal to Screen 1 state.
- [X] close: same behavior as "Try Another" — file is discarded if not confirmed.
- Manual section buttons: clicking one changes the active section selection. Does not auto-submit; student still must click "Confirm".

**Error states:**
- If `POST /api/documents/confirm` fails: `alert-danger` inside modal — "Something went wrong saving your document. Please try again." Confirm button re-enables.

---

### Profile Dashboard (updated tile state — post-confirm)

After confirmation, the section tile that received the document updates:

```
|  Academic                              |
|  [bi-book]                             |
|  1 document                            |
|  [Upload docs]   (still available)     |
```

The tile count reflects the number of confirmed documents for that section. "Upload docs" remains available so students can add more documents.

---

## Data and backend

### Data entities

#### Document record (stored in `documents.json`)

File location: `/DATA_DIR/documents.json`

This file is an array of document records. Each record:

```json
{
  "id": "doc_20260614_143022_abc123",
  "filename": "20260614_143022_transcript_2026.pdf",
  "originalName": "transcript_2026.pdf",
  "uploadedAt": "2026-06-14T14:30:22Z",
  "filePath": "/DATA_DIR/uploads/20260614_143022_transcript_2026.pdf",
  "fileSize": 204800,
  "mimeType": "application/pdf",
  "status": "pending_confirmation",
  "classification": {
    "type": "Transcript",
    "category": "Academic",
    "confidence": 87,
    "recommendation": "This looks like a transcript. Recommended type: Transcript (87% confident)",
    "preview": "Springfield High School · Official Transcript · Student: [name redacted] · GPA: ...",
    "warnings": [],
    "classifiedAt": "2026-06-14T14:30:35Z",
    "modelUsed": "gemini-2.5-flash-lite"
  },
  "confirmedBy": null,
  "confirmedAt": null,
  "confirmedType": null,
  "confirmedCategory": null,
  "sourceSection": "academic"
}
```

Field definitions:

| Field | Type | Required | Validation |
|---|---|---|---|
| `id` | string | system-generated | Format: `doc_{YYYYMMDD}_{HHmmss}_{6-char random hex}` |
| `filename` | string | system-generated | `{YYYYMMDD_HHmmss}_{sanitized originalName}` — max 200 chars total |
| `originalName` | string | system-captured | Original filename from browser. Sanitized: strip non-ASCII, replace spaces with `_`, max 100 chars |
| `uploadedAt` | string (ISO 8601) | system-generated | UTC timestamp of upload arrival |
| `filePath` | string | system-generated | Absolute path to saved file on disk |
| `fileSize` | number | system-captured | Bytes. Validation: > 0 and <= 20971520 (20 MB) |
| `mimeType` | string | system-captured | Must be one of: `application/pdf`, `image/jpeg`, `image/png`, `image/webp` |
| `status` | string (enum) | system-managed | Values: `pending_confirmation`, `confirmed`, `discarded` |
| `classification.type` | string | AI-generated | One of the 21 taxonomy values defined in the classification taxonomy section |
| `classification.category` | string | AI-generated | One of: `Academic`, `Tests`, `Achievements`, `Activities`, `Other` |
| `classification.confidence` | number | AI-generated | Integer 0–100 |
| `classification.recommendation` | string | AI-generated | Human-readable recommendation sentence, max 200 chars (e.g., "This looks like a transcript. Recommended type: Transcript (87% confident)"). Empty string `""` when type is "Unrecognized Document". |
| `classification.preview` | string | AI-generated | Max 300 characters, UTF-8 text excerpt from document |
| `classification.warnings` | array of strings | AI-generated | Empty array if none. Possible values: `"low_quality_scan"`, `"non_english_text_detected"`, `"handwritten_content"`, `"partial_parse"` |
| `classification.classifiedAt` | string (ISO 8601) | system-generated | UTC timestamp when Gemini returned its result |
| `classification.modelUsed` | string | system-generated | Value of `GEMINI_MODEL` env var at time of classification |
| `confirmedBy` | string or null | student-set | Always `"student"` when set (single-user app) |
| `confirmedAt` | string (ISO 8601) or null | system-generated on confirm | UTC timestamp |
| `confirmedType` | string or null | student-set | Final type after student confirms or overrides |
| `confirmedCategory` | string or null | student-set | Final category after student confirms or overrides |
| `sourceSection` | string | captured from UI | Which tile button the student clicked: `academic`, `tests`, `achievements`, `activities` |

#### Uploaded file storage

- Directory: `/DATA_DIR/uploads/`
- Filename format: `{YYYYMMDD_HHmmss}_{sanitized_originalName}{ext}`
  - Example: `20260614_143022_transcript_springfield.pdf`
  - Sanitization: lowercase, replace spaces with `_`, strip characters outside `[a-z0-9_\-\.]`, preserve original extension, max 200 chars total.
- Files are written before Gemini classification begins. If classification fails, the file remains on disk but the document record has `status: "discarded"` after the student clicks "Try Another" (or closes the modal). The file itself is not deleted from disk on discard — only the record status changes. This preserves evidence and allows manual recovery.

---

### API endpoints

#### `POST /api/documents/upload`

Accepts a multipart form upload, saves the file, calls Gemini Vision to classify, and returns the classification result.

**Request:**
- Content-Type: `multipart/form-data`
- Fields:
  - `file` (file, required): The document file. Max 20 MB. Accepted MIME types: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`.
  - `sourceSection` (string, required): One of `academic`, `tests`, `achievements`, `activities`. Which tile the student clicked.

**Server processing steps (in order):**
1. Validate `sourceSection` is one of the four allowed values. Return 400 if not.
2. Validate file MIME type. Return 415 if unsupported.
3. Validate file size <= 20 MB. Return 413 if exceeded.
4. Sanitize filename and generate `id` and timestamped filename.
5. Write file to `/DATA_DIR/uploads/` using `fs.writeFile`. Return 500 if write fails.
6. If file is PDF: extract text using `pdf-parse`. Pass text to Gemini as text content.
7. If file is image (JPG/PNG/WEBP): resize to max 2048px on longest side using `sharp` (preserve aspect ratio), convert to JPEG at 85% quality, pass as base64 image to Gemini Vision.
8. Call Gemini Vision with classification prompt (see AI integration section). Timeout: 45 seconds.
9. Parse Gemini JSON response. If parse fails, retry once with simplified prompt. If still fails, return classification as `{ type: "Unrecognized Document", category: "Other", confidence: 0, preview: "", warnings: ["parse_failure"] }` — do NOT return 500.
10. Write initial document record to `documents.json` with `status: "pending_confirmation"`.
11. Return response.

**Response (success — 200):**
```json
{
  "success": true,
  "data": {
    "documentId": "doc_20260614_143022_abc123",
    "filename": "20260614_143022_transcript_2026.pdf",
    "originalName": "transcript_2026.pdf",
    "classification": {
      "type": "Transcript",
      "category": "Academic",
      "confidence": 87,
      "recommendation": "This looks like a transcript. Recommended type: Transcript (87% confident)",
      "preview": "Springfield High School · Official Transcript · GPA ...",
      "warnings": []
    }
  },
  "error": null,
  "timestamp": "2026-06-14T14:30:35Z"
}
```

**Error responses:**

| Condition | Status | `error.code` | `error.message` |
|---|---|---|---|
| Missing `sourceSection` | 400 | `INVALID_SECTION` | "sourceSection must be one of: academic, tests, achievements, activities" |
| No file provided | 400 | `NO_FILE` | "No file was provided." |
| Unsupported MIME type | 415 | `UNSUPPORTED_FILE_TYPE` | "Unsupported file type. Please upload a PDF, JPG, PNG, or WEBP file." |
| File > 20 MB | 413 | `FILE_TOO_LARGE` | "File exceeds 20 MB limit. Please compress the file and try again." |
| File write failure | 500 | `STORAGE_ERROR` | "Unable to save file. Please check your data directory and try again." |
| Gemini timeout (> 45s) | 200 | — | Returns degraded classification: `type: "Unrecognized Document"`, `confidence: 0`, `warnings: ["timeout"]` |
| Gemini API key invalid | 500 | `AI_AUTH_ERROR` | "AI service is unavailable. Please check your GEMINI_API_KEY in .env." |
| Rate limit exceeded | 429 | `RATE_LIMIT` | "Too many requests. Please wait a moment and try again." |

Note: Gemini classification failures return HTTP 200 with a degraded `Unrecognized Document` classification, not an HTTP error. The student can still manually assign a category. Only hard infrastructure failures (file write failure, API auth failure) return 5xx.

---

#### `GET /api/documents/pending`

Returns all documents with `status: "pending_confirmation"`. Used by the frontend on dashboard load to detect any documents left in a pending state (e.g., if the student closed the modal before confirming).

**Request:** No parameters.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "documents": [
      {
        "documentId": "doc_20260614_143022_abc123",
        "originalName": "transcript_2026.pdf",
        "classification": {
          "type": "Transcript",
          "category": "Academic",
          "confidence": 87,
          "recommendation": "This looks like a transcript. Recommended type: Transcript (87% confident)",
          "preview": "...",
          "warnings": []
        },
        "uploadedAt": "2026-06-14T14:30:22Z"
      }
    ]
  },
  "error": null,
  "timestamp": "2026-06-14T14:31:00Z"
}
```

If no pending documents: `data.documents` is an empty array `[]`.

**Frontend behavior:** On Profile Dashboard load, if `documents` array is non-empty, show a dismissible `alert-warning` banner: "You have [n] document(s) awaiting confirmation. [Review]" — clicking "Review" re-opens the classification result modal for the first pending document.

---

#### `POST /api/documents/confirm`

Confirms a document classification (with optional student override) and sets status to `confirmed`.

**Request body (JSON):**
```json
{
  "documentId": "doc_20260614_143022_abc123",
  "confirmedType": "Transcript",
  "confirmedCategory": "Academic"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `documentId` | string | required | Must match an existing record in `documents.json` with `status: "pending_confirmation"` |
| `confirmedType` | string | required | Must be one of the 21 taxonomy type values (see classification taxonomy) |
| `confirmedCategory` | string | required | One of: `Academic`, `Tests`, `Achievements`, `Activities`, `Other` |

**Server processing:**
1. Look up document by `documentId` in `documents.json`. Return 404 if not found.
2. Return 409 if `status` is already `confirmed` or `discarded`.
3. Update record: set `status: "confirmed"`, `confirmedBy: "student"`, `confirmedAt: <now UTC>`, `confirmedType`, `confirmedCategory`.
4. Write updated `documents.json` (with file lock).
5. Append audit log entry to `/DATA_DIR/.audit.json`: `{ "action": "document_confirmed", "documentId": "...", "type": "...", "category": "...", "timestamp": "..." }`.
6. Return success.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "documentId": "doc_20260614_143022_abc123",
    "status": "confirmed",
    "confirmedType": "Transcript",
    "confirmedCategory": "Academic",
    "confirmedAt": "2026-06-14T14:32:00Z"
  },
  "error": null,
  "timestamp": "2026-06-14T14:32:00Z"
}
```

**Error responses:**

| Condition | Status | `error.code` | `error.message` |
|---|---|---|---|
| Document not found | 404 | `DOCUMENT_NOT_FOUND` | "Document not found." |
| Already confirmed/discarded | 409 | `INVALID_STATUS` | "Document has already been processed." |
| Invalid `confirmedType` | 400 | `INVALID_TYPE` | "Invalid document type." |
| Invalid `confirmedCategory` | 400 | `INVALID_CATEGORY` | "Invalid document category." |
| File write failure | 500 | `STORAGE_ERROR` | "Unable to save confirmation. Please try again." |

---

#### `DELETE /api/documents/:id`

Discards a pending document (student clicks "Try Another" or closes modal without confirming).

**Request:** URL parameter `id` — the `documentId`.

**Server processing:**
1. Look up document. Return 404 if not found.
2. If `status` is already `confirmed`, return 409 (cannot discard a confirmed document).
3. Set `status: "discarded"` in `documents.json`. File remains on disk.
4. Append audit log entry: `{ "action": "document_discarded", "documentId": "...", "timestamp": "..." }`.
5. Return success.

**Response (200):**
```json
{
  "success": true,
  "data": { "documentId": "doc_20260614_143022_abc123", "status": "discarded" },
  "error": null,
  "timestamp": "2026-06-14T14:33:00Z"
}
```

| Condition | Status | `error.code` | `error.message` |
|---|---|---|---|
| Document not found | 404 | `DOCUMENT_NOT_FOUND` | "Document not found." |
| Already confirmed | 409 | `INVALID_STATUS` | "Cannot discard a confirmed document." |

---

## AI integration

### Trigger

Student clicks "Upload" with a valid file selected. The server calls Gemini after the file is saved to disk. The AI call is server-side only — the API key never reaches the browser.

### Input

For **PDF files:** Extract raw text from the PDF using `pdf-parse`. Pass the first 5000 characters of extracted text as a text part to Gemini. If `pdf-parse` returns empty text (scanned PDF with no embedded text), fall back to treating the PDF as an image: render first page as PNG using a server-side PDF renderer (if available) or pass the raw PDF bytes as base64 to Gemini Vision directly.

For **image files (JPG, PNG, WEBP):** Resize to max 2048px on longest side using `sharp`, encode as JPEG at 85% quality, base64-encode, and pass as an inline image part to Gemini Vision.

Size limits: Total request to Gemini must not exceed Gemini's inline data limit (20 MB base64-encoded). Files are pre-validated at 20 MB raw, which is safely within this limit.

### Prompt template

The following prompt is defined in `/src/ai/extraction.js` as `CLASSIFICATION_PROMPT`. The `{{document_content}}` placeholder is replaced at runtime.

For image input, the prompt text is sent alongside the inline image data. For text input, the document content is inserted into the prompt.

```
You are a document classifier for a college admissions assistant application. Your job is to identify what type of academic document has been uploaded by a high school student.

Analyze the document carefully and respond with a valid JSON object only — no markdown, no explanation, just the JSON.

Document content:
{{document_content}}

Classify this document using ONLY the following taxonomy:

Academic: Transcript, Course Report, Grade Card, School Report
Tests: SAT Score Report, ACT Score Report, AP Exam Result, IB Exam Result, Other Standardized Test
Achievements: Award Certificate, Honor Roll, Scholarship Notice, Competition Result, Recognition Letter
Activities: Club/Sports Registration, Leadership Role, Volunteer Certificate, Work Experience Document, Activity Participation
Other: Unrecognized Document

Rules:
1. Choose the single most specific type that matches the document.
2. If you can see visible evidence (logos, titles, headers, stamp text), cite it in your response.
3. If the document is blurry, handwritten, or partially readable, still make your best classification but lower your confidence score accordingly and add the appropriate warning.
4. If nothing in the document matches any category, use type "Unrecognized Document" and category "Other". Set "recommendation" to an empty string "" in this case.
5. The "preview" field must be a verbatim excerpt (max 300 characters) from the actual document text or visible content. Do not paraphrase or invent. If no text is readable, set preview to an empty string.
6. The "recommendation" field must be a single human-readable sentence explaining your classification decision and recommending the document type. Format: "This looks like a [description]. Recommended type: [type] ([confidence]% confident)". For low confidence (below 50%), use: "This might be a [description], but we're not confident. Recommended type: [type] ([confidence]%)". Max 200 characters.

Respond with exactly this JSON structure:
{
  "classification": "Transcript",
  "category": "Academic",
  "confidence": 87,
  "recommendation": "This looks like a transcript. Recommended type: Transcript (87% confident)",
  "preview": "Springfield High School · Official Transcript · Cumulative GPA: 3.90 · Class of 2026",
  "evidence": "Document header reads 'Official Transcript' and includes a school seal for Springfield High School.",
  "warnings": []
}

Allowed values for "warnings": "low_quality_scan", "non_english_text_detected", "handwritten_content", "partial_parse"
confidence must be an integer from 0 to 100.
```

For image-based inputs, replace `{{document_content}}` with the literal text `[Image provided as inline data — analyze the visual content of the image above.]` and attach the base64 image as an inline part. The image is sent as the first part of a multi-part Gemini request, and the prompt text above is sent as the second text part.

### Expected output schema

```json
{
  "classification": "string — one of 21 valid taxonomy type values",
  "category": "string — one of: Academic, Tests, Achievements, Activities, Other",
  "confidence": "integer — 0 to 100",
  "recommendation": "string — max 200 chars, human-readable recommendation sentence; empty string when type is 'Unrecognized Document'",
  "preview": "string — max 300 chars, verbatim excerpt or empty string",
  "evidence": "string — one sentence citing visible evidence from document",
  "warnings": ["array of strings — zero or more of the four allowed warning values"]
}
```

**Validation of Gemini response (server-side, before returning to client):**
- `classification` must be one of the 21 taxonomy values. If not, replace with `"Unrecognized Document"` and category with `"Other"`.
- `confidence` must be an integer 0–100. If missing or out of range, set to 0.
- `recommendation` must be a string. If missing or not a string, synthesize it server-side: for a valid classification use `"This looks like a [classification]. Recommended type: [classification] ([confidence]% confident)"`. If classification is "Unrecognized Document", set to `""`. Truncate to 200 chars if longer.
- `preview` max 300 chars — truncate if longer.
- `warnings` must be an array. If not, replace with `[]`.
- If Gemini returns non-JSON or malformed JSON: retry once with the same prompt. If second attempt also fails: return `{ classification: "Unrecognized Document", category: "Other", confidence: 0, recommendation: "", preview: "", warnings: ["parse_failure"] }`.

### How output maps to UI

| Gemini field | UI element |
|---|---|
| `recommendation` | Displayed as an `alert-info` (confidence >= 50%) or `alert-warning` (< 50%) banner at the top of Screen 3. Shown verbatim. Omitted only when `recommendation` is an empty string (Unrecognized Document path). |
| `classification` | Displayed as the document type: "We found: **SAT Score Report**" |
| `category` | Displayed as "Category: Tests" in muted text; pre-selects the category section button |
| `confidence` | Displayed as "87% confident" or warning styling if < 50% |
| `preview` | Displayed verbatim in the monospace preview box |
| `warnings` | If non-empty: shown as small `text-warning` pills below preview (e.g., "Low quality scan detected") |

The `evidence` field is stored in the document record for debugging but is not shown in the UI.

### Fallback

If Gemini is unavailable (timeout > 45 seconds, API key error, network failure):
- HTTP 200 is still returned (not 5xx) unless it is an auth error.
- `classification` is set to `"Unrecognized Document"`, `category: "Other"`, `confidence: 0`.
- The student sees the low-confidence flow: prompted to manually assign a section.
- An `alert-warning` note appears in the modal: "We couldn't classify this document automatically. Please assign it to a section manually — you can still save it and review it later."
- The student can choose any section and click Confirm. The document is saved with the manually chosen category.
- The student can always complete the upload flow without AI — the AI failure is not a blocker.

---

## Enterprise checks

**Auth:** No authentication. This is a single-user local desktop app. All endpoints are accessible at `http://localhost:3000` on the user's own machine. No session tokens, no login gates. The server binds to `127.0.0.1` only (not `0.0.0.0`) to prevent external network access.

**Input validation:**
- Client-side: file type checked via MIME sniffing on the `File` object in the browser (`file.type` must match allowed MIME types). File size checked against `file.size`. `sourceSection` is set programmatically from the tile's `data-section` attribute — not user-typed.
- Server-side (mandatory, authoritative):
  - `sourceSection`: must be `academic | tests | achievements | activities`. Enforced before any file processing.
  - File MIME type: validated by `multer` using `fileFilter` on `mimetype`. Allowed: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`.
  - File size: enforced by `multer` `limits.fileSize: 20971520` (20 MB).
  - `documentId` on confirm/discard: must match existing record. No SQL injection risk (JSON file lookup).
  - `confirmedType` on confirm: must be in the allowed taxonomy list (21 values). Enforced by allowlist check.
  - `confirmedCategory` on confirm: must be in `['Academic', 'Tests', 'Achievements', 'Activities', 'Other']`.
  - Filename sanitization: strip non-ASCII, path traversal characters (`../`, `/`), max 200 chars.

**Error states:**
- Unsupported file type: inline `alert-danger` in modal. File input reset. No upload initiated.
- File too large: inline `alert-danger` in modal. No upload initiated (checked client-side before fetch; server also enforces).
- Gemini timeout / unavailable: degraded classification returned, student manually assigns. `alert-warning` shown.
- Gemini API key invalid: `alert-danger` in modal — "AI service is unavailable. Check your GEMINI_API_KEY in .env and restart the app." Student cannot proceed with AI classification but can still confirm a manual assignment.
- Network error during upload fetch: `alert-danger` — "Network error. Please check your connection and try again." Upload button re-enables.
- File write failure on server: `alert-danger` — "Unable to save file. Please check your data directory and try again."
- `POST /api/documents/confirm` failure: `alert-danger` inside modal. Confirm button re-enables.

**Data safety:** The file is written to `/DATA_DIR/uploads/` before Gemini classification is attempted. If the browser is closed mid-upload (after file write but before confirm):
- The document record exists in `documents.json` with `status: "pending_confirmation"`.
- The file remains on disk.
- On next dashboard load, `GET /api/documents/pending` detects the pending document and shows a banner prompting the student to review or discard it.
- No data is lost. Partial state is fully recoverable.

If the browser is closed during the Gemini API call (before the server responds): the server completes the Gemini call and writes the pending record to `documents.json` regardless. Same recovery path applies on next load.

**Rate limiting / abuse:** `POST /api/documents/upload` triggers a Gemini API call. Per the architecture guardrail, Gemini API calls are rate-limited to 10 requests per minute. The server enforces this with an in-memory counter (reset every 60 seconds). If exceeded, `POST /api/documents/upload` returns 429 with `error.code: "RATE_LIMIT"`. The UI shows `alert-warning`: "Too many uploads — please wait a moment before trying again." The upload modal stays open.

**AI fallback:** Yes — if Gemini is unavailable, the student can manually assign the document to a section and confirm. The core task (saving a document to a section) is completable without AI. Only the automatic classification is lost.

---

## Acceptance criteria

1. Clicking "Upload docs" on the Academic, Tests, Achievements, or Activities tile opens the upload modal with the correct section pre-selected as a badge and the section button highlighted.
2. Attempting to upload an unsupported file type (e.g., `.docx`, `.exe`) shows an inline `alert-danger` error inside the modal and does not initiate the upload request.
3. Attempting to upload a file larger than 20 MB shows an inline size error and does not initiate the upload request.
4. Selecting a valid PDF or image file and clicking "Upload" calls `POST /api/documents/upload`, transitions the modal to the processing spinner state, and disables the close button and Cancel during processing.
5. A successful Gemini classification response displays the document type (e.g., "SAT Score Report"), category ("Tests"), confidence percentage, a text excerpt preview, and an AI recommendation banner (e.g., "This looks like an SAT Score Report. Recommended type: SAT Score Report (87% confident)") in the classification result screen.
6. When Gemini returns confidence >= 50%, the student can click "Confirm" which calls `POST /api/documents/confirm` and closes the modal, and the corresponding section tile on the dashboard increments its document count.
7. When Gemini returns confidence < 50% or returns "Unrecognized Document", the Confirm button is disabled until the student clicks one of the four manual section assignment buttons.
8. Clicking "Try Another" calls `DELETE /api/documents/:id` to discard the pending document and resets the modal to the file picker state (Screen 1).
9. Closing the modal (clicking [X]) without confirming marks the document as discarded via `DELETE /api/documents/:id`.
10. The uploaded file is saved to `/DATA_DIR/uploads/` with filename format `{YYYYMMDD_HHmmss}_{sanitized_originalName}.ext` before the Gemini call begins.
11. If Gemini is unavailable (timeout or auth error), the modal transitions to the classification result screen showing "We couldn't classify this document automatically" with manual section assignment buttons enabled and Confirm available once a section is selected.
12. If the student closes the browser mid-upload (document in `pending_confirmation` state), the next dashboard load shows a banner "You have 1 document awaiting confirmation" with a "Review" link that re-opens the classification result modal for that document.
13. Dropping a valid file onto the drop zone (drag-and-drop) selects it and shows the file name and size — equivalent to using the file browser picker.
14. The Gemini prompt is read from `/src/ai/extraction.js` and the model used is always the value of `GEMINI_MODEL` from `.env` — never hardcoded.
15. Every successful Gemini classification response includes a non-empty `recommendation` string for all 20 named document types in the taxonomy. Verifiable: upload one document of each type; the `recommendation` field in `documents.json` must be non-empty for each successful classification.
16. The `recommendation` field in the Gemini response is validated server-side before returning to the client: if Gemini omits it or returns a non-string, the server synthesizes a fallback recommendation string from the `classification` and `confidence` fields. The client always receives a non-empty `recommendation` for any named (non-Unrecognized) document type.
17. For documents classified as "Unrecognized Document", the recommendation banner is not shown in the UI (the `recommendation` field is an empty string `""` for this type only).
18. The upload modal opens and closes without triggering `history.pushState` — pressing the browser back button while the modal is open (or immediately after closing it) navigates to the previous route established by STORY-001's SPA router, not to a modal-specific URL.
19. After clicking "Confirm" on the classification result, the dashboard section tile count updates in place (without a page reload) by re-fetching `GET /api/profile/sections`.

---

## Known risks

- **Large files near 20 MB limit** may cause slow Gemini processing (15–30 seconds). The 45-second server timeout mitigates runaway requests, and the degraded classification fallback ensures the student is never stuck.
- **Poor scan quality** (blurry phone photos, faded ink) will result in low-confidence or `"Unrecognized Document"` results. The manual assignment path is the mitigation. The `low_quality_scan` warning flag in the response gives the student actionable feedback.
- **Misclassification** (e.g., Gemini classifies a transcript as a School Report) is expected to occur occasionally. The manual section override buttons on Screen 3 are always visible regardless of confidence — the student can always correct the classification before confirming.
- **Gemini API rate limits** (free tier: ~10 RPM). Rate limit enforcement on the server (in-memory counter) prevents hammering the API. The 429 response with a clear wait message prevents silent failures.
- **PDF text extraction failures** (scanned PDFs with no embedded text): `pdf-parse` returns empty string. The fallback path sends the PDF binary as inline data to Gemini Vision. This doubles the Gemini request size but recovers the classification path.
- **Concurrent uploads** (student opens two modals simultaneously — unlikely but possible via direct URL manipulation): both will write to `documents.json`. File locking during writes prevents corruption. Both pending records will appear in `GET /api/documents/pending` and can be individually confirmed or discarded.

---

## Change history

| Release | Date | Summary | Type |
|---|---|---|---|
| 1.0.0 | 2026-06-14 | Initial spec authored | feature |
| 1.0.0 | 2026-06-14 | Bug-fix pass: added Gemini `recommendation` field to prompt, schema, document record, and all API response shapes; server-side fallback synthesis when Gemini omits recommendation; recommendation banner rendered on Screen 3; SPA routing integration note (no pushState on modal open/close; tile count updated in-place post-confirm); 5 new acceptance criteria (criteria 15–19) | fix |
