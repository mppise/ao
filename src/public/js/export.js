/* export.js — Export page logic for STORY-005 (dedicated /export SPA page) */
'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let cachedJsonBlob = null;
let cachedJsonFilename = null;
let cachedPdfBlob = null;
let cachedPdfFilename = null;

const EXPORT_TIMEOUT_MS = 30000;

// ── Render the Export Page ────────────────────────────────────────────────

/**
 * Called by the SPA router when path === '/export'.
 * Shows #export-page section, hides #app-screen, initialises panels.
 */
async function renderExportPage() {
  // Hide the main app-screen
  const appScreen = document.getElementById('app-screen');
  if (appScreen) appScreen.style.display = 'none';

  // Show export page section
  const exportPage = document.getElementById('export-page');
  if (exportPage) exportPage.style.display = '';

  // Show navbar
  if (typeof showNavbar === 'function') showNavbar();

  document.title = 'Export Profile — Admissions Officer';

  await initExportPage();
}

/**
 * Wire up the export page panels and check profile emptiness.
 */
async function initExportPage() {
  // Reset cached blobs for new page visit
  cachedJsonBlob = null;
  cachedJsonFilename = null;
  cachedPdfBlob = null;
  cachedPdfFilename = null;

  // Render the three panels
  renderExportPanels();

  // Check profile emptiness
  await checkProfileEmpty();
}

/**
 * Render the three side-by-side export panels into #export-panels.
 */
