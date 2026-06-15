/* app.js — Main application logic, screen routing, form handling */

'use strict';

// ─── STORY-003a: Module-level state for AI transparency layer ─────────────────

/**
 * Holds the student's questionnaire answers for the current impact-statement flow.
 * Reset when the questionnaire modal is closed (×/ESC/backdrop) or after save.
 */
let currentAnswerSheet = {
  achievementId: '',
  role: '',
  challenge: '',
  growth: '',
  importance: '',
  impact: '',
};

/**
 * Cache for the last preview-reasoning API response.
 * TTL: 5 minutes. Keyed implicitly on achievementId.
 */
let reasoningPreviewCache = null; // { achievementId, fetchedAt, data }

/**
 * Holds the provenance selection built from the essay provenance modal.
 * Passed to POST /api/essays/generate when the student clicks [Generate Essay].
 */
let provenanceSelection = null; // { includeGpa, testScoreIds, achievementIds, impactStatementIds }

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Register popstate handler for browser back/forward
  window.addEventListener('popstate', () => {
    router(window.location.pathname);
  });

  // Handle hash changes (SPA hash routing for review, section, profile)
  window.addEventListener('hashchange', () => {
    handleHashRoute(window.location.hash);
  });

  // Navbar: centralized upload button — always opens upload modal (no pre-selected section)
  const navUploadBtn = document.getElementById('nav-btn-upload');
  if (navUploadBtn) {
    navUploadBtn.addEventListener('click', () => {
      openUploadModal(null);
    });
  }

  // Check for hash route on initial load
  if (window.location.hash && window.location.hash.length > 1) {
    await router(window.location.pathname);
    handleHashRoute(window.location.hash);
  } else {
    // Route based on current path
    await router(window.location.pathname);
  }
});

/**
 * Handle hash-based routes for SPA navigation.
 * @param {string} hash - e.g. "#review/abc-123", "#section/academic", "#documents"
 */
async function handleHashRoute(hash) {
  if (!hash || hash === '#') return;

  const cleanHash = hash.startsWith('#') ? hash.slice(1) : hash;

  if (cleanHash.startsWith('review/')) {
    const documentId = cleanHash.replace('review/', '');
    if (documentId) {
      // Load pending extraction for this document and show review
      const result = await getExtractionPreview(documentId);
      if (result.success && result.data && result.data.fields) {
        showExtractionReview(documentId, result.data, false);
      } else {
        const statusResult = await getOnboardingStatus();
        const student = statusResult.success && statusResult.data && statusResult.data.student ? statusResult.data.student : {};
        showDashboard(student);
      }
    }
    return;
  }

  if (cleanHash.startsWith('section/')) {
    const sectionName = cleanHash.replace('section/', '');
    const statusResult = await getOnboardingStatus();
    if (statusResult.success) {
      showNavbar();
      await showSectionPlaceholder(sectionName, statusResult.data && statusResult.data.student);
    }
    return;
  }

  if (cleanHash.startsWith('profile/')) {
    const sectionName = cleanHash.replace('profile/', '');
    const statusResult = await getOnboardingStatus();
    if (statusResult.success) {
      showNavbar();
      await showSectionPlaceholder(sectionName, statusResult.data && statusResult.data.student);
    }
    return;
  }

  if (cleanHash === 'documents') {
    const statusResult = await getOnboardingStatus();
    if (statusResult.success && statusResult.data.onboardingComplete) {
      showDashboard(statusResult.data.student);
    }
    return;
  }
}

/**
 * SPA router — dispatch to the right screen based on path.
 * @param {string} path - window.location.pathname
 */
async function router(path) {
  // Export page — show without onboarding check (requires profile data)
  if (path === '/export') {
    // Hide app-screen, show export-page section
    const appScreen = document.getElementById('app-screen');
    if (appScreen) appScreen.style.display = 'none';
    if (typeof renderExportPage === 'function') await renderExportPage();
    return;
  }

  // Settings screen can be shown without onboarding check
  if (path === '/settings') {
    showNavbar();
    await showSettings();
    return;
  }

  const result = await getOnboardingStatus();
  if (!result.success) {
    showScreenError('Could not connect to the AO server. Make sure `npx ao` is running.');
    return;
  }

  if (result.data.onboardingComplete) {
    // Prevent going back into onboarding once complete
    if (path.startsWith('/onboarding/')) {
      history.replaceState({}, '', '/');
      showDashboard(result.data.student);
      return;
    }
    // Impact statements routes
    if (path === '/impact-statements') {
      showNavbar();
      await showImpactStatementsList();
      return;
    }
    if (path === '/impact-statements/generate') {
      // Deep-link to generate: redirect to list since achievement context is lost
      showNavbar();
      await showImpactStatementsList();
      return;
    }
    if (path === '/impact-statements/edit') {
      // Deep-link to edit: redirect to list
      showNavbar();
      await showImpactStatementsList();
      return;
    }
    // Personal Statements (Essays) routes
    if (path === '/essays') {
      showNavbar();
      await showEssaysList();
      return;
    }
    if (path === '/essays/generate') {
      showNavbar();
      await showEssayGenerating();
      return;
    }
    if (path.match(/^\/essays\/[^/]+\/edit$/)) {
      const id = path.replace('/essays/', '').replace('/edit', '');
      showNavbar();
      await showEssayEditById(id);
      return;
    }
    if (path.match(/^\/essays\/[^/]+$/)) {
      const id = path.replace('/essays/', '');
      showNavbar();
      await showEssayEditById(id);
      return;
    }
    // Section views
    if (path.startsWith('/section/')) {
      const sectionName = path.replace('/section/', '');
      showNavbar();
      await showSectionPlaceholder(sectionName, result.data.student);
      return;
    }
    showDashboard(result.data.student);
  } else {
    if (path === '/onboarding/directory') {
      showDirectorySelection();
    } else if (path === '/onboarding/name') {
      showNameEntry();
    } else {
      showWelcome();
    }
  }
}

/**
 * Navigate to a path using pushState, then dispatch via router.
 * Used by navbar links and screen buttons.
 * @param {string} path
 */
function appNavigate(path) {
  // STORY-007: If leaving /settings with unsaved limits changes, confirm first
  if (
    window.location.pathname === '/settings' &&
    path !== '/settings' &&
    typeof limitsHasUnsavedChanges === 'function' &&
    limitsHasUnsavedChanges()
  ) {
    const confirmed = confirm('You have unsaved settings changes. Leave without saving?');
    if (!confirmed) return;
    if (typeof limitsResetDirtyState === 'function') limitsResetDirtyState();
  }
  history.pushState({}, '', path);
  router(path);
}

// ─── Screen: Welcome ──────────────────────────────────────────────────────────

function showWelcome() {
  hideNavbar();
  history.pushState({}, '', '/');
  document.title = 'Admissions Officer';

  renderTemplate(`
    <div class="d-flex justify-content-center align-items-center" style="min-height: 70vh;">
      <div class="card shadow-sm p-5 text-center ao-onboarding-card mx-auto">
        <div class="ao-welcome-icon mb-3">
          <i class="bi bi-mortarboard"></i>
        </div>
        <h1 class="h3 fw-bold mb-1">Admissions Officer</h1>
        <p class="text-muted mb-4">Your personal college application assistant</p>
        <button id="btn-get-started" class="btn btn-primary btn-lg px-5">
          Get Started
        </button>
      </div>
    </div>
  `);

  document.getElementById('btn-get-started').addEventListener('click', showNameEntry);
}

// ─── Screen: Name Entry ───────────────────────────────────────────────────────

function showNameEntry() {
  hideNavbar();
  history.pushState({}, '', '/onboarding/name');
  document.title = 'Your Name — Admissions Officer';

  // Restore from localStorage if available
  const saved = getSavedOnboarding();

  renderTemplate(`
    <div class="d-flex justify-content-center align-items-start pt-4">
      <div class="card shadow-sm p-4 ao-onboarding-card mx-auto w-100">
        <div class="mb-3">
          <small class="text-muted">Step 1 of 2</small>
          <div class="progress ao-progress mt-1 mb-3">
            <div class="progress-bar bg-primary" role="progressbar" style="width: 50%"></div>
          </div>
          <h2 class="h5 fw-semibold">What's your name?</h2>
        </div>

        <div id="ao-alert-zone"></div>

        <form id="form-name" novalidate>
          <div class="mb-3">
            <label for="input-first-name" class="form-label">
              First name <span class="text-danger">*</span>
            </label>
            <input
              type="text"
              id="input-first-name"
              class="form-control"
              maxlength="50"
              autocomplete="given-name"
              value="${escapeHtml(saved.firstName || '')}"
              aria-required="true"
            >
            <div class="invalid-feedback"></div>
          </div>

          <div class="mb-4">
            <label for="input-last-name" class="form-label">
              Last name <span class="text-muted small">(optional)</span>
            </label>
            <input
              type="text"
              id="input-last-name"
              class="form-control"
              maxlength="50"
              autocomplete="family-name"
              value="${escapeHtml(saved.lastName || '')}"
            >
            <div class="invalid-feedback"></div>
          </div>

          <div class="d-grid">
            <button type="submit" class="btn btn-primary">Continue</button>
          </div>
        </form>
      </div>
    </div>
  `);

  document.getElementById('form-name').addEventListener('submit', handleNameSubmit);
}

function handleNameSubmit(e) {
  e.preventDefault();

  const firstNameEl = document.getElementById('input-first-name');
  const lastNameEl = document.getElementById('input-last-name');
  const namePattern = /^[A-Za-z'\- ]{1,50}$/;
  const lastNamePattern = /^[A-Za-z'\- ]{0,50}$/;

  const firstResult = validateField(firstNameEl, {
    required: true,
    requiredMessage: 'First name is required.',
    maxLength: 50,
    pattern: namePattern,
    patternMessage: 'Name may only contain letters, hyphens, apostrophes, and spaces.',
  });

  let lastResult = { valid: true, message: '' };
  if (lastNameEl.value.trim() !== '') {
    lastResult = validateField(lastNameEl, {
      required: false,
      maxLength: 50,
      pattern: lastNamePattern,
      patternMessage: 'Name may only contain letters, hyphens, apostrophes, and spaces.',
    });
  }

  applyValidation(firstNameEl, firstResult);
  applyValidation(lastNameEl, lastResult);

  if (!firstResult.valid || !lastResult.valid) return;

  // Store in localStorage and advance
  const firstName = firstNameEl.value.trim();
  const lastName = lastNameEl.value.trim();
  saveOnboarding({ firstName, lastName });

  showDirectorySelection();
}

// ─── Screen: Directory Selection ─────────────────────────────────────────────

async function showDirectorySelection() {
  hideNavbar();
  history.pushState({}, '', '/onboarding/directory');
  document.title = 'Data Directory — Admissions Officer';

  // Get suggested default path
  const defaultRes = await getOnboardingDefaults();
  const suggestedDir = defaultRes.success && defaultRes.data
    ? defaultRes.data.suggestedDataDir
    : '/Users/yourname/ao-profile';

  renderTemplate(`
    <div class="d-flex justify-content-center align-items-start pt-4">
      <div class="card shadow-sm p-4 ao-onboarding-card mx-auto w-100">
        <div class="mb-3">
          <small class="text-muted">Step 2 of 2</small>
          <div class="progress ao-progress mt-1 mb-3">
            <div class="progress-bar bg-primary" role="progressbar" style="width: 100%"></div>
          </div>
          <h2 class="h5 fw-semibold">Where should AO store your profile data?</h2>
          <p class="text-muted small">Choose a folder on your computer.</p>
        </div>

        <div id="ao-alert-zone"></div>

        <form id="form-dir" novalidate>
          <div class="mb-3">
            <label for="input-data-dir" class="form-label">
              Directory path <span class="text-danger">*</span>
            </label>
            <input
              type="text"
              id="input-data-dir"
              class="form-control font-monospace"
              value="${escapeHtml(suggestedDir)}"
              aria-required="true"
            >
            <div class="invalid-feedback"></div>
            <div class="form-text">
              <i class="bi bi-info-circle me-1"></i>
              AO will create this folder if it doesn't exist. All data stays on your machine.
            </div>
          </div>

          <div class="d-grid gap-2">
            <button type="submit" id="btn-create-profile" class="btn btn-primary">
              Create Profile
            </button>
            <button type="button" id="btn-back" class="btn btn-link text-decoration-none">
              Back
            </button>
          </div>
        </form>
      </div>
    </div>
  `);

  document.getElementById('form-dir').addEventListener('submit', handleDirectorySubmit);
  document.getElementById('btn-back').addEventListener('click', showNameEntry);
}

async function handleDirectorySubmit(e) {
  e.preventDefault();

  const dirEl = document.getElementById('input-data-dir');
  const btn = document.getElementById('btn-create-profile');
  const value = dirEl.value.trim();

  // Client-side validation
  if (value === '') {
    applyValidation(dirEl, { valid: false, message: 'A directory path is required.' });
    return;
  }

  const isAbsolute = value.startsWith('/') || /^[A-Za-z]:[\\\/]/.test(value);
  if (!isAbsolute) {
    applyValidation(dirEl, { valid: false, message: 'Path must be absolute (e.g., /Users/yourname/ao-profile).' });
    return;
  }

  if (value.length < 5) {
    applyValidation(dirEl, { valid: false, message: 'Path seems too short. Please choose a specific folder.' });
    return;
  }

  clearValidation(dirEl);

  // Disable button and show spinner
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Setting up your profile...';

  const saved = getSavedOnboarding();
  const result = await signup(saved.firstName, saved.lastName, value);

  btn.disabled = false;
  btn.innerHTML = 'Create Profile';

  if (result.success) {
    // Clear onboarding state from localStorage
    localStorage.removeItem('ao_onboarding');
    showDashboard(result.data.student);
    return;
  }

  // Handle errors
  const code = result.error && result.error.code;
  const message = result.error && result.error.message;

  if (code === 'PROTECTED_PATH') {
    showAlert('danger', `<i class="bi bi-shield-exclamation me-2"></i>${message}`, 'ao-alert-zone', false);
    return;
  }

  if (code === 'PROFILE_EXISTS') {
    showProfileExistsModal(result.data.existingProfile, value);
    return;
  }

  if (code === 'NETWORK_ERROR') {
    showAlert('danger', `<i class="bi bi-wifi-off me-2"></i>${message}`, 'ao-alert-zone', true);
    return;
  }

  // Generic error
  showAlert('danger', `<i class="bi bi-exclamation-triangle me-2"></i>${message || 'An unexpected error occurred. Please try again.'}`, 'ao-alert-zone', true);
}

/**
 * Show modal when a profile already exists at the chosen path.
 */
function showProfileExistsModal(existingProfile, dataDir) {
  // Remove any existing modal
  const existing = document.getElementById('modal-profile-exists');
  if (existing) existing.remove();

  const modalHtml = `
    <div class="modal fade" id="modal-profile-exists" tabindex="-1" aria-labelledby="modalExistsLabel" aria-modal="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="modalExistsLabel">Profile Already Exists</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <p>A profile for <strong>${escapeHtml(existingProfile.displayName || existingProfile.firstName)}</strong> already exists at this path.</p>
            <p class="text-muted small">Created: ${existingProfile.createdAt ? new Date(existingProfile.createdAt).toLocaleDateString() : 'Unknown'}</p>
            <p>Do you want to open it instead?</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" id="btn-open-existing">Open Existing Profile</button>
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Choose Different Directory</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  const modalEl = document.getElementById('modal-profile-exists');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();

  document.getElementById('btn-open-existing').addEventListener('click', async () => {
    modal.hide();
    // Set DATA_DIR by calling a special endpoint or just reload status
    // Since we can't set DATA_DIR without writing .env, we reload the status
    // The profile exists so /api/onboarding/status should return complete if DATA_DIR is set
    // We need to trigger a server-side env reload — simplest: call status again
    const statusResult = await getOnboardingStatus();
    if (statusResult.success && statusResult.data.onboardingComplete) {
      showDashboard(statusResult.data.student);
    } else {
      // DATA_DIR might not be set yet — tell server to use this dir
      // Use the signup endpoint which will handle PROFILE_EXISTS, then re-check
      // Actually we need to open the profile at dataDir — expose a separate endpoint
      // For now, inform the user and reload
      showAlert('info', 'To open an existing profile, ensure DATA_DIR is set in your .env file and restart AO.', 'ao-alert-zone', true);
    }
  });

  modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
}

// ─── Screen: Profile Dashboard ────────────────────────────────────────────────

async function showDashboard(studentData) {
  showNavbar();
  history.replaceState({}, '', '/');
  document.title = 'Dashboard — Admissions Officer';

  // Show loading state
  renderTemplate(`
    <div class="text-center py-5">
      <div class="spinner-border text-primary"></div>
      <p class="text-muted mt-2">Loading your profile...</p>
    </div>
  `);

  const result = await getProfileSections();

  if (!result.success) {
    renderTemplate(`
      <div class="alert alert-danger d-flex align-items-center gap-3" role="alert">
        <i class="bi bi-exclamation-triangle-fill fs-4"></i>
        <div>
          Could not load your profile. Check that your data directory is accessible.
          <button id="btn-retry-sections" class="btn btn-sm btn-outline-danger ms-3">Retry</button>
        </div>
      </div>
    `);
    document.getElementById('btn-retry-sections').addEventListener('click', () => showDashboard(studentData));
    return;
  }

  const { sections, student } = result.data;
  const firstName = (student && student.firstName) || (studentData && studentData.firstName) || 'there';
  const displayName = (student && student.displayName) || firstName;

  const hintDismissed = localStorage.getItem('ao_hint_dismissed') === 'true';

  renderTemplate(`
    <div class="mb-4 d-flex justify-content-between align-items-center">
      <h2 class="h4 fw-semibold mb-0">Welcome, ${escapeHtml(firstName)}!</h2>
    </div>

    <div class="row row-cols-1 row-cols-sm-2 g-3 mb-4" id="sections-grid">
      ${renderSectionCard('academic', 'Academic', 'bi-book', sections.academic)}
      ${renderSectionCard('tests', 'Tests', 'bi-pencil-square', sections.tests)}
      ${renderSectionCard('achievements', 'Achievements', 'bi-trophy', sections.achievements)}
      ${renderSectionCard('activities', 'Activities', 'bi-activity', sections.activities)}
      ${renderGenerateCard('impact_statements', 'Impact Statements', 'bi-chat-quote', sections.impact_statements, sections)}
      ${renderGenerateCard('essays', 'Personal Statements', 'bi-journal-text', sections.essays, sections)}
      <div class="col">
        <div
          class="card card-export-link h-100 ao-section-card text-center p-3 shadow-sm"
          id="card-export"
          role="button"
          tabindex="0"
          aria-label="Export Profile — go to export page"
          data-navigate="/export"
        >
          <div class="ao-section-icon mb-2"><i class="bi bi-download"></i></div>
          <h3 class="h6 fw-semibold mb-1">Export Profile</h3>
          <p class="ao-section-status mb-0">Download JSON, PDF, or share</p>
        </div>
      </div>
    </div>

    ${hintDismissed ? '' : `
    <div class="alert alert-info ao-hint-banner d-flex align-items-center gap-2" role="note" id="ao-hint-banner">
      <i class="bi bi-info-circle-fill"></i>
      <span>Tip: Upload documents for AI extraction, or add entries manually.</span>
      <button type="button" class="btn-close ms-auto" id="btn-dismiss-hint" aria-label="Dismiss hint"></button>
    </div>
    `}
  `);

  // Wire up section buttons
  wireUpSectionButtons(sections);

  if (!hintDismissed) {
    document.getElementById('btn-dismiss-hint').addEventListener('click', () => {
      localStorage.setItem('ao_hint_dismissed', 'true');
      document.getElementById('ao-hint-banner').remove();
    });
  }

  // Check for pending documents and show recovery banner
  getPendingDocuments().then(pendingResult => {
    if (pendingResult.success && pendingResult.data && pendingResult.data.documents && pendingResult.data.documents.length > 0) {
      showPendingDocumentsBanner(pendingResult.data.documents);
    }
  }).catch(() => { /* non-fatal */ });

  // Check for pending extractions (unfinished review) on confirmed docs
  fetch('/api/documents/confirmed-list')
    .then(r => r.json())
    .then(r => {
      if (r.success && Array.isArray(r.data && r.data.documents)) {
        checkPendingExtractions(r.data.documents);
      }
    })
    .catch(() => { /* non-fatal */ });

  // Init Export card (card-as-link)
  if (typeof initExportCard === 'function') initExportCard();

  // Init Bootstrap tooltips on disabled generate buttons
  document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
    new bootstrap.Tooltip(el);
  });
}

/**
 * Render a data section tile (Academic, Tests, Achievements, Activities).
 * The entire card is a clickable link navigating to #section/[key].
 */
function renderSectionCard(key, label, icon, section) {
  const isEmpty = section ? section.isEmpty : true;
  const count = section && section.count !== undefined ? section.count : null;

  let statusLabel;
  if (count !== null) {
    statusLabel = count === 0 ? '0 items' : `${count} item${count !== 1 ? 's' : ''}`;
  } else {
    // For sections with summary (academic, tests)
    if (isEmpty) {
      statusLabel = 'Empty';
    } else {
      // Show section-specific summary if available
      const summary = section && section.summary ? section.summary : 'Profile data added';
      statusLabel = summary;
    }
  }

  return `
    <div class="col">
      <a
        class="card-link"
        href="#section/${key}"
        aria-label="Go to ${label}"
        data-section-nav="${key}"
      >
        <div class="card h-100 ao-section-card text-center p-3 shadow-sm">
          <div class="ao-section-icon mb-2"><i class="bi ${icon}"></i></div>
          <h3 class="h6 fw-semibold mb-1">${escapeHtml(label)}</h3>
          <p class="ao-section-status mb-3">${escapeHtml(String(statusLabel))}</p>
          <div class="d-flex gap-2 justify-content-center flex-wrap" onclick="event.stopPropagation()">
            <button
              class="btn btn-sm btn-outline-secondary btn-add-manual"
              data-section="${key}"
              aria-label="Add ${label} manually"
            >
              <i class="bi bi-pencil me-1"></i>Add manually
            </button>
          </div>
        </div>
      </a>
    </div>
  `;
}

/**
 * Render a generate section tile (Impact Statements, Generated Essays).
 */
function renderGenerateCard(key, label, icon, section, sections) {
  const count = section && section.count !== undefined ? section.count : 0;

  // For impact_statements: check if there are achievements/activities
  let hasSource = false;
  let availableCount = 0;
  if (key === 'impact_statements' && sections) {
    const achCount = (sections.achievements && sections.achievements.count) || 0;
    const actCount = (sections.activities && sections.activities.count) || 0;
    hasSource = (achCount + actCount) > 0;
    availableCount = achCount + actCount;
  }

  // Personal Statements (essays) tile: card-as-link pattern
  if (key === 'essays') {
    const achCount = (sections && sections.achievements && sections.achievements.count) || 0;
    const actCount = (sections && sections.activities && sections.activities.count) || 0;
    const hasProfile = (achCount + actCount) > 0;
    const tooltipText = 'Add at least one achievement or activity to your profile first.';

    let statusLabel;
    let buttonsHtml;

    if (count === 0) {
      statusLabel = hasProfile
        ? 'No statements saved yet.'
        : 'No statements saved yet.<br><span class="small text-muted">Add achievements or activities first.</span>';

      if (hasProfile) {
        buttonsHtml = `
          <button class="btn btn-sm btn-primary btn-generate-essay" aria-label="Generate Essay">
            <i class="bi bi-stars me-1"></i>Generate Essay
          </button>`;
      } else {
        buttonsHtml = `
          <button
            class="btn btn-sm btn-outline-secondary disabled"
            tabindex="-1"
            aria-disabled="true"
            data-bs-toggle="tooltip"
            data-bs-placement="top"
            title="${escapeHtml(tooltipText)}"
          >
            <i class="bi bi-stars me-1"></i>Generate Essay
          </button>`;
      }

      // No statements: non-clickable card
      return `
        <div class="col">
          <div class="card h-100 ao-section-card text-center p-3 shadow-sm">
            <div class="ao-section-icon mb-2"><i class="bi ${icon}"></i></div>
            <h3 class="h6 fw-semibold mb-1">${escapeHtml(label)}</h3>
            <p class="ao-section-status mb-3">${statusLabel}</p>
            <div class="d-flex gap-2 justify-content-center flex-wrap">
              ${buttonsHtml}
            </div>
          </div>
        </div>
      `;
    } else {
      // Has saved statements — whole card is a link to /essays
      const lastEdited = section && section.lastEdited ? new Date(section.lastEdited).toLocaleString() : '';
      statusLabel = `${count} statement${count !== 1 ? 's' : ''} saved${lastEdited ? `<br><span class="small text-muted">Last edited: ${escapeHtml(lastEdited)}</span>` : ''}`;

      const generateNewBtn = hasProfile
        ? `<button class="btn btn-sm btn-primary btn-generate-essay" aria-label="Generate essay">
            <i class="bi bi-stars me-1"></i>Generate
          </button>`
        : `<button
            class="btn btn-sm btn-outline-secondary disabled"
            tabindex="-1"
            aria-disabled="true"
            data-bs-toggle="tooltip"
            data-bs-placement="top"
            title="${escapeHtml(tooltipText)}"
          >
            <i class="bi bi-stars me-1"></i>Generate
          </button>`;

      return `
        <div class="col">
          <div
            class="card-link h-100"
            role="link"
            tabindex="0"
            aria-label="View all personal statements"
            data-essays-card-nav="true"
            style="cursor:pointer;display:block;"
          >
            <div class="card h-100 ao-section-card text-center p-3 shadow-sm">
              <div class="ao-section-icon mb-2"><i class="bi ${icon}"></i></div>
              <h3 class="h6 fw-semibold mb-1">${escapeHtml(label)}</h3>
              <p class="ao-section-status mb-3">${statusLabel}</p>
              <div class="d-flex gap-2 justify-content-center flex-wrap">
                ${generateNewBtn}
              </div>
            </div>
          </div>
        </div>
      `;
    }
  }

  // ── Impact Statements tile — card-as-link navigating to /impact-statements ──
  if (key === 'impact_statements') {
    const remaining = Math.max(0, availableCount - count);

    let statusLabel;
    if (count === 0 && !hasSource) {
      statusLabel = 'No impact statements yet.<br><span class="small text-muted">Add achievements or activities first,<br>then generate drafts here.</span>';
    } else if (count === 0) {
      statusLabel = `0 statements · ${availableCount} achievement${availableCount !== 1 ? 's' : ''} available`;
    } else {
      const secondLine = remaining > 0
        ? `<br><span class="small text-muted">${remaining} achievement${remaining !== 1 ? 's' : ''} remaining</span>`
        : '';
      statusLabel = `${count} statement${count !== 1 ? 's' : ''} saved${secondLine}`;
    }

    const generateDisabled = !hasSource;
    const tooltipText = 'Add at least one achievement or activity first.';

    const generateBtn = generateDisabled
      ? `<button
            class="btn btn-sm btn-outline-secondary ao-generate-disabled disabled"
            data-section="${key}"
            tabindex="-1"
            aria-disabled="true"
            data-bs-toggle="tooltip"
            data-bs-placement="top"
            title="${escapeHtml(tooltipText)}"
          >
            <i class="bi bi-stars me-1"></i>Generate
          </button>`
      : `<button
            class="btn btn-sm btn-primary btn-generate-impact"
            data-section="${key}"
            aria-label="Generate Impact Statement"
          >
            <i class="bi bi-stars me-1"></i>Generate
          </button>`;

    return `
      <div class="col">
        <div
          class="card-link"
          role="link"
          aria-label="View all impact statements"
          tabindex="0"
          data-impact-card-nav="true"
          style="cursor:pointer;display:block;"
        >
          <div class="card h-100 ao-section-card text-center p-3 shadow-sm">
            <div class="ao-section-icon mb-2"><i class="bi ${icon}"></i></div>
            <h3 class="h6 fw-semibold mb-1">${escapeHtml(label)}</h3>
            <p class="ao-section-status mb-3">${statusLabel}</p>
            <div class="d-flex gap-2 justify-content-center flex-wrap">
              ${generateBtn}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Generic generate tile (essays, etc.) ─────────────────────────────────────
  const genericStatusLabel = count === 0 ? 'Empty' : `${count} item${count !== 1 ? 's' : ''}`;
  const genericGenerateDisabled = true;
  const genericTooltipText = 'Not available yet.';
  const genericGenerateBtn = `<button class="btn btn-sm btn-outline-secondary disabled" tabindex="-1" aria-disabled="true"
    data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(genericTooltipText)}">
    <i class="bi bi-stars me-1"></i>Generate
  </button>`;

  return `
    <div class="col">
      <a class="card-link" href="#section/${key}" aria-label="Go to ${label}" data-section-nav="${key}">
        <div class="card h-100 ao-section-card text-center p-3 shadow-sm">
          <div class="ao-section-icon mb-2"><i class="bi ${icon}"></i></div>
          <h3 class="h6 fw-semibold mb-1">${escapeHtml(label)}</h3>
          <p class="ao-section-status mb-3">${genericStatusLabel}</p>
          <div class="d-flex gap-2 justify-content-center flex-wrap" onclick="event.stopPropagation()">
            ${genericGenerateBtn}
          </div>
        </div>
      </a>
    </div>
  `;
}

/**
 * Wire up click handlers for Upload and Add Manually buttons on dashboard.
 */
function wireUpSectionButtons(sections) {
  // Card-link navigation (entire card clicks navigate to section)
  document.querySelectorAll('[data-section-nav]').forEach(link => {
    link.addEventListener('click', e => {
      // If the click came from inside any button, don't navigate
      if (e.target.closest('button') || e.target.tagName === 'BUTTON') {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const sectionKey = link.dataset.sectionNav;
      appNavigate(`/section/${sectionKey}`);
    });
    link.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const sectionKey = link.dataset.sectionNav;
        appNavigate(`/section/${sectionKey}`);
      }
    });
  });

  // Add manually buttons
  document.querySelectorAll('.btn-add-manual').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const section = btn.dataset.section;
      openManualEntryModal(section, sections);
    });
  });

  // Impact Statements card-as-link — entire card navigates to /impact-statements
  document.querySelectorAll('[data-impact-card-nav]').forEach(card => {
    card.addEventListener('click', e => {
      // If the click came from inside any button, don't navigate
      if (e.target.closest('button') || e.target.tagName === 'BUTTON') {
        return;
      }
      appNavigate('/impact-statements');
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        appNavigate('/impact-statements');
      }
    });
  });

  // Impact Statements generate button (stopPropagation handled by card-link div wrapper)
  document.querySelectorAll('.btn-generate-impact').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openImpactPickerModal();
    });
  });

  // Essays: generate button — opens provenance modal (Screen 2a), does NOT navigate directly
  document.querySelectorAll('.btn-generate-essay').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openEssayProvenanceModal();
    });
  });

  // Personal Statements card-as-link — entire card navigates to /essays
  document.querySelectorAll('[data-essays-card-nav]').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('button') || e.target.tagName === 'BUTTON') {
        return;
      }
      appNavigate('/essays');
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        appNavigate('/essays');
      }
    });
  });

  // Export card — card-as-link navigating to /export
  const exportCard = document.getElementById('card-export');
  if (exportCard) {
    exportCard.addEventListener('click', () => {
      if (exportCard.style.pointerEvents === 'none') return;
      appNavigate('/export');
    });
    exportCard.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (exportCard.style.pointerEvents === 'none') return;
        appNavigate('/export');
      }
    });
  }
}

// ─── Manual Entry Modals ──────────────────────────────────────────────────────

