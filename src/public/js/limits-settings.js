/* limits-settings.js — Word Limits & College Guideline Presets settings panel (STORY-007) */

'use strict';

// ─── Preset definitions ───────────────────────────────────────────────────────

const PRESET_DEFAULTS = {
  common_app: {
    impactStatements: { min: 100, max: 1000 },
    essays: { min: 500, max: 650 },
    questionnaireFields: { min: 100, max: 500 },
  },
  coalition_app: {
    impactStatements: { min: 100, max: 1000 },
    essays: { min: 500, max: 650 },
    questionnaireFields: { min: 100, max: 500 },
  },
};

// ─── State ────────────────────────────────────────────────────────────────────

/**
 * The last-loaded or last-saved limits config.
 * Used as baseline for dirty-check.
 */
let _limitsBaseline = null;

/**
 * Whether the panel has unsaved changes relative to baseline.
 */
let _limitsHasUnsavedChanges = false;

/**
 * beforeunload / popstate guard handler reference for cleanup.
 */
let _limitsUnloadHandler = null;

/**
 * The original preset that was loaded (e.g. 'common_app').
 * Used to show "based on Common App" badge when user edits within that tab.
 */
let _limitsOriginalPreset = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format an ISO timestamp as human-readable.
 * @param {string|null} iso
 * @returns {string}
 */
function _formatLimitsTimestamp(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) {
    return iso;
  }
}

/**
 * Read current field values from the DOM as a limits object.
 * @returns {{ limits: object }}
 */
function _readLimitsFromDOM() {
  const limits = {
    impactStatements: {
      min: parseInt(document.getElementById('limits-is-min').value, 10),
      max: parseInt(document.getElementById('limits-is-max').value, 10),
    },
    essays: {
      min: parseInt(document.getElementById('limits-essays-min').value, 10),
      max: parseInt(document.getElementById('limits-essays-max').value, 10),
    },
    questionnaireFields: {
      min: parseInt(document.getElementById('limits-qf-min').value, 10),
      max: parseInt(document.getElementById('limits-qf-max').value, 10),
    },
  };

  return { limits };
}

/**
 * Deep-equal check between two limits objects (baseline vs current DOM).
 */
function _limitsEqual(a, b) {
  if (!a || !b) return false;
  const secs = ['impactStatements', 'essays', 'questionnaireFields'];
  for (const sec of secs) {
    if ((a.limits[sec].min) !== (b.limits[sec].min)) return false;
    if ((a.limits[sec].max) !== (b.limits[sec].max)) return false;
  }
  return true;
}


/**
 * Fill field inputs with given limits values.
 * @param {object} limits - { impactStatements, essays, questionnaireFields }
 */
function _populateLimitsFields(limits) {
  document.getElementById('limits-is-min').value = limits.impactStatements.min;
  document.getElementById('limits-is-max').value = limits.impactStatements.max;
  document.getElementById('limits-essays-min').value = limits.essays.min;
  document.getElementById('limits-essays-max').value = limits.essays.max;
  document.getElementById('limits-qf-min').value = limits.questionnaireFields.min;
  document.getElementById('limits-qf-max').value = limits.questionnaireFields.max;
}

/**
 * Apply readonly attribute state based on preset.
 * All presets are now editable — this function ensures readonly is always removed.
 * @param {'common_app'|'coalition_app'|'custom'} preset
 */
function _applyReadonlyState(preset) {
  const inputs = document.querySelectorAll('.limits-field-input');
  inputs.forEach(input => {
    input.removeAttribute('readonly');
    input.classList.remove('bg-light');
  });
}

/**
 * Run client-side validation on all min/max pairs.
 * Shows/clears inline errors. Returns true if all valid.
 */
function _validateLimitsForm() {
  const sections = [
    { minId: 'limits-is-min', maxId: 'limits-is-max', errId: 'limits-is-error', label: 'Impact statement' },
    { minId: 'limits-essays-min', maxId: 'limits-essays-max', errId: 'limits-essays-error', label: 'Essay' },
    { minId: 'limits-qf-min', maxId: 'limits-qf-max', errId: 'limits-qf-error', label: 'Questionnaire field' },
  ];

  let allValid = true;

  for (const sec of sections) {
    const minEl = document.getElementById(sec.minId);
    const maxEl = document.getElementById(sec.maxId);
    const errEl = document.getElementById(sec.errId);
    if (!minEl || !maxEl || !errEl) continue;

    const minVal = parseInt(minEl.value, 10);
    const maxVal = parseInt(maxEl.value, 10);

    if (!isNaN(minVal) && !isNaN(maxVal) && maxVal <= minVal) {
      errEl.textContent = 'Max must be greater than min.';
      errEl.classList.remove('d-none');
      maxEl.classList.add('is-invalid');
      allValid = false;
    } else {
      errEl.textContent = '';
      errEl.classList.add('d-none');
      maxEl.classList.remove('is-invalid');
    }
  }

  return allValid;
}

/**
 * Update the Save button disabled/enabled state.
 */
