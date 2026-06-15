/* ui-utils.js — DOM helpers, form validation, alerts, toasts */

'use strict';

/**
 * Validate a single input element against a rules object.
 * @param {HTMLElement} inputEl
 * @param {{ required?: boolean, maxLength?: number, pattern?: RegExp, patternMessage?: string, numeric?: boolean, numericRange?: [number, number] }} rules
 * @returns {{ valid: boolean, message: string }}
 */
function validateField(inputEl, rules) {
  const value = (inputEl.value || '').trim();

  if (rules.required && value === '') {
    return { valid: false, message: rules.requiredMessage || 'This field is required.' };
  }

  if (value === '' && !rules.required) {
    // Optional empty field — valid
    return { valid: true, message: '' };
  }

  if (rules.maxLength && value.length > rules.maxLength) {
    return { valid: false, message: `Must be ${rules.maxLength} characters or fewer.` };
  }

  if (rules.pattern && !rules.pattern.test(value)) {
    return { valid: false, message: rules.patternMessage || 'Invalid format.' };
  }

  if (rules.numeric) {
    const num = parseFloat(value);
    if (isNaN(num)) {
      return { valid: false, message: rules.numericMessage || 'Must be a number.' };
    }
    if (rules.numericRange) {
      const [min, max] = rules.numericRange;
      if (num < min || num > max) {
        return { valid: false, message: `Must be between ${min} and ${max}.` };
      }
    }
  }

  return { valid: true, message: '' };
}

/**
 * Show or clear inline validation error on an input element.
 * Expects a sibling .invalid-feedback element.
 * @param {HTMLElement} inputEl
 * @param {{ valid: boolean, message: string }} result
 */
function applyValidation(inputEl, result) {
  if (result.valid) {
    inputEl.classList.remove('is-invalid');
    inputEl.classList.add('is-valid');
    const fb = inputEl.parentElement.querySelector('.invalid-feedback');
    if (fb) fb.textContent = '';
  } else {
    inputEl.classList.add('is-invalid');
    inputEl.classList.remove('is-valid');
    const fb = inputEl.parentElement.querySelector('.invalid-feedback');
    if (fb) fb.textContent = result.message;
  }
}

/**
 * Clear all validation states on an element.
 * @param {HTMLElement} inputEl
 */
function clearValidation(inputEl) {
  inputEl.classList.remove('is-invalid', 'is-valid');
  const fb = inputEl.parentElement && inputEl.parentElement.querySelector('.invalid-feedback');
  if (fb) fb.textContent = '';
}

/**
 * Render HTML string into #app-screen.
 * @param {string} htmlString
 */
function renderTemplate(htmlString) {
  // Ensure app-screen is visible and export-page is hidden
  const screen = document.getElementById('app-screen');
  if (screen) {
    screen.style.display = '';
    screen.innerHTML = htmlString;
  }
  const exportPage = document.getElementById('export-page');
  if (exportPage) exportPage.style.display = 'none';
}

/**
 * Show a Bootstrap alert in a container element.
 * @param {string} type — 'danger' | 'success' | 'info' | 'warning'
 * @param {string} message
 * @param {string} containerId — id of element to prepend alert into
 * @param {boolean} dismissible
 */
function showAlert(type, message, containerId = 'ao-alert-zone', dismissible = true) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const dismissBtn = dismissible
    ? `<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>`
    : '';
  const alertEl = document.createElement('div');
  alertEl.className = `alert alert-${type} ${dismissible ? 'alert-dismissible' : ''} fade show`;
  alertEl.setAttribute('role', 'alert');
  alertEl.innerHTML = message + dismissBtn;
  container.innerHTML = '';
  container.appendChild(alertEl);
}

/**
 * Show a brief Bootstrap toast notification.
 * @param {string} message
 * @param {string} [subtitle] - optional subtitle text
 * @param {'success'|'danger'|'info'|'warning'} [type] - toast color variant (default 'success')
 */
function showToast(message, subtitle, type) {
  const toastType = type || 'success';
  const iconMap = {
    success: 'bi-check-circle-fill text-success',
    danger: 'bi-x-circle-fill text-danger',
    info: 'bi-info-circle-fill text-info',
    warning: 'bi-exclamation-triangle-fill text-warning',
  };
  const icon = iconMap[toastType] || iconMap.success;

  // Create or reuse toast container
  let container = document.getElementById('ao-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'ao-toast-container';
    container.className = 'ao-toast-container';
    document.body.appendChild(container);
  }

  const toastEl = document.createElement('div');
  toastEl.className = 'toast show shadow';
  toastEl.setAttribute('role', 'status');
  toastEl.style.minWidth = '280px';
  toastEl.innerHTML = `
    <div class="toast-header">
      <i class="bi ${icon} me-2"></i>
      <strong class="me-auto">${message}</strong>
      <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
    </div>
    ${subtitle ? `<div class="toast-body text-muted small">${subtitle}</div>` : ''}`;
  container.appendChild(toastEl);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(() => toastEl.remove(), 300);
  }, 5000);
}