function openManualEntryModal(section, currentSections, onSuccess) {
  const existingModal = document.getElementById('modal-manual-entry');
  if (existingModal) existingModal.remove();

  const sectionLabels = {
    academic: 'Academic',
    tests: 'Tests',
    achievements: 'Achievements',
    activities: 'Activities',
  };
  const label = sectionLabels[section] || capitalize(section);

  const formHtml = buildManualEntryForm(section);

  const modalHtml = `
    <div class="modal fade" id="modal-manual-entry" tabindex="-1" aria-labelledby="manualEntryLabel" aria-modal="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="manualEntryLabel">Add to ${escapeHtml(label)}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div id="modal-alert-zone"></div>
            ${formHtml}
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="btn-modal-save">Save</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  const modalEl = document.getElementById('modal-manual-entry');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();

  document.getElementById('btn-modal-save').addEventListener('click', () => {
    handleManualEntrySave(section, modal, currentSections, onSuccess);
  });

  modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
}

function buildManualEntryForm(section) {
  switch (section) {
    case 'academic':
      return `
        <form id="form-manual-entry" novalidate>
          <div class="mb-3">
            <label class="form-label">GPA <span class="text-danger">*</span> <span class="text-muted small">(e.g., 3.85)</span></label>
            <input type="text" id="me-gpa" class="form-control" maxlength="10">
            <div class="invalid-feedback"></div>
          </div>
          <div class="mb-3">
            <label class="form-label">GPA Scale <span class="text-muted small">(e.g., 4.0)</span></label>
            <input type="text" id="me-gpa-scale" class="form-control" maxlength="10">
            <div class="invalid-feedback"></div>
          </div>
          <div class="mb-3">
            <label class="form-label">Graduation Year <span class="text-muted small">(e.g., 2026)</span></label>
            <input type="text" id="me-grad-year" class="form-control" maxlength="4">
            <div class="invalid-feedback"></div>
          </div>
          <div class="mb-3">
            <label class="form-label">School Name <span class="text-muted small">(optional)</span></label>
            <input type="text" id="me-school" class="form-control" maxlength="100">
            <div class="invalid-feedback"></div>
          </div>
        </form>
      `;

    case 'tests':
      return `
        <form id="form-manual-entry" novalidate>
          <div class="mb-3">
            <label class="form-label">Test Type <span class="text-danger">*</span></label>
            <select id="me-test-type" class="form-select">
              <option value="">Select type...</option>
              <option>SAT</option><option>ACT</option><option>AP</option><option>IB</option><option>Other</option>
            </select>
            <div class="invalid-feedback"></div>
          </div>
          <div class="mb-3">
            <label class="form-label">Test Name <span class="text-danger">*</span> <span class="text-muted small">(e.g., "SAT", "AP Biology")</span></label>
            <input type="text" id="me-test-name" class="form-control" maxlength="50">
            <div class="invalid-feedback"></div>
          </div>
          <div class="mb-3">
            <label class="form-label">Score <span class="text-danger">*</span> <span class="text-muted small">(e.g., "1480" or "5")</span></label>
            <input type="text" id="me-score" class="form-control" maxlength="20">
            <div class="invalid-feedback"></div>
          </div>
          <div class="mb-3">
            <label class="form-label">Test Date <span class="text-muted small">(MM/DD/YYYY, optional)</span></label>
            <input type="text" id="me-test-date" class="form-control" maxlength="10" placeholder="MM/DD/YYYY">
            <div class="invalid-feedback"></div>
          </div>
        </form>
      `;

    case 'achievements':
      return `
        <form id="form-manual-entry" novalidate>
          <div class="mb-3">
            <label class="form-label">Award/Honor Title <span class="text-danger">*</span></label>
            <input type="text" id="me-title" class="form-control" maxlength="100">
            <div class="invalid-feedback"></div>
          </div>
          <div class="mb-3">
            <label class="form-label">Issuing Organization <span class="text-muted small">(e.g., school name)</span></label>
            <input type="text" id="me-org" class="form-control" maxlength="100">
            <div class="invalid-feedback"></div>
          </div>
          <div class="mb-3">
            <label class="form-label">Date Awarded <span class="text-muted small">(MM/DD/YYYY, optional)</span></label>
            <input type="text" id="me-date-awarded" class="form-control" maxlength="10" placeholder="MM/DD/YYYY">
            <div class="invalid-feedback"></div>
          </div>
          <div class="mb-3">
            <label class="form-label">Category <span class="text-muted small">(optional)</span></label>
            <select id="me-category" class="form-select">
              <option value="">Select category...</option>
              <option value="academic">Academic</option>
              <option value="sports">Sports</option>
              <option value="community">Community</option>
              <option value="other">Other</option>
            </select>
            <div class="invalid-feedback"></div>
          </div>
        </form>
      `;

    case 'activities':
      return `
        <form id="form-manual-entry" novalidate>
          <div class="mb-3">
            <label class="form-label">Activity Name <span class="text-danger">*</span></label>
            <input type="text" id="me-activity-name" class="form-control" maxlength="100">
            <div class="invalid-feedback"></div>
          </div>
          <div class="mb-3">
            <label class="form-label">Role <span class="text-muted small">(e.g., "Member", "President")</span></label>
            <input type="text" id="me-role" class="form-control" maxlength="100">
            <div class="invalid-feedback"></div>
          </div>
          <div class="mb-3">
            <label class="form-label">Organization/School</label>
            <input type="text" id="me-org" class="form-control" maxlength="100">
            <div class="invalid-feedback"></div>
          </div>
          <div class="mb-3">
            <label class="form-label">Hours per week <span class="text-muted small">(optional)</span></label>
            <input type="text" id="me-hours" class="form-control" maxlength="5">
            <div class="invalid-feedback"></div>
          </div>
        </form>
      `;

    default:
      return '<p class="text-muted">No form available for this section.</p>';
  }
}

async function handleManualEntrySave(section, modal, currentSections, onSuccess) {
  clearModalErrors();

  let valid = true;
  let payload = {};

  if (section === 'academic') {
    const gpaEl = document.getElementById('me-gpa');
    const gpaScaleEl = document.getElementById('me-gpa-scale');
    const gradYearEl = document.getElementById('me-grad-year');
    const schoolEl = document.getElementById('me-school');

    const gpaResult = validateField(gpaEl, {
      required: true,
      requiredMessage: 'GPA is required.',
      numeric: true,
      numericMessage: 'GPA must be a number.',
      numericRange: [0, 5.0],
    });
    applyValidation(gpaEl, gpaResult);
    if (!gpaResult.valid) valid = false;

    if (gpaScaleEl.value.trim()) {
      const scaleResult = validateField(gpaScaleEl, { numeric: true, numericMessage: 'GPA Scale must be a number.' });
      applyValidation(gpaScaleEl, scaleResult);
      if (!scaleResult.valid) valid = false;
    }

    if (gradYearEl.value.trim()) {
      const yearResult = validateField(gradYearEl, { numeric: true, numericMessage: 'Graduation year must be a number.' });
      applyValidation(gradYearEl, yearResult);
      if (!yearResult.valid) valid = false;
    }

    if (!valid) return;

    payload = {
      gpa: gpaEl.value.trim(),
      gpaScale: gpaScaleEl.value.trim() || undefined,
      graduationYear: gradYearEl.value.trim() || undefined,
      school: schoolEl.value.trim() || undefined,
    };

  } else if (section === 'tests') {
    const typeEl = document.getElementById('me-test-type');
    const nameEl = document.getElementById('me-test-name');
    const scoreEl = document.getElementById('me-score');
    const dateEl = document.getElementById('me-test-date');

    if (!typeEl.value) {
      applyValidation(typeEl, { valid: false, message: 'Test type is required.' });
      valid = false;
    }
    const nameResult = validateField(nameEl, { required: true, requiredMessage: 'Test name is required.', maxLength: 50 });
    applyValidation(nameEl, nameResult);
    if (!nameResult.valid) valid = false;

    const scoreResult = validateField(scoreEl, { required: true, requiredMessage: 'Score is required.', numeric: true, numericMessage: 'Score must be numeric.' });
    applyValidation(scoreEl, scoreResult);
    if (!scoreResult.valid) valid = false;

    if (dateEl.value.trim() && !/^\d{2}\/\d{2}\/\d{4}$/.test(dateEl.value.trim())) {
      applyValidation(dateEl, { valid: false, message: 'Date must be in MM/DD/YYYY format.' });
      valid = false;
    }

    if (!valid) return;

    payload = {
      testType: typeEl.value,
      testName: nameEl.value.trim(),
      score: scoreEl.value.trim(),
      testDate: dateEl.value.trim() || undefined,
    };

  } else if (section === 'achievements') {
    const titleEl = document.getElementById('me-title');
    const orgEl = document.getElementById('me-org');
    const dateEl = document.getElementById('me-date-awarded');
    const catEl = document.getElementById('me-category');

    const titleResult = validateField(titleEl, { required: true, requiredMessage: 'Title is required.', maxLength: 100 });
    applyValidation(titleEl, titleResult);
    if (!titleResult.valid) valid = false;

    if (dateEl.value.trim() && !/^\d{2}\/\d{2}\/\d{4}$/.test(dateEl.value.trim())) {
      applyValidation(dateEl, { valid: false, message: 'Date must be in MM/DD/YYYY format.' });
      valid = false;
    }

    if (!valid) return;

    payload = {
      title: titleEl.value.trim(),
      organization: orgEl.value.trim() || undefined,
      dateAwarded: dateEl.value.trim() || undefined,
      category: catEl.value || undefined,
    };

  } else if (section === 'activities') {
    const nameEl = document.getElementById('me-activity-name');
    const roleEl = document.getElementById('me-role');
    const orgEl = document.getElementById('me-org');
    const hoursEl = document.getElementById('me-hours');

    const nameResult = validateField(nameEl, { required: true, requiredMessage: 'Activity name is required.', maxLength: 100 });
    applyValidation(nameEl, nameResult);
    if (!nameResult.valid) valid = false;

    if (hoursEl.value.trim()) {
      const hoursResult = validateField(hoursEl, { numeric: true, numericMessage: 'Hours must be a number.', numericRange: [0, 100] });
      applyValidation(hoursEl, hoursResult);
      if (!hoursResult.valid) valid = false;
    }

    if (!valid) return;

    payload = {
      activityName: nameEl.value.trim(),
      role: roleEl.value.trim() || undefined,
      organization: orgEl.value.trim() || undefined,
      hoursPerWeek: hoursEl.value.trim() || undefined,
    };
  }

  // Disable save button
  const saveBtn = document.getElementById('btn-modal-save');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

  let result;
  if (section === 'academic') result = await addAcademic(payload);
  else if (section === 'tests') result = await addTest(payload);
  else if (section === 'achievements') result = await addAchievement(payload);
  else if (section === 'activities') result = await addActivity(payload);

  saveBtn.disabled = false;
  saveBtn.innerHTML = 'Save';

  if (result && result.success) {
    modal.hide();
    showToast(`Added to ${capitalize(section)}`);
    if (typeof onSuccess === 'function') {
      // Caller provided a custom success handler (e.g., detail page refresh)
      onSuccess();
    } else {
      // Default: refresh dashboard
      const statusResult = await getOnboardingStatus();
      const student = statusResult.success && statusResult.data.student ? statusResult.data.student : {};
      showDashboard(student);
    }
  } else {
    const msg = result && result.error ? result.error.message : 'Failed to save. Please try again.';
    showAlert('danger', msg, 'modal-alert-zone', true);
  }
}

function clearModalErrors() {
  document.querySelectorAll('#modal-manual-entry .is-invalid').forEach(el => {
    el.classList.remove('is-invalid');
  });
  document.querySelectorAll('#modal-manual-entry .invalid-feedback').forEach(el => {
    el.textContent = '';
  });
  const alertZone = document.getElementById('modal-alert-zone');
  if (alertZone) alertZone.innerHTML = '';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showNavbar() {
  document.getElementById('app-navbar').classList.remove('d-none');
}

function hideNavbar() {
  document.getElementById('app-navbar').classList.add('d-none');
}

function showScreenError(message) {
  renderTemplate(`
    <div class="alert alert-danger" role="alert">
      <i class="bi bi-exclamation-triangle me-2"></i>${escapeHtml(message)}
    </div>
  `);
}

function getSavedOnboarding() {
  try {
    return JSON.parse(localStorage.getItem('ao_onboarding') || '{}');
  } catch (_) {
    return {};
  }
}

function saveOnboarding(data) {
  localStorage.setItem('ao_onboarding', JSON.stringify(data));
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

// ─── Pending documents banner ─────────────────────────────────────────────────

function showPendingDocumentsBanner(pendingDocs) {
  // Remove existing banner if any
  const existing = document.getElementById('ao-pending-banner');
  if (existing) existing.remove();

  const n = pendingDocs.length;
  const firstDoc = pendingDocs[0];

  const sectionsGrid = document.getElementById('sections-grid');
  if (!sectionsGrid) return;

  const banner = document.createElement('div');
  banner.id = 'ao-pending-banner';
  banner.className = 'alert alert-warning d-flex align-items-center gap-2 mb-3';
  banner.setAttribute('role', 'alert');
  banner.innerHTML = `
    <i class="bi bi-clock-history"></i>
    <span>You have ${n} document${n !== 1 ? 's' : ''} awaiting confirmation.</span>
    <button type="button" class="btn btn-sm btn-warning ms-2" id="btn-review-pending">Review</button>
    <button type="button" class="btn-close ms-auto" id="btn-dismiss-pending" aria-label="Dismiss"></button>
  `;
  sectionsGrid.parentElement.insertBefore(banner, sectionsGrid);

  document.getElementById('btn-review-pending').addEventListener('click', () => {
    banner.remove();
    // Re-open classification result screen for first pending doc
    openUploadModalWithResult(firstDoc);
  });
  document.getElementById('btn-dismiss-pending').addEventListener('click', () => banner.remove());
}

// ─── Upload Modal ─────────────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

const SECTION_LABELS = {
  academic: 'Academic',
  tests: 'Tests',
  achievements: 'Achievements',
  activities: 'Activities',
};

/**
 * Open upload modal for a given section (Screens 1 → 2 → 3).
 * @param {string} section - source section key
 * @param {object|null} [preloadResult] - if provided, skip to Screen 3 with this result
 */
function openUploadModal(section, preloadResult = null) {
  _destroyUploadModal();

  // Build section selector HTML for Screen 1
  const sectionKeys = ['academic', 'tests', 'achievements', 'activities'];
  const sectionSelectorHtml = sectionKeys.map(key => {
    const label = SECTION_LABELS[key];
    const isActive = key === section;
    return `<button type="button" class="btn btn-sm ${isActive ? 'btn-primary' : 'btn-outline-secondary'} upload-section-btn" data-section-key="${key}">${escapeHtml(label)}</button>`;
  }).join('');

  const modalHtml = `
    <div class="modal fade" id="modal-upload-doc" tabindex="-1" aria-labelledby="uploadDocLabel" aria-modal="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header" id="upload-modal-header">
            <h5 class="modal-title" id="uploadDocLabel">Upload a Document</h5>
            <button type="button" class="btn-close" id="upload-modal-close" aria-label="Close"></button>
          </div>
          <div class="modal-body" id="upload-modal-body">
            <!-- Screen 1: file picker -->
            <div id="upload-screen-1">
              <div class="mb-3">
                <p class="small text-muted mb-2">Which section does this document belong to?</p>
                <div class="d-flex flex-wrap gap-2" id="upload-section-selector">
                  ${sectionSelectorHtml}
                </div>
              </div>
              <div id="upload-alert-zone"></div>

              <!-- Drop zone -->
              <div
                id="upload-drop-zone"
                class="border border-2 border-dashed rounded text-center p-4 mb-3"
                style="cursor:pointer;"
                role="button"
                tabindex="0"
                aria-label="Click or drag to upload a document"
              >
                <i class="bi bi-cloud-upload fs-1 text-primary mb-3 d-block"></i>
                <p class="fw-medium mb-1">Drag &amp; drop your document here</p>
                <p class="text-muted small mb-2">PDF, JPG, PNG, WEBP — max 20 MB</p>
                <p class="text-muted small mb-0"><em>or click the <strong>Upload Document</strong> button below</em></p>
                <input type="file" id="upload-file-input" accept=".pdf,.jpg,.jpeg,.png,.webp" class="d-none" aria-label="Select file">
              </div>

              <!-- Selected file display -->
              <div id="upload-selected-file" class="d-none mb-3">
                <div class="d-flex align-items-center gap-2 p-2 bg-light rounded border">
                  <i class="bi bi-file-earmark-pdf text-danger fs-5" id="upload-file-icon"></i>
                  <div class="flex-grow-1 text-truncate">
                    <span id="upload-filename" class="fw-medium"></span>
                    <span id="upload-filesize" class="text-muted small ms-2"></span>
                  </div>
                  <button type="button" class="btn btn-link text-danger p-0" id="btn-remove-file" aria-label="Remove file">
                    <i class="bi bi-x-circle"></i>
                  </button>
                </div>
              </div>
            </div>

            <!-- Screen 2: processing spinner -->
            <div id="upload-screen-2" class="d-none text-center py-3">
              <div class="position-relative d-inline-block mb-3">
                <div class="spinner-border text-primary" role="status" style="width:3.5rem;height:3.5rem;">
                  <span class="visually-hidden">Analyzing...</span>
                </div>
                <i class="bi bi-cloud-upload text-primary position-absolute top-50 start-50 translate-middle" style="font-size:1.2rem;"></i>
              </div>
              <p class="fw-semibold mb-1">Uploading &amp; classifying your document...</p>
              <p id="upload-processing-filename" class="text-primary small fw-medium mb-2"></p>
              <div class="progress mb-3" style="height:4px;">
                <div id="upload-progress-bar" class="progress-bar progress-bar-striped progress-bar-animated bg-primary" role="progressbar" style="width:100%"></div>
              </div>
              <p class="text-muted small">AI is reading your document. This usually takes 5–15 seconds.</p>
            </div>

            <!-- Screen 3: classification result -->
            <div id="upload-screen-3" class="d-none">
              <div id="upload-result-alert-zone"></div>
              <div class="text-center mb-3">
                <i id="result-icon" class="bi bi-check-circle-fill text-success fs-1"></i>
              </div>
              <div id="result-high-conf">
                <p class="text-muted small mb-1">Detected document type:</p>
                <p id="result-type" class="h4 fw-bold mb-2 text-dark"></p>
                <div class="d-flex align-items-center gap-3 mb-2">
                  <span class="badge bg-secondary fs-6 px-3 py-2" id="result-category-badge"></span>
                  <span class="text-success fw-medium" id="result-confidence-text"></span>
                </div>
                <p class="text-muted small d-none">
                  <span class="text-muted">Category: </span>
                  <span id="result-category" class="text-muted"></span>
                </p>
              </div>
              <div id="result-low-conf" class="d-none">
                <p class="mb-1 text-warning fw-semibold">We're not sure what type this document is.</p>
                <p class="text-muted small mb-1">Best guess: <span id="result-guess" class="fw-medium"></span></p>
              </div>
              <div id="result-unrecognized" class="d-none">
                <p class="mb-1 fw-medium">Document type could not be detected automatically.</p>
                <p class="text-muted small">Please assign it to a section below so it can be saved.</p>
              </div>

              <!-- Preview box -->
              <div class="mb-3" id="result-preview-container">
                <p class="small text-muted mb-1">Preview (from your document):</p>
                <pre id="result-preview" class="bg-light p-2 rounded font-monospace small mb-0" style="white-space:pre-wrap;max-height:120px;overflow-y:auto;font-size:0.8em;"></pre>
              </div>

              <!-- Warnings -->
              <div id="result-warnings" class="mb-2 d-none">
                <span class="small text-warning" id="result-warnings-text"></span>
              </div>

              <!-- Category mismatch notice -->
              <div id="result-mismatch-notice" class="alert alert-warning small d-none" role="alert">
                <i class="bi bi-exclamation-triangle me-1"></i>
                <span id="result-mismatch-text"></span>
              </div>

              <!-- Manual section assignment -->
              <div class="mb-2">
                <p class="small text-muted mb-2" id="result-section-label">Wrong category? Assign manually:</p>
                <div class="d-flex flex-wrap gap-2" id="result-section-buttons">
                  <button type="button" class="btn btn-sm btn-outline-secondary result-section-btn" data-cat="Academic">Academic</button>
                  <button type="button" class="btn btn-sm btn-outline-secondary result-section-btn" data-cat="Tests">Tests</button>
                  <button type="button" class="btn btn-sm btn-outline-secondary result-section-btn" data-cat="Achievements">Achievements</button>
                  <button type="button" class="btn btn-sm btn-outline-secondary result-section-btn" data-cat="Activities">Activities</button>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer" id="upload-modal-footer">
            <!-- Screen 1 footer -->
            <div id="footer-screen-1" class="w-100 d-flex justify-content-between">
              <button type="button" class="btn btn-outline-secondary" id="btn-upload-cancel">Cancel</button>
              <button type="button" class="btn btn-primary" id="btn-upload-submit">
                <i class="bi bi-cloud-upload me-2"></i>Upload Document
              </button>
            </div>
            <!-- Screen 2 footer (processing) -->
            <div id="footer-screen-2" class="w-100 d-none">
              <button type="button" class="btn btn-outline-secondary" disabled>Cancel</button>
            </div>
            <!-- Screen 3 footer -->
            <div id="footer-screen-3" class="w-100 d-none d-flex justify-content-between">
              <button type="button" class="btn btn-outline-secondary" id="btn-try-another">Try Another</button>
              <button type="button" class="btn btn-success" id="btn-confirm-doc">Next: Review and extract</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  const modalEl = document.getElementById('modal-upload-doc');
  const bsModal = new bootstrap.Modal(modalEl, { backdrop: 'static', keyboard: false });

  // State
  let selectedFile = null;
  let currentDocumentId = null;
  let currentClassification = null;
  let selectedCategory = null;
  let sourceSection = section || null;

  // ── Section selector wiring (Screen 1) ────────────────────────────────────

  document.querySelectorAll('.upload-section-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Toggle active state
      document.querySelectorAll('.upload-section-btn').forEach(b => {
        b.classList.remove('btn-primary');
        b.classList.add('btn-outline-secondary');
      });
      btn.classList.remove('btn-outline-secondary');
      btn.classList.add('btn-primary');
      sourceSection = btn.dataset.sectionKey;
      // Clear section-related inline errors
      const alertZone = document.getElementById('upload-alert-zone');
      if (alertZone && alertZone.querySelector('.ao-section-error')) {
        alertZone.querySelector('.ao-section-error').remove();
      }
    });
  });

  // ── File input / drop zone wiring ──────────────────────────────────────────

  const fileInput = document.getElementById('upload-file-input');
  const dropZone = document.getElementById('upload-drop-zone');

  function selectFile(file) {
    const alertZone = document.getElementById('upload-alert-zone');
    alertZone.innerHTML = '';

    // Validate type
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_MIME_TYPES.includes(file.type) && !ALLOWED_EXTENSIONS.includes(ext)) {
      alertZone.innerHTML = `<div class="alert alert-danger small py-2">This file type is not supported. Please upload a PDF, JPG, PNG, or WEBP file.</div>`;
      selectedFile = null;
      document.getElementById('upload-selected-file').classList.add('d-none');
      document.getElementById('upload-drop-zone').classList.remove('d-none');
      return;
    }

    // Validate size
    if (file.size > MAX_FILE_SIZE) {
      alertZone.innerHTML = `<div class="alert alert-danger small py-2">This file is too large (max 20 MB). Please compress or crop the document and try again.</div>`;
      selectedFile = null;
      document.getElementById('upload-selected-file').classList.add('d-none');
      document.getElementById('upload-drop-zone').classList.remove('d-none');
      return;
    }

    selectedFile = file;

    // Show file info
    const icon = document.getElementById('upload-file-icon');
    if (file.type === 'application/pdf') {
      icon.className = 'bi bi-file-earmark-pdf text-danger fs-5';
    } else {
      icon.className = 'bi bi-file-earmark-image text-primary fs-5';
    }
    document.getElementById('upload-filename').textContent = file.name;
    document.getElementById('upload-filesize').textContent = formatFileSize(file.size);
    document.getElementById('upload-drop-zone').classList.add('d-none');
    document.getElementById('upload-selected-file').classList.remove('d-none');
  }

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) selectFile(fileInput.files[0]);
  });

  // Drag and drop
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('border-primary', 'bg-light');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-primary', 'bg-light');
  });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('border-primary', 'bg-light');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) selectFile(e.dataTransfer.files[0]);
  });

  document.getElementById('btn-remove-file').addEventListener('click', () => {
    selectedFile = null;
    fileInput.value = '';
    document.getElementById('upload-drop-zone').classList.remove('d-none');
    document.getElementById('upload-selected-file').classList.add('d-none');
    document.getElementById('upload-alert-zone').innerHTML = '';
  });

  // ── Upload submit ──────────────────────────────────────────────────────────

  document.getElementById('btn-upload-submit').addEventListener('click', async () => {
    if (!selectedFile) {
      // No file yet — open the file picker directly (single-button flow)
      fileInput.click();
      return;
    }

    // Validate that a section has been selected
    if (!sourceSection) {
      const alertZone = document.getElementById('upload-alert-zone');
      // Remove previous section error if any
      const existing = alertZone.querySelector('.ao-section-error');
      if (existing) existing.remove();
      const errDiv = document.createElement('div');
      errDiv.className = 'alert alert-danger small py-2 ao-section-error';
      errDiv.textContent = 'Please select a section before uploading.';
      alertZone.appendChild(errDiv);
      document.getElementById('upload-section-selector').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    // Transition to screen 2 (processing)
    document.getElementById('upload-screen-1').classList.add('d-none');
    document.getElementById('upload-screen-2').classList.remove('d-none');
    document.getElementById('footer-screen-1').classList.add('d-none');
    document.getElementById('footer-screen-2').classList.remove('d-none');
    document.getElementById('upload-modal-close').disabled = true;
    document.getElementById('upload-processing-filename').textContent = selectedFile.name;

    const result = await uploadDocument(selectedFile, sourceSection);

    document.getElementById('upload-screen-2').classList.add('d-none');
    document.getElementById('upload-modal-close').disabled = false;
    document.getElementById('footer-screen-2').classList.add('d-none');

    if (!result.success) {
      // Revert to screen 1 with error
      document.getElementById('upload-screen-1').classList.remove('d-none');
      document.getElementById('footer-screen-1').classList.remove('d-none');
      const errorCode = result.error && result.error.code;
      let errorMsg = (result.error && result.error.message) || 'Upload failed. Please try again.';
      if (errorCode === 'NETWORK_ERROR') errorMsg = 'Network error. Please check your connection and try again.';
      if (errorCode === 'STORAGE_ERROR') errorMsg = 'Unable to save file. Please check your data directory and try again.';
      if (errorCode === 'AI_AUTH_ERROR') errorMsg = 'AI service is unavailable. Check your GEMINI_API_KEY in .env and restart the app.';
      document.getElementById('upload-alert-zone').innerHTML = `<div class="alert alert-danger small py-2">${escapeHtml(errorMsg)}</div>`;
      return;
    }

    // Successful upload — show screen 3
    currentDocumentId = result.data.documentId;
    currentClassification = result.data.classification;
    showClassificationResult(result.data, sourceSection);
  });

  // ── Cancel / close ─────────────────────────────────────────────────────────

  function handleClose() {
    if (currentDocumentId) {
      discardDocument(currentDocumentId).catch(() => {});
    }
    bsModal.hide();
  }

  document.getElementById('upload-modal-close').addEventListener('click', handleClose);
  document.getElementById('btn-upload-cancel').addEventListener('click', () => bsModal.hide());

  // ── Try Another ────────────────────────────────────────────────────────────

  // (btn-try-another is in screen 3 — wired after showClassificationResult)

  // ── Show classification result (Screen 3) ──────────────────────────────────

  function showClassificationResult(data, origSection) {
    const cls = data.classification;
    const confidence = cls.confidence;
    const isUnrecognized = cls.type === 'Unrecognized Document';
    const isLowConf = confidence < 50;

    document.getElementById('upload-screen-3').classList.remove('d-none');
    document.getElementById('footer-screen-3').classList.remove('d-none');

    // Update modal title to reflect classified state
    const modalTitle = document.getElementById('uploadDocLabel');
    if (modalTitle) modalTitle.textContent = 'Document Classified';

    // Recommendation banner (AC-5, AC-16, AC-17)
    const resultAlertZone = document.getElementById('upload-result-alert-zone');
    if (resultAlertZone && cls.recommendation) {
      const bannerClass = isLowConf ? 'alert-warning' : 'alert-info';
      const iconClass = isLowConf ? 'bi-exclamation-triangle text-warning' : 'bi-info-circle text-primary';
      resultAlertZone.innerHTML = `
        <div class="alert ${bannerClass} small mb-2 d-flex align-items-start gap-2" role="note">
          <i class="bi ${iconClass} flex-shrink-0 mt-1"></i>
          <span>${escapeHtml(cls.recommendation)}</span>
        </div>`;
    } else if (resultAlertZone && !cls.recommendation) {
      resultAlertZone.innerHTML = '';
    }

    const resultIcon = document.getElementById('result-icon');

    if (isUnrecognized) {
      resultIcon.className = 'bi bi-exclamation-triangle-fill text-warning fs-1';
      document.getElementById('result-high-conf').classList.add('d-none');
      document.getElementById('result-low-conf').classList.add('d-none');
      document.getElementById('result-unrecognized').classList.remove('d-none');
    } else if (isLowConf) {
      resultIcon.className = 'bi bi-exclamation-triangle-fill text-warning fs-1';
      document.getElementById('result-high-conf').classList.add('d-none');
      document.getElementById('result-low-conf').classList.remove('d-none');
      document.getElementById('result-guess').textContent = `${cls.type} (${confidence}% confidence)`;
    } else {
      resultIcon.className = 'bi bi-check-circle-fill text-success fs-1';
      document.getElementById('result-high-conf').classList.remove('d-none');
      document.getElementById('result-type').textContent = cls.type;
      document.getElementById('result-category').textContent = cls.category;
      const categoryBadge = document.getElementById('result-category-badge');
      if (categoryBadge) categoryBadge.textContent = cls.category;
      document.getElementById('result-confidence-text').textContent = `${confidence}% confident`;
    }

    // Preview
    const previewEl = document.getElementById('result-preview');
    const previewContainer = document.getElementById('result-preview-container');
    if (cls.preview) {
      previewEl.textContent = cls.preview;
      previewContainer.classList.remove('d-none');
    } else {
      previewContainer.classList.add('d-none');
    }

    // Warnings
    if (cls.warnings && cls.warnings.length > 0) {
      const warnMap = {
        low_quality_scan: 'Low quality scan detected',
        non_english_text_detected: 'Non-English text detected',
        handwritten_content: 'Handwritten content detected',
        partial_parse: 'Partial parse — some content may be missing',
        timeout: 'Classification timed out',
        parse_failure: 'Classification response could not be parsed',
      };
      const warnText = cls.warnings.map(w => warnMap[w] || w).join(' · ');
      document.getElementById('result-warnings').classList.remove('d-none');
      document.getElementById('result-warnings-text').textContent = warnText;
    }

    // Determine initial selected category
    const aiCategory = cls.category;
    const sourceSectionLabel = SECTION_LABELS[origSection] || capitalize(origSection);

    // Check category mismatch
    if (!isUnrecognized && aiCategory && aiCategory !== 'Other' && aiCategory !== sourceSectionLabel) {
      const mismatch = document.getElementById('result-mismatch-notice');
      mismatch.classList.remove('d-none');
      document.getElementById('result-mismatch-text').textContent =
        `This looks like it belongs in ${aiCategory}, not ${sourceSectionLabel}. We've updated the section — or choose a different one below.`;
    }

    // Pre-select category button
    selectedCategory = (isUnrecognized || isLowConf || aiCategory === 'Other') ? null : aiCategory;

    if (selectedCategory === null && !isUnrecognized && !isLowConf && aiCategory && aiCategory !== 'Other') {
      selectedCategory = aiCategory;
    }

    // Set label for manual assignment section
    if (isUnrecognized || isLowConf) {
      document.getElementById('result-section-label').textContent = 'Please assign this document to a section manually:';
    }

    // Wire section buttons
    document.querySelectorAll('.result-section-btn').forEach(btn => {
      const cat = btn.dataset.cat;
      if (cat === selectedCategory) {
        btn.classList.remove('btn-outline-secondary');
        btn.classList.add('btn-primary');
      }
      btn.addEventListener('click', () => {
        selectedCategory = cat;
        document.querySelectorAll('.result-section-btn').forEach(b => {
          b.classList.remove('btn-primary');
          b.classList.add('btn-outline-secondary');
        });
        btn.classList.remove('btn-outline-secondary');
        btn.classList.add('btn-primary');
        // Enable confirm button
        document.getElementById('btn-confirm-doc').disabled = false;
      });
    });

    // Confirm button state
    const confirmBtn = document.getElementById('btn-confirm-doc');
    if (isUnrecognized || isLowConf) {
      confirmBtn.disabled = !selectedCategory;
      confirmBtn.className = 'btn btn-primary';
    } else {
      confirmBtn.disabled = false;
      confirmBtn.className = 'btn btn-success';
    }

    // Try Another
    document.getElementById('btn-try-another').addEventListener('click', () => {
      if (currentDocumentId) {
        discardDocument(currentDocumentId).catch(() => {});
        currentDocumentId = null;
      }
      // Reset to screen 1
      document.getElementById('upload-screen-3').classList.add('d-none');
      document.getElementById('footer-screen-3').classList.add('d-none');
      document.getElementById('upload-screen-1').classList.remove('d-none');
      document.getElementById('footer-screen-1').classList.remove('d-none');
      // Reset modal title
      const titleEl = document.getElementById('uploadDocLabel');
      if (titleEl) titleEl.textContent = 'Upload a Document';
      // Clear file
      selectedFile = null;
      fileInput.value = '';
      document.getElementById('upload-drop-zone').classList.remove('d-none');
      document.getElementById('upload-selected-file').classList.add('d-none');
      document.getElementById('upload-alert-zone').innerHTML = '';
      document.getElementById('result-alerts-zone') && (document.getElementById('result-alerts-zone').innerHTML = '');
    });

    // Confirm (save classification) — now also transitions to extraction
    confirmBtn.addEventListener('click', async () => {
      const finalCategory = selectedCategory || aiCategory || 'Other';
      const finalType = cls.type;

      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

      const confirmResult = await confirmDocumentClassification(currentDocumentId, finalType, finalCategory);

      confirmBtn.disabled = false;
      confirmBtn.innerHTML = 'Next: Review and extract';

      if (!confirmResult.success) {
        const msg = (confirmResult.error && confirmResult.error.message) || 'Something went wrong saving your document. Please try again.';
        document.getElementById('upload-result-alert-zone').innerHTML = `<div class="alert alert-danger small py-2">${escapeHtml(msg)}</div>`;
        return;
      }

      // Classification confirmed — close the upload modal and open extraction screen
      localStorage.setItem('ao_hint_dismissed', 'true');
      bsModal.hide();

      // Show extraction flow
      const docFilename = data && data.originalName ? data.originalName : (data && data.filename ? data.filename : 'document');
      openExtractionScreen(currentDocumentId, docFilename, finalType, finalCategory);
    });
  }

  // ── Open ───────────────────────────────────────────────────────────────────

  modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
  bsModal.show();

  // If preload result provided, skip to screen 3
  if (preloadResult) {
    currentDocumentId = preloadResult.documentId;
    currentClassification = preloadResult.classification;
    document.getElementById('upload-screen-1').classList.add('d-none');
    document.getElementById('footer-screen-1').classList.add('d-none');
    showClassificationResult(preloadResult, section);
  }
}

/**
 * Open upload modal pre-loaded with classification result (for pending doc review).
 */
function openUploadModalWithResult(pendingDoc) {
  _destroyUploadModal();

  // Build a minimal data object matching what uploadDocument returns
  const data = {
    documentId: pendingDoc.documentId,
    filename: pendingDoc.originalName,
    originalName: pendingDoc.originalName,
    classification: pendingDoc.classification,
  };
  // Infer source section from category
  const catToSection = { Academic: 'academic', Tests: 'tests', Achievements: 'achievements', Activities: 'activities' };
  const section = (pendingDoc.classification && catToSection[pendingDoc.classification.category]) || 'academic';

  openUploadModal(section, data);
}

function _destroyUploadModal() {
  const existing = document.getElementById('modal-upload-doc');
  if (existing) {
    // Attempt to hide via Bootstrap
    try {
      const inst = bootstrap.Modal.getInstance(existing);
      if (inst) inst.dispose();
    } catch (_) {}
    existing.remove();
  }
}

/**
 * Format file size for display.
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ─── Extraction Screen ────────────────────────────────────────────────────────

/**
 * Entry point: student confirmed classification, now kick off extraction.
 * Shows full-screen spinner, then transitions to review table.
 *
 * @param {string} documentId
 * @param {string} documentFilename
 * @param {string} documentType - raw classified type label
 * @param {string} documentCategory
 */
async function openExtractionScreen(documentId, documentFilename, documentType, documentCategory) {
  showNavbar();
  history.pushState({}, '', '/extract');
  document.title = 'Extracting Data — Admissions Officer';

  // Screen: spinner
  renderTemplate(`
    <div class="d-flex flex-column justify-content-center align-items-center" style="min-height:70vh;" id="extraction-spinner-screen">
      <div class="spinner-border spinner-border-lg text-primary mb-4" style="width:3.5rem;height:3.5rem;" role="status">
        <span class="visually-hidden">Analyzing...</span>
      </div>
      <h2 class="h4 fw-semibold mb-2">Analyzing your document...</h2>
      <p class="text-muted mb-1">This may take up to 30 seconds. Do not close this tab.</p>
      <p class="text-muted small">${escapeHtml(documentFilename)}</p>
      <div id="extraction-error-zone" class="mt-3 w-100" style="max-width:500px;"></div>
    </div>
  `);

  // Check for existing pending extraction (recovery path) first
  const previewResult = await getExtractionPreview(documentId);
  if (previewResult.success && previewResult.data && previewResult.data.fields) {
    showExtractionReview(documentId, previewResult.data, true);
    return;
  }

  // Trigger extraction
  await _runExtraction(documentId, documentFilename, documentType, documentCategory, false);
}

/**
 * Internal: call POST /extract and handle all error states.
 */
async function _runExtraction(documentId, documentFilename, documentType, documentCategory, isRetry) {
  const result = await extractDocument(documentId);

  if (result.success) {
    showExtractionReview(documentId, result.data, false);
    return;
  }

  const errorZone = document.getElementById('extraction-error-zone');
  if (!errorZone) return;

  const spinnerScreen = document.getElementById('extraction-spinner-screen');
  if (spinnerScreen) {
    // Stop spinner
    const spinner = spinnerScreen.querySelector('.spinner-border');
    if (spinner) spinner.style.display = 'none';
  }

  const code = result.error && result.error.code;

  if (code === 'EXTRACTION_TIMEOUT' || result.status === 504) {
    errorZone.innerHTML = `
      <div class="alert alert-warning">
        <i class="bi bi-hourglass-split me-2"></i>
        <strong>Extraction timed out.</strong> Please try again or enter data manually.
        <div class="mt-2 d-flex gap-2 flex-wrap">
          <button class="btn btn-sm btn-primary" id="btn-retry-extract">Try again</button>
          <button class="btn btn-sm btn-outline-secondary" id="btn-manual-entry-fallback">Enter manually</button>
        </div>
      </div>`;
  } else if (code === 'RATE_LIMITED' || result.status === 429) {
    if (!isRetry) {
      // Auto-retry once after 5 seconds
      errorZone.innerHTML = `
        <div class="alert alert-info">
          <i class="bi bi-clock-history me-2"></i>Processing queue is busy. Your document is queued — please wait.
        </div>`;
      const spinnerEl = document.getElementById('extraction-spinner-screen');
      if (spinnerEl) {
        const sp = spinnerEl.querySelector('.spinner-border');
        if (sp) sp.style.display = '';
      }
      setTimeout(() => _runExtraction(documentId, documentFilename, documentType, documentCategory, true), 5000);
      return;
    }
    // Retry also failed
    errorZone.innerHTML = `
      <div class="alert alert-warning">
        <i class="bi bi-exclamation-triangle me-2"></i>
        Processing queue is still busy. Please try again later.
        <div class="mt-2 d-flex gap-2 flex-wrap">
          <button class="btn btn-sm btn-primary" id="btn-retry-extract">Try again</button>
          <button class="btn btn-sm btn-outline-secondary" id="btn-manual-entry-fallback">Enter manually</button>
        </div>
      </div>`;
  } else {
    const msg = (result.error && result.error.message) || 'Could not analyze this document.';
    errorZone.innerHTML = `
      <div class="alert alert-danger">
        <i class="bi bi-exclamation-circle me-2"></i>
        ${escapeHtml(msg)}
        <div class="mt-2 d-flex gap-2 flex-wrap">
          <button class="btn btn-sm btn-primary" id="btn-retry-extract">Try again</button>
          <button class="btn btn-sm btn-outline-secondary" id="btn-manual-entry-fallback">Enter manually</button>
        </div>
      </div>`;
  }

  // Wire retry and manual entry
  const retryBtn = document.getElementById('btn-retry-extract');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      openExtractionScreen(documentId, documentFilename, documentType, documentCategory);
    });
  }
  const manualBtn = document.getElementById('btn-manual-entry-fallback');
  if (manualBtn) {
    manualBtn.addEventListener('click', () => {
      const section = _categoryToSection(documentCategory);
      openManualEntryForExtraction(documentId, section);
    });
  }
}

function _categoryToSection(category) {
  const m = { Academic: 'academic', Tests: 'tests', Achievements: 'achievements', Activities: 'activities' };
  return m[category] || 'academic';
}

/**
 * Show the extraction review table (Screen 2).
 */
