(() => {
  'use strict';

  const UI = window.VPS_UI;
  const utils = window.VPS_UTILS;
  if (!UI) return;

  const originalRenderTableStrip = UI.renderTableStrip.bind(UI);
  const originalRenderAssetMatrix = UI.renderAssetMatrix.bind(UI);
  const originalRenderAccordions = UI.renderAccordions.bind(UI);
  const STATUS_KEYS = ['green', 'yellow', 'orange', 'red', 'neutral'];
  const PRIORITY = { neutral: 0, green: 1, yellow: 2, orange: 3, red: 4 };

  let accordionContext = null;
  let refreshFrame = 0;

  function queueStatusRefresh() {
    if (refreshFrame) return;
    refreshFrame = window.requestAnimationFrame(() => {
      refreshFrame = 0;
      decorateCurrentFields();
      updatePreviewStatus();
    });
  }

  function containTableCover(container) {
    const cover = container?.querySelector('.table-cover');
    const image = cover?.querySelector(':scope > .table-cover-image');
    if (!cover || !image || cover.querySelector(':scope > .table-cover-frame')) return;

    const frame = document.createElement('span');
    frame.className = 'table-cover-frame';
    cover.insertBefore(frame, image);
    frame.appendChild(image);
  }

  function hasText(value) {
    return typeof value === 'string'
      ? value.trim().length > 0
      : value !== undefined && value !== null;
  }

  function normalizeNames(value) {
    if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
    return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  }

  function isMd5(value) {
    return /^[a-f0-9]{32}$/i.test(String(value || '').trim());
  }

  function getFieldErrors(step, values, callbacks) {
    const errors = new Map();
    const add = (fieldName, message) => {
      if (!fieldName || !message) return;
      const messages = errors.get(fieldName) || [];
      if (!messages.includes(message)) messages.push(message);
      errors.set(fieldName, messages);
    };
    const validateChecksum = (fieldName, label, { required = false } = {}) => {
      // This dot mirrors what the visible input shows — only the primary
      // checksum (index 0). Additional entries (added via the
      // checksum-additional modal) are validated separately, in that modal
      // and in main.js's blocking validateBuild().
      const raw = values[fieldName];
      const value = String(Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')).trim();
      if (required && !value) add(fieldName, `${label} is required.`);
      else if (value && !isMd5(value)) add(fieldName, `${label} must be a 32-character MD5 value.`);
    };

    if (!step || callbacks?.isEnabled?.(step) === false) return errors;

    switch (step.id) {
      case 'main': {
        if (!hasText(values.tableVPSId)) add('tableVPSId', 'Table VPS ID is required.');
        const fps = String(values.fps ?? '').trim();
        if (!fps) add('fps', 'FPS is required.');
        else if (!/^\d+$/.test(fps)) add('fps', 'FPS must be an integer.');
        if (!normalizeNames(values.testers).length) add('testers', 'At least one tester is required.');
        break;
      }
      case 'vpx':
        if (!hasText(values.vpxVPSId)) add('vpxVPSId', 'A VPX file must be selected.');
        validateChecksum('vpxChecksum', 'VPX Checksum', { required: true });
        break;
      case 'b2s':
        validateChecksum('backglassChecksum', 'Backglass Checksum', { required: true });
        if (hasText(values.backglassUrlOverride) && !hasText(values.backglassNotes)) {
          add('backglassNotes', 'Backglass Notes are required when using Backglass URL Override.');
        }
        // Bundled means it ships inside the table's own download — no
        // external URL/Authors/Image Override needed, only Notes. Override
        // (no VPS entry) still requires the full set via the generic loop.
        if (values.backglassBundled === true && !hasText(values.backglassNotes)) {
          add('backglassNotes', 'Bundled Backglass entries require notes.');
        }
        break;
      case 'rom':
        validateChecksum('romChecksum', 'ROM Checksum', { required: true });
        if (hasText(values.romUrlOverride) && hasText(values.romVPSId)) {
          add('romVPSId', 'ROM VPS ID conflicts with ROM URL Override.');
          add('romUrlOverride', 'Use either ROM VPS ID or ROM URL Override, not both.');
        }
        if (hasText(values.romUrlOverride) && !hasText(values.romVersionOverride)) {
          add('romVersionOverride', 'ROM Version Override is required when using a URL override.');
        }
        if (hasText(values.romUrlOverride) && !hasText(values.romNotes)) {
          add('romNotes', 'ROM Notes are required when using ROM URL Override.');
        }
        // Bundled means it ships inside the table's own download — no
        // external URL/Version Override needed, only Notes.
        if (values.romBundled === true && !hasText(values.romNotes)) {
          add('romNotes', 'Bundled ROM entries require notes.');
        }
        break;
      case 'coloredRom': {
        validateChecksum('coloredROMChecksum', 'Color ROM Checksum', { required: true });
        if (values.coloredROMPin2DMD === true) {
          validateChecksum('coloredROMChecksumSecondary', 'Color ROM VNI Checksum', { required: true });
        }
        if (hasText(values.coloredROMUrlOverride) && !hasText(values.coloredROMNotes)) {
          add('coloredROMNotes', 'Color ROM Notes are required when using Color ROM URL Override.');
        }
        // Bundled means it ships inside the table's own download — no
        // external URL/Version Override needed, only Notes.
        if (values.coloredROMBundled === true && !hasText(values.coloredROMNotes)) {
          add('coloredROMNotes', 'Bundled Color ROM entries require notes.');
        }
        break;
      }
      case 'pup': {
        validateChecksum('pupChecksum', 'PUP Pack Checksum', { required: true });
        if (values.pupBundled === true && !hasText(values.pupNotes)) {
          add('pupNotes', 'Bundled PUP Pack entries require notes.');
        }
        if (!hasText(values.pupVersion)) add('pupVersion', 'PUP Pack Version is required.');
        if (!hasText(values.pupArchiveRoot)) add('pupArchiveRoot', 'PUP Pack Archive Root is required.');
        if (!hasText(values.pupArchiveFormat)) add('pupArchiveFormat', 'PUP Pack Archive Format is required.');
        break;
      }
      case 'vpuPatch':
        validateChecksum('diffChecksum', 'VPU Patch Checksum');
        if (hasText(values.diffUrlOverride) && !hasText(values.diffNotes)) {
          add('diffNotes', 'Patch Notes are required when using Patch URL Override.');
        }
        // Bundled means it ships inside the table's own download — no
        // external URL/Authors/Version Override needed, only Notes.
        if (values.diffBundled === true && !hasText(values.diffNotes)) {
          add('diffNotes', 'Bundled VPU Patch entries require notes.');
        }
        break;
      default:
        break;
    }

    // Override unlocks a tab without a VPS ID; every field the step declares
    // in overrideRequiredFields (its Advanced Config overrides, plus PUP
    // Notes) becomes required in exchange. Generic so it stays in sync with
    // fields.js instead of duplicating each step's field list here.
    if (step.overrideField && values[step.overrideField] === true) {
      (step.overrideRequiredFields || []).forEach(key => {
        if (!hasText(values[key])) {
          const label = step.fields.find(field => field.yml_field === key)?.name || key;
          add(key, `${label} is required when Override is enabled.`);
        }
      });
    }

    return errors;
  }

  function clearFieldErrors(container) {
    container?.querySelectorAll('.field.has-field-error').forEach(field => {
      field.classList.remove('has-field-error');
      field.removeAttribute('data-error-count');
      field.querySelector(':scope > .field-error-dot')?.remove();
    });
  }

  function findFieldWrapper(container, fieldName) {
    const control = container?.querySelector(`#field-${utils.cssEscape(fieldName)}`)
      || container?.querySelector(`[name="${utils.cssEscape(fieldName)}"]`);
    return control?.closest('.field') || null;
  }

  function addFieldErrorDot(container, fieldName, messages) {
    const wrapper = findFieldWrapper(container, fieldName);
    if (!wrapper || !messages?.length) return false;

    wrapper.classList.add('has-field-error');
    wrapper.dataset.errorCount = String(messages.length);

    const dot = document.createElement('span');
    dot.className = 'field-error-dot';
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', messages.join(' '));
    dot.title = messages.join('\n');
    wrapper.appendChild(dot);
    return true;
  }

  function decorateCurrentFields() {
    if (!accordionContext?.container?.isConnected) return;

    const { container, steps, values, callbacks } = accordionContext;
    clearFieldErrors(container);

    const panel = container.querySelector('.config-tab-panel');
    const step = steps.find(candidate => candidate.id === panel?.dataset.step);
    if (!step) return;

    const errors = getFieldErrors(step, values, callbacks);
    let added = 0;
    errors.forEach((messages, fieldName) => {
      if (addFieldErrorDot(container, fieldName, messages)) added += 1;
    });

    const tab = container.querySelector(`.config-tab[data-step="${utils.cssEscape(step.id)}"]`);
    // Steps validated exclusively by the newer feature-validation layer (e.g.
    // Alt Sound) have no case in getFieldErrors above, so `added` is always 0
    // for them. Query that layer's errors directly (a pure read of current
    // state) rather than checking for its `.feature-has-field-error` DOM
    // marker — that marker is applied by an independently rAF-scheduled
    // pass and isn't guaranteed to have run yet on this same frame.
    const extendedErrors = [
      ...(window.VPS_FEATURE_VALIDATION?.errors?.() || []),
      ...(window.VPS_V090_VALIDATION?.errors?.() || [])
    ];
    const hasExtendedFieldError = extendedErrors.some(entry => entry.stepId === step.id);
    if (!added && !hasExtendedFieldError && tab?.classList.contains('has-error')) {
      const fallback = step.fields.find(field => field.readonly)
        || step.fields.find(field => !field.advanced)
        || step.fields[0];
      if (fallback) {
        addFieldErrorDot(container, fallback.yml_field, ['This section contains an unresolved validation error.']);
      }
    }
  }

  function classState(element) {
    return STATUS_KEYS.find(key => element.classList.contains(`state-${key}`)) || 'neutral';
  }

  function emptyCounts() {
    return { green: 0, yellow: 0, orange: 0, red: 0, neutral: 0 };
  }

  function collectAssetCounts() {
    const counts = emptyCounts();
    document.querySelectorAll('#assetMatrix .asset-status').forEach(status => {
      counts[classState(status)] += 1;
    });
    return counts;
  }

  function collectConfigCounts() {
    const counts = emptyCounts();
    document.querySelectorAll('#accordionStack .config-tab:not(:disabled)').forEach(tab => {
      if (tab.classList.contains('has-error')) counts.red += 1;
      else if (tab.classList.contains('has-warning')) counts.orange += 1;
      else counts.green += 1;
    });
    return counts;
  }

  function highestState(assetCounts, configCounts) {
    return STATUS_KEYS.reduce((highest, key) => {
      const total = (assetCounts[key] || 0) + (configCounts[key] || 0);
      return total > 0 && PRIORITY[key] > PRIORITY[highest] ? key : highest;
    }, 'neutral');
  }

  function statusItems(counts, type) {
    const labels = type === 'assets'
      ? { green: 'Ready', yellow: 'Caution', orange: 'Action', red: 'Error', neutral: 'Not included' }
      : { green: 'Ready', yellow: 'Caution', orange: 'Warnings', red: 'Errors', neutral: 'Not included' };

    return STATUS_KEYS
      .filter(key => counts[key] > 0)
      .map(key => ({ key, label: labels[key], count: counts[key] }));
  }

  function ensurePreviewBreakdown(dot) {
    const heading = dot.closest('#previewHeading');
    if (!heading) return null;

    let breakdown = heading.querySelector('.preview-status-breakdown');
    if (!breakdown) {
      breakdown = document.createElement('span');
      breakdown.className = 'preview-status-breakdown';
      breakdown.id = 'previewStatusBreakdown';
      breakdown.setAttribute('role', 'tooltip');
      heading.insertBefore(breakdown, dot.nextSibling);
    }
    return breakdown;
  }

  function appendBreakdownGroup(target, title, items) {
    if (!items.length) return;
    const group = document.createElement('span');
    group.className = 'preview-status-group';

    const heading = document.createElement('strong');
    heading.textContent = title;
    group.appendChild(heading);

    items.forEach(item => {
      const row = document.createElement('span');
      row.className = `preview-status-item state-${item.key}`;
      const marker = document.createElement('span');
      marker.className = 'preview-status-marker';
      marker.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = `${item.label}: ${item.count}`;
      row.append(marker, label);
      group.appendChild(row);
    });

    target.appendChild(group);
  }

  function summaryText(assetItems, configItems) {
    const format = items => items.map(item => `${item.label} ${item.count}`).join(', ');
    const parts = [];
    if (assetItems.length) parts.push(`Assets: ${format(assetItems)}`);
    if (configItems.length) parts.push(`Configuration: ${format(configItems)}`);
    return parts.join('. ') || 'No table loaded';
  }

  function updatePreviewStatus() {
    const dot = document.getElementById('previewStatusDot');
    if (!dot) return;

    const assetCounts = collectAssetCounts();
    const configCounts = collectConfigCounts();
    const assetItems = statusItems(assetCounts, 'assets');
    const configItems = statusItems(configCounts, 'config');
    const overall = highestState(assetCounts, configCounts);
    const summary = summaryText(assetItems, configItems);

    dot.className = `preview-dot state-${overall}`;
    dot.tabIndex = 0;
    dot.title = summary;
    dot.setAttribute('aria-label', `YAML build status. ${summary}`);
    dot.setAttribute('aria-describedby', 'previewStatusBreakdown');

    const breakdown = ensurePreviewBreakdown(dot);
    if (!breakdown) return;
    breakdown.replaceChildren();
    appendBreakdownGroup(breakdown, 'Assets', assetItems);
    appendBreakdownGroup(breakdown, 'Configuration', configItems);
  }

  UI.renderTableStrip = function renderTableStripWithContainment(...args) {
    const result = originalRenderTableStrip(...args);
    containTableCover(args[0]);
    queueStatusRefresh();
    return result;
  };

  UI.renderAssetMatrix = function renderAssetMatrixWithStatus(...args) {
    const result = originalRenderAssetMatrix(...args);
    queueStatusRefresh();
    return result;
  };

  UI.renderAccordions = function renderAccordionsWithFieldStatus(container, steps, values, callbacks) {
    const enhancedCallbacks = {
      ...callbacks,
      onChange: (key, value, field) => {
        callbacks.onChange(key, value, field);
        queueStatusRefresh();
      }
    };

    const result = originalRenderAccordions(container, steps, values, enhancedCallbacks);
    accordionContext = { container, steps, values, callbacks: enhancedCallbacks };
    queueStatusRefresh();
    return result;
  };

  document.addEventListener('input', queueStatusRefresh, true);
  document.addEventListener('change', queueStatusRefresh, true);

  // Truncated checksum hints expose their full text as a hover tooltip.
  document.addEventListener('mouseover', event => {
    const hint = event.target instanceof Element ? event.target.closest('.checksum-drop-hint') : null;
    const status = hint?.closest('.checksum-drop-status');
    if (!status) return;
    if (hint.scrollWidth > hint.clientWidth) status.dataset.tooltip = hint.textContent;
    else delete status.dataset.tooltip;
  }, true);

  function startPreviewObserver() {
    const preview = document.getElementById('previewYaml');
    if (!preview || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(queueStatusRefresh);
    observer.observe(preview, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      startPreviewObserver();
      queueStatusRefresh();
    }, { once: true });
  } else {
    startPreviewObserver();
    queueStatusRefresh();
  }
})();