function _updateSaveButtonState() {
  const saveBtn = document.getElementById('btn-save-limits');
  if (!saveBtn) return;

  const current = _readLimitsFromDOM();
  const formValid = _validateLimitsForm();
  const isDirty = !_limitsEqual(_limitsBaseline, current);

  _limitsHasUnsavedChanges = isDirty;

  // Disabled when: no changes OR form is invalid
  saveBtn.disabled = !isDirty || !formValid;
}


// ─── Limits banner (used on impact statement and essay screens) ───────────────

/**
 * Fetch limits and inject a contextual banner into a DOM element.
 * If fetch fails: silently omit the banner (generation flow not blocked).
 *
 * @param {string} containerId - ID of the container element to prepend the banner into
 * @param {'impact'|'essay'} type - determines which limits field to show
 * @returns {Promise<void>}
 */
async function renderLimitsBanner(containerId, type) {
  const container = document.getElementById(containerId);
  if (!container) return;

  let limitsData;
  try {
    const result = await getLimitsConfig();
    if (!result.success || !result.data) return; // Silent fail per spec
    limitsData = result.data;
  } catch (_) {
    return; // Silent fail
  }

  const limits = limitsData.limits;

  let limitsLine;
  if (type === 'impact') {
    const min = limits.impactStatements.min;
    const max = limits.impactStatements.max;
    limitsLine = `Impact statement: ${min} – ${max} words`;
  } else {
    const min = limits.essays.min;
    const max = limits.essays.max;
    limitsLine = `Essay: ${min} – ${max} words`;
  }

  const banner = document.createElement('div');
  banner.className = 'alert alert-info d-flex align-items-start gap-2 mb-3';
  banner.setAttribute('role', 'note');
  banner.id = 'limits-banner';
  banner.innerHTML = `
    <i class="bi bi-info-circle-fill mt-1 flex-shrink-0"></i>
    <div class="flex-grow-1">
      <strong>Generating within your limits</strong><br>
      <span class="small">${escapeHtml(limitsLine)}</span>
    </div>
    <a href="/settings" class="btn btn-sm btn-outline-info ms-auto flex-shrink-0"
       onclick="event.preventDefault(); appNavigate('/settings');">
      Change limits
    </a>
  `;

  container.prepend(banner);
}

// ─── Main screen renderer ─────────────────────────────────────────────────────

/**
 * Render the Word Limits & College Guidelines settings panel.
 * Called by showSettings() in app.js after the main settings HTML is in the DOM.
 */