function showExtractionReview(documentId, extractionData, isRecovery) {
  showNavbar();
  // Use hash routing per spec: #review/{documentId}
  history.pushState({}, '', `#review/${documentId}`);
  document.title = 'Review Extraction — Admissions Officer';

  const fields = extractionData.fields || [];
  const filename = extractionData.documentFilename || 'document';
  const docType = extractionData.documentType || '';
  const typeLabel = _extractionTypeLabel(docType);

  const lowConfFields = fields.filter(f => f.confidence < 70 && !f.skipped);
  const medConfFields = fields.filter(f => f.confidence >= 70 && f.confidence < 85 && !f.skipped);

  const needsAttentionCount = lowConfFields.length;
  const badgeHtml = needsAttentionCount > 0
    ? `<span class="badge bg-warning text-dark ms-2">${needsAttentionCount} field${needsAttentionCount !== 1 ? 's' : ''} need${needsAttentionCount === 1 ? 's' : ''} your attention</span>`
    : '';

  const recoveryBannerHtml = isRecovery ? `
    <div class="alert alert-info d-flex align-items-center gap-2 mb-3" id="recovery-banner">
      <i class="bi bi-clock-history"></i>
      <span>You have an unfinished review for <strong>${escapeHtml(filename)}</strong>. Continue?</span>
      <button class="btn btn-sm btn-outline-info ms-auto" id="btn-dismiss-recovery">Dismiss</button>
    </div>` : '';

  // Build table rows — filter out deleted fields for display
  const visibleFields = fields.filter(f => !f.deleted);

  // AP/IB informational row (for transcripts only)
  const apIbInfoRow = docType === 'transcript' ? `
    <tr class="table-light">
      <td class="fw-medium text-muted">AP / IB Exam Scores</td>
      <td class="text-muted fst-italic small">(none yet — add via manual entry or upload your AP/IB score report)</td>
      <td>—</td>
      <td>—</td>
      <td>—</td>
    </tr>` : '';

  const rowsHtml = visibleFields.length === 0 && docType !== 'transcript' ? '' : visibleFields.map((field, idx) => {
    const conf = field.confidence;
    const confClass = conf >= 85 ? 'success' : (conf >= 70 ? 'warning' : 'danger');
    const rowClass = conf < 70 ? 'table-danger' : '';
    const valueDisplay = _formatFieldValue(field.value);
    const excerptShort = field.excerpt ? (field.excerpt.length > 120 ? field.excerpt.slice(0, 120) : field.excerpt) : '';
    const excerptLong = field.excerpt && field.excerpt.length > 120 ? field.excerpt : '';

    // Warnings: show only non-ignored
    const ignoredWarnings = Array.isArray(field.ignoredWarnings) ? field.ignoredWarnings : [];
    const activeWarnings = Array.isArray(field.warnings)
      ? field.warnings.filter(w => !ignoredWarnings.includes(w))
      : [];

    const warningsHtml = activeWarnings.length > 0
      ? activeWarnings.map(w => `
          <div class="small text-warning mt-1 d-flex align-items-center gap-1 flex-wrap">
            <i class="bi bi-exclamation-triangle me-1"></i>
            <span>${escapeHtml(w.replace(/_/g, ' '))}</span>
            <button class="btn btn-sm btn-link text-muted p-0 ms-1 btn-ignore-warning" data-field-idx="${idx}" data-field-name="${escapeHtml(field.name)}" data-warning="${escapeHtml(w)}" title="Ignore this warning">
              <i class="bi bi-eye-slash"></i> Ignore
            </button>
          </div>`).join('')
      : '';

    const actionBtn = conf < 70
      ? `<button class="btn btn-sm btn-outline-warning btn-edit-field" data-field-idx="${idx}" data-field-name="${escapeHtml(field.name)}" title="Enter manually">
           <i class="bi bi-keyboard me-1"></i>Enter manually
         </button>`
      : `<button class="btn btn-sm btn-outline-secondary btn-edit-field" data-field-idx="${idx}" data-field-name="${escapeHtml(field.name)}" title="Edit this field">
           <i class="bi bi-pencil me-1"></i>Edit
         </button>`;

    const deleteBtn = `<button class="btn btn-sm btn-outline-danger ms-1 btn-delete-field" data-field-idx="${idx}" data-field-name="${escapeHtml(field.name)}" title="Remove this field">
      <i class="bi bi-trash"></i>
    </button>`;

    const confirmedBadge = field.confirmedByStudent
      ? `<span class="badge bg-success ms-1" title="You confirmed this value"><i class="bi bi-check2"></i></span>` : '';

    return `
      <tr class="${rowClass}" id="field-row-${idx}" data-field-idx="${idx}">
        <td class="fw-medium text-${confClass}">${escapeHtml(field.label)}</td>
        <td id="field-value-cell-${idx}">
          <span class="field-value-display">${escapeHtml(valueDisplay)}${confirmedBadge}</span>
        </td>
        <td style="min-width:120px;">
          <div class="d-flex align-items-center gap-1">
            <span class="small text-${confClass} fw-bold">${conf}%</span>
          </div>
          <div class="progress mt-1" style="height:6px;">
            <div class="progress-bar bg-${confClass}" style="width:${conf}%"></div>
          </div>
        </td>
        <td class="small text-muted">
          ${escapeHtml(excerptShort)}${excerptLong ? `<span class="d-none excerpt-full">${escapeHtml(excerptLong)}</span><a href="#" class="ms-1 btn-show-more small">…show more</a>` : ''}
          ${warningsHtml}
        </td>
        <td class="text-nowrap">${actionBtn}${deleteBtn}</td>
      </tr>`;
  }).join('') + apIbInfoRow;

  const tableOrEmpty = (fields.length === 0 && docType !== 'transcript')
    ? `<div class="text-center py-5">
        <i class="bi bi-exclamation-circle text-warning fs-1 mb-3 d-block"></i>
        <p class="fw-medium">We couldn't extract any data from this document.</p>
        <p class="text-muted small">This may be due to low image quality or an unsupported format.</p>
        <div class="d-flex gap-2 justify-content-center mt-3">
          <button class="btn btn-outline-secondary" id="btn-reupload-doc">Re-upload document</button>
          <button class="btn btn-primary" id="btn-manual-empty">Enter data manually</button>
        </div>
       </div>`
    : `<div class="table-responsive">
        <table class="table table-bordered table-hover">
          <thead class="table-light">
            <tr>
              <th>Field</th>
              <th>Extracted Value</th>
              <th>Confidence</th>
              <th>Source Excerpt</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="extraction-table-body">${rowsHtml}</tbody>
        </table>
       </div>`;

  renderTemplate(`
    ${recoveryBannerHtml}
    <div class="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
      <div>
        <h2 class="h5 fw-semibold mb-1">
          ${escapeHtml(filename)}
          <span class="text-muted fw-normal small ms-2">— ${escapeHtml(typeLabel)}</span>
        </h2>
        <div>
          <span class="badge bg-secondary" id="extracted-count-badge">${visibleFields.length} field${visibleFields.length !== 1 ? 's' : ''} extracted</span>
          ${badgeHtml}
        </div>
      </div>
      <button class="btn btn-primary" id="btn-save-to-profile" ${needsAttentionCount > 0 || fields.length === 0 ? 'disabled' : ''}>
        <i class="bi bi-cloud-check me-1"></i>Save to Profile
      </button>
    </div>

    <div id="extraction-review-alert-zone" class="mb-3"></div>

    ${tableOrEmpty}

    ${(visibleFields.length > 0 || docType === 'transcript') ? `
    <div class="mt-3 d-flex justify-content-between align-items-center">
      <button class="btn btn-primary btn-lg" id="btn-save-to-profile-bottom" ${needsAttentionCount > 0 ? 'disabled' : ''}>
        <i class="bi bi-cloud-check me-1"></i>Save to Profile
      </button>
      <a href="#" class="btn btn-link text-muted" id="btn-cancel-review">Cancel</a>
    </div>` : ''}
  `);

  // State tracking
  const reviewedLowConf = new Set();
  let currentFields = fields.map(f => ({ ...f }));

  // ── Wire recovery banner dismiss ──────────────────────────────────────────
  const recBanner = document.getElementById('recovery-banner');
  if (recBanner) {
    document.getElementById('btn-dismiss-recovery').addEventListener('click', () => recBanner.remove());
  }

  // ── Wire "show more" excerpt toggles ────────────────────────────────────
  document.querySelectorAll('.btn-show-more').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const cell = btn.closest('td');
      const full = cell.querySelector('.excerpt-full');
      if (full) {
        full.classList.toggle('d-none');
        btn.textContent = full.classList.contains('d-none') ? '…show more' : 'show less';
      }
    });
  });

  // ── Wire Edit buttons ─────────────────────────────────────────────────────
  function wireEditButtons() {
    document.querySelectorAll('.btn-edit-field').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.fieldIdx, 10);
        openInlineFieldEdit(idx, documentId, currentFields, () => {
          updateSaveButtonState();
        });
      });
    });
  }
  wireEditButtons();

  // ── Wire Delete (trash) buttons ────────────────────────────────────────────
  function wireDeleteButtons() {
    document.querySelectorAll('.btn-delete-field').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.fieldIdx, 10);
        const fieldName = btn.dataset.fieldName;
        const row = document.getElementById(`field-row-${idx}`);

        // Immediately hide the row
        if (row) row.style.display = 'none';
        currentFields[idx].deleted = true;

        // Call API
        const result = await deleteExtractionField(documentId, fieldName);
        if (!result.success) {
          // Revert row visibility on error
          if (row) row.style.display = '';
          currentFields[idx].deleted = false;
          const alertZone = document.getElementById('extraction-review-alert-zone');
          if (alertZone) {
            alertZone.innerHTML = `<div class="alert alert-warning small py-2"><i class="bi bi-exclamation-triangle me-1"></i>Could not remove field. Please try again.</div>`;
          }
        }
        updateSaveButtonState();
      });
    });
  }
  wireDeleteButtons();

  // ── Wire Ignore Warning buttons ────────────────────────────────────────────
  function wireIgnoreButtons() {
    document.querySelectorAll('.btn-ignore-warning').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.fieldIdx, 10);
        const fieldName = btn.dataset.fieldName;
        const warningText = btn.dataset.warning;

        // Immediately remove the warning div from UI
        const warningDiv = btn.closest('div.small.text-warning');
        if (warningDiv) warningDiv.remove();

        // Update local state
        if (!Array.isArray(currentFields[idx].ignoredWarnings)) {
          currentFields[idx].ignoredWarnings = [];
        }
        currentFields[idx].ignoredWarnings.push(warningText);

        // Call API
        await ignoreExtractionFieldWarning(documentId, fieldName, warningText);
      });
    });
  }
  wireIgnoreButtons();

  // ── Low-confidence field acknowledgment via IntersectionObserver ─────────
  // Yellow (70-84%) rows: track if student has scrolled past them
  if (typeof IntersectionObserver !== 'undefined') {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const row = entry.target;
          const idx = parseInt(row.dataset.fieldIdx, 10);
          if (!isNaN(idx)) {
            const field = currentFields[idx];
            if (field && field.confidence >= 70 && field.confidence < 85) {
              reviewedLowConf.add(idx);
            }
            observer.unobserve(row);
          }
          updateSaveButtonState();
        }
      });
    }, { threshold: 0.5 });

    document.querySelectorAll('[id^="field-row-"]').forEach(row => {
      const idx = parseInt(row.dataset.fieldIdx, 10);
      if (!isNaN(idx)) {
        const field = currentFields[idx];
        if (field && field.confidence >= 70 && field.confidence < 85) {
          observer.observe(row);
        }
      }
    });
  } else {
    // No IntersectionObserver — mark all medium-conf as reviewed
    currentFields.forEach((f, idx) => {
      if (f.confidence >= 70 && f.confidence < 85) reviewedLowConf.add(idx);
    });
  }

  function updateSaveButtonState() {
    const activeFields = currentFields.filter(f => !f.deleted);
    const lowUnacked = activeFields.filter(f =>
      f.confidence < 70 && !f.skipped && !f.confirmedByStudent
    );
    // Medium conf: must have been seen
    const medUnreviewed = activeFields.filter((f, idx) =>
      f.confidence >= 70 && f.confidence < 85 && !f.skipped && !reviewedLowConf.has(currentFields.indexOf(f))
    );

    const disabled = (lowUnacked.length > 0) || (medUnreviewed.length > 0) || activeFields.length === 0;

    ['btn-save-to-profile', 'btn-save-to-profile-bottom'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = disabled;
    });
  }

  // ── Save to Profile button ─────────────────────────────────────────────────
  function handleSaveToProfile() {
    const lowConf = currentFields.filter(f => f.confidence < 70 && !f.skipped && !f.confirmedByStudent);
    if (lowConf.length > 0) {
      openLowConfidenceModal(lowConf, currentFields, documentId, extractionData);
    } else {
      doSaveToProfile(currentFields, documentId, extractionData);
    }
  }

  ['btn-save-to-profile', 'btn-save-to-profile-bottom'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', handleSaveToProfile);
  });

  // ── Cancel link ────────────────────────────────────────────────────────────
  const cancelLink = document.getElementById('btn-cancel-review');
  if (cancelLink) {
    cancelLink.addEventListener('click', async e => {
      e.preventDefault();
      window.location.hash = 'documents';
    });
  }

  // ── Empty state buttons ────────────────────────────────────────────────────
  const reuploadBtn = document.getElementById('btn-reupload-doc');
  if (reuploadBtn) {
    reuploadBtn.addEventListener('click', async () => {
      const section = _categoryToSection(extractionData.documentType === 'transcript' ? 'Academic' : capitalize(extractionData.documentType));
      openUploadModal(section);
    });
  }
  const manualEmptyBtn = document.getElementById('btn-manual-empty');
  if (manualEmptyBtn) {
    manualEmptyBtn.addEventListener('click', () => {
      const section = _docTypeToSection(extractionData.documentType);
      openManualEntryForExtraction(documentId, section);
    });
  }
}

function _extractionTypeLabel(docType) {
  const labels = {
    transcript: 'Academic Transcript',
    test_result: 'Test Score Report',
    certificate: 'Award / Certificate',
    activity: 'Activity Document',
  };
  return labels[docType] || capitalize(docType);
}

function _docTypeToSection(docType) {
  const m = { transcript: 'academic', test_result: 'tests', certificate: 'achievements', activity: 'activities' };
  return m[docType] || 'academic';
}

function _formatFieldValue(value) {
  if (value === null || value === undefined) return '(not found)';
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 80);
  return String(value);
}

/**
 * Open inline field edit for a row.
 */
function openInlineFieldEdit(idx, documentId, currentFields, onUpdate) {
  const field = currentFields[idx];
  if (!field) return;

  const valueCell = document.getElementById(`field-value-cell-${idx}`);
  if (!valueCell) return;

  // Determine if numeric field
  const numericFields = ['gpa_overall', 'gpa_scale', 'graduation_year', 'sat_math', 'sat_ebrw', 'sat_total',
    'act_english', 'act_math', 'act_reading', 'act_science', 'act_composite', 'hours_per_week'];
  const isNumeric = numericFields.includes(field.name);

  const currentVal = Array.isArray(field.value) ? JSON.stringify(field.value) : (field.value !== null ? String(field.value) : '');

  valueCell.innerHTML = `
    <div class="d-flex gap-1 align-items-start flex-column">
      <input type="text" class="form-control form-control-sm" id="field-edit-input-${idx}" value="${escapeHtml(currentVal)}" style="max-width:250px;">
      <div class="invalid-feedback d-block small" id="field-edit-error-${idx}" style="display:none!important;"></div>
      <div class="d-flex gap-1 mt-1">
        <button class="btn btn-sm btn-success" id="btn-field-save-${idx}"><i class="bi bi-check2"></i> Save</button>
        <button class="btn btn-sm btn-outline-secondary" id="btn-field-cancel-${idx}">Cancel</button>
      </div>
    </div>
  `;

  // Focus
  const input = document.getElementById(`field-edit-input-${idx}`);
  if (input) setTimeout(() => input.focus(), 50);

  // Cancel
  document.getElementById(`btn-field-cancel-${idx}`).addEventListener('click', () => {
    // Revert to display
    const confirmedBadge = field.confirmedByStudent
      ? `<span class="badge bg-success ms-1" title="You confirmed this value"><i class="bi bi-check2"></i></span>` : '';
    valueCell.innerHTML = `<span class="field-value-display">${escapeHtml(_formatFieldValue(field.value))}${confirmedBadge}</span>`;
  });

  // Save
  document.getElementById(`btn-field-save-${idx}`).addEventListener('click', async () => {
    const newVal = document.getElementById(`field-edit-input-${idx}`).value.trim();
    const errorEl = document.getElementById(`field-edit-error-${idx}`);

    // Validate
    if (newVal === '') {
      errorEl.textContent = 'This field cannot be empty.';
      errorEl.style.display = '';
      document.getElementById(`field-edit-input-${idx}`).classList.add('is-invalid');
      return;
    }
    if (isNumeric && isNaN(parseFloat(newVal))) {
      errorEl.textContent = 'Must be a number.';
      errorEl.style.display = '';
      document.getElementById(`field-edit-input-${idx}`).classList.add('is-invalid');
      return;
    }

    // Validate GPA range
    if (field.name === 'gpa_overall' || field.name === 'gpa_scale') {
      const num = parseFloat(newVal);
      if (isNaN(num) || num < 0 || num > 5.0) {
        errorEl.textContent = 'Must be a number between 0 and 5.0.';
        errorEl.style.display = '';
        document.getElementById(`field-edit-input-${idx}`).classList.add('is-invalid');
        return;
      }
    }

    // Call API
    const result = await updateExtractionField(documentId, field.name, newVal, true);

    if (!result.success) {
      errorEl.textContent = 'Could not save change. Please try again.';
      errorEl.style.display = '';
      return;
    }

    // Update local state
    currentFields[idx].value = newVal;
    currentFields[idx].confirmedByStudent = true;

    // Render updated cell
    valueCell.innerHTML = `
      <span class="field-value-display">${escapeHtml(newVal)}
        <span class="badge bg-success ms-1" title="You confirmed this value"><i class="bi bi-check2"></i></span>
      </span>`;

    if (onUpdate) onUpdate();
  });
}

/**
 * Open low-confidence modal (Screen 4).
 */
function openLowConfidenceModal(lowConfFields, currentFields, documentId, extractionData) {
  const existing = document.getElementById('modal-low-confidence');
  if (existing) existing.remove();

  const rowsHtml = lowConfFields.map((field, i) => {
    const val = _formatFieldValue(field.value);
    return `
      <tr>
        <td class="fw-medium text-danger">${escapeHtml(field.label)}</td>
        <td>${field.value !== null ? escapeHtml(val) : '<em class="text-muted">No value extracted</em>'}</td>
        <td><span class="text-danger fw-bold">${field.confidence}%</span></td>
        <td class="small text-muted">${escapeHtml((field.excerpt || '').slice(0, 100))}</td>
        <td>
          <div class="form-check form-check-inline">
            <input class="form-check-input" type="radio" name="lc-decision-${i}" id="lc-accept-${i}" value="accept">
            <label class="form-check-label text-success" for="lc-accept-${i}">Accept</label>
          </div>
          <div class="form-check form-check-inline">
            <input class="form-check-input" type="radio" name="lc-decision-${i}" id="lc-skip-${i}" value="skip" checked>
            <label class="form-check-label text-muted" for="lc-skip-${i}">Skip</label>
          </div>
        </td>
      </tr>`;
  }).join('');

  const modalHtml = `
    <div class="modal fade" id="modal-low-confidence" tabindex="-1" aria-labelledby="lcModalLabel" aria-modal="true">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="lcModalLabel">
              <i class="bi bi-exclamation-triangle me-2 text-warning"></i>Some fields need your attention
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <p class="text-muted small mb-3">These fields have low confidence scores. Choose to accept or skip each one before saving.</p>
            <div class="table-responsive">
              <table class="table table-sm table-bordered">
                <thead class="table-light">
                  <tr><th>Field</th><th>Value</th><th>Confidence</th><th>Excerpt</th><th>Decision</th></tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
              </table>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal" id="btn-lc-go-back">Go back and edit</button>
            <button type="button" class="btn btn-primary" id="btn-lc-continue" disabled>Continue to save</button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const modalEl = document.getElementById('modal-low-confidence');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();

  // Enable "Continue to save" only when all low-conf fields have a decision
  // (they default to "skip", so they're all pre-selected — enable immediately)
  // But we want explicit interaction: watch for any change
  function checkAllDecided() {
    let allDecided = true;
    for (let i = 0; i < lowConfFields.length; i++) {
      const accepted = document.getElementById(`lc-accept-${i}`);
      const skipped = document.getElementById(`lc-skip-${i}`);
      if (!accepted || !skipped) { allDecided = false; break; }
      // One of them must be checked (they default to skip=checked, so always decided)
    }
    document.getElementById('btn-lc-continue').disabled = !allDecided;
  }
  // Default all fields are pre-decided (skip), so enable immediately
  checkAllDecided();

  modalEl.querySelectorAll('input[type="radio"]').forEach(r => {
    r.addEventListener('change', checkAllDecided);
  });

  document.getElementById('btn-lc-continue').addEventListener('click', () => {
    // Apply decisions
    for (let i = 0; i < lowConfFields.length; i++) {
      const field = lowConfFields[i];
      const decision = document.querySelector(`input[name="lc-decision-${i}"]:checked`);
      const fieldIdx = currentFields.findIndex(f => f.name === field.name);
      if (fieldIdx === -1) continue;
      if (decision && decision.value === 'accept') {
        currentFields[fieldIdx].confirmedByStudent = true;
        currentFields[fieldIdx].skipped = false;
      } else {
        currentFields[fieldIdx].skipped = true;
        currentFields[fieldIdx].confirmedByStudent = false;
      }
    }

    modal.hide();
    doSaveToProfile(currentFields, documentId, extractionData);
  });

  modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
}

/**
 * Call POST /review and handle the result.
 */
async function doSaveToProfile(currentFields, documentId, extractionData, coursesMergeMode) {
  // If this is a transcript, check for duplicates before saving (unless merge mode already chosen)
  if (!coursesMergeMode && extractionData && extractionData.documentType === 'transcript') {
    const dupCheck = await checkDuplicateCourses(documentId);
    if (dupCheck.success && dupCheck.data && dupCheck.data.hasDuplicates) {
      // Show a merge-or-add dialog before saving
      const chosen = await _showMergeOrAddDialog(dupCheck.data);
      if (chosen === null) {
        // User cancelled
        return;
      }
      coursesMergeMode = chosen; // 'merge' or 'add_new'
    }
  }

  // Disable save buttons
  ['btn-save-to-profile', 'btn-save-to-profile-bottom'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';
    }
  });

  const payload = currentFields.map(f => ({
    name: f.name,
    value: f.value,
    confirmedByStudent: f.confirmedByStudent || false,
    skipped: f.skipped || false,
    deleted: f.deleted || false,
  }));

  const result = await reviewAndSaveExtraction(documentId, payload, coursesMergeMode ? { coursesMergeMode } : undefined);

  if (!result.success) {
    ['btn-save-to-profile', 'btn-save-to-profile-bottom'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-cloud-check me-1"></i>Save to Profile';
      }
    });

    const alertZone = document.getElementById('extraction-review-alert-zone');
    if (alertZone) {
      const msg = (result.error && result.error.message) || 'Save failed. Please try again.';
      alertZone.innerHTML = `<div class="alert alert-danger"><i class="bi bi-x-circle-fill me-2"></i>${escapeHtml(msg)}</div>`;
    }
    return;
  }

  // Success
  const { profileSection, fieldsSaved, fieldsSkipped, transformWarnings } = result.data;
  const sectionLabel = capitalize(profileSection || 'profile');

  // Show transform warnings if any
  if (transformWarnings && transformWarnings.length > 0) {
    const alertZone = document.getElementById('extraction-review-alert-zone');
    if (alertZone) {
      const warnList = transformWarnings.map(w => `<li>${escapeHtml(w)}</li>`).join('');
      alertZone.innerHTML = `<div class="alert alert-warning"><i class="bi bi-exclamation-triangle me-2"></i>${transformWarnings.length} field${transformWarnings.length !== 1 ? 's' : ''} could not be saved due to a format error — check your data and re-enter manually if needed.<ul class="mb-0 mt-1">${warnList}</ul></div>`;
    }
  }

  showToast(
    `Data saved to your ${sectionLabel} profile`,
    `${fieldsSaved} field${fieldsSaved !== 1 ? 's' : ''} saved. ${fieldsSkipped} field${fieldsSkipped !== 1 ? 's' : ''} skipped. <a href="#profile/${profileSection}" class="text-decoration-underline">View profile</a>`,
    'success'
  );

  // Redirect to dashboard after toast
  setTimeout(async () => {
    const statusResult = await getOnboardingStatus();
    const student = statusResult.success && statusResult.data && statusResult.data.student ? statusResult.data.student : {};
    showDashboard(student);
  }, 2500);
}

/**
 * Show a dialog asking the user whether to merge with existing courses or add as new.
 * Returns a Promise that resolves to 'merge', 'add_new', or null (cancelled).
 * @param {{ duplicateCount: number, totalIncoming: number, duplicates: Array }} dupData
 */
function _showMergeOrAddDialog(dupData) {
  return new Promise(resolve => {
    const existingModal = document.getElementById('modal-merge-courses');
    if (existingModal) existingModal.remove();

    const dupList = (dupData.duplicates || []).slice(0, 5).map(d =>
      `<li class="small">${escapeHtml(d.courseName)}</li>`
    ).join('');
    const moreCount = (dupData.duplicates || []).length > 5 ? `<li class="small text-muted">...and ${dupData.duplicates.length - 5} more</li>` : '';

    const modalHtml = `
      <div class="modal fade" id="modal-merge-courses" tabindex="-1" aria-labelledby="mergeCourseLabel" aria-modal="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="mergeCourseLabel"><i class="bi bi-arrow-left-right me-2"></i>Duplicate Courses Detected</h5>
            </div>
            <div class="modal-body">
              <p class="mb-2">
                <strong>${dupData.duplicateCount}</strong> course${dupData.duplicateCount !== 1 ? 's' : ''} in this document already exist in your profile:
              </p>
              <ul class="mb-3">${dupList}${moreCount}</ul>
              <p class="mb-0 text-muted small">How would you like to handle these courses?</p>
            </div>
            <div class="modal-footer flex-column align-items-stretch gap-2">
              <button type="button" class="btn btn-primary w-100" id="btn-merge-mode-merge">
                <i class="bi bi-arrow-repeat me-2"></i>Merge updates (update grade/score on existing entries)
              </button>
              <button type="button" class="btn btn-outline-secondary w-100" id="btn-merge-mode-add">
                <i class="bi bi-plus-circle me-2"></i>Add as new entries (keep both old and new)
              </button>
              <button type="button" class="btn btn-link text-muted w-100" id="btn-merge-mode-cancel">Cancel</button>
            </div>
          </div>
        </div>
      </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modalEl = document.getElementById('modal-merge-courses');
    const modal = new bootstrap.Modal(modalEl, { backdrop: 'static' });

    let resolved = false;
    const done = (val) => {
      if (!resolved) {
        resolved = true;
        modal.hide();
        resolve(val);
      }
    };

    document.getElementById('btn-merge-mode-merge').addEventListener('click', () => done('merge'));
    document.getElementById('btn-merge-mode-add').addEventListener('click', () => done('add_new'));
    document.getElementById('btn-merge-mode-cancel').addEventListener('click', () => done(null));

    modalEl.addEventListener('hidden.bs.modal', () => {
      modalEl.remove();
      if (!resolved) resolve(null);
    });

    modal.show();
  });
}

/**
 * Open manual entry modal for the extraction fallback path.
 * Saves via POST /review with confirmedByStudent:true, confidence:100, excerpt:''.
 */
function openManualEntryForExtraction(documentId, section) {
  const sectionLabels = { academic: 'Academic', tests: 'Tests', achievements: 'Achievements', activities: 'Activities' };
  const label = sectionLabels[section] || capitalize(section);
  const formHtml = buildManualEntryForm(section);

  const existingModal = document.getElementById('modal-manual-extraction');
  if (existingModal) existingModal.remove();

  const modalHtml = `
    <div class="modal fade" id="modal-manual-extraction" tabindex="-1" aria-labelledby="manualExtractionLabel" aria-modal="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="manualExtractionLabel">Enter ${escapeHtml(label)} Data Manually</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div id="modal-extraction-alert-zone"></div>
            ${formHtml}
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="btn-manual-extraction-save">Save</button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const modalEl = document.getElementById('modal-manual-extraction');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();

  document.getElementById('btn-manual-extraction-save').addEventListener('click', async () => {
    // For manual entry we directly call the profile add APIs (reuse existing logic)
    // Build a payload from the form
    const saveBtn = document.getElementById('btn-manual-extraction-save');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

    let result;
    try {
      // Delegate to existing handleManualEntrySave patterns by constructing the call inline
      // Collect form values and call the right API
      if (section === 'academic') result = await _collectAndSaveAcademic();
      else if (section === 'tests') result = await _collectAndSaveTest();
      else if (section === 'achievements') result = await _collectAndSaveAchievement();
      else if (section === 'activities') result = await _collectAndSaveActivity();
    } catch (_) {}

    saveBtn.disabled = false;
    saveBtn.innerHTML = 'Save';

    if (result && result.success) {
      modal.hide();
      showToast(`Added to ${label}`);
      const statusResult = await getOnboardingStatus();
      const student = statusResult.success && statusResult.data && statusResult.data.student ? statusResult.data.student : {};
      showDashboard(student);
    } else {
      const msg = result && result.error ? result.error.message : 'Failed to save. Please try again.';
      const alertZone = document.getElementById('modal-extraction-alert-zone');
      if (alertZone) alertZone.innerHTML = `<div class="alert alert-danger small py-2">${escapeHtml(msg)}</div>`;
    }
  });

  modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
}

async function _collectAndSaveAcademic() {
  const gpaEl = document.getElementById('me-gpa');
  const gpaScaleEl = document.getElementById('me-gpa-scale');
  const gradYearEl = document.getElementById('me-grad-year');
  const schoolEl = document.getElementById('me-school');
  if (!gpaEl || !gpaEl.value.trim()) return { success: false, error: { message: 'GPA is required.' } };
  return addAcademic({
    gpa: gpaEl.value.trim(),
    gpaScale: gpaScaleEl && gpaScaleEl.value.trim() || undefined,
    graduationYear: gradYearEl && gradYearEl.value.trim() || undefined,
    school: schoolEl && schoolEl.value.trim() || undefined,
  });
}

async function _collectAndSaveTest() {
  const typeEl = document.getElementById('me-test-type');
  const nameEl = document.getElementById('me-test-name');
  const scoreEl = document.getElementById('me-score');
  const dateEl = document.getElementById('me-test-date');
  if (!typeEl || !typeEl.value || !nameEl || !nameEl.value.trim() || !scoreEl || !scoreEl.value.trim()) {
    return { success: false, error: { message: 'Test type, name and score are required.' } };
  }
  return addTest({
    testType: typeEl.value,
    testName: nameEl.value.trim(),
    score: scoreEl.value.trim(),
    testDate: dateEl && dateEl.value.trim() || undefined,
  });
}

async function _collectAndSaveAchievement() {
  const titleEl = document.getElementById('me-title');
  const orgEl = document.getElementById('me-org');
  const dateEl = document.getElementById('me-date-awarded');
  const catEl = document.getElementById('me-category');
  if (!titleEl || !titleEl.value.trim()) return { success: false, error: { message: 'Title is required.' } };
  return addAchievement({
    title: titleEl.value.trim(),
    organization: orgEl && orgEl.value.trim() || undefined,
    dateAwarded: dateEl && dateEl.value.trim() || undefined,
    category: catEl && catEl.value || undefined,
  });
}

async function _collectAndSaveActivity() {
  const nameEl = document.getElementById('me-activity-name');
  const roleEl = document.getElementById('me-role');
  const orgEl = document.getElementById('me-org');
  const hoursEl = document.getElementById('me-hours');
  if (!nameEl || !nameEl.value.trim()) return { success: false, error: { message: 'Activity name is required.' } };
  return addActivity({
    activityName: nameEl.value.trim(),
    role: roleEl && roleEl.value.trim() || undefined,
    organization: orgEl && orgEl.value.trim() || undefined,
    hoursPerWeek: hoursEl && hoursEl.value.trim() || undefined,
  });
}

// ─── Recovery banner on dashboard ────────────────────────────────────────────

/**
 * Check for pending extractions on confirmed documents and show a recovery banner.
 * Called from showDashboard.
 * @param {Array} confirmedDocs - confirmed document records
 */
async function checkPendingExtractions(confirmedDocs) {
  if (!Array.isArray(confirmedDocs) || confirmedDocs.length === 0) return;

  for (const doc of confirmedDocs) {
    const preview = await getExtractionPreview(doc.documentId);
    if (preview.success && preview.data && preview.data.fields) {
      showExtractionRecoveryBanner(doc, preview.data);
      return; // Show banner for the first pending one
    }
  }
}

function showExtractionRecoveryBanner(doc, extractionData) {
  const sectionsGrid = document.getElementById('sections-grid');
  if (!sectionsGrid) return;

  const existing = document.getElementById('ao-extraction-recovery-banner');
  if (existing) existing.remove();

  const filename = extractionData.documentFilename || doc.originalName || 'your document';

  const banner = document.createElement('div');
  banner.id = 'ao-extraction-recovery-banner';
  banner.className = 'alert alert-info d-flex align-items-center gap-2 mb-3';
  banner.setAttribute('role', 'alert');
  banner.innerHTML = `
    <i class="bi bi-clock-history"></i>
    <span>You have an unfinished review for <strong>${escapeHtml(filename)}</strong>. Continue?</span>
    <button type="button" class="btn btn-sm btn-outline-info ms-2" id="btn-continue-extraction">Continue</button>
    <button type="button" class="btn-close ms-auto" id="btn-dismiss-extraction-recovery" aria-label="Dismiss"></button>
  `;
  sectionsGrid.parentElement.insertBefore(banner, sectionsGrid);

  document.getElementById('btn-continue-extraction').addEventListener('click', () => {
    banner.remove();
    showExtractionReview(doc.documentId, extractionData, false);
  });
  document.getElementById('btn-dismiss-extraction-recovery').addEventListener('click', () => banner.remove());
}

// ─── Impact Statements UI ─────────────────────────────────────────────────────

/**
 * Screen 2 — Achievement picker modal.
 * Lists achievements/activities that don't yet have a statement.
 */
async function openImpactPickerModal() {
  // Remove any stale modal
  const stale = document.getElementById('modal-impact-picker');
  if (stale) stale.remove();

  // Create modal with loading state
  const modalHtml = `
    <div class="modal fade" id="modal-impact-picker" tabindex="-1" aria-labelledby="impactPickerLabel" aria-modal="true">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="impactPickerLabel">Choose an achievement to write about</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <p class="text-muted small mb-3">Select one achievement or activity. We'll generate a draft — you rewrite it in your own words.</p>
            <div id="impact-picker-body">
              <div class="text-center py-3">
                <div class="spinner-border text-primary spinner-border-sm"></div>
                <span class="ms-2 text-muted small">Loading...</span>
              </div>
            </div>
          </div>
          <div class="modal-footer" id="impact-picker-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="btn-generate-draft" disabled>
              <i class="bi bi-stars me-1"></i>Start Questionnaire
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  const modalEl = document.getElementById('modal-impact-picker');
  const bsModal = new bootstrap.Modal(modalEl);
  bsModal.show();

  let selectedAchievementId = null;
  let selectedAchievementData = null;

  // Load available achievements
  const result = await getAvailableForImpact();

  const body = document.getElementById('impact-picker-body');
  if (!body) return; // modal was closed

  if (!result.success) {
    body.innerHTML = `
      <div class="alert alert-danger">
        <i class="bi bi-exclamation-triangle me-2"></i>
        Could not load achievements. Check your data directory is accessible.
        <button class="btn btn-sm btn-outline-danger ms-2" id="btn-retry-impact-load">Retry</button>
      </div>`;
    document.getElementById('btn-retry-impact-load').addEventListener('click', () => {
      bsModal.hide();
      setTimeout(openImpactPickerModal, 300);
    });
    return;
  }

  const available = result.data.available || [];

  if (available.length === 0) {
    body.innerHTML = `
      <p class="text-muted text-center py-3">All achievements have impact statements.<br>You can edit existing ones from the list.</p>`;
    const footer = document.getElementById('impact-picker-footer');
    if (footer) {
      footer.innerHTML = `
        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn btn-primary" id="btn-view-all-from-picker">
          <i class="bi bi-list me-1"></i>View All Statements
        </button>`;
      document.getElementById('btn-view-all-from-picker').addEventListener('click', () => {
        bsModal.hide();
        setTimeout(showImpactStatementsList, 300);
      });
    }
    return;
  }

  // Render achievement radio list
  const rowsHtml = available.map(a => {
    const desc = (a.description || '').slice(0, 80);
    return `
      <div class="form-check border rounded p-3 mb-2" style="cursor:pointer;" id="picker-row-${escapeHtml(a.id)}">
        <input class="form-check-input" type="radio" name="impact-achievement" id="radio-${escapeHtml(a.id)}" value="${escapeHtml(a.id)}">
        <label class="form-check-label w-100" for="radio-${escapeHtml(a.id)}" style="cursor:pointer;">
          <span class="fw-semibold">${escapeHtml(a.name)}</span>
          <span class="badge bg-secondary ms-2 small">${escapeHtml(a.category)}</span>
          ${desc ? `<br><span class="text-muted small">${escapeHtml(desc)}${a.description && a.description.length > 80 ? '…' : ''}</span>` : ''}
        </label>
      </div>`;
  }).join('');

  body.innerHTML = rowsHtml;

  // Wire radio selection
  body.querySelectorAll('input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', () => {
      selectedAchievementId = radio.value;
      selectedAchievementData = available.find(a => a.id === selectedAchievementId);
      document.getElementById('btn-generate-draft').disabled = false;
      // Highlight selected row
      body.querySelectorAll('.form-check').forEach(r => r.classList.remove('border-primary', 'bg-light'));
      const row = document.getElementById(`picker-row-${selectedAchievementId}`);
      if (row) { row.classList.add('border-primary', 'bg-light'); }
    });
  });

  // Wire Generate Draft button — STORY-003a: opens questionnaire modal first
  document.getElementById('btn-generate-draft').addEventListener('click', () => {
    if (!selectedAchievementId || !selectedAchievementData) return;
    bsModal.hide();
    // Reset answer sheet for this new achievement
    currentAnswerSheet = {
      achievementId: selectedAchievementId,
      role: '', challenge: '', growth: '', importance: '', impact: '',
    };
    reasoningPreviewCache = null;
    setTimeout(() => openQuestionnaireModal(selectedAchievementData), 300);
  });

  modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
}

// ─── STORY-003a: Questionnaire Modal (Screen 1) ───────────────────────────────

/**
 * Open the questionnaire modal for personalising the impact statement.
 * Called after the student selects an achievement in the picker modal.
 * @param {object} achievement - normalized achievement object
 */
