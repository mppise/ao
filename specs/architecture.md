# Architecture

## Vision
An intelligent AI-assisted platform that helps high-school seniors build rich, comprehensive academic profiles for university applications. The system reads and classifies uploaded documents (transcripts, certificates, result sheets), extracts relevant information, and auto-populates profile sections. Real-time impact statement generation guides students toward compelling personal statements while ensuring AI outputs are grounded in actual student data.

## Problem & Users

**Primary user:** High-school seniors (ages 17–18) applying to universities within 2–3 months.

**Current pain:** Students assemble profiles manually — typing achievement descriptions, organizing GPAs and test scores, manually hunting for patterns in their achievements. They start personal essays with no clear sense of the story their profile tells. Advisors (teachers, counselors, parents) receive ad-hoc updates and scattered documents, making it hard to write recommendations or guide applications.

**What they do instead:** Google Docs, spreadsheets, local files, unstructured notes. Some use essay coaching services (expensive, not accessible to many). Many start essays from a blank page and get stuck articulating "why this matters."

**Good-enough for v1:** A student uploads transcripts, test certificates, and achievement documents. AO reads and extracts the data, auto-populates their profile (GPA, test scores, activities, awards). AI generates impact statement starters based on what it extracted. Student refines them. AO produces a shareable PDF summary and a first-draft personal essay (500–650 words). The student can export this data and share it with advisors.

**Success metric:** Student has a rich, exportable profile and a strong first draft essay after 2–3 months of adding documents and refining AI suggestions.

## Constraints

**Hard stops:**
1. **Grounding mandate:** Every fact extracted must be traced back to an uploaded document. No AI "reasoning" inserted without evidence. Confidence scoring required for extracted data — low-confidence extractions flagged for student review.
2. **Document handling:** Must accept PDFs, images (JPG/PNG), and variable quality (phone photos of official documents). OCR and image preprocessing required.
3. **Local-first data:** All student data stored as JSON files in a user-selected directory on disk. No cloud storage, no external databases. Data never leaves the user's machine unless student explicitly exports/shares.
4. **Data exportability:** Full profile (JSON) + summary (PDF) must be downloadable locally. Students can share exported profiles with advisors/parents via email or file transfer.
5. **No external mandates:** Admissions workflows vary by school. AO is student-centric, not bound to specific school policies or recommendation letter integrations.
6. **Desktop-only:** App runs on desktop (macOS, Windows, Linux) via `npx` command. No mobile, no web hosting required.

**Preferences (changeable, not gates):**
- Target latency: document upload → AI extraction in <30 seconds
- Profile completeness UI should feel rewarding (progress bars, encouragement)
- Generated essay draft should sound like a student voice, not ChatGPT corporate speak

## Risks & Out of Scope

**Top 3 risks:**

1. **AI hallucination in extraction (CRITICAL)** — LLM invents or misreads data (e.g., wrong GPA, invented award). Mitigation: Confidence scoring on every extraction; low-confidence fields flagged for manual review; AI output always shown with source excerpt from document; student review gate before any data saves to profile.

2. **Document OCR/parsing failures** — Blurry phone photos, non-English text, handwritten components fail to parse. Student uploads 5 documents, 2 fail silently. Mitigation: Clear error reporting on upload (which pages succeeded, which failed); offer manual entry fallback; retry with different OCR engine if first attempt fails.

3. **Profile overload and decision paralysis** — Student sees 50 fields, doesn't know which matter. Generates essay draft, gets overwhelmed by editing choices. Mitigation: Smart defaults (show only relevant sections per student); AI-generated essay is clearly first-draft ("This is a starting point — your job is to rewrite"); focus guidance on "top 3 gaps."

**Out of scope for v1:**
- Admissions counseling (advising on which schools to apply to, strategy)
- Recommendation letter generation (only profile summaries, not letters)
- Collaboration features (multi-user profiles, real-time editing)
- Integration with Common App, school systems, or student information systems
- Mobile app (web-first only)
- International students (English documents only; SAT/ACT/AP exams only — IB and other systems can be added post-MVP)

## Tech Stack