async function renderLimitsSettingsPanel() {
  const panelContainer = document.getElementById('limits-settings-panel');
  if (!panelContainer) return;

  // Show loading state within panel
  panelContainer.innerHTML = `
    <div class="text-center py-3">
      <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
      <span class="ms-2 text-muted small">Loading limits...</span>
    </div>
  `;

  const result = await getLimitsConfig();

  let limitsData;
  let loadError = false;

  if (result.success && result.data) {
    limitsData = result.data;
  } else {
    // Fallback to hardcoded defaults
    loadError = true;
    limitsData = {
      source: 'defaults',
      lastUpdated: null,
      limits: {
        impactStatements: { min: 100, max: 1000 },
        essays: { min: 500, max: 650 },
        questionnaireFields: { min: 100, max: 500 },
      },
    };
  }

  const { lastUpdated, limits } = limitsData;

  const lastSavedHtml = lastUpdated
    ? `<span class="text-muted small" id="limits-last-saved">Last saved: ${escapeHtml(_formatLimitsTimestamp(lastUpdated))}</span>`
    : `<span class="text-muted small d-none" id="limits-last-saved"></span>`;

  panelContainer.innerHTML = `
    ${loadError ? `
      <div class="alert alert-warning d-flex align-items-center gap-2 mb-3" role="alert">
        <i class="bi bi-exclamation-triangle-fill"></i>
        <span>Could not load current settings. Showing defaults.</span>
      </div>` : ''}

    <div class="card mb-4 shadow-sm">
      <div class="card-body">
        <h6 class="fw-semibold mb-3">Word Limits &amp; College Guidelines</h6>

        <div id="limits-alert-zone" class="mb-3"></div>

        <p class="text-muted small mb-3">
          Set global word/character limits applied to all AI generations.
        </p>

        <p class="fw-semibold small mb-2">Current limits:</p>

        <!-- Impact Statements -->
        <div class="mb-3">
          <label class="form-label small fw-semibold">Impact Statements</label>
          <div class="row g-2">
            <div class="col-auto">
              <label for="limits-is-min" class="col-form-label col-form-label-sm">Min words:</label>
            </div>
            <div class="col-auto">
              <input type="number" id="limits-is-min"
                class="form-control form-control-sm limits-field-input"
                value="${limits.impactStatements.min}"
                min="0" max="9999" step="1" style="width:90px;">
            </div>
            <div class="col-auto">
              <label for="limits-is-max" class="col-form-label col-form-label-sm">Max words:</label>
            </div>
            <div class="col-auto">
              <input type="number" id="limits-is-max"
                class="form-control form-control-sm limits-field-input"
                value="${limits.impactStatements.max}"
                min="1" max="9999" step="1" style="width:90px;">
            </div>
          </div>
          <div id="limits-is-error" class="text-danger small mt-1 d-none"></div>
        </div>

        <!-- Essays -->
        <div class="mb-3">
          <label class="form-label small fw-semibold">Essays</label>
          <div class="row g-2">
            <div class="col-auto">
              <label for="limits-essays-min" class="col-form-label col-form-label-sm">Min words:</label>
            </div>
            <div class="col-auto">
              <input type="number" id="limits-essays-min"
                class="form-control form-control-sm limits-field-input"
                value="${limits.essays.min}"
                min="0" max="9999" step="1" style="width:90px;">
            </div>
            <div class="col-auto">
              <label for="limits-essays-max" class="col-form-label col-form-label-sm">Max words:</label>
            </div>
            <div class="col-auto">
              <input type="number" id="limits-essays-max"
                class="form-control form-control-sm limits-field-input"
                value="${limits.essays.max}"
                min="1" max="9999" step="1" style="width:90px;">
            </div>
          </div>
          <div id="limits-essays-error" class="text-danger small mt-1 d-none"></div>
        </div>

        <!-- Questionnaire Fields -->
        <div class="mb-3">
          <label class="form-label small fw-semibold">Questionnaire Fields</label>
          <div class="row g-2">
            <div class="col-auto">
              <label for="limits-qf-min" class="col-form-label col-form-label-sm">Min words:</label>
            </div>
            <div class="col-auto">
              <input type="number" id="limits-qf-min"
                class="form-control form-control-sm limits-field-input"
                value="${limits.questionnaireFields.min}"
                min="0" max="9999" step="1" style="width:90px;">
            </div>
            <div class="col-auto">
              <label for="limits-qf-max" class="col-form-label col-form-label-sm">Max words:</label>
            </div>
            <div class="col-auto">
              <input type="number" id="limits-qf-max"
                class="form-control form-control-sm limits-field-input"
                value="${limits.questionnaireFields.max}"
                min="1" max="9999" step="1" style="width:90px;">
            </div>
          </div>
          <div id="limits-qf-error" class="text-danger small mt-1 d-none"></div>
        </div>

        <div class="d-flex align-items-center gap-3 mt-3 flex-wrap">
          <button class="btn btn-primary" id="btn-save-limits" disabled>
            <i class="bi bi-floppy me-1"></i>Save Settings
          </button>
          ${lastSavedHtml}
        </div>
      </div>
    </div>
  `;

  // Initialize baseline for dirty-check
  _limitsBaseline = {
    limits: {
      impactStatements: { min: limits.impactStatements.min, max: limits.impactStatements.max },
      essays: { min: limits.essays.min, max: limits.essays.max },
      questionnaireFields: { min: limits.questionnaireFields.min, max: limits.questionnaireFields.max },
    },
  };
  _limitsHasUnsavedChanges = false;

  // Wire field input events for dirty-check and validation
  document.querySelectorAll('.limits-field-input').forEach(input => {
    input.addEventListener('input', _updateSaveButtonState);
    input.addEventListener('change', _updateSaveButtonState);
  });

  // Wire Save Settings button
  document.getElementById('btn-save-limits').addEventListener('click', _handleSaveLimits);
}

/**
 * Handle Save Settings button click.
 */
async function _handleSaveLimits() {
  const saveBtn = document.getElementById('btn-save-limits');
  if (!saveBtn || saveBtn.disabled) return;

  if (!_validateLimitsForm()) return;

  const payload = _readLimitsFromDOM();

  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span>Saving...';

  const result = await saveLimitsConfig(payload);

  saveBtn.innerHTML = '<i class="bi bi-floppy me-1"></i>Save Settings';

  if (!result.success) {
    const msg = (result.error && result.error.message) || 'Could not save settings. Check your data directory.';
    showToast(msg, null, 'danger');
    saveBtn.disabled = false;
    return;
  }

  // Update baseline to the saved values
  const saved = result.data;
  _limitsBaseline = {
    limits: {
      impactStatements: {
        min: saved.limits.impactStatements.min,
        max: saved.limits.impactStatements.max,
      },
      essays: {
        min: saved.limits.essays.min,
        max: saved.limits.essays.max,
      },
      questionnaireFields: {
        min: saved.limits.questionnaireFields.min,
        max: saved.limits.questionnaireFields.max,
      },
    },
  };
  _limitsHasUnsavedChanges = false;
  saveBtn.disabled = true; // No unsaved changes now

  // Update last saved line
  const lastSavedEl = document.getElementById('limits-last-saved');
  if (lastSavedEl && saved.lastUpdated) {
    lastSavedEl.textContent = `Last saved: ${_formatLimitsTimestamp(saved.lastUpdated)}`;
    lastSavedEl.classList.remove('d-none');
  }

  showToast('Settings saved.', null, 'success');
}

/**
 * Returns true if the limits settings panel has unsaved changes.
 * Used by the navigation guard in showSettings().
 */
function limitsHasUnsavedChanges() {
  return _limitsHasUnsavedChanges;
}

/**
 * Reset unsaved-changes state (call after navigation completes).
 */
function limitsResetDirtyState() {
  _limitsHasUnsavedChanges = false;
}