function openQuestionnaireModal(achievement) {
  const existing = document.getElementById('questionnaireModal');
  if (existing) existing.remove();

  const durationParts = [];
  if (achievement.yearsInvolved) durationParts.push(`${achievement.yearsInvolved} year${achievement.yearsInvolved !== 1 ? 's' : ''}`);
  if (achievement.hoursPerWeek != null) durationParts.push(`${achievement.hoursPerWeek} hrs/week`);
  const durationStr = durationParts.join(' · ');

  const modalHtml = `
    <div class="modal fade" id="questionnaireModal" tabindex="-1" aria-labelledby="questionnaireModalLabel" aria-modal="true">
      <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="questionnaireModalLabel">Tell us about this experience</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <!-- Progress bar — Step 1 of 4 at 25% -->
            <div class="mb-3">
              <div class="progress ao-progress mb-1">
                <div class="progress-bar bg-primary" role="progressbar" style="width:25%" aria-valuenow="25" aria-valuemin="0" aria-valuemax="100"></div>
              </div>
              <small class="text-muted">Step 1 of 4 — Tell us about this experience</small>
            </div>
            <!-- Read-only context bar -->
            <div class="alert alert-light border mb-3 py-2 px-3">
              <strong>${escapeHtml(achievement.name)}</strong>
              <span class="badge bg-secondary ms-2 small">${escapeHtml(achievement.category)}</span>
              ${durationStr ? `<span class="text-muted small ms-2">${escapeHtml(durationStr)}</span>` : ''}
            </div>
            <!-- STORY-007: Limits banner placeholder — filled asynchronously after modal shown -->
            <div id="questionnaire-limits-banner-container"></div>

            <p class="text-muted small mb-3">These questions are optional. The more you share, the more personal your statement will be.</p>

            <div id="questionnaire-preview-alert"></div>

            <form id="questionnaire-form" novalidate>
              ${_buildQuestionnaireField('q-role', 'What was your role or biggest contribution?', 'e.g., I led the mechanical design team and made final calls on build decisions...', 'role')}
              ${_buildQuestionnaireField('q-challenge', 'What challenge did you face, and how did you overcome it?', 'e.g., Our robot kept failing under load — I spent 3 nights debugging the drivetrain...', 'challenge')}
              ${_buildQuestionnaireField('q-growth', 'What did you learn or how did you grow?', 'e.g., I discovered I work best when there\'s real pressure and clear stakes...', 'growth')}
              ${_buildQuestionnaireField('q-importance', 'Why was this important to you personally?', 'e.g., Robotics was the first place I felt like I genuinely belonged...', 'importance')}
              ${_buildQuestionnaireField('q-impact', 'What impact did it have — on you, your team, or others?', 'e.g., We placed 3rd regionally and I realised I could lead under pressure...', 'impact')}
            </form>
          </div>
          <div class="modal-footer d-flex align-items-center">
            <button type="button" class="btn btn-secondary me-auto" id="btn-preview-reasoning">
              Preview AI Reasoning
            </button>
            <button type="button" class="btn btn-outline-secondary" id="btn-skip-generate">
              Skip — Generate Now
            </button>
            <button type="button" class="btn btn-primary" id="btn-continue-to-preview">
              Continue to Preview
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  const modalEl = document.getElementById('questionnaireModal');
  const bsModal = new bootstrap.Modal(modalEl);
  bsModal.show();

  // STORY-007: Inject limits banner into modal (async, non-blocking)
  if (typeof renderLimitsBanner === 'function') {
    renderLimitsBanner('questionnaire-limits-banner-container', 'impact');
  }

  // Restore any previously saved answers (e.g. returning from offcanvas)
  _restoreQuestionnaireFields();

  // Live sync answers to currentAnswerSheet + character counters
  _bindQuestionnaireLiveSync();

  // Close via × / ESC / backdrop → reset and return to picker
  modalEl.addEventListener('hidden.bs.modal', () => {
    // Only reset if not being closed programmatically by one of the buttons
    if (!modalEl._suppressReset) {
      currentAnswerSheet = { achievementId: '', role: '', challenge: '', growth: '', importance: '', impact: '' };
      reasoningPreviewCache = null;
    }
    modalEl.remove();
  });

  // [Preview AI Reasoning] — optional mid-form peek
  document.getElementById('btn-preview-reasoning').addEventListener('click', () => {
    _syncCurrentAnswers();
    _triggerReasoningPreview(achievement, bsModal, modalEl, false);
  });

  // [Continue to Preview] — commits to preview before generating
  document.getElementById('btn-continue-to-preview').addEventListener('click', () => {
    _syncCurrentAnswers();
    _triggerReasoningPreview(achievement, bsModal, modalEl, false);
  });

  // [Skip — Generate Now]
  document.getElementById('btn-skip-generate').addEventListener('click', () => {
    _syncCurrentAnswers();
    modalEl._suppressReset = true;
    bsModal.hide();
    setTimeout(() => showImpactGenerator(achievement, currentAnswerSheet), 300);
  });
}

function _buildQuestionnaireField(id, label, placeholder, answerKey) {
  return `
    <div class="mb-3">
      <label for="${id}" class="form-label small fw-semibold">${escapeHtml(label)}</label>
      <textarea
        id="${id}"
        class="form-control"
        rows="3"
        maxlength="500"
        placeholder="${escapeHtml(placeholder)}"
        data-answer-key="${answerKey}"
        style="resize:vertical;"
      ></textarea>
      <div class="ao-char-counter mt-1" id="${id}-counter">0 / 500</div>
    </div>
  `;
}

function _restoreQuestionnaireFields() {
  const fields = { 'q-role': 'role', 'q-challenge': 'challenge', 'q-growth': 'growth', 'q-importance': 'importance', 'q-impact': 'impact' };
  Object.entries(fields).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el && currentAnswerSheet[key]) {
      el.value = currentAnswerSheet[key];
      _updateCharCounter(id, currentAnswerSheet[key].length);
    }
  });
}

function _updateCharCounter(fieldId, len) {
  const counter = document.getElementById(`${fieldId}-counter`);
  if (!counter) return;
  counter.textContent = `${len} / 500`;
  counter.className = 'ao-char-counter mt-1';
  if (len >= 500) counter.classList.add('danger');
  else if (len >= 450) counter.classList.add('warn');
}

function _bindQuestionnaireLiveSync() {
  document.querySelectorAll('#questionnaire-form textarea').forEach(ta => {
    ta.addEventListener('input', () => {
      const key = ta.dataset.answerKey;
      if (key) currentAnswerSheet[key] = ta.value;
      _updateCharCounter(ta.id, ta.value.length);
    });
  });
}

function _syncCurrentAnswers() {
  const fields = { 'q-role': 'role', 'q-challenge': 'challenge', 'q-growth': 'growth', 'q-importance': 'importance', 'q-impact': 'impact' };
  Object.entries(fields).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) currentAnswerSheet[key] = el.value;
  });
}

/**
 * Trigger the preview-reasoning API call and open the offcanvas.
 * Used by both [Preview AI Reasoning] and [Continue to Preview].
 */
async function _triggerReasoningPreview(achievement, bsModal, modalEl, fromModal) {
  const previewBtn = document.getElementById('btn-preview-reasoning');
  const continueBtn = document.getElementById('btn-continue-to-preview');

  // Check cache first (5-minute TTL, same achievementId)
  const now = Date.now();
  const answers = { role: currentAnswerSheet.role, challenge: currentAnswerSheet.challenge, growth: currentAnswerSheet.growth, importance: currentAnswerSheet.importance, impact: currentAnswerSheet.impact };
  let useCache = false;
  if (reasoningPreviewCache && reasoningPreviewCache.achievementId === achievement.id) {
    const age = now - Date.parse(reasoningPreviewCache.fetchedAt);
    if (age < 300000) useCache = true;
  }

  // Open offcanvas immediately (will show spinner until data arrives)
  modalEl._suppressReset = true;
  bsModal.hide();
  setTimeout(() => openReasoningOffcanvas(achievement, useCache ? reasoningPreviewCache.data : null, !useCache ? answers : null), 300);
}

// ─── STORY-003a: Reasoning Preview Offcanvas (Screen 2) ──────────────────────

/**
 * Open the reasoning preview off-canvas panel.
 * If preloadedData is provided, display it immediately.
 * If studentAnswers is provided, make the API call.
 * @param {object} achievement
 * @param {object|null} preloadedData - pre-fetched reasoning data
 * @param {object|null} studentAnswers - answers to send if API call needed
 */
async function openReasoningOffcanvas(achievement, preloadedData, studentAnswers) {
  const existing = document.getElementById('reasoningOffcanvas');
  if (existing) existing.remove();

  const offcanvasHtml = `
    <div class="offcanvas offcanvas-end" tabindex="-1" id="reasoningOffcanvas" aria-labelledby="reasoningOffcanvasLabel" style="width:400px;">
      <div class="offcanvas-header border-bottom">
        <div class="w-100">
          <div class="progress ao-progress mb-1" style="height:4px;">
            <div class="progress-bar bg-primary" role="progressbar" style="width:50%" aria-valuenow="50" aria-valuemin="0" aria-valuemax="100"></div>
          </div>
          <small class="text-muted d-block mb-1">Step 2 of 4 — Review what I'll focus on</small>
          <h5 class="offcanvas-title mb-0" id="reasoningOffcanvasLabel">Here's what I'll focus on</h5>
          <small class="text-muted">Based on your answers and profile data</small>
        </div>
        <button type="button" class="btn-close ms-2" data-bs-dismiss="offcanvas" aria-label="Close"></button>
      </div>
      <div class="offcanvas-body" id="reasoning-offcanvas-body">
        <div class="text-center py-4" id="reasoning-spinner">
          <div class="spinner-border text-primary spinner-border-sm mb-2" role="status"></div>
          <p class="text-muted small mb-0">Fetching reasoning preview…</p>
        </div>
        <div id="reasoning-content" class="d-none"></div>
        <div id="reasoning-error" class="d-none"></div>
      </div>
      <div class="offcanvas-footer border-top p-3 d-flex gap-2">
        <button class="btn btn-secondary" id="btn-edit-answers">
          <i class="bi bi-arrow-left me-1"></i>Edit Answers
        </button>
        <button class="btn btn-primary ms-auto" id="btn-generate-draft-from-reasoning">
          <i class="bi bi-stars me-1"></i>Generate Draft
        </button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', offcanvasHtml);

  const offcanvasEl = document.getElementById('reasoningOffcanvas');
  const bsOffcanvas = new bootstrap.Offcanvas(offcanvasEl);
  bsOffcanvas.show();

  // [Edit Answers] — go back to questionnaire modal
  document.getElementById('btn-edit-answers').addEventListener('click', () => {
    offcanvasEl._suppressQReturn = false;
    bsOffcanvas.hide();
    setTimeout(() => {
      const q = document.getElementById('questionnaireModal');
      if (q) { new bootstrap.Modal(q).show(); }
      else { openQuestionnaireModal(achievement); }
    }, 350);
  });

  // [Generate Draft] — proceed to generation
  document.getElementById('btn-generate-draft-from-reasoning').addEventListener('click', () => {
    offcanvasEl._suppressQReturn = true;
    bsOffcanvas.hide();
    setTimeout(() => showImpactGenerator(achievement, currentAnswerSheet), 300);
  });

  // ESC / × close → re-open questionnaire modal
  offcanvasEl.addEventListener('hidden.bs.offcanvas', () => {
    offcanvasEl.remove();
    if (!offcanvasEl._suppressQReturn) {
      setTimeout(() => {
        const q = document.getElementById('questionnaireModal');
        if (q) { new bootstrap.Modal(q).show(); }
        else { openQuestionnaireModal(achievement); }
      }, 350);
    }
  });

  // Now fetch or display data
  if (preloadedData) {
    _renderReasoningContent(preloadedData);
  } else {
    // Start a 2-second timer to show "taking longer than expected"
    let slowTimer = setTimeout(() => {
      const spinnerEl = document.getElementById('reasoning-spinner');
      if (spinnerEl) {
        spinnerEl.insertAdjacentHTML('beforeend', '<p class="text-warning small mt-2 mb-0">Preview is taking longer than expected…</p>');
      }
    }, 2000);

    try {
      const result = await previewImpactReasoning(achievement.id, studentAnswers);
      clearTimeout(slowTimer);

      if (result.success && result.data) {
        reasoningPreviewCache = {
          achievementId: achievement.id,
          fetchedAt: new Date().toISOString(),
          data: result.data,
        };
        _renderReasoningContent(result.data);
      } else {
        _renderReasoningError(achievement);
      }
    } catch (e) {
      clearTimeout(slowTimer);
      _renderReasoningError(achievement);
    }
  }
}

function _renderReasoningContent(data) {
  const spinnerEl = document.getElementById('reasoning-spinner');
  const contentEl = document.getElementById('reasoning-content');
  if (spinnerEl) spinnerEl.classList.add('d-none');
  if (!contentEl) return;

  const profileDataUsed = data.profileDataUsed || [];
  const answersReceived = data.answersReceived || {};
  const focusAreas = data.focusAreas || [];
  const unansweredCount = data.unansweredCount != null ? data.unansweredCount : 5;

  const profileListHtml = profileDataUsed.length > 0
    ? profileDataUsed.map(item => `<li>${escapeHtml(typeof item === 'string' ? item : `${item.label}: ${item.value}`)}</li>`).join('')
    : '<li class="text-muted fst-italic">No profile data found for this achievement.</li>';

  const answerLabels = [
    ['role', 'Role / contribution'],
    ['challenge', 'Challenge faced'],
    ['growth', 'What you learned'],
    ['importance', 'Why it mattered'],
    ['impact', 'Impact'],
  ];
  const answersHtml = answerLabels.map(([key, label]) => {
    const val = answersReceived[key] || '';
    const display = val
      ? escapeHtml(val)
      : '<span class="text-muted fst-italic">(not answered)</span>';
    return `<div class="mb-2"><span class="fw-semibold small">${escapeHtml(label)}:</span><br>${display}</div>`;
  }).join('');

  let focusHtml;
  if (unansweredCount === 5) {
    focusHtml = `<div class="alert alert-info small mb-0">You haven't answered any questions yet. The AI will base the statement entirely on your profile data. Consider going back and adding at least one answer for a more personal result.</div>`;
  } else if (focusAreas.length > 0) {
    focusHtml = `<ul class="list-unstyled mb-0">${focusAreas.map(f => `<li><i class="bi bi-arrow-right me-1 text-primary"></i>${escapeHtml(f)}</li>`).join('')}</ul>`;
  } else {
    focusHtml = '<p class="text-muted small mb-0">No specific focus areas identified.</p>';
  }

  contentEl.innerHTML = `
    <div class="ao-reasoning-section mb-3">
      <h6 class="text-secondary mb-2">Profile data</h6>
      <ul class="list-unstyled mb-0">${profileListHtml}</ul>
    </div>
    <div class="ao-reasoning-section mb-3">
      <h6 class="text-secondary mb-2">Your answers</h6>
      ${answersHtml}
    </div>
    <div class="ao-reasoning-section">
      <h6 class="text-secondary mb-2">I'll emphasise</h6>
      ${focusHtml}
    </div>
  `;
  contentEl.classList.remove('d-none');
}

function _renderReasoningError(achievement) {
  const spinnerEl = document.getElementById('reasoning-spinner');
  const errorEl = document.getElementById('reasoning-error');
  if (spinnerEl) spinnerEl.classList.add('d-none');
  if (!errorEl) return;
  errorEl.innerHTML = `
    <div class="text-center py-3">
      <i class="bi bi-exclamation-triangle text-warning fs-3 d-block mb-2"></i>
      <p class="text-muted small mb-3">Could not load the reasoning preview.</p>
      <div class="d-flex gap-2 justify-content-center">
        <button class="btn btn-sm btn-outline-primary" id="btn-retry-reasoning">Retry</button>
        <button class="btn btn-sm btn-outline-secondary" id="btn-continue-anyway">Continue Anyway</button>
      </div>
    </div>
  `;
  errorEl.classList.remove('d-none');

  document.getElementById('btn-retry-reasoning').addEventListener('click', async () => {
    errorEl.classList.add('d-none');
    if (spinnerEl) spinnerEl.classList.remove('d-none');
    const result = await previewImpactReasoning(achievement.id, currentAnswerSheet);
    if (result.success && result.data) {
      reasoningPreviewCache = { achievementId: achievement.id, fetchedAt: new Date().toISOString(), data: result.data };
      _renderReasoningContent(result.data);
    } else {
      _renderReasoningError(achievement);
    }
  });

  document.getElementById('btn-continue-anyway').addEventListener('click', () => {
    const offcanvasEl = document.getElementById('reasoningOffcanvas');
    if (offcanvasEl) {
      offcanvasEl._suppressQReturn = true;
      const bsOC = bootstrap.Offcanvas.getInstance(offcanvasEl);
      if (bsOC) bsOC.hide();
    }
    setTimeout(() => showImpactGenerator(achievement, currentAnswerSheet), 300);
  });
}

// ─── STORY-003a: Essay Provenance Modal (Screen 3) ───────────────────────────

/**
 * Open the essay data provenance modal before calling POST /api/essays/generate.
 * Fetches GET /api/essays/provenance and renders section blocks.
 */