**Deployment:** Node.js + NPX (local desktop app, not web-hosted)
- **Entry point:** `package.json` with `bin` field pointing to CLI launcher
- **Server:** Express.js (lightweight HTTP server, runs locally on http://localhost:3000 by default)
- **Frontend:** Plain HTML5, vanilla JavaScript, Bootstrap 5 CSS + Bootstrap Icons
- **No external frameworks:** No React, no build transpilation — direct browser support

**Data Storage:** JSON files on disk
- **Location:** User-selected directory (set in config on first run)
- **Schema:** JSON files for profile sections (academic.json, achievements.json, impact_statements.json, etc.)
- **Transactional safety:** Simple file-based locking during writes; append-only activity log for audit trail

**AI & Document Processing:** Google Gemini API
- **Model:** Specified in `.env` as `GEMINI_MODEL` (e.g., `gemini-2.5-flash-lite`)
- **Usage:** Single model for all tasks — document classification, text extraction, OCR, impact statement generation, essay drafting, confidence scoring
- **API Key:** `GEMINI_API_KEY` in `.env` file (user supplies their own); later: localStorage for key management
- **Non-negotiable:** Application must read and use whatever model is configured in `.env`; never hardcode or override

**Configuration:** `.env` file (user-editable at project root)
- `GEMINI_API_KEY=...` (required — user's Gemini API key)
- `GEMINI_MODEL=gemini-2.5-flash-lite` (required — model to use for all AI tasks; must match .env)
- `DATA_DIR=/path/to/user/chosen/directory` (set on first run or configurable)
- Later migration: Store key and model name in browser localStorage when web UI is added
- **Non-negotiable:** App reads these values from .env on startup; never hardcodes or falls back to different models

**File Handling:**
- **PDFs:** `pdf-parse` or `pdfjs-dist` (extract text)
- **Images:** `sharp` (preprocessing, resize, enhance) + Gemini Vision (OCR and classification)

**Testing & Quality:** Node test runner (backend endpoints), manual QA gates for AI outputs

## Guardrails

### Mandatory Project Structure

All code must follow this structure; this is non-negotiable across all stories:

```
/src
  /server           → Express.js server entry point and routes
    /routes         → API route handlers (upload, extract, export, etc.)
    /middleware     → Auth, error handling, logging
  /ai               → AI prompts and orchestration
    /extraction.js  → Gemini Vision prompts for document classification & extraction
    /essay.js       → Gemini text prompts for essay generation
    /impact.js      → Gemini text prompts for impact statement generation
  /public           → Static HTML, CSS, JavaScript, images
    /index.html     → Main UI entry point
    /css
      /bootstrap.min.css
      /custom.css   → Custom Bootstrap theme and overrides
    /js
      /app.js       → Main application logic (vanilla JS)
      /api-client.js → Wrapper around fetch() for API calls
      /ui-utils.js  → DOM manipulation, event handling
    /icons          → Bootstrap Icons or embedded icon set
  /lib              → Utilities: PDF generation, file handling, confidence scoring, data validation
  /utils            → Helper functions (date formatting, path resolution, file I/O)
  /config           → Config loader (.env validation, DATA_DIR setup)
  /.env             → Secrets (GEMINI_API_KEY, GEMINI_MODEL_NAME, DATA_DIR)
/bin                → CLI entry point for `npx` invocation
/data               → User's selected data directory (SYMLINKED or COPIED, not in repo)
/specs              → Architecture & project state (this directory)
/tests              → Test files mirroring /src structure
/package.json       → bin field: "ao": "./bin/cli.js"
```

### Grounding & Evidence Rules

1. **Every extraction must be cited:** Every piece of data (GPA, test score, award, achievement) extracted from a document must include:
   - Source document filename and upload timestamp
   - Confidence score (0–100, derived from Gemini Vision's JSON response)
   - Text excerpt from the original document stored alongside the extracted field
   
2. **Confidence thresholds:**
   - >= 85: Auto-save to profile, show with light review prompt
   - 70–84: Flag for manual review in UI before saving
   - < 70: Reject; offer manual entry fallback

3. **AI output never appears as fact:**
   - All generated text (impact statements, essay drafts) is clearly labeled "AI-generated draft — you should rewrite this"
   - Essay draft always includes inline citations linking back to source data in student's profile (e.g., "[from GPA: 3.9]")
   - No AI reasoning or inference is stored as profile fact unless explicitly confirmed by student

4. **Data file structure:**
   - Each profile section stored as separate JSON file (e.g., `academic.json`, `achievements.json`)
   - Extraction metadata (source doc, timestamp, confidence) stored alongside data
   - Example: `academic.json` contains: `{ gpa: 3.9, confidence: 92, source: "transcript-2026-06-14.pdf", excerpt: "GPA: 3.90" }`

### Data Privacy & FERPA Compliance

**Local storage principle:** All data stays on student's machine. No network transmission except API calls to Gemini for document processing. Documents are NOT sent to Gemini permanently; only processed and discarded. API responses (extracted data) are stored locally.

**What NOT to store in profile JSON:**
- Student's legal name (if different from chosen display name)
- Date of birth or age
- Home address or contact info beyond email
- Parents' or guardians' personal data
- Teacher/counselor names associated with recommendations
- School ID or district-level identifiers
- Passport or legal identification numbers
- Social Security number or tax identifiers

**What CAN store (minimally):**
- First name + optional display name (what student enters)
- Email (for sharing only, not required for local operation)
- Uploaded document files (PDFs/images stored in user's chosen data directory)
- Extracted structured data (GPA, test scores, activity descriptions — no PII)
- Generated profile sections and essay drafts
- Timestamps of uploads and edits
- Metadata: source documents, confidence scores, extraction audit trail

**Deletion mandate:** Student can delete data at any time. Simply delete JSON files and/or uploaded documents from the data directory. All generated content is derivative and tied to source data — deletion cascades automatically.

### Error Handling & OCR Failures

1. **Upload response must always include:**
   - Pages successfully parsed (e.g., "2 of 3 pages recognized")
   - Pages that failed (with reason: "blurry," "non-English," "handwritten," "unsupported format")
   - Retry suggestion (manual re-upload, crop/enhance, try a different scan)

2. **Graceful fallback:**
   - If Claude Vision fails on upload, show student: "We couldn't read this document. Please check quality and re-upload, or enter data manually."
   - Offer manual form entry for any field extraction fails on
   - No silent failures; student always knows what succeeded and what didn't

3. **Retry logic:**
   - On extraction failure, backend automatically retries once with a slightly different prompt
   - If still fails, fallback to manual entry UI for that field
   - Log all failures for debugging (do not expose error details to student)

### Testing Requirements for AI Outputs

1. **Extraction quality (per story 3):**
   - Test with 5 real sample documents (varied quality, formats)
   - Validate extracted GPA matches document text (100% accuracy required)
   - Validate extracted test scores match source (100% accuracy)
   - Confidence scores must be realistic (validated against false-positive rate)

2. **Essay generation (per story 6):**
   - Generate 3 essays from same profile; all should sound like student voice, not corporate
   - Manual spot-check: does generated essay cite only real data from student's profile?
   - Does essay avoid generic phrases like "I am a lifelong learner"?

3. **Impact statements (per story 4):**
   - Validate at least 50% of statements reference actual activities/achievements in profile
   - Manual review: do statements feel authentic and not over-polished?

### Code Quality & Guardrails

1. **Environment & secrets:**
   - All configuration must live in `/.env` (user-edited on first run)
   - Config loader (`/src/config`) must validate that required env vars exist on startup: `GEMINI_API_KEY`, `GEMINI_MODEL`
   - **Critical:** Application must read `GEMINI_MODEL` from .env and use that model for all AI calls; never hardcode or override
   - Never log API keys, full documents, or extracted PII to console or error logs
   - On startup, verify Gemini API key is valid; fail gracefully if not

2. **JSON data file handling:**
   - All profile sections stored as separate `.json` files in `DATA_DIR`
   - File structure: `/DATA_DIR/profile/{section}.json` (e.g., `academic.json`, `achievements.json`)
   - All writes must use file locking to prevent concurrent edits
   - On app exit, ensure all pending writes are flushed to disk
   - Maintain an audit log: `/DATA_DIR/.audit.json` with timestamp, action, affected fields

3. **API response format (standardized):**
   ```json
   {
     "success": true,
     "data": { ... },
     "error": null,
     "timestamp": "2026-06-14T10:30:00Z"
   }
   ```
   On error: `success: false`, populate `error: { code, message }`, data is null

4. **Rate limiting (Gemini API):**
   - Enforce rate limits on Gemini API calls: 10 extraction requests per minute per user (Gemini's free tier)
   - Queue AI requests if limit exceeded; show UI spinner with "Processing... please wait"
   - Never retry failed Gemini calls automatically without user consent

5. **Logging & observability:**
   - Log all document uploads, extractions, and AI calls (with outcome, not full content)
   - Do not log student data or extracted PII
   - Save logs to `/DATA_DIR/.logs/` with daily rotation
   - Include trace IDs for debugging

6. **UI guidelines (HTML/CSS/JS):**
   - Use Bootstrap 5 CSS for consistent, responsive design
   - Use Bootstrap Icons for all iconography (no custom icons needed)
   - Use vanilla JavaScript (no frameworks) — keep JS in `/src/public/js/`
   - All UI state stored in DOM or browser's localStorage (never in-memory only)
   - Accessibility: semantic HTML, ARIA labels for screen readers, keyboard navigation support

## Amendment — 2026-06-15: AI Transparency & Data Provenance Layer

### New Story Added
**STORY-003a: AI transparency and data provenance display** (inserted between STORY-003 and STORY-004)

This cross-cutting feature provides a unified guidance and transparency layer for all AI-assisted content generation (impact statements and essays). It ensures students understand what profile data drives AI recommendations and can see the reasoning behind generated content.

### Scope
- **For impact statements (STORY-004):** Questionnaire modal with 5 optional fields (activities, achievements, test scores, challenges, personal goals) → backend preview-reasoning endpoint → confidence/focus areas display before final generation
- **For essays (STORY-006):** Data provenance display showing which profile sections (achievements, activities, test scores, GPA) are included in essay generation + inline citations linking generated content back to source data
- **General:** Unified display of what profile data is included in each AI generation; explain AI reasoning at a high level (e.g., "Essay emphasizes your test score of 1540 and leadership in debate")
- **Implementation:** UI layer + API integration only; backend endpoints already exist and require no changes

### Dependencies
- STORY-003a depends on STORY-003 (requires confidence scoring and data extraction to be complete)
- STORY-004 now depends on STORY-003a (impact statement generation requires the questionnaire & reasoning preview)
- STORY-006 now depends on STORY-004 AND STORY-003a (essay needs both impact statement context and data provenance display)

### Non-Goals (v1)
- Changes to backend extraction or confidence scoring logic
- Deep AI reasoning explanations (kept simple and student-facing)
- Full audit trails or versioning of profile data (comes in v1.2)