function renderExportPanels() {
  const container = document.getElementById('export-panels');
  if (!container) return;

  container.innerHTML = `
    <!-- JSON card -->
    <div class="col-md-4">
      <div class="card h-100 p-3" id="json-card-body">
        <i class="bi bi-file-zip fs-1 text-primary mb-2 d-block text-center"></i>
        <h5 class="card-title text-center">Download JSON</h5>
        <p class="card-text text-muted small text-center">All profile data as a .zip file. Full portability.</p>
        <div class="text-center mt-auto">
          <button class="btn btn-primary btn-sm" id="btn-download-json" aria-label="Download JSON export">
            Download as JSON
          </button>
        </div>
      </div>
    </div>
    <!-- PDF card -->
    <div class="col-md-4">
      <div class="card h-100 p-3" id="pdf-card-body">
        <i class="bi bi-file-pdf fs-1 text-danger mb-2 d-block text-center"></i>
        <h5 class="card-title text-center">Download PDF</h5>
        <p class="card-text text-muted small text-center">Formatted 1-3 page summary. Great for advisors.</p>
        <div class="text-center mt-auto">
          <button class="btn btn-danger btn-sm" id="btn-download-pdf" aria-label="Download PDF export">
            Download as PDF
          </button>
        </div>
      </div>
    </div>
    <!-- Share card -->
    <div class="col-md-4">
      <div class="card h-100 p-3" id="share-card-body">
        <div id="share-panel-create">
          <i class="bi bi-link-45deg fs-1 text-success mb-2 d-block text-center"></i>
          <h5 class="card-title text-center">Share Link</h5>
          <p class="card-text text-muted small text-center">Generate a timed read-only link.</p>
          <div class="text-center mt-auto">
            <button class="btn btn-success btn-sm" id="btn-open-share" aria-label="Create shareable link">
              Create
            </button>
          </div>
        </div>

        <!-- Share sub-panel: expanded -->
        <div id="share-panel-expanded" class="d-none">
          <h6 class="fw-semibold mb-3"><i class="bi bi-link-45deg me-1"></i>Share Link</h6>

          <div class="mb-3 d-flex align-items-center gap-2">
            <label for="share-duration" class="form-label mb-0 text-nowrap small">Link expires after:</label>
            <select id="share-duration" class="form-select form-select-sm w-auto">
              <option value="1">1 day</option>
              <option value="3">3 days</option>
              <option value="7" selected>7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
            </select>
          </div>

          <button class="btn btn-success btn-sm mb-2" id="btn-generate-link" aria-label="Generate shareable link">
            Generate Link
          </button>

          <div class="alert alert-danger mt-2 d-none small" id="share-link-alert" role="alert"></div>

          <div id="share-link-result" class="mt-3 d-none">
            <div class="input-group mb-1">
              <input type="text" id="share-url-input" class="form-control form-control-sm" readonly
                     aria-label="Shareable link URL">
              <button class="btn btn-sm btn-outline-secondary" id="btn-copy-share-url"
                      aria-label="Copy link to clipboard"
                      data-bs-toggle="tooltip" data-bs-placement="top"
                      data-bs-trigger="manual" title="Copied!">
                <i class="bi bi-clipboard"></i>
              </button>
            </div>
            <div id="share-expiry-display" class="text-muted small mb-1"></div>
            <p class="text-muted small mb-2">Anyone with this link can view your profile summary.</p>
            <div class="d-flex gap-2 flex-wrap">
              <button class="btn btn-sm btn-link ps-0" id="btn-view-active-links">View Active Links</button>
              <button class="btn btn-sm btn-link ps-0" id="btn-close-share">Close</button>
            </div>
          </div>

          <div class="mt-2" id="share-panel-no-result-close">
            <button class="btn btn-sm btn-link ps-0" id="btn-close-share-early">Close</button>
          </div>
        </div>

        <!-- Active links sub-panel -->
        <div id="share-panel-links" class="d-none">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 id="links-count" class="fw-semibold mb-0">Active shareable links</h6>
            <button class="btn btn-sm btn-link p-0" id="btn-links-back">
              <i class="bi bi-arrow-left me-1"></i>Back
            </button>
          </div>

          <div id="links-loading" class="text-muted small">
            <span class="spinner-border spinner-border-sm me-1"></span>Loading links...
          </div>

          <div id="links-error-zone" class="d-none">
            <div class="alert alert-danger small py-2">
              Could not load shareable links.
              <button class="btn btn-sm btn-link p-0 ms-2" id="btn-retry-links">Retry</button>
            </div>
          </div>

          <div id="links-empty-state" class="text-muted small d-none">
            You have no active shareable links.
          </div>

          <table class="table table-sm d-none" id="links-table" aria-label="Active shareable links">
            <thead>
              <tr>
                <th scope="col">Link</th>
                <th scope="col">Expires</th>
                <th scope="col">Views</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody id="links-table-body"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Wire up event listeners
  wireExportPage();
}

/**
 * Wire up all button click handlers on the export page.
 */
function wireExportPage() {
  const btnJson = document.getElementById('btn-download-json');
  if (btnJson) btnJson.addEventListener('click', doJsonExport);

  const btnPdf = document.getElementById('btn-download-pdf');
  if (btnPdf) btnPdf.addEventListener('click', doPdfExport);

  const btnShare = document.getElementById('btn-open-share');
  if (btnShare) btnShare.addEventListener('click', openSharePanel);

  const btnClose = document.getElementById('btn-close-share');
  if (btnClose) btnClose.addEventListener('click', closeSharePanel);

  const btnCloseEarly = document.getElementById('btn-close-share-early');
  if (btnCloseEarly) btnCloseEarly.addEventListener('click', closeSharePanel);

  const btnGenLink = document.getElementById('btn-generate-link');
  if (btnGenLink) btnGenLink.addEventListener('click', doGenerateLink);

  const btnCopy = document.getElementById('btn-copy-share-url');
  if (btnCopy) btnCopy.addEventListener('click', copyShareUrl);

  const btnViewLinks = document.getElementById('btn-view-active-links');
  if (btnViewLinks) btnViewLinks.addEventListener('click', openActiveLinks);

  const btnLinksBack = document.getElementById('btn-links-back');
  if (btnLinksBack) btnLinksBack.addEventListener('click', closeActiveLinks);

  const btnRetryLinks = document.getElementById('btn-retry-links');
  if (btnRetryLinks) btnRetryLinks.addEventListener('click', loadActiveLinks);
}

// ── Profile empty check ────────────────────────────────────────────────────

async function checkProfileEmpty() {
  try {
    const res = await fetch('/api/profile/sections');
    const data = await res.json();
    if (!data.success) {
      showExportEmptyWarning('Data directory is not configured. Please restart AO and complete setup.');
      disableAllExportButtons();
      return;
    }
    const sections = data.data && data.data.sections;
    const hasData = sections && (
      !sections.academic?.isEmpty ||
      !sections.tests?.isEmpty ||
      !sections.achievements?.isEmpty ||
      !sections.activities?.isEmpty ||
      !sections.impact_statements?.isEmpty
    );

    if (!hasData) {
      showExportEmptyWarning('Your profile is empty — add data before exporting.');
      disableAllExportButtons();
    }
  } catch (_) {
    // Non-fatal — leave buttons enabled
  }
}

function showExportEmptyWarning(msg) {
  const warn = document.getElementById('export-empty-warning');
  if (!warn) return;
  const textNode = warn.childNodes[0];
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    textNode.textContent = msg + ' ';
  }
  warn.classList.remove('d-none');
}

function disableAllExportButtons() {
  ['btn-download-json', 'btn-download-pdf', 'btn-open-share'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
    }
  });
}

// ── Share panel helpers ────────────────────────────────────────────────────

function openSharePanel() {
  const create = document.getElementById('share-panel-create');
  const expanded = document.getElementById('share-panel-expanded');
  if (create) create.classList.add('d-none');
  if (expanded) expanded.classList.remove('d-none');
}

function closeSharePanel() {
  const create = document.getElementById('share-panel-create');
  const expanded = document.getElementById('share-panel-expanded');
  const links = document.getElementById('share-panel-links');
  if (create) create.classList.remove('d-none');
  if (expanded) expanded.classList.add('d-none');
  if (links) links.classList.add('d-none');
}

function openActiveLinks() {
  const expanded = document.getElementById('share-panel-expanded');
  const links = document.getElementById('share-panel-links');
  if (expanded) expanded.classList.add('d-none');
  if (links) links.classList.remove('d-none');
  loadActiveLinks();
}

function closeActiveLinks() {
  const expanded = document.getElementById('share-panel-expanded');
  const links = document.getElementById('share-panel-links');
  if (links) links.classList.add('d-none');
  if (expanded) expanded.classList.remove('d-none');
}

// ── JSON Export ───────────────────────────────────────────────────────────

async function doJsonExport() {
  const card = document.getElementById('json-card-body');
  setCardLoading(card, 'Preparing...');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);

  try {
    const res = await fetch('/api/export/json', { method: 'POST', signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const code = data.error && data.error.code;
      const msg = getJsonErrorMessage(code, data.error && data.error.message);
      setCardError(card, msg, doJsonExport);
      return;
    }

    const cd = res.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : 'ao-profile.zip';

    const blob = await res.blob();
    cachedJsonBlob = blob;
    cachedJsonFilename = filename;

    triggerDownload(blob, filename);
    setCardSuccess(card, filename, () => triggerDownload(cachedJsonBlob, cachedJsonFilename));
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      setCardError(card, 'Export timed out. Check your system and try again.', doJsonExport);
    } else {
      setCardError(card, 'Export failed. Check disk space and try again.', doJsonExport);
    }
  }
}

function getJsonErrorMessage(code, fallback) {
  if (code === 'ZIP_FAILED') return 'Export failed. Check disk space and try again.';
  if (code === 'PROFILE_EMPTY') return 'Profile is empty — add data first.';
  if (code === 'DATA_DIR_MISSING') return 'Data directory is not configured. Restart AO and complete setup.';
  return fallback || 'Export failed. Please try again.';
}

// ── PDF Export ────────────────────────────────────────────────────────────

async function doPdfExport() {
  const card = document.getElementById('pdf-card-body');
  setCardLoading(card, 'Preparing...');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);

  try {
    const res = await fetch('/api/export/pdf', { method: 'POST', signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const code = data.error && data.error.code;
      const msg = getPdfErrorMessage(code, data.error && data.error.message);
      setCardError(card, msg, doPdfExport);
      return;
    }

    const cd = res.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : 'ao-profile.pdf';

    const blob = await res.blob();
    cachedPdfBlob = blob;
    cachedPdfFilename = filename;

    triggerDownload(blob, filename);
    setCardSuccess(card, filename, () => triggerDownload(cachedPdfBlob, cachedPdfFilename));
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      setCardError(card, 'Export timed out. Check your system and try again.', doPdfExport);
    } else {
      setCardError(card, 'PDF generation failed. Try again or use JSON export.', doPdfExport);
    }
  }
}

function getPdfErrorMessage(code, fallback) {
  if (code === 'PDF_FAILED') return 'PDF generation failed. Try again or use JSON export.';
  if (code === 'PROFILE_EMPTY') return 'Profile is empty — add data first.';
  return fallback || 'PDF export failed. Please try again.';
}

// ── Share Link ────────────────────────────────────────────────────────────

async function doGenerateLink() {
  const btn = document.getElementById('btn-generate-link');
  const alertEl = document.getElementById('share-link-alert');
  const resultEl = document.getElementById('share-link-result');
  const noResultClose = document.getElementById('share-panel-no-result-close');
  const durationEl = document.getElementById('share-duration');

  if (alertEl) { alertEl.classList.add('d-none'); alertEl.textContent = ''; }
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Generating...';
  }

  const durationDays = parseInt(durationEl ? durationEl.value : '7', 10);

  try {
    const res = await fetch('/api/share/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ durationDays }),
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      const msg = (data.error && data.error.message) || 'Could not generate link. Please try again.';
      if (alertEl) { alertEl.textContent = msg; alertEl.classList.remove('d-none'); }
      if (btn) { btn.disabled = false; btn.textContent = 'Generate Link'; }
      // Rate-limited: disable button for 30 seconds
      if (res.status === 429) {
        if (btn) {
          btn.disabled = true;
          setTimeout(() => { if (btn) { btn.disabled = false; } }, 30000);
        }
      }
      return;
    }

    const { url, expiresAt } = data.data;
    const expiryFormatted = new Date(expiresAt).toLocaleString();

    const urlInput = document.getElementById('share-url-input');
    if (urlInput) urlInput.value = url;

    const expiryEl = document.getElementById('share-expiry-display');
    if (expiryEl) expiryEl.textContent = `This link expires on: ${expiryFormatted}`;

    if (resultEl) resultEl.classList.remove('d-none');
    if (noResultClose) noResultClose.classList.add('d-none');

    // Init copy button tooltip
    const copyBtn = document.getElementById('btn-copy-share-url');
    if (copyBtn) {
      // Dispose old tooltip if any
      const oldTip = bootstrap.Tooltip.getInstance(copyBtn);
      if (oldTip) oldTip.dispose();
      new bootstrap.Tooltip(copyBtn, { title: 'Copied!', trigger: 'manual', placement: 'top' });
    }

    if (btn) { btn.disabled = false; btn.textContent = 'Generate Another Link'; }
  } catch (e) {
    if (alertEl) { alertEl.textContent = 'Could not generate link. Please try again.'; alertEl.classList.remove('d-none'); }
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Link'; }
  }
}

async function copyShareUrl() {
  const urlInput = document.getElementById('share-url-input');
  const copyBtn = document.getElementById('btn-copy-share-url');
  if (!urlInput || !urlInput.value) return;

  try {
    await navigator.clipboard.writeText(urlInput.value);
  } catch (e) {
    // Fallback
    urlInput.select();
    document.execCommand('copy');
  }

  if (copyBtn) {
    const tooltip = bootstrap.Tooltip.getInstance(copyBtn) || new bootstrap.Tooltip(copyBtn, { title: 'Copied!', trigger: 'manual', placement: 'top' });
    tooltip.show();
    setTimeout(() => tooltip.hide(), 2000);
  }
}

// ── Active Links ──────────────────────────────────────────────────────────

async function loadActiveLinks() {
  const loadingEl = document.getElementById('links-loading');
  const errorZone = document.getElementById('links-error-zone');
  const emptyState = document.getElementById('links-empty-state');
  const tableEl = document.getElementById('links-table');
  const tableBody = document.getElementById('links-table-body');
  const countEl = document.getElementById('links-count');

  if (loadingEl) loadingEl.classList.remove('d-none');
  if (errorZone) errorZone.classList.add('d-none');
  if (emptyState) emptyState.classList.add('d-none');
  if (tableEl) tableEl.classList.add('d-none');

  try {
    const res = await fetch('/api/share/list');
    const data = await res.json();

    if (loadingEl) loadingEl.classList.add('d-none');

    if (!res.ok || !data.success) {
      if (errorZone) errorZone.classList.remove('d-none');
      const retryBtn = document.getElementById('btn-retry-links');
      if (retryBtn) retryBtn.addEventListener('click', loadActiveLinks);
      return;
    }

    const tokens = data.data && data.data.tokens ? data.data.tokens : [];
    const active = tokens.filter(t => !t.revoked && new Date() <= new Date(t.expiresAt));

    if (countEl) countEl.textContent = `Active shareable links (${active.length})`;

    if (active.length === 0) {
      if (emptyState) emptyState.classList.remove('d-none');
      return;
    }

    if (tableEl) tableEl.classList.remove('d-none');
    if (tableBody) {
      tableBody.innerHTML = active.map(t => {
        const shortUrl = t.url.length > 30 ? t.url.slice(0, 30) + '...' : t.url;
        const expiry = new Date(t.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const safeToken = _escHtml(t.token);
        return `<tr id="link-row-${safeToken}">
          <td title="${_escHtml(t.url)}" class="small">${_escHtml(shortUrl)}</td>
          <td class="small">${_escHtml(expiry)}</td>
          <td class="small">${_escHtml(String(t.accessCount || 0))}</td>
          <td>
            <button class="btn btn-sm btn-outline-danger" id="btn-revoke-${safeToken}"
                    aria-label="Revoke link" onclick="revokeLink('${safeToken}')">
              <i class="bi bi-trash me-1"></i>Revoke
            </button>
            <span id="revoke-err-${safeToken}" class="text-danger small ms-1 d-none">Could not revoke. Try again.</span>
          </td>
        </tr>`;
      }).join('');
    }
  } catch (e) {
    if (loadingEl) loadingEl.classList.add('d-none');
    if (errorZone) errorZone.classList.remove('d-none');
  }
}

async function revokeLink(token) {
  const row = document.getElementById(`link-row-${token}`);
  const btn = document.getElementById(`btn-revoke-${token}`);
  const errSpan = document.getElementById(`revoke-err-${token}`);

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
  }

  try {
    const res = await fetch(`/api/share/${token}`, { method: 'DELETE' });
    const data = await res.json();

    if (!res.ok || !data.success) {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-trash me-1"></i>Revoke'; }
      if (errSpan) errSpan.classList.remove('d-none');
      return;
    }

    if (row) row.remove();

    // Show success alert
    showRevokeSuccess();

    // Check if table is now empty
    const tableBody = document.getElementById('links-table-body');
    const emptyState = document.getElementById('links-empty-state');
    const countEl = document.getElementById('links-count');
    const tableEl = document.getElementById('links-table');
    if (tableBody && tableBody.children.length === 0) {
      if (emptyState) emptyState.classList.remove('d-none');
      if (tableEl) tableEl.classList.add('d-none');
      if (countEl) countEl.textContent = 'Active shareable links (0)';
    }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-trash me-1"></i>Revoke'; }
    if (errSpan) errSpan.classList.remove('d-none');
  }
}

function showRevokeSuccess() {
  const alertEl = document.getElementById('revoke-success-alert');
  if (!alertEl) return;
  alertEl.classList.remove('d-none');
  setTimeout(() => alertEl.classList.add('d-none'), 3000);
}

// ── DOM Helpers ───────────────────────────────────────────────────────────

function _escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setCardLoading(card, msg) {
  if (!card) return;
  card.innerHTML = `
    <div class="text-center py-3">
      <span class="spinner-border spinner-border-sm text-primary me-2" role="status" aria-hidden="true"></span>
      ${_escHtml(msg)}
    </div>`;
}

function setCardSuccess(card, filename, downloadAgainFn) {
  if (!card) return;
  // Store retry fn globally with unique key based on filename
  const fnKey = filename.endsWith('.zip') ? '_exportJsonDownloadAgain' : '_exportPdfDownloadAgain';
  window[fnKey] = downloadAgainFn;
  card.innerHTML = `
    <div class="text-center py-2">
      <i class="bi bi-check-circle-fill text-success fs-3 mb-2 d-block"></i>
      <div class="fw-semibold mb-1">Ready to download:</div>
      <div class="text-muted small mb-3">${_escHtml(filename)}</div>
      <button class="btn btn-sm btn-outline-success" onclick="window['${fnKey}']()" aria-label="Download again">
        Download Again
      </button>
    </div>`;
}

function setCardError(card, msg, retryFn) {
  if (!card) return;
  const fnKey = msg.includes('disk') || msg.includes('zip') || msg.includes('ZIP') || card.id === 'json-card-body'
    ? '_exportJsonRetry'
    : '_exportPdfRetry';
  // Distinguish JSON vs PDF by card id
  const key = card.id === 'json-card-body' ? '_exportJsonRetry' : '_exportPdfRetry';
  window[key] = retryFn;
  card.innerHTML = `
    <div class="text-center py-2">
      <i class="bi bi-exclamation-triangle-fill text-danger fs-3 mb-2 d-block"></i>
      <div class="text-danger small mb-3">${_escHtml(msg)}</div>
      <button class="btn btn-sm btn-outline-danger" onclick="window['${key}']()" aria-label="Try again">
        Try Again
      </button>
    </div>`;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// ── Dashboard Export Card ─────────────────────────────────────────────────

/**
 * Check if profile has any data to determine if the Export card should be enabled.
 * Called from showDashboard in app.js after rendering the export card.
 */
async function initExportCard() {
  const card = document.getElementById('card-export');
  if (!card) return;

  try {
    const res = await fetch('/api/profile/sections');
    const data = await res.json();

    const sections = data.success && data.data && data.data.sections;
    const hasData = sections && (
      !sections.academic?.isEmpty ||
      !sections.tests?.isEmpty ||
      !sections.achievements?.isEmpty ||
      !sections.activities?.isEmpty ||
      !sections.impact_statements?.isEmpty
    );

    if (hasData) {
      // Enable card
      card.style.opacity = '';
      card.style.pointerEvents = '';
      card.setAttribute('tabindex', '0');
      // Destroy tooltip if any
      const tip = bootstrap.Tooltip.getInstance(card);
      if (tip) tip.dispose();
    } else {
      // Disable card
      card.style.opacity = '0.5';
      card.style.pointerEvents = 'none';
      card.setAttribute('tabindex', '-1');
      new bootstrap.Tooltip(card, {
        title: 'Add profile data before exporting.',
        placement: 'top',
        trigger: 'hover focus',
      });
    }
  } catch (_) {
    // Non-fatal
  }
}

// Expose globally
window.revokeLink = revokeLink;
window.renderExportPage = renderExportPage;
window.initExportCard = initExportCard;

// Legacy compatibility (app.js still calls these)
window.initExportModal = function() {};
window.initExportButton = initExportCard;