async function openEssayProvenanceModal() {
  const existing = document.getElementById('essayProvenanceModal');
  if (existing) existing.remove();

  const modalHtml = `
    <div class="modal fade" id="essayProvenanceModal" tabindex="-1" aria-labelledby="essayProvenanceModalLabel" aria-modal="true">
      <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="essayProvenanceModalLabel">Data we'll use for your essay</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body" id="essay-provenance-body">
            <div class="text-center py-4" id="provenance-spinner">
              <div class="spinner-border text-primary spinner-border-sm mb-2" role="status"></div>
              <p class="text-muted small mb-0">Loading data sources…</p>
            </div>
            <div id="provenance-content" class="d-none"></div>
            <div id="provenance-error" class="d-none"></div>
          </div>
          <div class="modal-footer d-flex align-items-center">
            <span class="text-muted small me-auto" id="provenance-count-label"></span>
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="btn-generate-essay-provenance" disabled
              data-bs-toggle="tooltip" data-bs-placement="top" title="Select at least one data item to generate">
              <i class="bi bi-stars me-1"></i>Generate Essay
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  const modalEl = document.getElementById('essayProvenanceModal');
  const bsModal = new bootstrap.Modal(modalEl);
  bsModal.show();

  // Initialize tooltip on generate button
  const genBtn = document.getElementById('btn-generate-essay-provenance');
  let genBtnTooltip = new bootstrap.Tooltip(genBtn);

  // [Generate Essay] click
  genBtn.addEventListener('click', () => {
    _buildProvenanceSelection();
    modalEl._proceedToGenerate = true;
    bsModal.hide();
  });

  // On modal hidden
  modalEl.addEventListener('hidden.bs.modal', () => {
    modalEl.remove();
    if (modalEl._proceedToGenerate) {
      _runEssayGenerationWithProvenance();
    }
  });

  // Fetch provenance data
  await _fetchAndRenderProvenance(bsModal, modalEl);
}

async function _fetchAndRenderProvenance(bsModal, modalEl) {
  const result = await getEssayProvenance();
  const spinnerEl = document.getElementById('provenance-spinner');
  const contentEl = document.getElementById('provenance-content');
  const errorEl = document.getElementById('provenance-error');

  if (spinnerEl) spinnerEl.classList.add('d-none');

  if (!result.success) {
    // Full failure
    if (errorEl) {
      errorEl.innerHTML = `
        <div class="text-center py-3">
          <i class="bi bi-exclamation-triangle text-warning fs-3 d-block mb-2"></i>
          <p class="text-muted small mb-3">Could not load data summary.</p>
          <div class="d-flex gap-2 justify-content-center">
            <button class="btn btn-sm btn-outline-primary" id="btn-retry-provenance">Retry</button>
            <button class="btn btn-sm btn-outline-secondary" id="btn-generate-all-data">Generate with all data</button>
          </div>
        </div>`;
      errorEl.classList.remove('d-none');

      document.getElementById('btn-retry-provenance').addEventListener('click', async () => {
        errorEl.classList.add('d-none');
        if (spinnerEl) spinnerEl.classList.remove('d-none');
        await _fetchAndRenderProvenance(bsModal, modalEl);
      });

      document.getElementById('btn-generate-all-data').addEventListener('click', () => {
        provenanceSelection = null;
        modalEl._proceedToGenerate = true;
        bsModal.hide();
      });
    }
    return;
  }

  const data = result.data || {};
  const warnings = result.warnings || [];

  // Check if all sections are empty
  const hasData = data.gpa || (data.testScores && data.testScores.length > 0) ||
    (data.achievements && data.achievements.length > 0) ||
    (data.impactStatements && data.impactStatements.length > 0);

  if (contentEl) {
    if (!hasData) {
      contentEl.innerHTML = `
        <div class="alert alert-info">
          Your profile has no data yet. Add documents in the Documents section before generating an essay.
        </div>`;
      contentEl.classList.remove('d-none');
      // Hide generate button, show only close
      const genBtn = document.getElementById('btn-generate-essay-provenance');
      if (genBtn) genBtn.classList.add('d-none');
      return;
    }

    // Warnings banner
    const warningBanner = warnings.length > 0
      ? `<div class="alert alert-warning small mb-3">Some data sections could not be loaded: ${escapeHtml(warnings.join(' '))} Generation will proceed with available data.</div>`
      : '';

    // Master toggle
    const masterToggle = `
      <div class="form-check form-switch mb-3">
        <input class="form-check-input" type="checkbox" id="provenance-master-toggle" checked>
        <label class="form-check-label fw-semibold" for="provenance-master-toggle">Include all data</label>
      </div>`;

    // Build section cards
    let sectionsHtml = '';

    // GPA
    if (data.gpa) {
      const g = data.gpa;
      const conf = g.confidence != null ? g.confidence : null;
      const confBadge = conf != null ? _confidenceBadge(conf) : '';
      const srcBadge = `<span class="badge bg-light text-dark border">${escapeHtml(g.source || 'unknown')}</span>`;
      const isChecked = conf == null || conf >= 70;
      const tooltip = !isChecked ? 'data-bs-toggle="tooltip" title="Low confidence — verify before including."' : '';
      sectionsHtml += `
        <div class="card mb-3">
          <div class="card-header fw-semibold"><i class="bi bi-mortarboard me-1"></i>GPA</div>
          <div class="card-body py-2">
            <div class="ao-provenance-row">
              <div class="ao-prov-label">${escapeHtml(g.value)}</div>
              <div class="ao-prov-badges">${confBadge}${srcBadge}</div>
              <div class="ao-prov-toggle form-check form-switch mb-0" ${tooltip}>
                <input class="form-check-input provenance-toggle" type="checkbox" data-type="gpa" ${isChecked ? 'checked' : ''}>
              </div>
            </div>
          </div>
        </div>`;
    }

    // Test scores
    if (data.testScores && data.testScores.length > 0) {
      const rows = data.testScores.map(t => {
        const conf = t.confidence != null ? t.confidence : null;
        const confBadge = conf != null ? _confidenceBadge(conf) : '';
        const srcBadge = `<span class="badge bg-light text-dark border">${escapeHtml(t.source || 'unknown')}</span>`;
        const isChecked = conf == null || conf >= 70;
        const tooltip = !isChecked ? 'data-bs-toggle="tooltip" title="Low confidence — verify before including."' : '';
        return `
          <div class="ao-provenance-row">
            <div class="ao-prov-label">${escapeHtml(t.name)}: <strong>${escapeHtml(t.score)}</strong></div>
            <div class="ao-prov-badges">${confBadge}${srcBadge}</div>
            <div class="ao-prov-toggle form-check form-switch mb-0" ${tooltip}>
              <input class="form-check-input provenance-toggle" type="checkbox" data-type="test" data-id="${escapeHtml(t.id)}" ${isChecked ? 'checked' : ''}>
            </div>
          </div>`;
      }).join('');
      sectionsHtml += `
        <div class="card mb-3">
          <div class="card-header fw-semibold"><i class="bi bi-clipboard-data me-1"></i>Test scores</div>
          <div class="card-body py-2">${rows}</div>
        </div>`;
    }

    // Courses (display-only, always included)
    if (data.courses && data.courses.length > 0) {
      const coursesList = data.courses.slice(0, 10).map(c => escapeHtml(c)).join('<br>');
      sectionsHtml += `
        <div class="card mb-3">
          <div class="card-header fw-semibold"><i class="bi bi-book me-1"></i>Courses (included)</div>
          <div class="card-body py-2" style="font-size: 0.9rem;">
            <div class="text-muted small mb-2">Courses are automatically included in essay generation.</div>
            ${coursesList}
          </div>
        </div>`;
    }

    // AP/IB Exam Scores (display-only, always included)
    if (data.apIbScores && data.apIbScores.length > 0) {
      const rows = data.apIbScores.map(a => {
        const srcBadge = `<span class="badge bg-light text-dark border">${escapeHtml(a.source || 'unknown')}</span>`;
        return `
          <div class="ao-provenance-row">
            <div class="ao-prov-label">${escapeHtml(a.name)}: <strong>${escapeHtml(a.score)}</strong></div>
            <div class="ao-prov-badges">${srcBadge}</div>
          </div>`;
      }).join('');
      sectionsHtml += `
        <div class="card mb-3">
          <div class="card-header fw-semibold"><i class="bi bi-star me-1"></i>AP/IB Exam Scores (included)</div>
          <div class="card-body py-2">${rows}</div>
        </div>`;
    }

    // Achievements & activities
    if (data.achievements && data.achievements.length > 0) {
      const rows = data.achievements.map(a => {
        const catBadge = `<span class="badge bg-secondary">${escapeHtml(a.category || 'Other')}</span>`;
        const conf = a.confidence;
        const confBadge = conf != null ? _confidenceBadge(conf) : `<span class="badge bg-secondary">Manually added</span>`;
        const srcBadge = `<span class="badge bg-light text-dark border">${escapeHtml(a.source || 'Manually added')}</span>`;
        return `
          <div class="ao-provenance-row">
            <div class="ao-prov-label">${escapeHtml(a.name)} ${catBadge}</div>
            <div class="ao-prov-badges">${confBadge}${srcBadge}</div>
            <div class="ao-prov-toggle form-check form-switch mb-0">
              <input class="form-check-input provenance-toggle" type="checkbox" data-type="achievement" data-id="${escapeHtml(a.id)}" checked>
            </div>
          </div>`;
      }).join('');
      sectionsHtml += `
        <div class="card mb-3">
          <div class="card-header fw-semibold"><i class="bi bi-trophy me-1"></i>Achievements &amp; activities</div>
          <div class="card-body py-2">${rows}</div>
        </div>`;
    }

    // Impact statements
    if (data.impactStatements && data.impactStatements.length > 0) {
      const rows = data.impactStatements.map(s => {
        const aiBadge = s.aiGenerated
          ? `<span class="badge bg-info text-dark">AI-generated</span>`
          : `<span class="badge bg-secondary">Written manually</span>`;
        const previewText = s.preview.length > 80 ? s.preview.slice(0, 80) + '...' : s.preview;
        const achName = s.linkedAchievementName.length > 60 ? s.linkedAchievementName.slice(0, 60) : s.linkedAchievementName;
        return `
          <div class="ao-provenance-row">
            <div class="ao-prov-label">
              <strong>${escapeHtml(achName)}</strong><br>
              <span class="text-muted small">"${escapeHtml(previewText)}"</span>
            </div>
            <div class="ao-prov-badges">${aiBadge}</div>
            <div class="ao-prov-toggle form-check form-switch mb-0">
              <input class="form-check-input provenance-toggle" type="checkbox" data-type="impact" data-id="${escapeHtml(s.id)}" checked>
            </div>
          </div>`;
      }).join('');
      sectionsHtml += `
        <div class="card mb-3">
          <div class="card-header fw-semibold"><i class="bi bi-lightning me-1"></i>Impact statements</div>
          <div class="card-body py-2">${rows}</div>
        </div>`;
    }

    contentEl.innerHTML = warningBanner + masterToggle + sectionsHtml;
    contentEl.classList.remove('d-none');

    // Init tooltips on low-confidence items
    contentEl.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => new bootstrap.Tooltip(el));

    // Wire master toggle
    const masterEl = document.getElementById('provenance-master-toggle');
    masterEl.addEventListener('change', () => {
      const toggles = contentEl.querySelectorAll('.provenance-toggle');
      toggles.forEach(t => { t.checked = masterEl.checked; });
      _updateProvenanceCount();
    });

    // Wire individual toggles
    contentEl.querySelectorAll('.provenance-toggle').forEach(t => {
      t.addEventListener('change', () => {
        _updateProvenanceCount();
        _updateMasterToggleState(masterEl);
      });
    });

    _updateProvenanceCount();
  }
}

function _confidenceBadge(conf) {
  if (conf >= 85) return `<span class="badge bg-success">${conf}% confidence</span>`;
  if (conf >= 70) return `<span class="badge bg-warning text-dark">${conf}% confidence</span>`;
  return `<span class="badge bg-danger">${conf}% confidence</span>`;
}

function _updateProvenanceCount() {
  const toggles = document.querySelectorAll('#provenance-content .provenance-toggle');
  const checked = [...toggles].filter(t => t.checked).length;
  const total = toggles.length;
  const label = document.getElementById('provenance-count-label');
  if (label) label.textContent = `${checked} of ${total} data items selected`;
  const genBtn = document.getElementById('btn-generate-essay-provenance');
  if (genBtn) {
    if (checked === 0) {
      genBtn.disabled = true;
      genBtn.setAttribute('title', 'Select at least one data item to generate');
    } else {
      genBtn.disabled = false;
      genBtn.removeAttribute('data-bs-toggle');
      genBtn.removeAttribute('title');
    }
  }
}

function _updateMasterToggleState(masterEl) {
  const toggles = document.querySelectorAll('#provenance-content .provenance-toggle');
  const checked = [...toggles].filter(t => t.checked).length;
  if (checked === 0) {
    masterEl.checked = false;
    masterEl.indeterminate = false;
  } else if (checked === toggles.length) {
    masterEl.checked = true;
    masterEl.indeterminate = false;
  } else {
    masterEl.indeterminate = true;
  }
}

function _buildProvenanceSelection() {
  const toggles = document.querySelectorAll('#provenance-content .provenance-toggle');
  let includeGpa = false;
  const testScoreIds = [];
  const achievementIds = [];
  const impactStatementIds = [];

  toggles.forEach(t => {
    if (!t.checked) return;
    const type = t.dataset.type;
    const id = t.dataset.id;
    if (type === 'gpa') includeGpa = true;
    else if (type === 'test' && id) testScoreIds.push(id);
    else if (type === 'achievement' && id) achievementIds.push(id);
    else if (type === 'impact' && id) impactStatementIds.push(id);
  });

  provenanceSelection = { includeGpa, testScoreIds, achievementIds, impactStatementIds };
}

async function _runEssayGenerationWithProvenance() {
  showNavbar();
  history.pushState({}, '', '/essays/generate');
  document.title = 'Generating Personal Statement — Admissions Officer';

  let generationAborted = false;
  renderTemplate(`
    <div class="mb-3">
      <a href="#" class="btn btn-sm btn-link text-muted ps-0" id="btn-back-from-generating-prov">
        <i class="bi bi-arrow-left me-1"></i>Back to Personal Statements
      </a>
    </div>
    <div class="d-flex align-items-center mb-3">
      <h2 class="h5 fw-semibold mb-0">
        <i class="bi bi-journal-text me-2"></i>Personal Statements
      </h2>
    </div>
    <div class="card shadow-sm p-4 text-center mx-auto" style="max-width:520px;">
      <div class="spinner-border text-primary mb-3" style="width:3rem;height:3rem;" role="status">
        <span class="visually-hidden">Generating personal statement...</span>
      </div>
      <h2 class="h5 fw-semibold mb-2">Creating your personal statement draft...</h2>
      <p class="text-muted mb-1">${provenanceSelection ? 'Using your selected profile data.' : 'Using your achievements, activities, and impact statements.'}</p>
      <p class="text-muted small">This usually takes 10–20 seconds.</p>
    </div>
  `);

  document.getElementById('btn-back-from-generating-prov').addEventListener('click', async (e) => {
    e.preventDefault();
    if (!generationAborted) {
      const confirmed = await _essayConfirmModal('Generation is in progress. Leaving now will discard the new draft.', 'Leave anyway?', 'Leave', 'Stay');
      if (!confirmed) return;
    }
    generationAborted = true;
    appNavigate('/essays');
  });

  const result = await generateEssay(provenanceSelection);
  provenanceSelection = null; // reset after use

  if (generationAborted) return;

  if (!result.success) {
    showEssayGenerationError(result);
    return;
  }

  showEssayEditScreen(result.data, true);
}

// ─── STORY-003a: Inline sources panel for essay draft (Screen 5) ──────────────

/**
 * Build the HTML for the essay sources panel rendered inside the AI draft card.
 * @param {object|null} provenanceUsed - from POST /api/essays/generate response
 * @param {string} collapseId - unique ID for the collapse element
 * @returns {string} HTML string
 */
function _buildEssaySourcesPanel(provenanceUsed, collapseId) {
  const toggleId = `${collapseId}-toggle`;

  const hasProvenance = provenanceUsed && (
    provenanceUsed.gpa ||
    (provenanceUsed.testScores && provenanceUsed.testScores.length > 0) ||
    (provenanceUsed.achievements && provenanceUsed.achievements.length > 0) ||
    (provenanceUsed.impactStatements && provenanceUsed.impactStatements.length > 0)
  );

  let innerHtml;
  if (!hasProvenance) {
    innerHtml = '<p class="text-muted small mb-0">All available profile data was used. Select specific items next time using the data source panel.</p>';
  } else {
    const sections = [];

    if (provenanceUsed.gpa) {
      const g = provenanceUsed.gpa;
      sections.push(`
        <div class="ao-sources-section-heading">GPA</div>
        <div class="text-muted small">${escapeHtml(g.value)}${g.confidence ? ` · ${g.confidence}% confidence` : ''} · ${escapeHtml(g.source || '')}</div>`);
    }

    if (provenanceUsed.testScores && provenanceUsed.testScores.length > 0) {
      sections.push(`<div class="ao-sources-section-heading">Test scores</div>`);
      provenanceUsed.testScores.forEach(t => {
        sections.push(`<div class="text-muted small">${escapeHtml(t.name)}: ${escapeHtml(t.score)}${t.confidence ? ` · ${t.confidence}% confidence` : ''} · ${escapeHtml(t.source || '')}</div>`);
      });
    }

    if (provenanceUsed.achievements && provenanceUsed.achievements.length > 0) {
      sections.push(`<div class="ao-sources-section-heading">Achievements &amp; activities</div>`);
      provenanceUsed.achievements.forEach(a => {
        sections.push(`<div class="text-muted small">${escapeHtml(a.name)} · ${escapeHtml(a.category || '')} · ${escapeHtml(a.source || '')}</div>`);
      });
    }

    if (provenanceUsed.impactStatements && provenanceUsed.impactStatements.length > 0) {
      sections.push(`<div class="ao-sources-section-heading">Impact statements used</div>`);
      provenanceUsed.impactStatements.forEach(s => {
        sections.push(`<div class="text-muted small">"${escapeHtml(s.preview || '')}" (${escapeHtml(s.achievementName || '')})</div>`);
      });
    }

    innerHtml = sections.join('');
  }

  return `
    <div class="mt-3 border-top pt-2">
      <button class="ao-reasoning-toggle" id="${toggleId}" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false">
        <i class="bi bi-database me-1"></i>
        <span class="ao-toggle-label">Sources used in this draft</span>
        <i class="bi bi-chevron-down ao-toggle-icon"></i>
      </button>
      <div class="collapse" id="${collapseId}">
        <div class="ao-sources-inner">${innerHtml}</div>
      </div>
    </div>`;
}

/**
 * Build the HTML for the inline reasoning section in an impact statement draft card.
 * @param {object} generateData - { reasoning, profileDataUsed, focusAreas }
 * @param {string} collapseId - unique collapse ID
 * @returns {string} HTML string
 */
function _buildImpactReasoningPanel(generateData, collapseId) {
  const reasoning = generateData.reasoning || null;
  const profileDataUsed = generateData.profileDataUsed || [];
  const focusAreas = generateData.focusAreas || [];

  // If everything is empty, render nothing
  if (!reasoning && profileDataUsed.length === 0 && focusAreas.length === 0) return '';

  const toggleId = `${collapseId}-toggle`;

  const reasoningLine = reasoning
    ? `<p class="text-muted small mb-1"><em>Generated based on: ${escapeHtml(reasoning)}</em></p>`
    : '';

  let innerSections = '';
  if (profileDataUsed.length > 0) {
    const items = profileDataUsed.map(item => {
      const text = typeof item === 'string' ? item : `${item.label}: ${item.value}`;
      return `<li>${escapeHtml(text)}</li>`;
    }).join('');
    innerSections += `
      <div class="mb-2">
        <div class="fw-semibold small text-muted mb-1">What I used from your profile</div>
        <ul class="list-unstyled mb-0">${items}</ul>
      </div>`;
  }

  if (focusAreas.length > 0) {
    const items = focusAreas.map(f => `<li><i class="bi bi-arrow-right me-1 text-primary"></i>${escapeHtml(f)}</li>`).join('');
    innerSections += `
      <div>
        <div class="fw-semibold small text-muted mb-1">What I emphasised</div>
        <ul class="list-unstyled mb-0">${items}</ul>
      </div>`;
  }

  return `
    <div class="mt-2 border-top pt-2">
      ${reasoningLine}
      <button class="ao-reasoning-toggle" id="${toggleId}" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false">
        <i class="bi bi-chevron-down ao-toggle-icon me-1"></i>
        <span class="ao-toggle-label">Why did the AI focus on this?</span>
      </button>
      <div class="collapse" id="${collapseId}">
        <div class="ao-reasoning-inner">${innerSections}</div>
      </div>
    </div>`;
}

/**
 * Wire up collapse toggle label/icon switching for reasoning/sources panels.
 * @param {string} toggleId - ID of the toggle button
 * @param {string} collapseId - ID of the collapsible element
 * @param {string} labelCollapsed - label when collapsed
 * @param {string} labelExpanded - label when expanded
 */
function _wireCollapseToggle(toggleId, collapseId, labelCollapsed, labelExpanded) {
  const collapseEl = document.getElementById(collapseId);
  if (!collapseEl) return;
  collapseEl.addEventListener('show.bs.collapse', () => {
    const btn = document.getElementById(toggleId);
    if (!btn) return;
    const label = btn.querySelector('.ao-toggle-label');
    const icon = btn.querySelector('.ao-toggle-icon');
    if (label) label.textContent = labelExpanded;
    if (icon) { icon.classList.remove('bi-chevron-down'); icon.classList.add('bi-chevron-up'); }
  });
  collapseEl.addEventListener('hide.bs.collapse', () => {
    const btn = document.getElementById(toggleId);
    if (!btn) return;
    const label = btn.querySelector('.ao-toggle-label');
    const icon = btn.querySelector('.ao-toggle-icon');
    if (label) label.textContent = labelCollapsed;
    if (icon) { icon.classList.remove('bi-chevron-up'); icon.classList.add('bi-chevron-down'); }
  });
}

/**
 * Screen 3 — Impact statement generator.
 * Shows spinner while generating, then AI draft + editable textarea.
 *
 * @param {object} achievement - normalized achievement object
 * @param {object} [answers] - optional questionnaire answers from STORY-003a
 */
/**
 * Screen 5 — Impact statement generator.
 * Shows spinner while generating, then AI draft card + editable textarea.
 * Buttons: [Edit Draft inline] [Regenerate] [Adjust Answers] [Save As Is] [Discard]
 *
 * @param {object} achievement - normalized achievement object
 * @param {object} [answersArg] - optional questionnaire answers from STORY-003a
 */
async function showImpactGenerator(achievement, answersArg) {
  showNavbar();
  history.pushState({}, '', '/impact-statements/generate');
  document.title = 'Generate Impact Statement — Admissions Officer';

  // Keep a mutable reference to the answers so Adjust Answers can go back with pre-filled answers
  let answers = answersArg ? Object.assign({}, answersArg) : null;

  // Initial layout
  renderTemplate(`
    <div class="mb-3">
      <a href="#" class="btn btn-sm btn-link text-muted ps-0" id="btn-back-to-dashboard">
        <i class="bi bi-arrow-left me-1"></i>Back to Dashboard
      </a>
    </div>

    <div class="mb-1">
      <div class="progress ao-progress mb-2">
        <div class="progress-bar bg-primary" role="progressbar" style="width:75%" aria-valuenow="75" aria-valuemin="0" aria-valuemax="100"></div>
      </div>
      <small class="text-muted">Step 3 of 4 — Your Draft</small>
    </div>

    <h2 class="h5 fw-semibold mb-1">Impact Statement: ${escapeHtml(achievement.name)}</h2>
    <p class="text-muted small mb-4">
      Category: ${escapeHtml(achievement.category)}
      ${achievement.hoursPerWeek != null ? ` &middot; ${achievement.hoursPerWeek} hrs/week` : ''}
      ${achievement.yearsInvolved ? ` &middot; ${achievement.yearsInvolved} year${achievement.yearsInvolved !== 1 ? 's' : ''}` : ''}
    </p>

    <!-- AI Draft Card -->
    <div class="card mb-4" id="ai-draft-card">
      <div class="card-header d-flex align-items-center gap-2 bg-light">
        <i class="bi bi-robot text-primary"></i>
        <span class="fw-semibold small">AI-generated draft</span>
        <span class="text-muted small ms-1">— This is a starting point — rewrite it in your own words.</span>
      </div>
      <div class="card-body" id="ai-draft-body">
        <div class="text-center py-3" id="impact-spinner-state">
          <div class="spinner-border text-primary spinner-border-sm me-2" role="status"></div>
          <span class="text-muted">Generating your statement... this takes about 5–10 seconds</span>
        </div>
      </div>
    </div>

    <!-- Student textarea -->
    <div class="mb-3">
      <label class="form-label fw-semibold">Your statement: <span class="text-muted fw-normal small">(edit below — this is what gets saved)</span></label>
      <textarea
        id="impact-statement-textarea"
        class="form-control"
        rows="6"
        maxlength="1000"
        placeholder="Your statement will appear here once the draft is ready. Edit it freely."
        disabled
      ></textarea>
      <div class="d-flex justify-content-between mt-1">
        <div id="impact-textarea-error" class="text-danger small"></div>
        <span class="text-muted small">Character count: <span id="impact-char-count">0</span> / 1000</span>
      </div>
    </div>

    <!-- Inline discard confirmation -->
    <div id="impact-discard-confirm" class="alert alert-warning d-none mb-3" role="alert">
      <span class="fw-semibold">Discard this draft? Your answers and draft will be lost.</span>
      <div class="mt-2 d-flex gap-2">
        <button class="btn btn-sm btn-danger" id="btn-discard-confirm-yes">Yes, Discard</button>
        <button class="btn btn-sm btn-outline-secondary" id="btn-discard-confirm-no">Keep Working</button>
      </div>
    </div>

    <!-- Inline adjust answers confirmation -->
    <div id="impact-adjust-confirm" class="alert alert-warning d-none mb-3" role="alert">
      <span class="fw-semibold">Going back will discard your current draft edits. Continue?</span>
      <div class="mt-2 d-flex gap-2">
        <button class="btn btn-sm btn-warning" id="btn-adjust-confirm-yes">Yes, Go Back</button>
        <button class="btn btn-sm btn-outline-secondary" id="btn-adjust-confirm-no">Stay Here</button>
      </div>
    </div>

    <!-- Action buttons -->
    <div class="d-flex gap-2 flex-wrap" id="impact-action-buttons">
      <button class="btn btn-outline-secondary" id="btn-edit-draft-inline" disabled>
        <i class="bi bi-pencil me-1"></i>Edit Draft inline
      </button>
      <button class="btn btn-outline-secondary" id="btn-regenerate" disabled>
        <i class="bi bi-arrow-clockwise me-1"></i>Regenerate
      </button>
      <button class="btn btn-outline-secondary" id="btn-adjust-answers" disabled>
        <i class="bi bi-arrow-left me-1"></i>Adjust Answers
      </button>
      <button class="btn btn-primary" id="btn-save-as-is" disabled>
        <i class="bi bi-check2 me-1"></i>Save As Is
      </button>
      <button class="btn btn-link text-muted" id="btn-discard">Discard</button>
    </div>
  `);

  document.getElementById('btn-back-to-dashboard').addEventListener('click', (e) => {
    e.preventDefault();
    appNavigate('/');
  });

  // Character counter
  const textarea = document.getElementById('impact-statement-textarea');
  textarea.addEventListener('input', () => {
    const len = textarea.value.length;
    document.getElementById('impact-char-count').textContent = len;
    validateImpactTextarea();
  });

  // State
  let currentAiDraft = null;
  let currentGenerateData = null; // full result.data from last successful generate call

  function validateImpactTextarea() {
    const val = textarea.value.trim();
    const errorEl = document.getElementById('impact-textarea-error');
    const saveBtn = document.getElementById('btn-save-as-is');

    if (val.length === 0) {
      if (errorEl) errorEl.textContent = 'Statement cannot be empty.';
      if (saveBtn) saveBtn.disabled = true;
      return false;
    }
    if (val.length > 1000) {
      if (errorEl) errorEl.textContent = 'Statement is too long (max 1000 characters).';
      if (saveBtn) saveBtn.disabled = true;
      return false;
    }
    if (errorEl) errorEl.textContent = '';
    if (saveBtn) saveBtn.disabled = false;
    return true;
  }

  async function runGenerate() {
    const draftBody = document.getElementById('ai-draft-body');
    if (draftBody) {
      draftBody.innerHTML = `
        <div class="text-center py-3">
          <div class="spinner-border text-primary spinner-border-sm me-2" role="status"></div>
          <span class="text-muted">Generating your statement... this takes about 5–10 seconds</span>
        </div>`;
    }

    // Disable action buttons during generation (except Cancel/Discard)
    ['btn-save-as-is', 'btn-edit-draft-inline', 'btn-regenerate', 'btn-adjust-answers'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });

    const result = await generateImpactStatementDraft(achievement.id, answers);

    if (!result.success) {
      currentAiDraft = null;
      currentGenerateData = null;
      const errCode = result.error && result.error.code;
      const errMsg = errCode === 'AI_TIMEOUT'
        ? 'Draft generation timed out. You can write your own statement below.'
        : 'Draft generation failed. You can still write your own statement below.';
      if (draftBody) {
        draftBody.innerHTML = `
          <p class="text-muted fst-italic mb-0">
            <i class="bi bi-exclamation-triangle me-1 text-warning"></i>
            ${escapeHtml(errMsg)}
          </p>`;
      }
      const ta = document.getElementById('impact-statement-textarea');
      if (ta) {
        ta.disabled = false;
        ta.value = '';
        ta.focus();
        document.getElementById('impact-char-count').textContent = '0';
      }
    } else {
      currentAiDraft = result.data.draft;
      currentGenerateData = result.data;
      if (draftBody) {
        const reasoningCollapseId = 'impact-reasoning-collapse';
        const reasoningHtml = _buildImpactReasoningPanel(result.data, reasoningCollapseId);
        draftBody.innerHTML = `<p class="mb-0" style="white-space:pre-wrap;">${escapeHtml(currentAiDraft)}</p>${reasoningHtml}`;
        _wireCollapseToggle(
          `${reasoningCollapseId}-toggle`, reasoningCollapseId,
          'Why did the AI focus on this?', 'Hide reasoning'
        );
      }
      const ta = document.getElementById('impact-statement-textarea');
      if (ta) {
        ta.disabled = false;
        ta.value = currentAiDraft;
        document.getElementById('impact-char-count').textContent = currentAiDraft.length;
        validateImpactTextarea();
      }
    }

    // Enable action buttons after generation
    ['btn-edit-draft-inline', 'btn-regenerate', 'btn-adjust-answers'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = false;
    });
    // Validate textarea to set save button state
    validateImpactTextarea();
  }

  // Wire [Edit Draft inline]
  document.getElementById('btn-edit-draft-inline').addEventListener('click', () => {
    const ta = document.getElementById('impact-statement-textarea');
    const editBtn = document.getElementById('btn-edit-draft-inline');
    if (ta.disabled) {
      ta.disabled = false;
    }
    ta.focus();
    if (editBtn.textContent.trim().includes('Edit Draft inline')) {
      editBtn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Done Editing';
    } else {
      editBtn.innerHTML = '<i class="bi bi-pencil me-1"></i>Edit Draft inline';
    }
  });

  // Wire [Regenerate] — updates AI draft card but does NOT overwrite textarea
  document.getElementById('btn-regenerate').addEventListener('click', async () => {
    const draftBody = document.getElementById('ai-draft-body');
    if (draftBody) {
      draftBody.innerHTML = `
        <div class="text-center py-3">
          <div class="spinner-border text-primary spinner-border-sm me-2" role="status"></div>
          <span class="text-muted">Regenerating draft...</span>
        </div>`;
    }
    ['btn-save-as-is', 'btn-edit-draft-inline', 'btn-regenerate', 'btn-adjust-answers'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });

    const result = await generateImpactStatementDraft(achievement.id, answers);

    if (!result.success) {
      const errCode = result.error && result.error.code;
      const errMsg = errCode === 'AI_TIMEOUT'
        ? 'Draft generation timed out. You can write your own statement below.'
        : 'Draft generation failed. You can still write your own statement below.';
      if (draftBody) {
        draftBody.innerHTML = `
          <p class="text-muted fst-italic mb-0">
            <i class="bi bi-exclamation-triangle me-1 text-warning"></i>${escapeHtml(errMsg)}
          </p>`;
      }
    } else {
      currentAiDraft = result.data.draft;
      currentGenerateData = result.data;
      // Update AI draft card ONLY — do NOT overwrite textarea
      if (draftBody) {
        const reasoningCollapseId = 'impact-reasoning-collapse-regen';
        const reasoningHtml = _buildImpactReasoningPanel(result.data, reasoningCollapseId);
        draftBody.innerHTML = `<p class="mb-0" style="white-space:pre-wrap;">${escapeHtml(currentAiDraft)}</p>${reasoningHtml}`;
        _wireCollapseToggle(
          `${reasoningCollapseId}-toggle`, reasoningCollapseId,
          'Why did the AI focus on this?', 'Hide reasoning'
        );
      }
      // Textarea intentionally NOT updated (spec AC #13)
    }

    ['btn-edit-draft-inline', 'btn-regenerate', 'btn-adjust-answers'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = false;
    });
    validateImpactTextarea();
  });

  // Wire [Adjust Answers] — show confirmation dialog
  document.getElementById('btn-adjust-answers').addEventListener('click', () => {
    const confirmEl = document.getElementById('impact-adjust-confirm');
    const discardEl = document.getElementById('impact-discard-confirm');
    if (discardEl) discardEl.classList.add('d-none');
    if (confirmEl) confirmEl.classList.remove('d-none');
  });

  document.getElementById('btn-adjust-confirm-yes').addEventListener('click', () => {
    const confirmEl = document.getElementById('impact-adjust-confirm');
    if (confirmEl) confirmEl.classList.add('d-none');
    // Restore answers into currentAnswerSheet so questionnaire re-opens pre-filled
    if (answers) {
      currentAnswerSheet = Object.assign({ achievementId: achievement.id }, answers);
    } else {
      currentAnswerSheet = { achievementId: achievement.id, role: '', challenge: '', growth: '', importance: '', impact: '' };
    }
    openQuestionnaireModal(achievement);
  });

  document.getElementById('btn-adjust-confirm-no').addEventListener('click', () => {
    const confirmEl = document.getElementById('impact-adjust-confirm');
    if (confirmEl) confirmEl.classList.add('d-none');
  });

  // Wire [Discard] — show inline confirmation
  document.getElementById('btn-discard').addEventListener('click', () => {
    const discardEl = document.getElementById('impact-discard-confirm');
    const adjustEl = document.getElementById('impact-adjust-confirm');
    if (adjustEl) adjustEl.classList.add('d-none');
    if (discardEl) discardEl.classList.remove('d-none');
  });

  document.getElementById('btn-discard-confirm-yes').addEventListener('click', () => {
    // Reset state and return to achievement picker
    currentAnswerSheet = { achievementId: '', role: '', challenge: '', growth: '', importance: '', impact: '' };
    reasoningPreviewCache = null;
    openImpactPickerModal();
  });

  document.getElementById('btn-discard-confirm-no').addEventListener('click', () => {
    const discardEl = document.getElementById('impact-discard-confirm');
    if (discardEl) discardEl.classList.add('d-none');
  });

  // Wire [Save As Is]
  document.getElementById('btn-save-as-is').addEventListener('click', async () => {
    if (!validateImpactTextarea()) return;

    const statementText = document.getElementById('impact-statement-textarea').value.trim();
    const wasAiGenerated = currentAiDraft !== null;
    const wasEdited = currentAiDraft === null || statementText !== currentAiDraft;

    const saveBtn = document.getElementById('btn-save-as-is');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

    // Build generatedFrom from the last generation result
    let generatedFrom = {
      studentAnswers: { role: '', challenge: '', growth: '', importance: '', impact: '' },
      profileDataUsed: [],
      focusAreas: [],
    };
    if (currentGenerateData) {
      generatedFrom.profileDataUsed = currentGenerateData.profileDataUsed || [];
      generatedFrom.focusAreas = currentGenerateData.focusAreas || [];
    }
    if (answers) {
      generatedFrom.studentAnswers = {
        role: answers.role || '',
        challenge: answers.challenge || '',
        growth: answers.growth || '',
        importance: answers.importance || '',
        impact: answers.impact || '',
      };
    }

    const reasoning = (currentGenerateData && currentGenerateData.reasoning) || null;

    const result = await saveImpactStatement(
      achievement.id,
      statementText,
      currentAiDraft,
      wasAiGenerated,
      wasEdited,
      generatedFrom,
      reasoning
    );

    if (!result.success) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="bi bi-check2 me-1"></i>Save As Is';
      const code = result.error && result.error.code;
      const msg = (result.error && result.error.message) || 'Save failed. Please try again.';

      // Handle duplicate statement — offer to update instead
      if (code === 'DUPLICATE_STATEMENT') {
        const confirmed = confirm(msg + '\n\nWould you like to update the existing statement?');
        if (confirmed) {
          // Find existing statement for this achievement
          const allStmts = await getImpactStatements();
          if (allStmts.success && allStmts.data && allStmts.data.statements) {
            const existing = allStmts.data.statements.find(s => s.linkedAchievementId === achievement.id);
            if (existing) {
              const updateResult = await updateImpactStatement(existing.id, statementText);
              if (updateResult.success) {
                showToast('Impact statement updated.');
                setTimeout(() => {
                  showImpactStatementsList();
                }, 1500);
                return;
              } else {
                showToast((updateResult.error && updateResult.error.message) || 'Update failed.', '', 'danger');
              }
            }
          }
        }
        return;
      }

      if (code === 'VALIDATION_ERROR') {
        const errEl = document.getElementById('impact-textarea-error');
        if (errEl) errEl.textContent = msg;
      } else {
        showToast(msg, '', 'danger');
      }
      return;
    }

    showToast('Impact statement saved.');
    // Redirect to Screen 6 (impact statements list) after 1.5 seconds (AC #17)
    setTimeout(() => {
      showImpactStatementsList();
    }, 1500);
  });

  // Start generation
  await runGenerate();
}

/**
 * Format a date string for the impact statements list.
 * Output: "Jun 14, 2026 10:35 AM"
 * @param {string} isoStr
 * @returns {string}
 */
function formatImpactDate(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch (_) {
    return isoStr;
  }
}

/**
 * Truncate a statement text to max 200 chars at a word boundary.
 * @param {string} text
 * @returns {string}
 */
function truncateStatementPreview(text) {
  if (!text) return '';
  if (text.length <= 200) return text;
  // Find last space at or before char 200
  let cut = text.lastIndexOf(' ', 200);
  if (cut <= 0) cut = 200;
  return text.slice(0, cut) + '...';
}

/**
 * Screen 4 — Impact statements details page (/impact-statements).
 * Full page listing all saved statements with inline edit/delete.
 */
async function showImpactStatementsList() {
  showNavbar();
  history.replaceState({}, '', '/impact-statements');
  document.title = 'Impact Statements — Admissions Officer';

  renderTemplate(`
    <div class="mb-3">
      <a href="#" class="btn btn-sm btn-link text-muted ps-0" id="btn-back-to-dashboard-from-impact">
        <i class="bi bi-arrow-left me-1"></i>Back to Dashboard
      </a>
    </div>

    <div class="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
      <h2 class="h5 fw-semibold mb-0">Impact Statements</h2>
      <button class="btn btn-primary btn-sm d-none" id="btn-generate-new-impact">
        <i class="bi bi-plus-circle me-1"></i>Generate New Statement
      </button>
    </div>

    <div id="impact-list-alert"></div>

    <div id="impact-statements-list">
      <div class="text-center py-4">
        <div class="spinner-border text-primary spinner-border-sm"></div>
        <span class="ms-2 text-muted">Loading...</span>
      </div>
    </div>
  `);

  document.getElementById('btn-back-to-dashboard-from-impact').addEventListener('click', (e) => {
    e.preventDefault();
    appNavigate('/');
  });

  document.getElementById('btn-generate-new-impact').addEventListener('click', openImpactPickerModal);

  await _loadAndRenderImpactList();
}

async function _loadAndRenderImpactList() {
  const listEl = document.getElementById('impact-statements-list');
  if (!listEl) return;

  // Load both statements and available achievements (to determine "generate new" visibility)
  const [statementsResult, availableResult] = await Promise.all([
    getImpactStatements(),
    getAvailableForImpact().catch(() => ({ success: false })),
  ]);

  // Update "Generate New Statement" visibility
  const generateNewBtn = document.getElementById('btn-generate-new-impact');
  if (generateNewBtn) {
    const hasAvailable = availableResult.success &&
      availableResult.data && availableResult.data.available &&
      availableResult.data.available.length > 0;
    if (hasAvailable) {
      generateNewBtn.classList.remove('d-none');
    } else {
      generateNewBtn.classList.add('d-none');
    }
  }

  if (!statementsResult.success) {
    listEl.innerHTML = `
      <div class="alert alert-danger">
        <i class="bi bi-exclamation-triangle me-2"></i>
        Could not load statements. Check your data directory.
        <button class="btn btn-sm btn-outline-danger ms-2" id="btn-retry-list">Retry</button>
      </div>`;
    const retryBtn = document.getElementById('btn-retry-list');
    if (retryBtn) retryBtn.addEventListener('click', _loadAndRenderImpactList);
    return;
  }

  const statements = statementsResult.data.statements || [];

  if (statements.length === 0) {
    const hasAvailable = availableResult.success &&
      availableResult.data && availableResult.data.available &&
      availableResult.data.available.length > 0;
    listEl.innerHTML = `
      <div class="text-center py-5 text-muted">
        <i class="bi bi-chat-quote fs-1 d-block mb-3"></i>
        <p>No impact statements saved yet.</p>
        ${hasAvailable ? `<button class="btn btn-primary btn-generate-new-from-empty"><i class="bi bi-plus-circle me-1"></i>Generate New Statement</button>` : ''}
      </div>`;
    if (hasAvailable) {
      listEl.querySelector('.btn-generate-new-from-empty').addEventListener('click', openImpactPickerModal);
    }
    return;
  }

  const rowsHtml = statements.map(s => {
    const preview = truncateStatementPreview(s.statement || '');
    // Orphaned: grey italic prefix + badge
    const orphanedPrefix = s.orphaned
      ? `<span class="text-muted fst-italic small me-1">[Achievement removed]</span> `
      : '';
    const createdStr = formatImpactDate(s.createdAt);
    const editedStr = formatImpactDate(s.lastEditedAt);

    // "Generated from" line — AC #18
    let generatedFromLine = '';
    if (s.aiGenerated === false && s.editedByStudent) {
      generatedFromLine = 'written manually';
    } else if (s.generatedFrom && s.generatedFrom.studentAnswers) {
      const ans = s.generatedFrom.studentAnswers;
      const answeredCount = ['role', 'challenge', 'growth', 'importance', 'impact']
        .filter(k => ans[k] && ans[k].trim()).length;
      if (answeredCount > 0) {
        generatedFromLine = `${answeredCount} of 5 questions answered`;
      } else {
        generatedFromLine = 'profile data only';
      }
    } else if (s.aiGenerated) {
      generatedFromLine = 'profile data only';
    }

    // Encode the last answer sheet for [Regenerate with New Answers] data attribute
    const answersJson = (s.generatedFrom && s.generatedFrom.studentAnswers)
      ? escapeHtml(JSON.stringify(s.generatedFrom.studentAnswers))
      : '';
    const achievementId = escapeHtml(s.linkedAchievementId || '');

    return `
      <div class="card mb-3 impact-statement-row" id="statement-row-${escapeHtml(s.id)}" data-statement-id="${escapeHtml(s.id)}">
        <!-- Read-only view -->
        <div class="card-body impact-read-view" id="read-view-${escapeHtml(s.id)}">
          <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
            <div>
              ${orphanedPrefix}<span class="fw-semibold">${escapeHtml(s.linkedAchievementName || '(Unknown)')}</span>
              <span class="badge bg-light text-dark border ms-2 small">${escapeHtml(s.linkedAchievementCategory || '')}</span>
            </div>
            <div class="d-flex gap-2 flex-shrink-0 impact-action-btns" id="action-btns-${escapeHtml(s.id)}">
              <button class="btn btn-sm btn-outline-secondary btn-edit-statement" data-id="${escapeHtml(s.id)}">
                <i class="bi bi-pencil me-1"></i>Edit
              </button>
              <button class="btn btn-sm btn-outline-secondary btn-regenerate-statement"
                data-id="${escapeHtml(s.id)}"
                data-achievement-id="${achievementId}"
                data-answers="${answersJson}">
                <i class="bi bi-arrow-repeat me-1"></i>Regenerate with New Answers
              </button>
              <button class="btn btn-sm btn-outline-danger btn-delete-statement" data-id="${escapeHtml(s.id)}">
                <i class="bi bi-trash me-1"></i>Delete
              </button>
            </div>
          </div>
          <p class="text-muted small mt-1 mb-0">
            Created: ${escapeHtml(createdStr)}${editedStr && editedStr !== createdStr ? ` &middot; Last edited: ${escapeHtml(editedStr)}` : ''}
          </p>
          ${generatedFromLine ? `<p class="text-muted small mb-1">Generated from: ${escapeHtml(generatedFromLine)}</p>` : ''}
          <p class="mt-1 mb-0 small fst-italic" style="white-space:pre-wrap;">"${escapeHtml(preview)}"</p>
          <!-- Inline delete confirmation -->
          <div id="confirm-delete-${escapeHtml(s.id)}" class="d-none mt-2 p-2 bg-light rounded d-flex align-items-center gap-2 flex-wrap">
            <span class="small text-danger fw-semibold">Delete this statement?</span>
            <button class="btn btn-sm btn-danger btn-confirm-delete" data-id="${escapeHtml(s.id)}">Confirm Delete</button>
            <button class="btn btn-sm btn-outline-secondary btn-cancel-delete" data-id="${escapeHtml(s.id)}">Cancel</button>
          </div>
          <!-- Inline regenerate confirmation -->
          <div id="confirm-regen-${escapeHtml(s.id)}" class="d-none mt-2 p-2 bg-light rounded">
            <span class="small fw-semibold">This will start a new draft. Your current statement is preserved until you save a new one.</span>
            <div class="mt-2 d-flex gap-2">
              <button class="btn btn-sm btn-primary btn-confirm-regen" data-id="${escapeHtml(s.id)}" data-achievement-id="${achievementId}" data-answers="${answersJson}">Continue</button>
              <button class="btn btn-sm btn-outline-secondary btn-cancel-regen" data-id="${escapeHtml(s.id)}">Cancel</button>
            </div>
          </div>
        </div>
        <!-- Inline edit view (hidden by default) -->
        <div class="card-body impact-edit-view d-none" id="edit-view-${escapeHtml(s.id)}">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div>
              <span class="fw-semibold text-muted">Editing: ${escapeHtml(s.linkedAchievementName || '(Unknown)')}</span>
              <span class="badge bg-light text-dark border ms-2 small">${escapeHtml(s.linkedAchievementCategory || '')}</span>
            </div>
          </div>
          <p class="text-muted small mb-2">
            Created: ${escapeHtml(createdStr)}${editedStr && editedStr !== createdStr ? ` &middot; Last edited: ${escapeHtml(editedStr)}` : ''}
          </p>
          <textarea
            class="form-control mb-1 impact-inline-edit-textarea"
            rows="5"
            maxlength="1000"
            data-id="${escapeHtml(s.id)}"
            data-original="${escapeHtml(s.statement || '')}"
          >${escapeHtml(s.statement || '')}</textarea>
          <div class="d-flex justify-content-between mb-2">
            <div class="text-danger small impact-inline-edit-error" id="inline-edit-error-${escapeHtml(s.id)}"></div>
            <span class="text-muted small"><span class="impact-inline-char-count" id="inline-char-count-${escapeHtml(s.id)}">${(s.statement || '').length}</span> / 1000</span>
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-primary btn-save-inline-edit" data-id="${escapeHtml(s.id)}" disabled>
              <i class="bi bi-check2 me-1"></i>Save Changes
            </button>
            <button class="btn btn-sm btn-outline-secondary btn-cancel-inline-edit" data-id="${escapeHtml(s.id)}">Cancel</button>
          </div>
        </div>
      </div>`;
  }).join('');

  listEl.innerHTML = rowsHtml;

  // Wire inline edit buttons
  listEl.querySelectorAll('.btn-edit-statement').forEach(btn => {
    btn.addEventListener('click', () => {
      const stId = btn.dataset.id;
      _openInlineEdit(stId, statements, listEl);
    });
  });

  // Wire inline textarea changes
  listEl.querySelectorAll('.impact-inline-edit-textarea').forEach(ta => {
    ta.addEventListener('input', () => {
      const stId = ta.dataset.id;
      const original = ta.dataset.original;
      const charCount = document.getElementById(`inline-char-count-${stId}`);
      const errorEl = document.getElementById(`inline-edit-error-${stId}`);
      const saveBtn = listEl.querySelector(`.btn-save-inline-edit[data-id="${stId}"]`);
      if (charCount) charCount.textContent = ta.value.length;
      _validateInlineEdit(ta, original, errorEl, saveBtn);
    });
  });

  // Wire inline cancel buttons
  listEl.querySelectorAll('.btn-cancel-inline-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const stId = btn.dataset.id;
      _closeInlineEdit(stId);
    });
  });

  // Wire inline save buttons
  listEl.querySelectorAll('.btn-save-inline-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const stId = btn.dataset.id;
      const ta = listEl.querySelector(`.impact-inline-edit-textarea[data-id="${stId}"]`);
      const original = ta.dataset.original;
      const errorEl = document.getElementById(`inline-edit-error-${stId}`);
      if (!_validateInlineEdit(ta, original, errorEl, btn)) return;

      const newText = ta.value.trim();
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

      const updateResult = await updateImpactStatement(stId, newText);

      if (!updateResult.success) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check2 me-1"></i>Save Changes';
        const code = updateResult.error && updateResult.error.code;
        const msg = (updateResult.error && updateResult.error.message) || 'Save failed. Please try again.';
        if (code === 'NOT_FOUND') {
          showToast('This statement no longer exists. Refreshing list.', '', 'warning');
          await _loadAndRenderImpactList();
        } else if (code === 'VALIDATION_ERROR') {
          errorEl.textContent = msg;
        } else {
          showToast(msg, '', 'danger');
        }
        return;
      }

      // Update in-memory record for re-render
      const idx = statements.findIndex(x => x.id === stId);
      if (idx !== -1) {
        statements[idx].statement = newText;
        statements[idx].lastEditedAt = updateResult.data && updateResult.data.lastEditedAt
          ? updateResult.data.lastEditedAt : new Date().toISOString();
        // Update the read view preview and date in place
        const readView = document.getElementById(`read-view-${stId}`);
        if (readView) {
          const previewEl = readView.querySelector('p.fst-italic');
          if (previewEl) previewEl.textContent = `"${truncateStatementPreview(newText)}"`;
          const dateEl = readView.querySelector('p.text-muted.small');
          if (dateEl) {
            const createdStr = formatImpactDate(statements[idx].createdAt);
            const editedStr = formatImpactDate(statements[idx].lastEditedAt);
            dateEl.innerHTML = `Created: ${escapeHtml(createdStr)} &middot; Last edited: ${escapeHtml(editedStr)}`;
          }
        }
        // Update textarea original value
        ta.dataset.original = newText;
      }

      _closeInlineEdit(stId);
      showToast('Statement updated.');
    });
  });

  // Wire delete buttons
  listEl.querySelectorAll('.btn-delete-statement').forEach(btn => {
    btn.addEventListener('click', () => {
      const stId = btn.dataset.id;
      // Close any open inline edit first
      listEl.querySelectorAll('.impact-inline-edit-textarea').forEach(ta => {
        if (ta.dataset.id !== stId) _closeInlineEdit(ta.dataset.id);
      });
      // Hide all other confirm rows
      listEl.querySelectorAll('[id^="confirm-delete-"]').forEach(el => el.classList.add('d-none'));
      // Show action buttons (in case delete was clicked while another was confirming)
      listEl.querySelectorAll('.impact-action-btns').forEach(el => el.classList.remove('d-none'));
      // Show this confirm row and hide action buttons for this row
      const actionBtns = document.getElementById(`action-btns-${stId}`);
      if (actionBtns) actionBtns.classList.add('d-none');
      const confirmRow = document.getElementById(`confirm-delete-${stId}`);
      if (confirmRow) confirmRow.classList.remove('d-none');
    });
  });

  // Wire confirm delete
  listEl.querySelectorAll('.btn-confirm-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const stId = btn.dataset.id;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
      const deleteResult = await deleteImpactStatement(stId);
      if (!deleteResult.success) {
        const code = deleteResult.error && deleteResult.error.code;
        if (code === 'NOT_FOUND') {
          showToast('This statement no longer exists. Refreshing list.', '', 'warning');
          await _loadAndRenderImpactList();
        } else {
          const confirmRow = document.getElementById(`confirm-delete-${stId}`);
          if (confirmRow) {
            confirmRow.innerHTML += `<span class="text-danger small ms-2">Delete failed. Try again.</span>`;
          }
          btn.disabled = false;
          btn.innerHTML = 'Confirm Delete';
        }
        return;
      }
      // Remove row from DOM
      const rowEl = document.getElementById(`statement-row-${stId}`);
      if (rowEl) rowEl.remove();
      showToast('Statement deleted.');

      // If list now empty, show empty state
      if (!listEl.querySelector('.impact-statement-row')) {
        const hasAvail = availableResult.success &&
          availableResult.data && availableResult.data.available &&
          availableResult.data.available.length > 0;
        listEl.innerHTML = `
          <div class="text-center py-5 text-muted">
            <i class="bi bi-chat-quote fs-1 d-block mb-3"></i>
            <p>No impact statements saved yet.</p>
            ${hasAvail ? `<button class="btn btn-primary btn-generate-new-from-empty"><i class="bi bi-plus-circle me-1"></i>Generate New Statement</button>` : ''}
          </div>`;
        if (hasAvail) {
          listEl.querySelector('.btn-generate-new-from-empty').addEventListener('click', openImpactPickerModal);
        }
      }
    });
  });

  // Wire cancel delete
  listEl.querySelectorAll('.btn-cancel-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const stId = btn.dataset.id;
      const confirmRow = document.getElementById(`confirm-delete-${stId}`);
      if (confirmRow) confirmRow.classList.add('d-none');
      const actionBtns = document.getElementById(`action-btns-${stId}`);
      if (actionBtns) actionBtns.classList.remove('d-none');
    });
  });

  // Wire [Regenerate with New Answers] — shows inline confirmation first (AC #19)
  listEl.querySelectorAll('.btn-regenerate-statement').forEach(btn => {
    btn.addEventListener('click', () => {
      const stId = btn.dataset.id;
      // Hide delete confirmations
      listEl.querySelectorAll('[id^="confirm-delete-"]').forEach(el => el.classList.add('d-none'));
      listEl.querySelectorAll('[id^="confirm-regen-"]').forEach(el => el.classList.add('d-none'));
      listEl.querySelectorAll('.impact-action-btns').forEach(el => el.classList.remove('d-none'));
      const actionBtns = document.getElementById(`action-btns-${stId}`);
      if (actionBtns) actionBtns.classList.add('d-none');
      const confirmEl = document.getElementById(`confirm-regen-${stId}`);
      if (confirmEl) confirmEl.classList.remove('d-none');
    });
  });

  // Wire cancel regen
  listEl.querySelectorAll('.btn-cancel-regen').forEach(btn => {
    btn.addEventListener('click', () => {
      const stId = btn.dataset.id;
      const confirmEl = document.getElementById(`confirm-regen-${stId}`);
      if (confirmEl) confirmEl.classList.add('d-none');
      const actionBtns = document.getElementById(`action-btns-${stId}`);
      if (actionBtns) actionBtns.classList.remove('d-none');
    });
  });

  // Wire confirm regen — load achievement, restore answers, open questionnaire (AC #19)
  listEl.querySelectorAll('.btn-confirm-regen').forEach(btn => {
    btn.addEventListener('click', async () => {
      const achievementId = btn.dataset.achievementId;
      let lastAnswers = {};
      try {
        lastAnswers = JSON.parse(btn.dataset.answers || '{}');
      } catch (_) {}

      // Find the achievement object from available list or fetch fresh
      let achievement = null;
      const freshAvail = await getAvailableForImpact().catch(() => ({ success: false }));
      if (freshAvail.success && freshAvail.data) {
        // Check available list first
        achievement = (freshAvail.data.available || []).find(a => a.id === achievementId);
        if (!achievement) {
          // Achievement already has a statement; still need its data — fetch from already-have list
          // We need the achievement name/category; use it from the statement row card heading
          const stId = btn.dataset.id;
          const rowEl = document.getElementById(`statement-row-${stId}`);
          if (rowEl) {
            const nameEl = rowEl.querySelector('.fw-semibold');
            const catEl = rowEl.querySelector('.badge.bg-light');
            achievement = {
              id: achievementId,
              name: nameEl ? nameEl.textContent.trim() : '(Unknown)',
              category: catEl ? catEl.textContent.trim() : 'Other',
            };
          }
        }
      }

      if (!achievement) {
        showToast('Could not load achievement data. Try again.', '', 'danger');
        return;
      }

      // Restore answers into currentAnswerSheet so questionnaire opens pre-filled
      currentAnswerSheet = Object.assign({ achievementId }, lastAnswers);
      reasoningPreviewCache = null;
      openQuestionnaireModal(achievement);
    });
  });
}

/**
 * Open inline edit mode for a statement card on the list page.
 * Closes any other card that is currently in edit mode.
 * @param {string} stId
 * @param {Array} statements
 * @param {Element} listEl
 */
function _openInlineEdit(stId, statements, listEl) {
  // Close any currently open edit (discard changes — per spec)
  listEl.querySelectorAll('.impact-edit-view:not(.d-none)').forEach(el => {
    const openId = el.id.replace('edit-view-', '');
    if (openId !== stId) _closeInlineEdit(openId);
  });

  const readView = document.getElementById(`read-view-${stId}`);
  const editView = document.getElementById(`edit-view-${stId}`);
  if (!readView || !editView) return;

  readView.classList.add('d-none');
  editView.classList.remove('d-none');

  // Reset textarea to saved value
  const ta = editView.querySelector('.impact-inline-edit-textarea');
  const original = ta.dataset.original;
  ta.value = original;
  const charCount = document.getElementById(`inline-char-count-${stId}`);
  if (charCount) charCount.textContent = original.length;

  // Reset error and save button state
  const errorEl = document.getElementById(`inline-edit-error-${stId}`);
  if (errorEl) errorEl.textContent = '';
  const saveBtn = editView.querySelector('.btn-save-inline-edit');
  if (saveBtn) saveBtn.disabled = true; // disabled while text unchanged

  ta.focus();
}

/**
 * Close inline edit mode and revert to read-only view.
 * @param {string} stId
 */
function _closeInlineEdit(stId) {
  const readView = document.getElementById(`read-view-${stId}`);
  const editView = document.getElementById(`edit-view-${stId}`);
  if (!readView || !editView) return;
  editView.classList.add('d-none');
  readView.classList.remove('d-none');
}

/**
 * Validate the inline edit textarea.
 * @returns {boolean} true if valid
 */
function _validateInlineEdit(ta, original, errorEl, saveBtn) {
  const val = ta.value.trim();
  if (val.length === 0) {
    if (errorEl) errorEl.textContent = 'Statement cannot be empty.';
    if (saveBtn) saveBtn.disabled = true;
    return false;
  }
  if (val.length > 1000) {
    if (errorEl) errorEl.textContent = 'Statement is too long (max 1000 characters).';
    if (saveBtn) saveBtn.disabled = true;
    return false;
  }
  if (errorEl) errorEl.textContent = '';
  // Disable save if text unchanged
  if (saveBtn) saveBtn.disabled = (val === original.trim());
  return val !== original.trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// ESSAYS — Screens 2, 3, 5, 6
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Screen 2 — Essay generation in progress.
 * Calls the API, then navigates to Screen 3 or shows error.
 */
async function showEssayGenerating() {
  // STORY-006 spec: On direct URL load of /essays/generate (router dispatch),
  // fire POST /api/essays/generate immediately without provenance modal.
  // The modal is opened by the [Generate Essay] button click handlers instead.
  // This function is reached from the router when the path is /essays/generate.
  provenanceSelection = null; // no selection — use all data
  await _runEssayGenerationWithProvenance();
}

/**
 * Show error state for Screen 2.
 */
function showEssayGenerationError(result) {
  showNavbar();
  history.pushState({}, '', '/essays/generate');
  document.title = 'Personal Statement Generation Failed — Admissions Officer';

  const msg = (result.error && result.error.message) || "We couldn't create your personal statement draft.";

  renderTemplate(`
    <div class="mb-3">
      <a href="#" class="btn btn-sm btn-link text-muted ps-0" id="btn-back-from-error">
        <i class="bi bi-arrow-left me-1"></i>Back to Personal Statements
      </a>
    </div>

    <div class="card shadow-sm p-4 mx-auto" style="max-width:520px;">
      <div class="text-center mb-3">
        <i class="bi bi-exclamation-triangle text-warning fs-1"></i>
      </div>
      <h2 class="h5 fw-semibold mb-2 text-center">Generation failed</h2>
      <p class="text-muted text-center mb-1">We couldn't create your personal statement draft.</p>
      <p class="text-muted small text-center mb-4">Check your internet connection and Gemini API key, then try again.</p>
      <div class="d-flex gap-2 justify-content-center">
        <button class="btn btn-primary" id="btn-try-again-essay">
          <i class="bi bi-arrow-clockwise me-1"></i>Try Again
        </button>
        <a href="#" class="btn btn-outline-secondary" id="btn-back-to-stmts-from-error">
          <i class="bi bi-arrow-left me-1"></i>Back to Personal Statements
        </a>
      </div>
    </div>
  `);

  document.getElementById('btn-try-again-essay').addEventListener('click', () => {
    showEssayGenerating();
  });
  document.getElementById('btn-back-from-error').addEventListener('click', (e) => {
    e.preventDefault();
    appNavigate('/essays');
  });
  document.getElementById('btn-back-to-stmts-from-error').addEventListener('click', (e) => {
    e.preventDefault();
    appNavigate('/essays');
  });
}

/**
 * Screen 3 / Screen 6 — Essay draft view and edit.
 * @param {object} draft - draft object from API
 * @param {boolean} isNew - true if freshly generated (not from list)
 */
function showEssayEditScreen(draft, isNew) {
  showNavbar();
  history.pushState({ page: 'essay-edit', id: draft.id }, '', `/essays/${draft.id}/edit`);
  document.title = 'Edit Personal Statement — Admissions Officer';

  const aiDraftText = draft.aiDraft || '';
  // For new drafts: studentEdit starts prefilled with aiDraft
  const studentEditText = isNew ? (draft.studentEdit || draft.aiDraft || '') : (draft.studentEdit || draft.aiDraft || '');

  // Check for pending localStorage content
  const pendingKey = `ao_essay_pending_${draft.id}`;
  const pendingContent = localStorage.getItem(pendingKey);

  renderTemplate(`
    <div class="mb-3">
      <a href="#" class="btn btn-sm btn-link text-muted ps-0" id="btn-back-to-essays">
        <i class="bi bi-arrow-left me-1"></i>Back to Personal Statements
      </a>
    </div>

    <h2 class="h5 fw-semibold mb-4">
      <i class="bi bi-journal-text me-2"></i>Personal Statement
    </h2>

    <!-- AI Draft read-only card -->
    <div class="card mb-4">
      <div class="card-header fw-semibold">AI-generated Draft</div>
      <div class="card-body">
        <div class="alert alert-warning d-flex align-items-start gap-2 mb-3" role="alert">
          <i class="bi bi-exclamation-triangle-fill mt-1"></i>
          <span>AI-generated draft — heavily rewrite this in your own voice.</span>
        </div>
        <div id="essay-ai-draft-text" class="bg-light p-3 rounded" style="white-space:pre-wrap;line-height:1.7;font-size:0.95rem;">${escapeHtml(aiDraftText)}</div>
        ${_buildEssaySourcesPanel(draft.provenanceUsed || null, 'essay-sources-collapse')}
      </div>
    </div>

    <!-- Pending restore banner -->
    <div id="essay-pending-banner" class="alert alert-info d-flex align-items-center gap-2 mb-3 d-none" role="alert">
      <i class="bi bi-clock-history"></i>
      <span>You have unsaved changes from a previous session.</span>
      <button class="btn btn-sm btn-outline-info ms-auto me-2" id="btn-restore-pending">Restore</button>
      <button class="btn btn-sm btn-outline-secondary" id="btn-discard-pending">Discard</button>
    </div>

    <!-- Student Edit section -->
    <div class="card mb-3">
      <div class="card-header fw-semibold">Your Edit</div>
      <div class="card-body">
        <textarea
          id="essay-textarea"
          class="form-control mb-2"
          rows="20"
          maxlength="10000"
          aria-label="Your essay draft"
        >${escapeHtml(studentEditText)}</textarea>

        <!-- Inline error -->
        <div id="essay-save-error" class="text-danger small mb-2 d-none"></div>

        <!-- Word / char count -->
        <div class="d-flex align-items-center gap-4 mb-3">
          <span>Words: <strong id="essay-word-count">0</strong> / <span id="essay-word-target" class="fw-medium">Target: 500–650</span></span>
          <span class="text-muted small">Characters: <span id="essay-char-count">0</span></span>
        </div>
        <div id="essay-word-status" class="small mb-3"></div>

        <div class="d-flex gap-2 flex-wrap">
          <button class="btn btn-primary" id="btn-save-essay" disabled>
            <i class="bi bi-floppy me-1"></i>Save
          </button>
          <button class="btn btn-outline-secondary" id="btn-discard-essay">Discard Changes</button>
          <button class="btn btn-outline-primary" id="btn-regenerate-essay">
            <i class="bi bi-arrow-clockwise me-1"></i>Regenerate
          </button>
        </div>
      </div>
    </div>
  `);

  // STORY-003a: Wire sources panel collapse toggle
  _wireCollapseToggle('essay-sources-collapse-toggle', 'essay-sources-collapse', 'Sources used in this draft', 'Hide sources');

  const textarea = document.getElementById('essay-textarea');
  const wordCountEl = document.getElementById('essay-word-count');
  const charCountEl = document.getElementById('essay-char-count');
  const wordStatusEl = document.getElementById('essay-word-status');
  const saveBtn = document.getElementById('btn-save-essay');

  // Last saved version for discard
  let lastSavedText = draft.status === 'saved' ? (draft.studentEdit || aiDraftText) : aiDraftText;
  let saveDebounceHandle = null;

  function updateWordCount() {
    const text = textarea.value;
    const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).filter(Boolean).length;
    const chars = text.length;

    wordCountEl.textContent = words;
    charCountEl.textContent = chars.toLocaleString();

    // Color and status
    wordCountEl.className = '';
    if (words === 0) {
      wordStatusEl.textContent = '';
      wordStatusEl.className = 'small mb-3';
    } else if (words < 200) {
      wordCountEl.className = 'text-danger';
      wordStatusEl.textContent = 'Too short';
      wordStatusEl.className = 'small mb-3 text-danger';
    } else if (words < 500) {
      wordCountEl.className = 'text-warning';
      wordStatusEl.textContent = 'Below target';
      wordStatusEl.className = 'small mb-3 text-warning';
    } else if (words <= 650) {
      wordCountEl.className = 'text-success';
      wordStatusEl.textContent = 'On target';
      wordStatusEl.className = 'small mb-3 text-success';
    } else if (words <= 1000) {
      wordCountEl.className = 'text-warning';
      wordStatusEl.textContent = 'Above target';
      wordStatusEl.className = 'small mb-3 text-warning';
    } else {
      wordCountEl.className = 'text-danger';
      wordStatusEl.textContent = 'Too long';
      wordStatusEl.className = 'small mb-3 text-danger';
    }

    // Save button enabled only if non-empty and text has changed from last saved
    saveBtn.disabled = words === 0 || textarea.value === lastSavedText;
  }

  // Initial update
  updateWordCount();

  // Input handler — updates counts in real-time + debounced localStorage save
  textarea.addEventListener('input', () => {
    updateWordCount();
    // Hide inline error on edit
    document.getElementById('essay-save-error').classList.add('d-none');

    // Debounced localStorage persistence
    if (saveDebounceHandle) clearTimeout(saveDebounceHandle);
    saveDebounceHandle = setTimeout(() => {
      localStorage.setItem(pendingKey, textarea.value);
    }, 2000);
  });

  // Restore pending content from localStorage if present
  if (pendingContent && pendingContent !== studentEditText) {
    document.getElementById('essay-pending-banner').classList.remove('d-none');

    document.getElementById('btn-restore-pending').addEventListener('click', () => {
      textarea.value = pendingContent;
      updateWordCount();
      document.getElementById('essay-pending-banner').classList.add('d-none');
    });

    document.getElementById('btn-discard-pending').addEventListener('click', () => {
      localStorage.removeItem(pendingKey);
      document.getElementById('essay-pending-banner').classList.add('d-none');
    });
  }

  // Back to personal statements list — check for unsaved changes
  document.getElementById('btn-back-to-essays').addEventListener('click', async (e) => {
    e.preventDefault();
    const currentText = textarea.value;
    if (currentText !== lastSavedText) {
      const confirmed = await _essayConfirmModal(
        'You have unsaved changes. Leave without saving?',
        '',
        'Leave',
        'Keep editing'
      );
      if (!confirmed) return;
    }
    appNavigate('/essays');
  });

  // Save essay
  saveBtn.addEventListener('click', async () => {
    const text = textarea.value;
    if (!text.trim()) return;

    if (text.length > 10000) {
      const errEl = document.getElementById('essay-save-error');
      errEl.textContent = 'Essay is too long to save. Please shorten it.';
      errEl.classList.remove('d-none');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

    let result;
    if (draft.status === 'draft') {
      result = await saveEssay(draft.id, text);
    } else {
      result = await updateEssay(draft.id, text);
    }

    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="bi bi-floppy me-1"></i>Save';

    if (!result.success) {
      const code = result.error && result.error.code;
      const msg = (result.error && result.error.message) || 'Something went wrong. Please refresh and try again.';

      if (code === 'ESSAY_TOO_LONG') {
        const errEl = document.getElementById('essay-save-error');
        errEl.textContent = 'Essay is too long to save. Please shorten it.';
        errEl.classList.remove('d-none');
      } else {
        showToast(msg, '', 'danger');
      }
      return;
    }

    // Update local state
    const saved = result.data;
    draft.status = 'saved';
    draft.studentEdit = saved.studentEdit;
    draft.wordCount = saved.wordCount;
    lastSavedText = saved.studentEdit;

    // Clear pending localStorage key
    localStorage.removeItem(pendingKey);

    // Success toast
    showToast('Statement saved. <i class="bi bi-check-circle ms-1"></i>', '');

    // Word count warning if out of range
    const wc = saved.wordCount;
    if (wc < 500 || wc > 650) {
      setTimeout(() => {
        showToast(`Note: Your statement is ${wc} words — Common App target is 500–650. You can continue editing.`, '', 'warning');
      }, 300);
    }

    // Navigate to /essays list after save
    setTimeout(() => {
      appNavigate('/essays');
    }, 500);
  });

  // Discard changes
  document.getElementById('btn-discard-essay').addEventListener('click', async () => {
    const confirmed = await _essayConfirmModal(
      'Discard your changes and revert to the last saved version?',
      '',
      'Discard',
      'Keep editing'
    );
    if (!confirmed) return;
    textarea.value = lastSavedText;
    updateWordCount();
    localStorage.removeItem(pendingKey);
  });

  // Regenerate — routes through Screen 2a (provenance modal) per STORY-006 spec AC#30
  document.getElementById('btn-regenerate-essay').addEventListener('click', async () => {
    const confirmed = await _essayConfirmModal(
      'Regenerate will create a new draft using your current profile. Your existing draft stays saved.',
      'Continue?',
      'Regenerate',
      'Cancel'
    );
    if (!confirmed) return;
    // Open provenance modal so student can re-customise selection
    openEssayProvenanceModal();
  });
}

/**
 * Screen 5 — Essays list.
 */
async function showEssaysList() {
  showNavbar();
  history.replaceState({}, '', '/essays');
  document.title = 'Personal Statements — Admissions Officer';

  // Load sections to check if generate is available
  const sectionsResult = await getProfileSections();
  const hasProfile = sectionsResult.success && sectionsResult.data && sectionsResult.data.sections
    ? ((sectionsResult.data.sections.achievements && sectionsResult.data.sections.achievements.count) || 0) +
      ((sectionsResult.data.sections.activities && sectionsResult.data.sections.activities.count) || 0) > 0
    : false;

  const genBtnHtml = hasProfile
    ? `<button class="btn btn-sm btn-primary" id="btn-generate-new-from-list">
        <i class="bi bi-stars me-1"></i>Generate
      </button>`
    : `<button
        class="btn btn-sm btn-outline-secondary disabled"
        tabindex="-1"
        aria-disabled="true"
        data-bs-toggle="tooltip"
        data-bs-placement="top"
        title="Add at least one achievement or activity first"
        id="btn-generate-new-from-list"
      >
        <i class="bi bi-stars me-1"></i>Generate
      </button>`;

  renderTemplate(`
    <div class="mb-3">
      <a href="#" class="btn btn-sm btn-link text-muted ps-0" id="btn-back-to-dash-essays">
        <i class="bi bi-arrow-left me-1"></i>Back to Dashboard
      </a>
    </div>

    <div class="d-flex align-items-center justify-content-between mb-3">
      <h2 class="h5 fw-semibold mb-0">
        <i class="bi bi-journal-text me-2"></i>Personal Statements
      </h2>
      ${genBtnHtml}
    </div>

    <!-- STORY-007: Essay limits banner placeholder -->
    <div id="essay-limits-banner-container"></div>

    <div id="essays-list-content">
      <div class="text-center py-4">
        <div class="spinner-border text-primary spinner-border-sm"></div>
        <span class="ms-2 text-muted">Loading...</span>
      </div>
    </div>
  `);

  document.getElementById('btn-back-to-dash-essays').addEventListener('click', (e) => {
    e.preventDefault();
    appNavigate('/');
  });

  const genBtn = document.getElementById('btn-generate-new-from-list');
  if (genBtn && hasProfile) {
    genBtn.addEventListener('click', () => {
      // Opens provenance modal (Screen 2a) before generation — per STORY-006 spec
      openEssayProvenanceModal();
    });
  }

  // STORY-007: Inject essay limits banner (async, non-blocking)
  if (typeof renderLimitsBanner === 'function') {
    renderLimitsBanner('essay-limits-banner-container', 'essay');
  }

  // Init tooltips on disabled buttons
  document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
    new bootstrap.Tooltip(el);
  });

  const result = await listEssays();
  const listContent = document.getElementById('essays-list-content');
  if (!listContent) return;

  if (!result.success) {
    listContent.innerHTML = `<div class="alert alert-danger">Could not load personal statements. Please refresh and try again.</div>`;
    return;
  }

  const drafts = result.data.drafts || [];
  const total = result.data.total || 0;

  if (total === 0) {
    listContent.innerHTML = `
      <div class="text-center py-5">
        <p class="text-muted mb-3">No statements saved yet.</p>
        <p class="text-muted small">Click <strong>Generate</strong> to create your first draft.</p>
      </div>`;
    return;
  }

  listContent.innerHTML = `
    <p class="text-muted small mb-3">${total} statement${total !== 1 ? 's' : ''} saved</p>
    <div id="essays-cards"></div>`;

  _renderEssayCards(drafts);
}

/**
 * Load a single essay by ID and show edit screen.
 * Used for deep-links to /essays/:id/edit
 */
async function showEssayEditById(id) {
  showNavbar();
  // Fetch the specific draft via GET /api/essays/:id
  const result = await getEssayById(id);
  if (result.success && result.data && result.data.draft) {
    showEssayEditScreen(result.data.draft, false);
    return;
  }
  // Fallback: try listing all essays
  const listResult = await listEssays();
  if (listResult.success && listResult.data && listResult.data.drafts) {
    const draft = listResult.data.drafts.find(d => d.id === id);
    if (draft) {
      showEssayEditScreen(draft, false);
      return;
    }
  }
  // Draft not found
  renderTemplate(`
    <div class="mb-3">
      <a href="#" class="btn btn-sm btn-link text-muted ps-0" id="btn-back-not-found">
        <i class="bi bi-arrow-left me-1"></i>Back to Personal Statements
      </a>
    </div>
    <div class="alert alert-warning">
      <i class="bi bi-exclamation-triangle me-2"></i>Statement not found.
      <a href="#" id="link-back-stmts" class="alert-link ms-2">Back to Personal Statements</a>
    </div>
  `);
  document.getElementById('btn-back-not-found').addEventListener('click', e => { e.preventDefault(); appNavigate('/essays'); });
  document.getElementById('link-back-stmts').addEventListener('click', e => { e.preventDefault(); appNavigate('/essays'); });
}

function _renderEssayCards(drafts) {
  const container = document.getElementById('essays-cards');
  if (!container) return;

  container.innerHTML = drafts.map((draft, idx) => {
    const stmtNum = drafts.length - idx;
    const isLatest = idx === 0;
    const genDate = draft.generatedAt ? new Date(draft.generatedAt).toLocaleString() : '';
    const editDate = draft.editedAt ? new Date(draft.editedAt).toLocaleString() : '';
    const wc = draft.wordCount || 0;

    // Build preview: first 120 chars of studentEdit
    const previewSource = draft.studentEdit || draft.aiDraft || '';
    const isAiOnly = draft.studentEdit === draft.aiDraft;
    let previewText = previewSource.replace(/\s+/g, ' ').trim();
    const truncated = previewText.length > 120;
    previewText = previewText.slice(0, 120) + (truncated ? '…' : '');
    const previewHtml = isAiOnly
      ? `<em class="text-muted">(AI draft)</em> ${escapeHtml(previewText)}`
      : escapeHtml(previewText);

    return `
      <div class="card mb-3" id="essay-card-${escapeHtml(draft.id)}">
        <div class="card-body">
          <div class="d-flex align-items-center justify-content-between mb-2">
            <h3 class="h6 fw-semibold mb-0">
              Statement #${stmtNum}${isLatest ? ' <span class="badge bg-success ms-2">Latest</span>' : ''}
            </h3>
            <span class="badge bg-secondary">Saved</span>
          </div>
          <p class="text-muted small mb-1">Generated: ${escapeHtml(genDate)}</p>
          <p class="text-muted small mb-1">Last edited: ${escapeHtml(editDate)}</p>
          <p class="text-muted small mb-1">Word count: ${wc}</p>
          <p class="text-muted small mb-3" style="font-style:italic;">"${previewHtml}"</p>
          <div class="d-flex gap-2" id="essay-card-buttons-${escapeHtml(draft.id)}">
            <button class="btn btn-sm btn-outline-primary btn-edit-essay" data-id="${escapeHtml(draft.id)}">
              <i class="bi bi-pencil me-1"></i>Edit
            </button>
            <button class="btn btn-sm btn-outline-danger btn-delete-essay" data-id="${escapeHtml(draft.id)}">
              <i class="bi bi-trash me-1"></i>Delete
            </button>
          </div>
        </div>
      </div>`;
  }).join('');

  // Wire edit buttons
  container.querySelectorAll('.btn-edit-essay').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const r = await listEssays();
      if (!r.success) { showToast('Could not load statement.', '', 'danger'); return; }
      const draft = (r.data.drafts || []).find(d => d.id === id);
      if (!draft) { showToast('Statement not found.', '', 'danger'); return; }
      showEssayEditScreen(draft, false);
    });
  });

  // Wire delete buttons — show inline confirmation
  container.querySelectorAll('.btn-delete-essay').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const confirmed = await _essayConfirmModal(
        'Delete this personal statement? This cannot be undone.',
        '',
        'Delete',
        'Cancel'
      );
      if (!confirmed) return;

      const r = await deleteEssay(id);
      if (!r.success) {
        const msg = (r.error && r.error.message) || 'Failed to delete. Please try again.';
        showToast(msg, '', 'danger');
        return;
      }

      // Remove card from DOM
      const card = document.getElementById(`essay-card-${id}`);
      if (card) card.remove();
      showToast('Statement deleted.');

      // If no more cards, show empty state
      const remaining = document.querySelectorAll('[id^="essay-card-"]');
      if (remaining.length === 0) {
        const listContent = document.getElementById('essays-list-content');
        if (listContent) {
          listContent.innerHTML = `
            <div class="text-center py-5">
              <p class="text-muted mb-3">No statements saved yet.</p>
              <p class="text-muted small">Click <strong>Generate New Statement</strong> to create your first draft.</p>
            </div>`;
        }
      }
    });
  });
}

/**
 * Helper: show a Bootstrap confirm modal and return a promise that resolves to true/false.
 * @param {string} message - main message
 * @param {string} subMessage - optional sub-message
 * @param {string} confirmLabel - confirm button label
 * @param {string} cancelLabel - cancel button label
 * @returns {Promise<boolean>}
 */
function _essayConfirmModal(message, subMessage, confirmLabel, cancelLabel) {
  return new Promise(resolve => {
    const existingModal = document.getElementById('essay-confirm-modal');
    if (existingModal) existingModal.remove();

    const modalHtml = `
      <div class="modal fade" id="essay-confirm-modal" tabindex="-1" aria-modal="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-body pt-4 pb-2 px-4">
              <p class="fw-medium mb-1">${escapeHtml(message)}</p>
              ${subMessage ? `<p class="text-muted small">${escapeHtml(subMessage)}</p>` : ''}
            </div>
            <div class="modal-footer border-0">
              <button class="btn btn-outline-secondary" id="essay-modal-cancel">${escapeHtml(cancelLabel)}</button>
              <button class="btn btn-primary" id="essay-modal-confirm">${escapeHtml(confirmLabel)}</button>
            </div>
          </div>
        </div>
      </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modalEl = document.getElementById('essay-confirm-modal');
    const bsModal = new bootstrap.Modal(modalEl);
    bsModal.show();

    document.getElementById('essay-modal-confirm').addEventListener('click', () => {
      bsModal.hide();
      resolve(true);
    });
    document.getElementById('essay-modal-cancel').addEventListener('click', () => {
      bsModal.hide();
      resolve(false);
    });
    modalEl.addEventListener('hidden.bs.modal', () => {
      modalEl.remove();
    });
  });
}

// ─── Settings Screen ──────────────────────────────────────────────────────────

/**
 * Screen 6 — Settings page.
 * Accessible via gear icon in navbar. URL: /settings.
 */
async function showSettings() {
  history.replaceState({}, '', '/settings');
  document.title = 'Settings — Admissions Officer';

  // Show loading state
  renderTemplate(`
    <div class="text-center py-5">
      <div class="spinner-border text-primary"></div>
      <p class="text-muted mt-2">Loading settings...</p>
    </div>
  `);

  const result = await getSettings();

  if (!result.success) {
    renderTemplate(`
      <div class="alert alert-danger d-flex align-items-center gap-3" role="alert">
        <i class="bi bi-exclamation-triangle-fill fs-4"></i>
        <div>
          Could not load settings. Check that the <code>.env</code> file is accessible.
          <button id="btn-retry-settings" class="btn btn-sm btn-outline-danger ms-3">Retry</button>
        </div>
      </div>
    `);
    document.getElementById('btn-retry-settings').addEventListener('click', showSettings);
    return;
  }

  const s = result.data;

  renderTemplate(`
    <div class="mb-3">
      <a href="/" class="btn btn-sm btn-link text-muted ps-0" id="btn-settings-back">
        <i class="bi bi-arrow-left me-1"></i>Back to Dashboard
      </a>
    </div>

    <h2 class="h4 fw-semibold mb-4">Settings</h2>

    <div id="settings-alert-zone" class="mb-3"></div>

    <!-- STORY-007: Word Limits & College Guidelines -->
    <h6 class="text-muted text-uppercase small mb-2">Word Limits &amp; College Guidelines</h6>
    <div id="limits-settings-panel" class="mb-4"></div>

    <h6 class="text-muted text-uppercase small mb-2">Server</h6>
    <div class="card mb-4 shadow-sm">
      <div class="card-body">
        <label class="form-label fw-semibold">PORT</label>
        <input type="text" id="settings-port" class="form-control font-monospace" value="${escapeHtml(String(s.port || 3000))}" maxlength="5">
        <div class="invalid-feedback" id="settings-port-error"></div>
        <div class="form-text">Used when the app starts. Requires restart.</div>
      </div>
    </div>

    <h6 class="text-muted text-uppercase small mb-2">Data Storage</h6>
    <div class="card mb-4 shadow-sm">
      <div class="card-body">
        <label class="form-label fw-semibold">DATA_DIR</label>
        <input
          type="text"
          id="settings-data-dir"
          class="form-control font-monospace bg-light"
          value="${escapeHtml(s.dataDir || '')}"
          readonly
          tabindex="-1"
          title="Use setup to change data directory."
          data-bs-toggle="tooltip"
          data-bs-placement="top"
        >
        <div class="form-text">Read-only — change requires re-running setup.</div>
      </div>
    </div>

    <h6 class="text-muted text-uppercase small mb-2">AI</h6>
    <div class="card mb-4 shadow-sm">
      <div class="card-body">
        <div class="mb-3">
          <label class="form-label fw-semibold">GEMINI_MODEL</label>
          <input type="text" id="settings-model" class="form-control font-monospace" value="${escapeHtml(s.geminiModel || '')}" maxlength="60">
          <div class="invalid-feedback" id="settings-model-error"></div>
        </div>
        <div class="mb-1">
          <label class="form-label fw-semibold">GEMINI_API_KEY</label>
          <div class="input-group">
            <input
              type="password"
              id="settings-api-key"
              class="form-control font-monospace"
              placeholder="${s.geminiApiKeySet ? '(key is set — click Show to reveal)' : '(not set)'}"
              maxlength="256"
              data-key-loaded="false"
            >
            <button class="btn btn-outline-secondary" type="button" id="btn-toggle-key">Show</button>
          </div>
          <div class="invalid-feedback" id="settings-key-error"></div>
          <div class="form-text">Stored in <code>.env</code>. Never shared.</div>
        </div>
      </div>
    </div>

    <div class="d-flex gap-2 flex-wrap mb-5">
      <button class="btn btn-primary" id="btn-save-settings">
        <i class="bi bi-floppy me-1"></i>Save Settings
      </button>
      <button class="btn btn-outline-secondary" id="btn-export-config">
        <i class="bi bi-download me-1"></i>Export Config
      </button>
    </div>

    <h6 class="text-muted text-uppercase small mb-2">Profile Export</h6>
    <div class="card mb-4 shadow-sm">
      <div class="card-body">
        <p class="text-muted small mb-3">Download your profile data as JSON or PDF, or generate a shareable link for advisors and recommenders.</p>
        <button class="btn btn-outline-primary" id="btn-go-to-export">
          <i class="bi bi-box-arrow-up-right me-1"></i>Go to Export Page
        </button>
      </div>
    </div>
  `);

  // ── STORY-007: Render limits panel ────────────────────────────────────────
  if (typeof renderLimitsSettingsPanel === 'function') {
    await renderLimitsSettingsPanel();
  }

  // ── STORY-007: Back to Dashboard with unsaved-changes guard ──────────────
  document.getElementById('btn-settings-back').addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof limitsHasUnsavedChanges === 'function' && limitsHasUnsavedChanges()) {
      const confirmed = confirm('You have unsaved settings changes. Leave without saving?');
      if (!confirmed) return;
    }
    if (typeof limitsResetDirtyState === 'function') limitsResetDirtyState();
    appNavigate('/');
  });

  // Init tooltips
  document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
    new bootstrap.Tooltip(el);
  });

  // Show/Hide API key toggle
  const keyInput = document.getElementById('settings-api-key');
  const toggleBtn = document.getElementById('btn-toggle-key');
  let keyLoaded = false;

  toggleBtn.addEventListener('click', async () => {
    if (keyInput.type === 'password') {
      // Load key if not yet loaded
      if (!keyLoaded) {
        toggleBtn.textContent = '...';
        toggleBtn.disabled = true;
        const keyResult = await getSettingsKey();
        toggleBtn.disabled = false;
        if (keyResult.success) {
          keyInput.value = keyResult.data.geminiApiKey || '';
          keyLoaded = true;
          keyInput.dataset.keyLoaded = 'true';
        } else {
          showAlert('danger', 'Could not load API key.', 'settings-alert-zone', true);
          toggleBtn.textContent = 'Show';
          return;
        }
      }
      keyInput.type = 'text';
      toggleBtn.textContent = 'Hide';
    } else {
      keyInput.type = 'password';
      toggleBtn.textContent = 'Show';
    }
  });

  // Save Settings
  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const portEl = document.getElementById('settings-port');
    const modelEl = document.getElementById('settings-model');

    // Clear previous errors
    [portEl, modelEl, keyInput].forEach(el => {
      el.classList.remove('is-invalid');
    });
    document.getElementById('settings-alert-zone').innerHTML = '';

    let valid = true;
    const portVal = portEl.value.trim();
    const portNum = parseInt(portVal, 10);

    if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
      portEl.classList.add('is-invalid');
      document.getElementById('settings-port-error').textContent = 'Port must be a number between 1024 and 65535.';
      valid = false;
    }

    const modelVal = modelEl.value.trim();
    if (!modelVal || modelVal.length > 60) {
      modelEl.classList.add('is-invalid');
      document.getElementById('settings-model-error').textContent = 'Model name is required (max 60 characters).';
      valid = false;
    }

    if (!valid) return;

    const payload = { port: portNum, geminiModel: modelVal };

    // Only include API key if the user loaded and potentially edited it
    if (keyInput.dataset.keyLoaded === 'true' && keyInput.value.trim()) {
      payload.geminiApiKey = keyInput.value.trim();
    }

    const saveBtn = document.getElementById('btn-save-settings');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

    const saveResult = await saveSettings(payload);

    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="bi bi-floppy me-1"></i>Save Settings';

    if (!saveResult.success) {
      const msg = (saveResult.error && saveResult.error.message) || 'Failed to save settings.';
      showAlert('danger', `Failed to save settings: ${escapeHtml(msg)}`, 'settings-alert-zone', true);
      return;
    }

    showToast('Settings saved.');

    if (saveResult.data && saveResult.data.portChanged) {
      const zone = document.getElementById('settings-alert-zone');
      if (zone) {
        zone.innerHTML = `<div class="alert alert-info d-flex align-items-center gap-2" role="alert">
          <i class="bi bi-info-circle-fill"></i>
          <span>Port change will take effect after restarting <code>npx ao</code>.</span>
        </div>`;
      }
    }
  });

  // Export Config
  document.getElementById('btn-export-config').addEventListener('click', () => {
    window.location.href = '/api/settings/export';
  });

  // Go to Export Page
  const btnGoExport = document.getElementById('btn-go-to-export');
  if (btnGoExport) {
    btnGoExport.addEventListener('click', () => {
      if (typeof limitsHasUnsavedChanges === 'function' && limitsHasUnsavedChanges()) {
        const confirmed = confirm('You have unsaved settings changes. Leave without saving?');
        if (!confirmed) return;
      }
      if (typeof limitsResetDirtyState === 'function') limitsResetDirtyState();
      appNavigate('/export');
    });
  }
}

// ─── Section View Placeholder ──────────────────────────────────────────────────

/**
 * Show a section view. For sections 1–4, shows items list.
 * For sections 5–6 (impact_statements, essays), shows placeholder until built.
 * @param {string} sectionName - URL slug (e.g. 'achievements')
 * @param {object} student
 */
async function showSectionPlaceholder(sectionName, student) {
  // Redirect impact_statements and essays to their proper routes
  if (sectionName === 'impact_statements') {
    appNavigate('/impact-statements');
    return;
  }
  if (sectionName === 'essays') {
    appNavigate('/essays');
    return;
  }

  // Route to proper detail pages
  if (sectionName === 'academic') {
    await showAcademicDetail();
  } else if (sectionName === 'tests') {
    await showTestsDetail();
  } else if (sectionName === 'achievements') {
    await showAchievementsDetail();
  } else if (sectionName === 'activities') {
    await showActivitiesDetail();
  } else {
    // Unknown section — show generic placeholder
    history.replaceState({}, '', `/section/${sectionName}`);
    document.title = `${capitalize(sectionName)} — Admissions Officer`;
    renderTemplate(`
      <div class="mb-3">
        <button class="btn btn-sm btn-link text-muted ps-0" id="btn-back-section">
          <i class="bi bi-arrow-left me-1"></i>Back to Dashboard
        </button>
      </div>
      <h2 class="h5 fw-semibold mb-3">${escapeHtml(capitalize(sectionName))}</h2>
      <div class="alert alert-secondary">Section not recognized.</div>
    `);
    document.getElementById('btn-back-section').addEventListener('click', () => appNavigate('/'));
  }
}

// ─── Section Detail: Academic ─────────────────────────────────────────────────

async function showAcademicDetail() {
  history.replaceState({}, '', '/section/academic');
  document.title = 'Academic — Admissions Officer';

  renderTemplate(`
    <div class="mb-3">
      <button class="btn btn-sm btn-link text-muted ps-0" id="btn-back-section">
        <i class="bi bi-arrow-left me-1"></i>Back to Dashboard
      </button>
    </div>
    <h2 class="h5 fw-semibold mb-4">Academic</h2>
    <div id="section-content">
      <div class="text-center py-4">
        <div class="spinner-border text-primary spinner-border-sm"></div>
        <span class="ms-2 text-muted">Loading...</span>
      </div>
    </div>
  `);

  document.getElementById('btn-back-section').addEventListener('click', () => appNavigate('/'));

  const result = await getProfileSection('academic');
  const contentEl = document.getElementById('section-content');
  if (!contentEl) return;

  if (!result.success) {
    contentEl.innerHTML = `<div class="alert alert-danger"><i class="bi bi-exclamation-triangle me-2"></i>Could not load academic data.</div>`;
    return;
  }

  const d = result.data.data;
  const hasAny = d.gpa !== null || d.courses.length > 0 || d.apExams.length > 0;

  if (!hasAny) {
    contentEl.innerHTML = `
      <div class="text-center py-5 text-muted">
        <i class="bi bi-book fs-1 d-block mb-3"></i>
        <p>No academic data yet.</p>
        <p class="small">Upload a transcript or add data manually from the dashboard.</p>
      </div>`;
    return;
  }

  // Summary stats row
  const summaryCards = [];
  if (d.gpa !== null) {
    const scale = d.gpaScale ? `/${d.gpaScale}` : '';
    summaryCards.push(`<div class="col"><div class="card text-center p-3 shadow-sm h-100"><p class="text-muted small mb-1">GPA</p><p class="fs-5 fw-bold mb-0">${escapeHtml(String(d.gpa))}${escapeHtml(scale)}</p></div></div>`);
  }
  if (d.graduationYear) {
    summaryCards.push(`<div class="col"><div class="card text-center p-3 shadow-sm h-100"><p class="text-muted small mb-1">Class of</p><p class="fs-5 fw-bold mb-0">${escapeHtml(String(d.graduationYear))}</p></div></div>`);
  }
  if (d.classRank) {
    const rankStr = d.classSize ? `${d.classRank} / ${d.classSize}` : String(d.classRank);
    summaryCards.push(`<div class="col"><div class="card text-center p-3 shadow-sm h-100"><p class="text-muted small mb-1">Class Rank</p><p class="fs-5 fw-bold mb-0">${escapeHtml(rankStr)}</p></div></div>`);
  }
  if (d.courses.length > 0) {
    summaryCards.push(`<div class="col"><div class="card text-center p-3 shadow-sm h-100"><p class="text-muted small mb-1">Total Courses</p><p class="fs-5 fw-bold mb-0">${d.courses.length}</p></div></div>`);
  }

  const summaryHtml = summaryCards.length > 0
    ? `<div class="row row-cols-2 row-cols-sm-4 g-3 mb-4">${summaryCards.join('')}</div>`
    : '';

  if (d.school) {
    summaryCards.unshift(); // keep school as text
  }

  // Build a map from linked course name → exam score for inline display in courses table
  const examScoresByCourse = {};
  for (const e of d.apExams) {
    const key = String(e.linkedCourseName || '').toLowerCase().trim();
    if (key) {
      if (!examScoresByCourse[key]) examScoresByCourse[key] = [];
      examScoresByCourse[key].push(e);
    }
  }

  // AP/IB Exam scores section — load from dedicated endpoint for full CRUD
  const schoolLine = d.school ? `<p class="text-muted small mb-4"><i class="bi bi-building me-1"></i>${escapeHtml(d.school)}</p>` : '';

  contentEl.innerHTML = `
    ${schoolLine}
    ${summaryHtml}
    <div id="courses-section"></div>
    <div id="exam-scores-section"></div>
  `;

  // Render courses list with full CRUD and source badges
  await _renderCoursesList();

  // Wire "Add AP/IB Score" button and render scores
  await _renderExamScoresSection(d.courses || []);
}

/**
 * Build the source badge HTML for a course/achievement/activity item.
 * @param {object|string|null} source - item's source field
 * @returns {string} HTML badge
 */
function _buildSourceBadge(source) {
  // Handle null/undefined — default to manually added
  if (!source) {
    return `<span class="badge bg-light text-muted border" title="Manually added">Manually added</span>`;
  }
  // Handle legacy string source (e.g. "transcript-final.pdf" stored directly)
  if (typeof source === 'string') {
    if (source.trim()) {
      return `<span class="badge bg-info text-dark" title="Extracted from ${escapeHtml(source)}">From ${escapeHtml(source)}</span>`;
    }
    return `<span class="badge bg-light text-muted border" title="Manually added">Manually added</span>`;
  }
  // Handle proper source object with type === 'manual'
  if (source.type === 'manual') {
    return `<span class="badge bg-light text-muted border" title="Manually added">Manually added</span>`;
  }
  // Handle extracted source with documentName
  if (source.type === 'extracted' && source.documentName) {
    return `<span class="badge bg-info text-dark" title="Extracted from ${escapeHtml(source.documentName)}">From ${escapeHtml(source.documentName)}</span>`;
  }
  // Fallback: extracted but documentName missing — show generic extracted badge
  if (source.type === 'extracted') {
    return `<span class="badge bg-info text-dark" title="Extracted from document">From document</span>`;
  }
  // Default fallback
  return `<span class="badge bg-light text-muted border" title="Manually added">Manually added</span>`;
}

/**
 * Render the courses list with source badges, inline edit/delete for the Academic detail page.
 */
async function _renderCoursesList() {
  const sectionEl = document.getElementById('courses-section');
  if (!sectionEl) return;

  // Load courses with source tracking
  const result = await getCourses();
  let courses = [];
  if (result.success && result.data && Array.isArray(result.data.courses)) {
    courses = result.data.courses;
  }

  const headerHtml = `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h3 class="h6 fw-semibold mb-0">Courses <span class="badge bg-secondary ms-1">${courses.length}</span></h3>
      <button class="btn btn-sm btn-outline-secondary" id="btn-add-course-manual">
        <i class="bi bi-plus-circle me-1"></i>Add manually
      </button>
    </div>`;

  if (courses.length === 0) {
    sectionEl.innerHTML = `
      ${headerHtml}
      <div class="alert alert-info" role="alert">
        No courses added yet. Upload a transcript to extract courses automatically, or add them manually.
        <button class="btn btn-sm btn-outline-secondary ms-2" id="btn-add-course-empty">
          <i class="bi bi-plus-circle me-1"></i>Add course manually
        </button>
      </div>`;
    sectionEl.querySelector('#btn-add-course-manual').addEventListener('click', () => openCourseEditForm(null, null, () => _renderCoursesList()));
    sectionEl.querySelector('#btn-add-course-empty').addEventListener('click', () => openCourseEditForm(null, null, () => _renderCoursesList()));
    return;
  }

  const listItems = courses.map(c => _renderCourseListItem(c)).join('');

  sectionEl.innerHTML = `
    ${headerHtml}
    <ul class="list-group mb-4" id="courses-list">
      ${listItems}
    </ul>`;

  sectionEl.querySelector('#btn-add-course-manual').addEventListener('click', () => openCourseEditForm(null, null, () => _renderCoursesList()));

  _wireCourseItemEvents(sectionEl);
}

/**
 * Render a single course list-group item HTML.
 */
function _renderCourseListItem(c) {
  const id = c.id || '';
  const name = escapeHtml(c.name || c.courseName || '—');
  const grade = c.grade || null;
  const score = (c.score !== undefined && c.score !== null) ? c.score : null;
  const term = c.term || null;
  const level = c.level || null;

  // Grade badge color
  let gradeBadgeClass = 'bg-secondary';
  if (grade) {
    const g = grade.toUpperCase();
    if (g.startsWith('A')) gradeBadgeClass = 'bg-success';
    else if (g.startsWith('B')) gradeBadgeClass = 'bg-primary';
    else if (g.startsWith('C')) gradeBadgeClass = 'bg-warning text-dark';
    else if (g.startsWith('D') || g.startsWith('F')) gradeBadgeClass = 'bg-danger';
  }

  const gradeBadge = grade ? `<span class="badge ${gradeBadgeClass} me-1">${escapeHtml(grade)}</span>` : '';

  // Level badge
  const levelBadge = level ? `<span class="badge bg-light text-dark border me-1">${escapeHtml(level)}</span>` : '';

  // Score text
  const scoreText = score !== null ? `<span class="text-muted small me-2">${escapeHtml(String(score))}</span>` : '';

  // Term text
  const termText = term ? `<span class="text-muted small me-2">${escapeHtml(term)}</span>` : '';

  // Source badge
  const sourceBadge = _buildSourceBadge(c.source);

  return `
    <li class="list-group-item list-group-item-action" id="course-item-${escapeHtml(id)}" data-course-id="${escapeHtml(id)}">
      <div class="d-flex justify-content-between align-items-start">
        <div class="flex-grow-1">
          <strong>${name}</strong>
          <div class="mt-1">
            ${gradeBadge}${levelBadge}${scoreText}${termText}
          </div>
          <div class="mt-1">
            ${sourceBadge}
          </div>
        </div>
        <div class="d-flex gap-1 flex-shrink-0 ms-2">
          ${id ? `<button class="btn btn-sm btn-outline-secondary btn-edit-course" data-course-id="${escapeHtml(id)}" aria-label="Edit ${name}">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger btn-delete-course" data-course-id="${escapeHtml(id)}" aria-label="Delete ${name}">
            <i class="bi bi-trash"></i>
          </button>` : `<span class="text-muted small fst-italic">Legacy</span>`}
        </div>
      </div>
      ${id ? `<div class="course-edit-form d-none mt-2" id="course-edit-form-${escapeHtml(id)}"></div>
      <div class="course-delete-confirm d-none mt-2" id="course-delete-confirm-${escapeHtml(id)}"></div>` : ''}
    </li>`;
}

/**
 * Wire edit and delete button events on the courses section.
 */
function _wireCourseItemEvents(container) {
  // Get current courses data for inline operations
  container.querySelectorAll('.btn-edit-course').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.courseId;
      const item = container.querySelector(`#course-item-${id}`);
      if (!item) return;

      // Close any other open forms first
      container.querySelectorAll('.course-edit-form:not(.d-none), .course-delete-confirm:not(.d-none)').forEach(el => el.classList.add('d-none'));

      // Fetch fresh data
      const r = await getCourses();
      const courses = (r.success && r.data && r.data.courses) ? r.data.courses : [];
      const course = courses.find(c => c.id === id);
      if (!course) {
        showToast('This course no longer exists. Refresh the page.', '', 'danger');
        return;
      }

      openCourseEditForm(id, course, () => _renderCoursesList(), container);
    });
  });

  container.querySelectorAll('.btn-delete-course').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.courseId;
      const item = container.querySelector(`#course-item-${id}`);
      if (!item) return;

      // Close other forms
      container.querySelectorAll('.course-edit-form:not(.d-none), .course-delete-confirm:not(.d-none)').forEach(el => el.classList.add('d-none'));

      // Show inline delete confirmation
      const confirmEl = item.querySelector(`#course-delete-confirm-${id}`);
      const courseName = item.querySelector('strong') ? item.querySelector('strong').textContent : 'this course';

      confirmEl.innerHTML = `
        <div class="alert alert-warning py-2 px-3 mb-0">
          <span>Delete <strong>${escapeHtml(courseName)}</strong>? This cannot be undone.</span>
          <div class="mt-2 d-flex gap-2">
            <button class="btn btn-sm btn-danger btn-confirm-delete-course">Confirm delete</button>
            <button class="btn btn-sm btn-outline-secondary btn-cancel-delete-course">Cancel</button>
          </div>
        </div>`;
      confirmEl.classList.remove('d-none');

      confirmEl.querySelector('.btn-cancel-delete-course').addEventListener('click', () => {
        confirmEl.classList.add('d-none');
        confirmEl.innerHTML = '';
      });

      confirmEl.querySelector('.btn-confirm-delete-course').addEventListener('click', async () => {
        const deleteResult = await deleteCourse(id);
        if (deleteResult.success) {
          showToast('Course deleted.', '', 'success');
          await _renderCoursesList();
        } else {
          confirmEl.classList.add('d-none');
          confirmEl.innerHTML = '';
          const errMsg = (deleteResult.error && deleteResult.error.code === 'COURSE_NOT_FOUND')
            ? 'This course no longer exists. Refresh the page.'
            : 'Could not delete course. Please try again.';
          showToast(errMsg, '', 'danger');
        }
      });
    });
  });
}

/**
 * Open an inline course edit/create form.
 * @param {string|null} id - course UUID (null for create)
 * @param {object|null} course - existing course data (null for create)
 * @param {function} onSuccess - callback to run after save
 * @param {Element|null} container - optional container to find form in (for inline edit)
 */
function openCourseEditForm(id, course, onSuccess, container) {
  // For create mode: show a modal
  if (!id) {
    _openCourseModal(null, null, onSuccess);
    return;
  }

  // For edit mode: inline within the list item
  if (!container) container = document.getElementById('courses-section');
  const formEl = container ? container.querySelector(`#course-edit-form-${id}`) : null;
  if (!formEl) {
    // Fallback to modal
    _openCourseModal(id, course, onSuccess);
    return;
  }

  formEl.innerHTML = _buildCourseFormHtml(course);
  formEl.classList.remove('d-none');

  formEl.querySelector('.btn-cancel-course-edit').addEventListener('click', () => {
    formEl.classList.add('d-none');
    formEl.innerHTML = '';
  });

  formEl.querySelector('.btn-save-course-edit').addEventListener('click', async () => {
    const errEl = formEl.querySelector('.course-form-error');
    errEl.classList.add('d-none');
    errEl.textContent = '';

    const nameEl = formEl.querySelector('.cf-name');
    const gradeEl = formEl.querySelector('.cf-grade');
    const scoreEl = formEl.querySelector('.cf-score');
    const termEl = formEl.querySelector('.cf-term');
    const levelEl = formEl.querySelector('.cf-level');

    // Client-side validation
    if (!nameEl.value.trim()) {
      nameEl.classList.add('is-invalid');
      nameEl.nextElementSibling.textContent = 'Course name is required.';
      return;
    }
    nameEl.classList.remove('is-invalid');
    if (scoreEl.value.trim()) {
      const s = parseFloat(scoreEl.value);
      if (isNaN(s) || s < 0 || s > 100) {
        scoreEl.classList.add('is-invalid');
        scoreEl.nextElementSibling.textContent = 'Score must be a number between 0 and 100.';
        return;
      }
    }
    scoreEl.classList.remove('is-invalid');

    const payload = {
      name: nameEl.value.trim(),
      grade: gradeEl.value.trim() || null,
      score: scoreEl.value.trim() ? parseFloat(scoreEl.value) : null,
      term: termEl.value.trim() || null,
      level: levelEl.value || 'Regular',
    };

    const saveResult = await updateCourse(id, payload);
    if (saveResult.success) {
      formEl.classList.add('d-none');
      formEl.innerHTML = '';
      if (typeof onSuccess === 'function') onSuccess();
    } else {
      const msg = saveResult.error ? saveResult.error.message : 'Could not save. Please try again.';
      errEl.textContent = msg;
      errEl.classList.remove('d-none');
    }
  });
}

/**
 * Open a Bootstrap modal for creating/editing a course.
 */
function _openCourseModal(id, course, onSuccess) {
  const existingModal = document.getElementById('modal-course-edit');
  if (existingModal) existingModal.remove();

  const title = id ? 'Edit Course' : 'Add Course Manually';

  const modalHtml = `
    <div class="modal fade" id="modal-course-edit" tabindex="-1" aria-labelledby="courseEditLabel" aria-modal="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="courseEditLabel">${title}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div id="course-modal-error" class="alert alert-danger d-none"></div>
            ${_buildCourseFormHtml(course)}
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="btn-course-modal-save">Save</button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const modalEl = document.getElementById('modal-course-edit');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();

  document.getElementById('btn-course-modal-save').addEventListener('click', async () => {
    const errEl = document.getElementById('course-modal-error');
    errEl.classList.add('d-none');
    errEl.textContent = '';

    const nameEl = modalEl.querySelector('.cf-name');
    const gradeEl = modalEl.querySelector('.cf-grade');
    const scoreEl = modalEl.querySelector('.cf-score');
    const termEl = modalEl.querySelector('.cf-term');
    const levelEl = modalEl.querySelector('.cf-level');

    // Inline validation
    nameEl.classList.remove('is-invalid');
    scoreEl.classList.remove('is-invalid');
    let valid = true;
    if (!nameEl.value.trim()) {
      nameEl.classList.add('is-invalid');
      nameEl.nextElementSibling.textContent = 'Course name is required.';
      valid = false;
    }
    if (scoreEl.value.trim()) {
      const s = parseFloat(scoreEl.value);
      if (isNaN(s) || s < 0 || s > 100) {
        scoreEl.classList.add('is-invalid');
        scoreEl.nextElementSibling.textContent = 'Score must be a number between 0 and 100.';
        valid = false;
      }
    }
    if (!valid) return;

    const payload = {
      name: nameEl.value.trim(),
      grade: gradeEl.value.trim() || null,
      score: scoreEl.value.trim() ? parseFloat(scoreEl.value) : null,
      term: termEl.value.trim() || null,
      level: levelEl.value || 'Regular',
    };

    let saveResult;
    if (id) {
      saveResult = await updateCourse(id, payload);
    } else {
      saveResult = await createCourse(payload);
    }

    if (saveResult.success) {
      modal.hide();
      if (typeof onSuccess === 'function') onSuccess();
    } else {
      const msg = saveResult.error ? saveResult.error.message : 'Could not save. Please try again.';
      errEl.textContent = msg;
      errEl.classList.remove('d-none');
    }
  });

  modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
}

/**
 * Build the HTML for a course edit form (used inline and in modal).
 */
function _buildCourseFormHtml(course) {
  const name = escapeHtml((course && course.name) || '');
  const grade = escapeHtml((course && course.grade) || '');
  const score = (course && course.score !== null && course.score !== undefined) ? escapeHtml(String(course.score)) : '';
  const term = escapeHtml((course && course.term) || '');
  const level = (course && course.level) || 'Regular';

  const levelOptions = ['AP', 'IB', 'Honors', 'Dual Enrollment', 'Regular', 'Other'].map(l =>
    `<option value="${l}" ${level === l ? 'selected' : ''}>${l}</option>`
  ).join('');

  return `
    <div class="course-form-error alert alert-danger d-none mb-2"></div>
    <div class="mb-2">
      <label class="form-label form-label-sm">Course name <span class="text-danger">*</span></label>
      <input type="text" class="form-control form-control-sm cf-name" maxlength="200" value="${name}" placeholder="e.g. AP Calculus BC">
      <div class="invalid-feedback"></div>
    </div>
    <div class="row g-2 mb-2">
      <div class="col-6">
        <label class="form-label form-label-sm">Grade</label>
        <input type="text" class="form-control form-control-sm cf-grade" maxlength="5" value="${grade}" placeholder="e.g. A+">
        <div class="invalid-feedback"></div>
      </div>
      <div class="col-6">
        <label class="form-label form-label-sm">Score (0–100)</label>
        <input type="number" class="form-control form-control-sm cf-score" min="0" max="100" step="0.1" value="${score}" placeholder="e.g. 98">
        <div class="invalid-feedback"></div>
      </div>
    </div>
    <div class="mb-2">
      <label class="form-label form-label-sm">Term</label>
      <input type="text" class="form-control form-control-sm cf-term" maxlength="50" value="${term}" placeholder="e.g. Fall 2022">
      <div class="invalid-feedback"></div>
    </div>
    <div class="mb-2">
      <label class="form-label form-label-sm">Level <span class="text-danger">*</span></label>
      <select class="form-select form-select-sm cf-level">${levelOptions}</select>
    </div>
    <div class="d-flex gap-2 mt-3">
      <button class="btn btn-sm btn-primary btn-save-course-edit">Save</button>
      <button class="btn btn-sm btn-outline-secondary btn-cancel-course-edit">Cancel</button>
    </div>`;
}

/**
 * Render the AP/IB Exam Scores sub-section within Academic detail.
 * Uses GET /api/profile/academic/exam-scores for complete list with IDs.
 */
async function _renderExamScoresSection(courses) {
  const sectionEl = document.getElementById('exam-scores-section');
  if (!sectionEl) return;

  const apExamsHeaderHtml = `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h3 class="h6 fw-semibold mb-0">AP / IB Exam Scores</h3>
      <button class="btn btn-sm btn-outline-secondary" id="btn-add-exam-score">
        <i class="bi bi-plus-circle me-1"></i>Add Score
      </button>
    </div>`;

  // Fetch all scores with IDs
  const scoresResult = await getExamScores();
  let allScores = [];
  if (scoresResult.success) {
    const ap = scoresResult.data.ap || [];
    const ib = scoresResult.data.ib || [];
    allScores = [...ap, ...ib];
  }

  let apExamsTableHtml = '';
  if (allScores.length > 0) {
    const rows = allScores.map(e => {
      const scoreId = escapeHtml(e.id || '');
      const name = escapeHtml(e.courseName || e.subject || e.name || '—');
      const examType = escapeHtml(e.examType || 'AP');
      const score = escapeHtml(String(e.score || '—'));
      const date = escapeHtml(e.dateTaken || e.examDate || e.year || '—');
      const linked = e.linkedCourseName ? `<span class="badge bg-light text-dark border ms-1" title="Linked to course">${escapeHtml(e.linkedCourseName)}</span>` : '';
      const scoreColor = e.examType === 'IB' ? 'bg-info text-dark' : 'bg-danger';
      const editBtn = scoreId ? `<button class="btn btn-sm btn-outline-primary btn-edit-exam-score me-1"
        data-id="${scoreId}"
        data-course-name="${escapeHtml(e.courseName || '')}"
        data-exam-type="${escapeHtml(e.examType || 'AP')}"
        data-score="${escapeHtml(String(e.score || ''))}"
        data-date-taken="${escapeHtml(e.dateTaken || e.examDate || '')}"
        title="Edit exam score"><i class="bi bi-pencil"></i></button>` : '';
      const deleteBtn = scoreId ? `<button class="btn btn-sm btn-outline-danger btn-delete-exam-score-confirm" data-id="${scoreId}" data-course-name="${name}" title="Delete exam score"><i class="bi bi-trash"></i></button>` : '';
      return `<tr id="exam-row-${scoreId}">
        <td>${name}${linked}</td>
        <td><span class="badge bg-secondary">${examType}</span></td>
        <td><span class="badge ${scoreColor}" id="exam-score-val-${scoreId}">${score}</span></td>
        <td>${date}</td>
        <td class="text-nowrap">${editBtn}${deleteBtn}</td>
      </tr>`;
    }).join('');

    apExamsTableHtml = `
      <div class="table-responsive mb-4">
        <table class="table table-hover table-sm">
          <thead class="table-light">
            <tr><th>Subject</th><th>Type</th><th>Score</th><th>Date</th><th></th></tr>
          </thead>
          <tbody id="exam-scores-tbody">${rows}</tbody>
        </table>
      </div>`;
  } else {
    apExamsTableHtml = `<p class="text-muted small mb-4" id="exam-scores-empty">No AP/IB scores added yet.</p>`;
  }

  sectionEl.innerHTML = `${apExamsHeaderHtml}${apExamsTableHtml}`;

  // Wire Add Score button
  const addExamBtn = document.getElementById('btn-add-exam-score');
  if (addExamBtn) {
    addExamBtn.addEventListener('click', () => {
      openAddExamScoreModal(courses, () => _renderExamScoresSection(courses));
    });
  }

  // Wire Edit buttons
  document.querySelectorAll('.btn-edit-exam-score').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const data = {
        courseName: btn.dataset.courseName,
        examType: btn.dataset.examType,
        score: btn.dataset.score,
        dateTaken: btn.dataset.dateTaken,
      };
      openEditExamScoreModal(id, data, courses);
    });
  });

  // Wire Delete buttons (with confirmation modal)
  document.querySelectorAll('.btn-delete-exam-score-confirm').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const courseName = btn.dataset.courseName;
      openDeleteExamScoreModal(id, courseName, courses);
    });
  });
}

/**
 * Open Edit Exam Score Modal.
 */
function openEditExamScoreModal(id, data, courses) {
  const existing = document.getElementById('modal-edit-exam-score');
  if (existing) existing.remove();

  // Convert YYYY-MM to MM/YYYY for display
  let dateDisplay = '';
  if (data.dateTaken) {
    const dt = data.dateTaken.trim();
    const m = dt.match(/^(\d{4})-(\d{2})$/);
    if (m) dateDisplay = `${m[2]}/${m[1]}`;
    else dateDisplay = dt;
  }

  const modalHtml = `
    <div class="modal fade" id="modal-edit-exam-score" tabindex="-1" aria-labelledby="editExamLabel" aria-modal="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="editExamLabel">Edit Exam Score</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div id="edit-exam-alert-zone"></div>
            <form id="form-edit-exam" novalidate>
              <div class="mb-3">
                <label for="ee-course" class="form-label">Course Name <span class="text-danger">*</span></label>
                <input type="text" id="ee-course" class="form-control" maxlength="100" value="${escapeHtml(data.courseName || '')}">
                <div class="invalid-feedback"></div>
              </div>
              <div class="mb-3">
                <label for="ee-type" class="form-label">Exam Type <span class="text-danger">*</span></label>
                <select id="ee-type" class="form-select">
                  <option value="AP" ${data.examType === 'AP' ? 'selected' : ''}>AP (Advanced Placement)</option>
                  <option value="IB" ${data.examType === 'IB' ? 'selected' : ''}>IB (International Baccalaureate)</option>
                </select>
                <div class="invalid-feedback"></div>
              </div>
              <div class="mb-3">
                <label for="ee-score" class="form-label">Score <span class="text-danger">*</span></label>
                <input type="number" id="ee-score" class="form-control" min="1" max="7" step="1" value="${escapeHtml(String(data.score || ''))}">
                <div class="form-text" id="ee-score-hint">${data.examType === 'IB' ? 'IB scores range from 1 to 7.' : 'AP scores range from 1 to 5.'}</div>
                <div class="invalid-feedback"></div>
              </div>
              <div class="mb-3">
                <label for="ee-date" class="form-label">Date Taken <span class="text-muted small">(MM/YYYY, optional)</span></label>
                <input type="text" id="ee-date" class="form-control" maxlength="7" placeholder="MM/YYYY" value="${escapeHtml(dateDisplay)}">
                <div class="invalid-feedback"></div>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="btn-save-edit-exam">Save Changes</button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const modalEl = document.getElementById('modal-edit-exam-score');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();

  // Update score hint when type changes
  const typeEl = document.getElementById('ee-type');
  const scoreEl = document.getElementById('ee-score');
  const hintEl = document.getElementById('ee-score-hint');
  typeEl.addEventListener('change', () => {
    if (typeEl.value === 'IB') {
      hintEl.textContent = 'IB scores range from 1 to 7.';
      scoreEl.max = 7;
    } else {
      hintEl.textContent = 'AP scores range from 1 to 5.';
      scoreEl.max = 5;
    }
  });

  document.getElementById('btn-save-edit-exam').addEventListener('click', async () => {
    const courseEl = document.getElementById('ee-course');
    const dateEl = document.getElementById('ee-date');
    const alertZone = document.getElementById('edit-exam-alert-zone');

    // Clear errors
    [courseEl, typeEl, scoreEl, dateEl].forEach(el => {
      el.classList.remove('is-invalid');
      const fb = el.nextElementSibling && el.nextElementSibling.classList.contains('invalid-feedback') ? el.nextElementSibling : null;
      if (fb) fb.textContent = '';
    });
    alertZone.innerHTML = '';

    let valid = true;
    const examType = typeEl.value;
    const scoreVal = parseInt(scoreEl.value, 10);

    if (!courseEl.value.trim() || courseEl.value.length > 100) {
      courseEl.classList.add('is-invalid');
      const fb = courseEl.nextElementSibling;
      if (fb) fb.textContent = 'Course name is required.';
      valid = false;
    }
    if (isNaN(scoreVal)) {
      scoreEl.classList.add('is-invalid');
      const fb = scoreEl.nextElementSibling && scoreEl.nextElementSibling.classList.contains('invalid-feedback') ? scoreEl.nextElementSibling : scoreEl.parentElement.querySelector('.invalid-feedback');
      if (fb) fb.textContent = 'Score is required and must be a number.';
      valid = false;
    } else if (examType === 'AP' && (scoreVal < 1 || scoreVal > 5)) {
      scoreEl.classList.add('is-invalid');
      const fb = scoreEl.parentElement.querySelector('.invalid-feedback');
      if (fb) fb.textContent = 'Score must be between 1 and 5 for AP.';
      valid = false;
    } else if (examType === 'IB' && (scoreVal < 1 || scoreVal > 7)) {
      scoreEl.classList.add('is-invalid');
      const fb = scoreEl.parentElement.querySelector('.invalid-feedback');
      if (fb) fb.textContent = 'Score must be between 1 and 7 for IB.';
      valid = false;
    }
    if (dateEl.value.trim() && !/^\d{2}\/\d{4}$/.test(dateEl.value.trim())) {
      dateEl.classList.add('is-invalid');
      const fb = dateEl.nextElementSibling;
      if (fb) fb.textContent = 'Date must be in MM/YYYY format.';
      valid = false;
    }
    if (!valid) return;

    const saveBtn = document.getElementById('btn-save-edit-exam');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

    const result = await updateExamScore(id, {
      courseName: courseEl.value.trim(),
      examType,
      score: scoreVal,
      dateTaken: dateEl.value.trim() || null,
    });

    saveBtn.disabled = false;
    saveBtn.innerHTML = 'Save Changes';

    if (result.success) {
      modal.hide();
      showToast('Exam score updated.');
      // Refresh the exam scores section in-place
      await _renderExamScoresSection(courses);
    } else {
      const msg = (result.error && result.error.message) || 'Could not save changes.';
      alertZone.innerHTML = `<div class="alert alert-danger small py-2"><i class="bi bi-exclamation-triangle me-1"></i>Could not save changes: ${escapeHtml(msg)}</div>`;
    }
  });

  modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
}

/**
 * Open Delete Exam Score Confirmation Modal.
 */
function openDeleteExamScoreModal(id, courseName, courses) {
  const existing = document.getElementById('modal-delete-exam-score');
  if (existing) existing.remove();

  const modalHtml = `
    <div class="modal fade" id="modal-delete-exam-score" tabindex="-1" aria-labelledby="deleteExamLabel" aria-modal="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="deleteExamLabel">Delete Exam Score</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div id="delete-exam-alert-zone"></div>
            <p>Are you sure you want to delete the score for <strong>"${escapeHtml(courseName)}"</strong>?</p>
            <p class="text-muted small">This cannot be undone.</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-danger" id="btn-confirm-delete-exam">Delete</button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const modalEl = document.getElementById('modal-delete-exam-score');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();

  document.getElementById('btn-confirm-delete-exam').addEventListener('click', async () => {
    const deleteBtn = document.getElementById('btn-confirm-delete-exam');
    const alertZone = document.getElementById('delete-exam-alert-zone');
    deleteBtn.disabled = true;
    deleteBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Deleting...';

    const result = await deleteExamScore(id);

    if (result.success) {
      modal.hide();
      showToast('Exam score deleted.');
      // Remove row and any linked course badges
      const row = document.getElementById(`exam-row-${id}`);
      if (row) row.remove();
      // Also remove any course row badges linked to this score
      document.querySelectorAll(`[title*="Exam Score"]`).forEach(badge => {
        const rowEl = badge.closest('tr');
        if (rowEl && badge.textContent.trim()) {
          badge.remove();
        }
      });
      // Check if empty
      const tbody = document.getElementById('exam-scores-tbody');
      if (tbody && tbody.children.length === 0) {
        await _renderExamScoresSection(courses);
      }
    } else {
      const code = result.error && result.error.code;
      if (code === 'NOT_FOUND') {
        modal.hide();
        showToast('Item not found. It may have already been deleted.', '', 'warning');
        await _renderExamScoresSection(courses);
      } else {
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = 'Delete';
        alertZone.innerHTML = `<div class="alert alert-danger small py-2"><i class="bi bi-exclamation-triangle me-1"></i>Could not delete exam score. Please try again.</div>`;
      }
    }
  });

  modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
}

// ─── Add AP/IB Exam Score Modal ───────────────────────────────────────────────

/**
 * Open a modal to add an AP or IB exam score.
 * @param {Array} existingCourses - courses from academic profile (for linking)
 * @param {Function} onSuccess - callback when score is saved
 */
function openAddExamScoreModal(existingCourses, onSuccess) {
  const existingModal = document.getElementById('modal-add-exam-score');
  if (existingModal) existingModal.remove();

  // Build course options for linking
  const apIbCourses = existingCourses.filter(c => {
    const level = String(c.level || '').toUpperCase();
    return level === 'AP' || level === 'IB';
  });
  const allCourses = existingCourses;

  const apIbCourseOptions = apIbCourses.map(c =>
    `<option value="${escapeHtml(c.name || c.courseName || '')}">${escapeHtml(c.name || c.courseName || '')}</option>`
  ).join('');

  const allCourseOptions = allCourses.map(c =>
    `<option value="${escapeHtml(c.name || c.courseName || '')}">${escapeHtml(c.name || c.courseName || '')}</option>`
  ).join('');

  const modalHtml = `
    <div class="modal fade" id="modal-add-exam-score" tabindex="-1" aria-labelledby="addExamScoreLabel" aria-modal="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="addExamScoreLabel"><i class="bi bi-award me-2"></i>Add AP / IB Exam Score</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div id="exam-score-alert-zone"></div>

            <div class="mb-3">
              <label class="form-label fw-medium">Entry mode</label>
              <div class="form-check">
                <input class="form-check-input" type="radio" name="examEntryMode" id="mode-linked" value="linked" checked>
                <label class="form-check-label" for="mode-linked">Link score to an existing course</label>
              </div>
              <div class="form-check">
                <input class="form-check-input" type="radio" name="examEntryMode" id="mode-standalone" value="standalone">
                <label class="form-check-label" for="mode-standalone">Add standalone exam score (course not in profile)</label>
              </div>
            </div>

            <!-- Linked mode -->
            <div id="exam-linked-fields">
              <div class="mb-3">
                <label for="exam-linked-course" class="form-label">Course <span class="text-danger">*</span></label>
                <select class="form-select" id="exam-linked-course">
                  <option value="">— Select a course —</option>
                  ${allCourseOptions}
                </select>
                <div class="form-text">Select the course this exam score belongs to.</div>
              </div>
            </div>

            <!-- Standalone mode -->
            <div id="exam-standalone-fields" class="d-none">
              <div class="mb-3">
                <label for="exam-course-name" class="form-label">Exam / Subject Name <span class="text-danger">*</span></label>
                <input type="text" class="form-control" id="exam-course-name" maxlength="100" placeholder="e.g., AP Calculus BC">
              </div>
            </div>

            <div class="mb-3">
              <label for="exam-type" class="form-label">Exam Type <span class="text-danger">*</span></label>
              <select class="form-select" id="exam-type">
                <option value="AP">AP (Advanced Placement)</option>
                <option value="IB">IB (International Baccalaureate)</option>
              </select>
            </div>

            <div class="mb-3">
              <label for="exam-score" class="form-label">Score <span class="text-danger">*</span></label>
              <input type="number" class="form-control" id="exam-score" min="1" max="7" step="1" placeholder="AP: 1–5, IB: 1–7">
              <div class="form-text" id="exam-score-hint">AP scores range from 1 to 5.</div>
            </div>

            <div class="mb-3">
              <label for="exam-date" class="form-label">Exam Date (optional)</label>
              <input type="text" class="form-control" id="exam-date" placeholder="e.g., May 2024 or 2024">
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="btn-save-exam-score">Save Score</button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const modalEl = document.getElementById('modal-add-exam-score');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();

  // Toggle linked/standalone mode
  document.querySelectorAll('input[name="examEntryMode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isLinked = document.getElementById('mode-linked').checked;
      document.getElementById('exam-linked-fields').classList.toggle('d-none', !isLinked);
      document.getElementById('exam-standalone-fields').classList.toggle('d-none', isLinked);
    });
  });

  // Update score hint based on exam type
  document.getElementById('exam-type').addEventListener('change', () => {
    const type = document.getElementById('exam-type').value;
    const hintEl = document.getElementById('exam-score-hint');
    const scoreEl = document.getElementById('exam-score');
    if (type === 'AP') {
      hintEl.textContent = 'AP scores range from 1 to 5.';
      scoreEl.max = 5;
    } else {
      hintEl.textContent = 'IB scores range from 1 to 7.';
      scoreEl.max = 7;
    }
  });

  document.getElementById('btn-save-exam-score').addEventListener('click', async () => {
    const alertZone = document.getElementById('exam-score-alert-zone');
    const isLinked = document.getElementById('mode-linked').checked;
    const examType = document.getElementById('exam-type').value;
    const scoreVal = document.getElementById('exam-score').value.trim();
    const examDate = document.getElementById('exam-date').value.trim();

    let courseName = '';
    let linkedCourseName = null;

    if (isLinked) {
      linkedCourseName = document.getElementById('exam-linked-course').value;
      courseName = linkedCourseName;
      if (!linkedCourseName) {
        alertZone.innerHTML = `<div class="alert alert-danger small py-2">Please select a course to link this score to.</div>`;
        return;
      }
    } else {
      courseName = document.getElementById('exam-course-name').value.trim();
      if (!courseName) {
        alertZone.innerHTML = `<div class="alert alert-danger small py-2">Exam name is required.</div>`;
        return;
      }
    }

    if (!scoreVal || isNaN(parseInt(scoreVal, 10))) {
      alertZone.innerHTML = `<div class="alert alert-danger small py-2">Score is required and must be a number.</div>`;
      return;
    }

    const saveBtn = document.getElementById('btn-save-exam-score');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

    const result = await addExamScore({ examType, courseName, score: parseInt(scoreVal, 10), examDate: examDate || undefined, linkedCourseName: linkedCourseName || undefined });

    saveBtn.disabled = false;
    saveBtn.innerHTML = 'Save Score';

    if (result.success) {
      modal.hide();
      showToast('AP/IB exam score saved');
      if (typeof onSuccess === 'function') onSuccess();
    } else {
      const msg = (result.error && result.error.message) || 'Failed to save score. Please try again.';
      alertZone.innerHTML = `<div class="alert alert-danger small py-2">${escapeHtml(msg)}</div>`;
    }
  });

  modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
}

// ─── Section Detail: Tests ────────────────────────────────────────────────────

async function showTestsDetail() {
  history.replaceState({}, '', '/section/tests');
  document.title = 'Tests — Admissions Officer';

  renderTemplate(`
    <div class="mb-3">
      <button class="btn btn-sm btn-link text-muted ps-0" id="btn-back-section">
        <i class="bi bi-arrow-left me-1"></i>Back to Dashboard
      </button>
    </div>
    <h2 class="h5 fw-semibold mb-4">Tests</h2>
    <div id="section-content">
      <div class="text-center py-4">
        <div class="spinner-border text-primary spinner-border-sm"></div>
        <span class="ms-2 text-muted">Loading...</span>
      </div>
    </div>
  `);

  document.getElementById('btn-back-section').addEventListener('click', () => appNavigate('/'));

  const result = await getProfileSection('tests');
  const contentEl = document.getElementById('section-content');
  if (!contentEl) return;

  if (!result.success) {
    contentEl.innerHTML = `<div class="alert alert-danger"><i class="bi bi-exclamation-triangle me-2"></i>Could not load test data.</div>`;
    return;
  }

  const d = result.data.data;
  const hasAny = d.sat || d.act || d.ap.length > 0 || d.ib.length > 0 || d.other.length > 0;

  if (!hasAny) {
    contentEl.innerHTML = `
      <div class="text-center py-5 text-muted">
        <i class="bi bi-pencil-square fs-1 d-block mb-3"></i>
        <p>No test scores yet.</p>
        <p class="small">Upload a score report or add test results manually from the dashboard.</p>
      </div>`;
    return;
  }

  let html = '';

  // SAT
  if (d.sat) {
    const sat = d.sat;
    const math = sat.score && sat.score.math !== undefined ? sat.score.math : (sat.mathScore !== undefined ? sat.mathScore : null);
    const ebrw = sat.score && sat.score.ebrw !== undefined ? sat.score.ebrw : (sat.ebrwScore !== undefined ? sat.ebrwScore : null);
    const total = sat.score && sat.score.total !== undefined ? sat.score.total : (sat.score && typeof sat.score === 'number' ? sat.score : (sat.totalScore !== undefined ? sat.totalScore : null));
    const dateTaken = sat.testDate || sat.dateTaken || null;

    const satSourceBadge = _buildSourceBadge(sat.source);
    html += `
      <div class="card shadow-sm mb-4">
        <div class="card-header d-flex align-items-center gap-2">
          <span class="fw-semibold">SAT</span>
          ${total !== null ? `<span class="badge bg-primary ms-auto">${escapeHtml(String(total))}</span>` : ''}
        </div>
        <div class="card-body">
          <div class="row g-3">
            ${math !== null ? `<div class="col-sm-4"><p class="text-muted small mb-1">Math</p><p class="fw-bold mb-0">${escapeHtml(String(math))}</p></div>` : ''}
            ${ebrw !== null ? `<div class="col-sm-4"><p class="text-muted small mb-1">EBRW</p><p class="fw-bold mb-0">${escapeHtml(String(ebrw))}</p></div>` : ''}
            ${total !== null ? `<div class="col-sm-4"><p class="text-muted small mb-1">Total</p><p class="fw-bold mb-0">${escapeHtml(String(total))}</p></div>` : ''}
            ${dateTaken ? `<div class="col-sm-4"><p class="text-muted small mb-1">Date</p><p class="mb-0">${escapeHtml(dateTaken)}</p></div>` : ''}
          </div>
          <div class="mt-3">${satSourceBadge}</div>
        </div>
      </div>`;
  }

  // ACT
  if (d.act) {
    const act = d.act;
    const composite = act.score && act.score.composite !== undefined ? act.score.composite : (act.score && typeof act.score === 'number' ? act.score : (act.compositeScore !== undefined ? act.compositeScore : null));
    const dateTaken = act.testDate || act.dateTaken || null;

    const actSourceBadge = _buildSourceBadge(act.source);
    html += `
      <div class="card shadow-sm mb-4">
        <div class="card-header d-flex align-items-center gap-2">
          <span class="fw-semibold">ACT</span>
          ${composite !== null ? `<span class="badge bg-primary ms-auto">${escapeHtml(String(composite))}</span>` : ''}
        </div>
        <div class="card-body">
          <div class="row g-3">
            ${composite !== null ? `<div class="col-sm-4"><p class="text-muted small mb-1">Composite</p><p class="fw-bold mb-0">${escapeHtml(String(composite))}</p></div>` : ''}
            ${dateTaken ? `<div class="col-sm-4"><p class="text-muted small mb-1">Date</p><p class="mb-0">${escapeHtml(dateTaken)}</p></div>` : ''}
          </div>
          <div class="mt-3">${actSourceBadge}</div>
        </div>
      </div>`;
  }

  // AP Exams
  if (d.ap.length > 0) {
    const rows = d.ap.map(e => {
      const name = escapeHtml(e.testName || e.subject || e.name || '—');
      const score = escapeHtml(String(e.score || '—'));
      const date = escapeHtml(e.testDate || e.dateTaken || '—');
      return `<tr><td>${name}</td><td><span class="badge bg-danger">${score}</span></td><td>${date}</td></tr>`;
    }).join('');

    html += `
      <h3 class="h6 fw-semibold mb-3">AP Exam Results</h3>
      <div class="table-responsive mb-4">
        <table class="table table-hover table-sm">
          <thead class="table-light"><tr><th>Exam</th><th>Score</th><th>Date</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // IB Exams
  if (d.ib.length > 0) {
    const rows = d.ib.map(e => {
      const name = escapeHtml(e.testName || e.subject || e.name || '—');
      const score = escapeHtml(String(e.score || '—'));
      const date = escapeHtml(e.testDate || e.dateTaken || '—');
      return `<tr><td>${name}</td><td><span class="badge bg-success">${score}</span></td><td>${date}</td></tr>`;
    }).join('');

    html += `
      <h3 class="h6 fw-semibold mb-3">IB Exam Results</h3>
      <div class="table-responsive mb-4">
        <table class="table table-hover table-sm">
          <thead class="table-light"><tr><th>Exam</th><th>Score</th><th>Date</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // Other tests
  if (d.other.length > 0) {
    const rows = d.other.map(e => {
      const name = escapeHtml(e.testName || e.name || '—');
      const score = escapeHtml(String(e.score || '—'));
      const date = escapeHtml(e.testDate || e.dateTaken || '—');
      return `<tr><td>${name}</td><td>${score}</td><td>${date}</td></tr>`;
    }).join('');

    html += `
      <h3 class="h6 fw-semibold mb-3">Other Tests</h3>
      <div class="table-responsive mb-4">
        <table class="table table-hover table-sm">
          <thead class="table-light"><tr><th>Test</th><th>Score</th><th>Date</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  contentEl.innerHTML = html;
}

// ─── Section Detail: Achievements ────────────────────────────────────────────

async function showAchievementsDetail() {
  history.replaceState({}, '', '/section/achievements');
  document.title = 'Achievements — Admissions Officer';

  renderTemplate(`
    <div class="mb-3">
      <button class="btn btn-sm btn-link text-muted ps-0" id="btn-back-section">
        <i class="bi bi-arrow-left me-1"></i>Back to Dashboard
      </button>
    </div>
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h2 class="h5 fw-semibold mb-0">Achievements</h2>
      <button class="btn btn-sm btn-outline-secondary" id="btn-add-achievement-detail">
        <i class="bi bi-plus-circle me-1"></i>Add manually
      </button>
    </div>
    <div id="section-content">
      <div class="text-center py-4">
        <div class="spinner-border text-primary spinner-border-sm"></div>
        <span class="ms-2 text-muted">Loading...</span>
      </div>
    </div>
  `);

  document.getElementById('btn-back-section').addEventListener('click', () => appNavigate('/'));
  document.getElementById('btn-add-achievement-detail').addEventListener('click', () => {
    openManualEntryModal('achievements', null, () => showAchievementsDetail());
  });

  await _renderAchievementsList();
}

async function _renderAchievementsList() {
  const result = await getProfileSection('achievements');
  const contentEl = document.getElementById('section-content');
  if (!contentEl) return;

  if (!result.success) {
    contentEl.innerHTML = `<div class="alert alert-danger"><i class="bi bi-exclamation-triangle me-2"></i>Could not load achievements.</div>`;
    return;
  }

  const items = result.data.data.items || [];

  if (items.length === 0) {
    contentEl.innerHTML = `
      <div class="text-center py-5 text-muted">
        <i class="bi bi-trophy fs-1 d-block mb-3"></i>
        <p>No achievements yet.</p>
        <button class="btn btn-sm btn-outline-secondary btn-add-ach-empty">
          <i class="bi bi-plus-circle me-1"></i>Add manually
        </button>
      </div>`;
    contentEl.querySelector('.btn-add-ach-empty') && contentEl.querySelector('.btn-add-ach-empty').addEventListener('click', () => {
      openManualEntryModal('achievements', null, () => showAchievementsDetail());
    });
    return;
  }

  const categoryColors = {
    academic: 'bg-primary',
    sports: 'bg-success',
    community: 'bg-info text-dark',
    other: 'bg-secondary',
  };

  const cards = items.map(item => {
    const itemId = escapeHtml(item.id || '');
    const title = escapeHtml(item.title || '—');
    const description = item.description ? escapeHtml(item.description) : null;
    const org = item.organization ? escapeHtml(item.organization) : null;
    const category = (item.category || '').toLowerCase();
    const categoryLabel = category ? capitalize(category) : null;
    const badgeClass = categoryColors[category] || 'bg-secondary';
    const date = item.dateAwarded || null;
    const dateStr = date ? escapeHtml(date) : null;

    // Source badge for STORY-003
    const sourceBadge = _buildSourceBadge(item.source);

    let subtitleParts = [];
    if (org) subtitleParts.push(org);

    return `
      <div class="card shadow-sm mb-3" id="ach-card-${itemId}" data-achievement-id="${itemId}">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-start gap-2 mb-1">
            <h3 class="h6 fw-semibold mb-0" id="ach-title-${itemId}">${title}</h3>
            ${categoryLabel ? `<span class="badge ${badgeClass} flex-shrink-0" id="ach-cat-${itemId}">${escapeHtml(categoryLabel)}</span>` : `<span id="ach-cat-${itemId}"></span>`}
          </div>
          ${subtitleParts.length > 0 ? `<p class="text-muted small mb-1" id="ach-sub-${itemId}">${subtitleParts.join(' · ')}</p>` : `<p id="ach-sub-${itemId}" class="d-none"></p>`}
          ${description ? `<p class="text-muted small mb-1" id="ach-desc-${itemId}">${description}</p>` : `<p id="ach-desc-${itemId}" class="d-none"></p>`}
          ${dateStr ? `<p class="text-muted small mb-2" id="ach-date-${itemId}"><i class="bi bi-calendar3 me-1"></i>Awarded: ${dateStr}</p>` : `<p id="ach-date-${itemId}" class="d-none"></p>`}
          <div class="mb-2">${sourceBadge}</div>
          <div class="d-flex gap-2 mt-2">
            <button class="btn btn-sm btn-outline-primary btn-edit-achievement"
              data-achievement-id="${itemId}"
              data-title="${escapeHtml(item.title || '')}"
              data-description="${escapeHtml(item.description || '')}"
              data-category="${escapeHtml(item.category || '')}"
              data-date-awarded="${escapeHtml(item.dateAwarded || '')}"
              aria-label="Edit ${title}">
              <i class="bi bi-pencil me-1"></i>Edit
            </button>
            <button class="btn btn-sm btn-outline-danger btn-delete-achievement"
              data-achievement-id="${itemId}"
              data-title="${title}"
              aria-label="Delete ${title}">
              <i class="bi bi-trash me-1"></i>Delete
            </button>
          </div>
        </div>
      </div>`;
  }).join('');

  contentEl.innerHTML = `<p class="text-muted small mb-3">${items.length} achievement${items.length !== 1 ? 's' : ''}</p>${cards}`;

  // Wire Edit buttons
  contentEl.querySelectorAll('.btn-edit-achievement').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.achievementId;
      const data = {
        title: btn.dataset.title,
        description: btn.dataset.description,
        category: btn.dataset.category,
        dateAwarded: btn.dataset.dateAwarded,
      };
      openEditAchievementModal(id, data);
    });
  });

  // Wire Delete buttons
  contentEl.querySelectorAll('.btn-delete-achievement').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.achievementId;
      const title = btn.dataset.title;
      openDeleteAchievementModal(id, title);
    });
  });
}

/**
 * Open Edit Achievement Modal pre-populated with current values.
 */
function openEditAchievementModal(id, data) {
  const existing = document.getElementById('modal-edit-achievement');
  if (existing) existing.remove();

  // Convert ISO date (YYYY-MM-DD) to MM/DD/YYYY for form display
  let dateDisplay = '';
  if (data.dateAwarded) {
    const d = data.dateAwarded.trim();
    // Could be YYYY-MM-DD or already MM/DD/YYYY
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const [yyyy, mm, dd] = d.split('-');
      dateDisplay = `${mm}/${dd}/${yyyy}`;
    } else {
      dateDisplay = d;
    }
  }

  const modalHtml = `
    <div class="modal fade" id="modal-edit-achievement" tabindex="-1" aria-labelledby="editAchLabel" aria-modal="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="editAchLabel">Edit Achievement</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div id="edit-ach-alert-zone"></div>
            <form id="form-edit-achievement" novalidate>
              <div class="mb-3">
                <label for="ea-title" class="form-label">Award/Honor Title <span class="text-danger">*</span></label>
                <input type="text" id="ea-title" class="form-control" maxlength="100" value="${escapeHtml(data.title || '')}">
                <div class="invalid-feedback"></div>
              </div>
              <div class="mb-3">
                <label for="ea-description" class="form-label">Description <span class="text-muted small">(optional, max 500 chars)</span></label>
                <textarea id="ea-description" class="form-control" rows="3" maxlength="500">${escapeHtml(data.description || '')}</textarea>
                <div class="invalid-feedback"></div>
              </div>
              <div class="mb-3">
                <label for="ea-category" class="form-label">Category <span class="text-danger">*</span></label>
                <select id="ea-category" class="form-select">
                  <option value="">Select category...</option>
                  <option value="academic" ${(data.category || '').toLowerCase() === 'academic' ? 'selected' : ''}>Academic</option>
                  <option value="sports" ${(data.category || '').toLowerCase() === 'sports' ? 'selected' : ''}>Sports</option>
                  <option value="community" ${(data.category || '').toLowerCase() === 'community' ? 'selected' : ''}>Community</option>
                  <option value="other" ${(data.category || '').toLowerCase() === 'other' ? 'selected' : ''}>Other</option>
                </select>
                <div class="invalid-feedback"></div>
              </div>
              <div class="mb-3">
                <label for="ea-date" class="form-label">Date Earned <span class="text-muted small">(MM/DD/YYYY, optional)</span></label>
                <input type="text" id="ea-date" class="form-control" maxlength="10" placeholder="MM/DD/YYYY" value="${escapeHtml(dateDisplay)}">
                <div class="invalid-feedback"></div>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="btn-save-edit-achievement">Save Changes</button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const modalEl = document.getElementById('modal-edit-achievement');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();

  document.getElementById('btn-save-edit-achievement').addEventListener('click', async () => {
    const titleEl = document.getElementById('ea-title');
    const descEl = document.getElementById('ea-description');
    const catEl = document.getElementById('ea-category');
    const dateEl = document.getElementById('ea-date');
    const alertZone = document.getElementById('edit-ach-alert-zone');

    // Clear previous errors
    [titleEl, catEl, dateEl].forEach(el => { el.classList.remove('is-invalid'); el.nextElementSibling.textContent = ''; });
    alertZone.innerHTML = '';

    let valid = true;

    if (!titleEl.value.trim() || titleEl.value.length > 100) {
      titleEl.classList.add('is-invalid');
      titleEl.nextElementSibling.textContent = 'Title is required.';
      valid = false;
    }
    if (!catEl.value) {
      catEl.classList.add('is-invalid');
      catEl.nextElementSibling.textContent = 'Please select a category.';
      valid = false;
    }
    if (descEl.value.length > 500) {
      descEl.classList.add('is-invalid');
      descEl.nextElementSibling.textContent = 'Description must be 500 characters or fewer.';
      valid = false;
    }
    if (dateEl.value.trim() && !/^\d{2}\/\d{2}\/\d{4}$/.test(dateEl.value.trim())) {
      dateEl.classList.add('is-invalid');
      dateEl.nextElementSibling.textContent = 'Date must be in MM/DD/YYYY format.';
      valid = false;
    }
    if (dateEl.value.trim() && /^\d{2}\/\d{2}\/\d{4}$/.test(dateEl.value.trim())) {
      const [mm, dd, yyyy] = dateEl.value.trim().split('/');
      const d = new Date(`${yyyy}-${mm}-${dd}`);
      if (isNaN(d.getTime()) || d > new Date()) {
        dateEl.classList.add('is-invalid');
        dateEl.nextElementSibling.textContent = 'Date must be a valid past date.';
        valid = false;
      }
    }

    if (!valid) return;

    const saveBtn = document.getElementById('btn-save-edit-achievement');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

    const result = await updateAchievement(id, {
      title: titleEl.value.trim(),
      description: descEl.value.trim(),
      category: catEl.value,
      dateAwarded: dateEl.value.trim() || null,
    });

    saveBtn.disabled = false;
    saveBtn.innerHTML = 'Save Changes';

    if (result.success) {
      modal.hide();
      showToast('Achievement updated.');
      // In-place update of the card
      const card = document.getElementById(`ach-card-${id}`);
      if (card) {
        const categoryColors = { academic: 'bg-primary', sports: 'bg-success', community: 'bg-info text-dark', other: 'bg-secondary' };
        const newCat = catEl.value.toLowerCase();
        const newCatLabel = capitalize(catEl.value);
        const badgeClass = categoryColors[newCat] || 'bg-secondary';

        const titleEl2 = document.getElementById(`ach-title-${id}`);
        if (titleEl2) titleEl2.textContent = titleEl.value.trim();

        const catBadge = document.getElementById(`ach-cat-${id}`);
        if (catBadge) {
          catBadge.className = `badge ${badgeClass} flex-shrink-0`;
          catBadge.textContent = newCatLabel;
        }

        const descDisplay = document.getElementById(`ach-desc-${id}`);
        if (descDisplay) {
          if (descEl.value.trim()) {
            descDisplay.textContent = descEl.value.trim();
            descDisplay.classList.remove('d-none');
          } else {
            descDisplay.classList.add('d-none');
          }
        }

        const dateDisplay2 = document.getElementById(`ach-date-${id}`);
        if (dateDisplay2) {
          if (dateEl.value.trim()) {
            dateDisplay2.innerHTML = `<i class="bi bi-calendar3 me-1"></i>Awarded: ${escapeHtml(dateEl.value.trim())}`;
            dateDisplay2.classList.remove('d-none');
          } else {
            dateDisplay2.classList.add('d-none');
          }
        }

        // Update data attributes on edit button for next edit
        const editBtn = card.querySelector('.btn-edit-achievement');
        if (editBtn) {
          editBtn.dataset.title = titleEl.value.trim();
          editBtn.dataset.description = descEl.value.trim();
          editBtn.dataset.category = catEl.value;
          editBtn.dataset.dateAwarded = dateEl.value.trim();
        }
      }
    } else {
      const msg = (result.error && result.error.message) || 'Could not save changes.';
      alertZone.innerHTML = `<div class="alert alert-danger small py-2"><i class="bi bi-exclamation-triangle me-1"></i>Could not save changes: ${escapeHtml(msg)}</div>`;
    }
  });

  modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
}

/**
 * Open Delete Achievement Confirmation Modal.
 */
function openDeleteAchievementModal(id, title) {
  const existing = document.getElementById('modal-delete-achievement');
  if (existing) existing.remove();

  const modalHtml = `
    <div class="modal fade" id="modal-delete-achievement" tabindex="-1" aria-labelledby="deleteAchLabel" aria-modal="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="deleteAchLabel">Delete Achievement</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div id="delete-ach-alert-zone"></div>
            <p>Are you sure you want to delete <strong>"${escapeHtml(title)}"</strong>?</p>
            <p class="text-muted small">This cannot be undone.</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-danger" id="btn-confirm-delete-achievement">Delete</button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const modalEl = document.getElementById('modal-delete-achievement');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();

  document.getElementById('btn-confirm-delete-achievement').addEventListener('click', async () => {
    const deleteBtn = document.getElementById('btn-confirm-delete-achievement');
    const alertZone = document.getElementById('delete-ach-alert-zone');
    deleteBtn.disabled = true;
    deleteBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Deleting...';

    const result = await deleteAchievement(id);

    if (result.success) {
      modal.hide();
      showToast('Achievement deleted.');
      // Remove card from DOM without page reload
      const card = document.getElementById(`ach-card-${id}`);
      if (card) card.remove();
      // Update count text
      const countEl = document.querySelector('#section-content > p.text-muted.small');
      if (countEl) {
        const remaining = document.querySelectorAll('#section-content .card').length;
        if (remaining === 0) {
          // Show empty state
          const contentEl2 = document.getElementById('section-content');
          if (contentEl2) {
            contentEl2.innerHTML = `
              <div class="text-center py-5 text-muted">
                <i class="bi bi-trophy fs-1 d-block mb-3"></i>
                <p>No achievements yet.</p>
                <button class="btn btn-sm btn-outline-secondary btn-add-ach-empty">
                  <i class="bi bi-plus-circle me-1"></i>Add manually
                </button>
              </div>`;
            const emptyBtn2 = contentEl2.querySelector('.btn-add-ach-empty');
            if (emptyBtn2) emptyBtn2.addEventListener('click', () => openManualEntryModal('achievements', null, () => showAchievementsDetail()));
          }
        } else {
          countEl.textContent = `${remaining} achievement${remaining !== 1 ? 's' : ''}`;
        }
      }
      // Refresh dashboard count via re-fetch (non-blocking)
      getProfileSections().catch(() => {});
    } else {
      const code = result.error && result.error.code;
      if (code === 'NOT_FOUND') {
        modal.hide();
        showToast('Item not found. It may have already been deleted.', '', 'warning');
        const card = document.getElementById(`ach-card-${id}`);
        if (card) card.remove();
      } else {
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = 'Delete';
        alertZone.innerHTML = `<div class="alert alert-danger small py-2"><i class="bi bi-exclamation-triangle me-1"></i>Could not delete achievement. Please try again.</div>`;
      }
    }
  });

  modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
}

// ─── Section Detail: Activities ───────────────────────────────────────────────

async function showActivitiesDetail() {
  history.replaceState({}, '', '/section/activities');
  document.title = 'Activities — Admissions Officer';

  renderTemplate(`
    <div class="mb-3">
      <button class="btn btn-sm btn-link text-muted ps-0" id="btn-back-section">
        <i class="bi bi-arrow-left me-1"></i>Back to Dashboard
      </button>
    </div>
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h2 class="h5 fw-semibold mb-0">Activities</h2>
      <button class="btn btn-sm btn-outline-secondary" id="btn-add-activity-detail">
        <i class="bi bi-plus-circle me-1"></i>Add manually
      </button>
    </div>
    <div id="section-content">
      <div class="text-center py-4">
        <div class="spinner-border text-primary spinner-border-sm"></div>
        <span class="ms-2 text-muted">Loading...</span>
      </div>
    </div>
  `);

  document.getElementById('btn-back-section').addEventListener('click', () => appNavigate('/'));
  document.getElementById('btn-add-activity-detail').addEventListener('click', () => {
    openManualEntryModal('activities', null, () => showActivitiesDetail());
  });

  await _renderActivitiesList();
}

async function _renderActivitiesList() {
  const result = await getProfileSection('activities');
  const contentEl = document.getElementById('section-content');
  if (!contentEl) return;

  if (!result.success) {
    contentEl.innerHTML = `<div class="alert alert-danger"><i class="bi bi-exclamation-triangle me-2"></i>Could not load activities.</div>`;
    return;
  }

  const items = result.data.data.items || [];

  if (items.length === 0) {
    contentEl.innerHTML = `
      <div class="text-center py-5 text-muted">
        <i class="bi bi-activity fs-1 d-block mb-3"></i>
        <p>No activities yet.</p>
        <button class="btn btn-sm btn-outline-secondary btn-add-act-empty">
          <i class="bi bi-plus-circle me-1"></i>Add manually
        </button>
      </div>`;
    contentEl.querySelector('.btn-add-act-empty') && contentEl.querySelector('.btn-add-act-empty').addEventListener('click', () => {
      openManualEntryModal('activities', null, () => showActivitiesDetail());
    });
    return;
  }

  const cards = items.map(item => {
    const itemId = escapeHtml(item.id || '');
    const title = escapeHtml(item.activityName || item.name || '—');
    const role = item.role ? escapeHtml(item.role) : null;
    const org = item.organization ? escapeHtml(item.organization) : null;
    const hours = (item.hoursPerWeek !== undefined && item.hoursPerWeek !== null) ? escapeHtml(String(item.hoursPerWeek)) : null;
    const startDate = item.startDate || null;
    const endDate = item.endDate || null;

    let metaLine = [];
    if (role) metaLine.push(role);
    if (org) metaLine.push(org);
    if (hours) metaLine.push(`${hours} hrs/wk`);

    let dateLine = '';
    if (startDate || endDate) {
      const start = startDate ? `Start: ${escapeHtml(startDate)}` : '';
      const end = endDate ? `End: ${escapeHtml(endDate)}` : 'End: Ongoing';
      dateLine = [start, end].filter(Boolean).join('  ');
    }

    // Source badge for STORY-003
    const sourceBadge = _buildSourceBadge(item.source);

    return `
      <div class="card shadow-sm mb-3" id="act-card-${itemId}" data-activity-id="${itemId}">
        <div class="card-body">
          <h3 class="h6 fw-semibold mb-1" id="act-title-${itemId}">${title}</h3>
          ${metaLine.length > 0 ? `<p class="text-muted small mb-1" id="act-meta-${itemId}">${metaLine.join(' · ')}</p>` : `<p id="act-meta-${itemId}" class="d-none"></p>`}
          ${dateLine ? `<p class="text-muted small mb-2" id="act-date-${itemId}">${dateLine}</p>` : `<p id="act-date-${itemId}" class="d-none"></p>`}
          <div class="mb-2">${sourceBadge}</div>
          <div class="d-flex gap-2 mt-2">
            <button class="btn btn-sm btn-outline-primary btn-edit-activity"
              data-activity-id="${itemId}"
              data-activity-name="${escapeHtml(item.activityName || '')}"
              data-role="${escapeHtml(item.role || '')}"
              data-organization="${escapeHtml(item.organization || '')}"
              data-hours-per-week="${item.hoursPerWeek !== null && item.hoursPerWeek !== undefined ? item.hoursPerWeek : ''}"
              data-start-date="${escapeHtml(item.startDate || '')}"
              data-end-date="${escapeHtml(item.endDate || '')}"
              aria-label="Edit ${title}">
              <i class="bi bi-pencil me-1"></i>Edit
            </button>
            <button class="btn btn-sm btn-outline-danger btn-delete-activity"
              data-activity-id="${itemId}"
              data-title="${title}"
              aria-label="Delete ${title}">
              <i class="bi bi-trash me-1"></i>Delete
            </button>
          </div>
        </div>
      </div>`;
  }).join('');

  contentEl.innerHTML = `<p class="text-muted small mb-3">${items.length} activit${items.length !== 1 ? 'ies' : 'y'}</p>${cards}`;

  // Wire Edit buttons
  contentEl.querySelectorAll('.btn-edit-activity').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.activityId;
      const data = {
        activityName: btn.dataset.activityName,
        role: btn.dataset.role,
        organization: btn.dataset.organization,
        hoursPerWeek: btn.dataset.hoursPerWeek,
        startDate: btn.dataset.startDate,
        endDate: btn.dataset.endDate,
      };
      openEditActivityModal(id, data);
    });
  });

  // Wire Delete buttons
  contentEl.querySelectorAll('.btn-delete-activity').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.activityId;
      const title = btn.dataset.title;
      openDeleteActivityModal(id, title);
    });
  });
}

/**
 * Open Edit Activity Modal pre-populated with current values.
 */
function openEditActivityModal(id, data) {
  const existing = document.getElementById('modal-edit-activity');
  if (existing) existing.remove();

  // Convert ISO date (YYYY-MM-DD) to MM/DD/YYYY for display
  function isoToMMDDYYYY(isoStr) {
    if (!isoStr || isoStr.trim() === '') return '';
    const m = isoStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[2]}/${m[3]}/${m[1]}`;
    return isoStr; // already in another format, return as-is
  }

  const startDisplay = isoToMMDDYYYY(data.startDate);
  const endDisplay = isoToMMDDYYYY(data.endDate);

  const modalHtml = `
    <div class="modal fade" id="modal-edit-activity" tabindex="-1" aria-labelledby="editActLabel" aria-modal="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="editActLabel">Edit Activity</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div id="edit-act-alert-zone"></div>
            <form id="form-edit-activity" novalidate>
              <div class="mb-3">
                <label for="ea-act-name" class="form-label">Activity Name <span class="text-danger">*</span></label>
                <input type="text" id="ea-act-name" class="form-control" maxlength="100" value="${escapeHtml(data.activityName || '')}">
                <div class="invalid-feedback"></div>
              </div>
              <div class="mb-3">
                <label for="ea-act-role" class="form-label">Role <span class="text-muted small">(e.g., "Member", "President")</span></label>
                <input type="text" id="ea-act-role" class="form-control" maxlength="100" value="${escapeHtml(data.role || '')}">
                <div class="invalid-feedback"></div>
              </div>
              <div class="mb-3">
                <label for="ea-act-org" class="form-label">Organization</label>
                <input type="text" id="ea-act-org" class="form-control" maxlength="100" value="${escapeHtml(data.organization || '')}">
                <div class="invalid-feedback"></div>
              </div>
              <div class="mb-3">
                <label for="ea-act-hours" class="form-label">Hours per Week <span class="text-muted small">(optional)</span></label>
                <input type="text" id="ea-act-hours" class="form-control" maxlength="5" value="${escapeHtml(String(data.hoursPerWeek || ''))}">
                <div class="invalid-feedback"></div>
              </div>
              <div class="mb-3">
                <label for="ea-act-start" class="form-label">Start Date <span class="text-muted small">(MM/DD/YYYY, optional)</span></label>
                <input type="text" id="ea-act-start" class="form-control" maxlength="10" placeholder="MM/DD/YYYY" value="${escapeHtml(startDisplay)}">
                <div class="invalid-feedback"></div>
              </div>
              <div class="mb-3">
                <label for="ea-act-end" class="form-label">End Date <span class="text-muted small">(MM/DD/YYYY, leave blank = Ongoing)</span></label>
                <input type="text" id="ea-act-end" class="form-control" maxlength="10" placeholder="MM/DD/YYYY" value="${escapeHtml(endDisplay)}">
                <div class="invalid-feedback"></div>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="btn-save-edit-activity">Save Changes</button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const modalEl = document.getElementById('modal-edit-activity');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();

  document.getElementById('btn-save-edit-activity').addEventListener('click', async () => {
    const nameEl = document.getElementById('ea-act-name');
    const roleEl = document.getElementById('ea-act-role');
    const orgEl = document.getElementById('ea-act-org');
    const hoursEl = document.getElementById('ea-act-hours');
    const startEl = document.getElementById('ea-act-start');
    const endEl = document.getElementById('ea-act-end');
    const alertZone = document.getElementById('edit-act-alert-zone');

    // Clear previous errors
    [nameEl, roleEl, orgEl, hoursEl, startEl, endEl].forEach(el => {
      el.classList.remove('is-invalid');
      el.nextElementSibling.textContent = '';
    });
    alertZone.innerHTML = '';

    let valid = true;

    if (!nameEl.value.trim() || nameEl.value.length > 100) {
      nameEl.classList.add('is-invalid');
      nameEl.nextElementSibling.textContent = 'Activity name is required.';
      valid = false;
    }
    if (orgEl.value.length > 100) {
      orgEl.classList.add('is-invalid');
      orgEl.nextElementSibling.textContent = 'Organization must be 100 characters or fewer.';
      valid = false;
    }
    if (hoursEl.value.trim()) {
      const h = parseFloat(hoursEl.value.trim());
      if (isNaN(h) || h < 0 || h > 100) {
        hoursEl.classList.add('is-invalid');
        hoursEl.nextElementSibling.textContent = 'Hours per week must be a number between 0 and 100.';
        valid = false;
      }
    }
    function validateDateField(el, fieldName) {
      const v = el.value.trim();
      if (!v) return true;
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(v)) {
        el.classList.add('is-invalid');
        el.nextElementSibling.textContent = `${fieldName} must be a valid MM/DD/YYYY date.`;
        return false;
      }
      const [mm, dd, yyyy] = v.split('/');
      const d = new Date(`${yyyy}-${mm}-${dd}`);
      if (isNaN(d.getTime())) {
        el.classList.add('is-invalid');
        el.nextElementSibling.textContent = `${fieldName} is not a valid date.`;
        return false;
      }
      if (d > new Date()) {
        el.classList.add('is-invalid');
        el.nextElementSibling.textContent = `${fieldName} must not be in the future.`;
        return false;
      }
      return true;
    }

    const startValid = validateDateField(startEl, 'Start date');
    if (!startValid) valid = false;
    const endValid = validateDateField(endEl, 'End date');
    if (!endValid) valid = false;

    // Check end >= start
    if (startEl.value.trim() && endEl.value.trim() && startValid && endValid) {
      const [smm, sdd, syyyy] = startEl.value.trim().split('/');
      const [emm, edd, eyyyy] = endEl.value.trim().split('/');
      const startD = new Date(`${syyyy}-${smm}-${sdd}`);
      const endD = new Date(`${eyyyy}-${emm}-${edd}`);
      if (endD < startD) {
        endEl.classList.add('is-invalid');
        endEl.nextElementSibling.textContent = 'End date must be on or after start date.';
        valid = false;
      }
    }

    if (!valid) return;

    const saveBtn = document.getElementById('btn-save-edit-activity');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

    const result = await updateActivity(id, {
      activityName: nameEl.value.trim(),
      role: roleEl.value.trim() || null,
      organization: orgEl.value.trim() || null,
      hoursPerWeek: hoursEl.value.trim() || null,
      startDate: startEl.value.trim() || null,
      endDate: endEl.value.trim() || null,
    });

    saveBtn.disabled = false;
    saveBtn.innerHTML = 'Save Changes';

    if (result.success) {
      modal.hide();
      showToast('Activity updated.');
      // In-place update of the card
      const card = document.getElementById(`act-card-${id}`);
      if (card) {
        const newTitle = nameEl.value.trim();
        const newRole = roleEl.value.trim();
        const newOrg = orgEl.value.trim();
        const newHours = hoursEl.value.trim();
        const newStart = startEl.value.trim();
        const newEnd = endEl.value.trim();

        const titleEl2 = document.getElementById(`act-title-${id}`);
        if (titleEl2) titleEl2.textContent = newTitle;

        const metaEl = document.getElementById(`act-meta-${id}`);
        if (metaEl) {
          const parts = [];
          if (newRole) parts.push(newRole);
          if (newOrg) parts.push(newOrg);
          if (newHours) parts.push(`${newHours} hrs/wk`);
          if (parts.length > 0) {
            metaEl.textContent = parts.join(' · ');
            metaEl.classList.remove('d-none');
          } else {
            metaEl.classList.add('d-none');
          }
        }

        const dateEl2 = document.getElementById(`act-date-${id}`);
        if (dateEl2) {
          if (newStart || newEnd) {
            const start = newStart ? `Start: ${newStart}` : '';
            const end = newEnd ? `End: ${newEnd}` : 'End: Ongoing';
            dateEl2.textContent = [start, end].filter(Boolean).join('  ');
            dateEl2.classList.remove('d-none');
          } else {
            dateEl2.classList.add('d-none');
          }
        }

        // Update data attributes for next edit
        const editBtn = card.querySelector('.btn-edit-activity');
        if (editBtn) {
          editBtn.dataset.activityName = newTitle;
          editBtn.dataset.role = newRole;
          editBtn.dataset.organization = newOrg;
          editBtn.dataset.hoursPerWeek = newHours;
          editBtn.dataset.startDate = newStart;
          editBtn.dataset.endDate = newEnd;
        }
      }
    } else {
      const msg = (result.error && result.error.message) || 'Could not save changes.';
      alertZone.innerHTML = `<div class="alert alert-danger small py-2"><i class="bi bi-exclamation-triangle me-1"></i>Could not save changes: ${escapeHtml(msg)}</div>`;
    }
  });

  modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
}

/**
 * Open Delete Activity Confirmation Modal.
 */
function openDeleteActivityModal(id, title) {
  const existing = document.getElementById('modal-delete-activity');
  if (existing) existing.remove();

  const modalHtml = `
    <div class="modal fade" id="modal-delete-activity" tabindex="-1" aria-labelledby="deleteActLabel" aria-modal="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="deleteActLabel">Delete Activity</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div id="delete-act-alert-zone"></div>
            <p>Are you sure you want to delete <strong>"${escapeHtml(title)}"</strong>?</p>
            <p class="text-muted small">This cannot be undone.</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-danger" id="btn-confirm-delete-activity">Delete</button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const modalEl = document.getElementById('modal-delete-activity');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();

  document.getElementById('btn-confirm-delete-activity').addEventListener('click', async () => {
    const deleteBtn = document.getElementById('btn-confirm-delete-activity');
    const alertZone = document.getElementById('delete-act-alert-zone');
    deleteBtn.disabled = true;
    deleteBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Deleting...';

    const result = await deleteActivity(id);

    if (result.success) {
      modal.hide();
      showToast('Activity deleted.');
      // Remove card from DOM without page reload
      const card = document.getElementById(`act-card-${id}`);
      if (card) card.remove();
      // Update count text
      const contentEl = document.getElementById('section-content');
      const remaining = contentEl ? contentEl.querySelectorAll('.card').length : 0;
      const countEl = contentEl ? contentEl.querySelector('p.text-muted.small') : null;
      if (remaining === 0 && contentEl) {
        contentEl.innerHTML = `
          <div class="text-center py-5 text-muted">
            <i class="bi bi-activity fs-1 d-block mb-3"></i>
            <p>No activities yet.</p>
            <button class="btn btn-sm btn-outline-secondary btn-add-act-empty">
              <i class="bi bi-plus-circle me-1"></i>Add manually
            </button>
          </div>`;
        const emptyBtn = contentEl.querySelector('.btn-add-act-empty');
        if (emptyBtn) emptyBtn.addEventListener('click', () => openManualEntryModal('activities', null, () => showActivitiesDetail()));
      } else if (countEl) {
        countEl.textContent = `${remaining} activit${remaining !== 1 ? 'ies' : 'y'}`;
      }
    } else {
      const code = result.error && result.error.code;
      if (code === 'NOT_FOUND') {
        modal.hide();
        showToast('Item not found. It may have already been deleted.', '', 'warning');
        const card = document.getElementById(`act-card-${id}`);
        if (card) card.remove();
      } else {
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = 'Delete';
        alertZone.innerHTML = `<div class="alert alert-danger small py-2"><i class="bi bi-exclamation-triangle me-1"></i>Could not delete activity. Please try again.</div>`;
      }
    }
  });

  modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
}
