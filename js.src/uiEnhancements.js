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

  // Every error dot in the builder, drawn in one pass from the merged rulebook
  // (validationRules.js). Until 2026-10-06 four scripts drew them, each on its
  // own frame: this file (getFieldErrors and the fallback dot),
  // featureValidationController.js, v090Enhancements.js, and v091Corrections.js,
  // which deleted any dot drawn on the VPU Patch ID. Every dot now says what
  // its dialog line says, headline then instruction (Phase 2 decision 5,
  // 2026-10-15), and every dot is one kind (piece 3, 2026-10-18): one
  // .field-error-dot per field, carrying all of that field's problems in
  // rulebook order (build, then v090, then feature), each once. Until then each
  // system drew its own (.feature-error-dot, and a v090 dot per issue), so a
  // field with problems from two systems stacked two dots in one corner and
  // the top one hid the other. The tooltip shows one line per problem with its
  // headline in bold (piece 2); data-tooltip keeps the plain text, one line
  // each. Feature problems are also written into the control's aria-label, as
  // they always were.

  const dotText = issue => [issue.title, issue.message].filter(Boolean).join('. ');
  // A dot's entries are its issues' { title, message }; a plain string is a
  // line with no headline.
  const entryText = entry => (typeof entry === 'string' ? entry : dotText(entry));

  // The tooltip a dot shows: one line per problem, its headline in bold
  // (decision 5, piece 2). It is a real element because a pseudo-element's
  // text cannot be partly bold; data-tooltip keeps the plain text, which the
  // scenario tests read, and its pseudo tooltip steps aside for this one.
  function setDotTip(dot, entries) {
    const tip = document.createElement('span');
    tip.className = 'error-dot-tip';
    tip.setAttribute('aria-hidden', 'true');
    entries.forEach(entry => {
      const line = document.createElement('span');
      line.className = 'error-dot-tip-line';
      const { title, message } = typeof entry === 'string' ? { message: entry } : entry;
      if (title) {
        const headline = document.createElement('strong');
        headline.textContent = message ? `${title}.` : title;
        line.appendChild(headline);
      }
      if (message) {
        const text = document.createElement('span');
        text.textContent = title ? ` ${message}` : message;
        line.appendChild(text);
      }
      tip.appendChild(line);
    });
    dot.querySelector(':scope > .error-dot-tip')?.remove();
    dot.appendChild(tip);
  }

  function findFieldWrapper(container, fieldName) {
    const control = container?.querySelector(`#field-${utils.cssEscape(fieldName)}`)
      || container?.querySelector(`[name="${utils.cssEscape(fieldName)}"]`);
    return control?.closest('.field') || null;
  }

  function restoreControlLabel(control) {
    if (!control) return;
    if (control.dataset.featureOriginalAriaLabel !== undefined) {
      const original = control.dataset.featureOriginalAriaLabel;
      if (original) control.setAttribute('aria-label', original);
      else control.removeAttribute('aria-label');
      delete control.dataset.featureOriginalAriaLabel;
    }
    control.removeAttribute('aria-invalid');
  }

  function clearFeaturePresentation() {
    document.querySelectorAll('.feature-has-field-error').forEach(wrapper => {
      wrapper.classList.remove('feature-has-field-error');
      if (wrapper.matches('.additional-rom-controls')) {
        wrapper.querySelectorAll('[aria-describedby="additional-rom-error-dot"]').forEach(control => {
          control.removeAttribute('aria-describedby');
          control.removeAttribute('aria-invalid');
        });
      } else {
        restoreControlLabel(wrapper.querySelector('input, textarea, select, button, .readonly-id'));
      }
    });
  }

  // The dot is a real element rather than a pseudo-element on the field
  // wrapper. CSS cannot scope :hover to a pseudo-element, so the old
  // attribute-only feature version popped its tooltip from anywhere in the
  // field, including the hint line underneath it. A real element owns the hover.
  //
  // Updated in place, and swept in decorateCurrentFields only once its field
  // clears, so a field with a standing error causes no DOM mutation between
  // passes; its tooltip element is rebuilt only when the text changes. Until
  // piece 3 only the feature dots worked this way; the rest were deleted and
  // redrawn on every pass.
  //
  // .additional-rom-controls is the whole Advanced Config header row, so its
  // dot sits on the Additional ROM indicator inside it (the + button when there
  // is no indicator). Until 2026-10-11 it was a pseudo-element on the row: it
  // sat on the row's corner and popped its tooltip from anywhere on the row.
  function presentErrorDot(wrapper, entries) {
    const inButton = wrapper.matches('.additional-rom-controls');
    const host = inButton
      ? wrapper.querySelector('.additional-rom-indicator') || wrapper.querySelector('.additional-rom-add')
      : wrapper;
    if (!host) return null;
    let dot = host.querySelector(':scope > .field-error-dot');
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'field-error-dot';
      dot.setAttribute('role', 'img');
      // A focus stop inside a button is invalid, and the button already
      // announces this dot through aria-describedby (presentField).
      if (!inButton) dot.tabIndex = 0;
      host.appendChild(dot);
    }
    const messages = entries.map(entryText);
    const tooltip = messages.join('\n');
    if (dot.dataset.tooltip !== tooltip || !dot.querySelector(':scope > .error-dot-tip')) {
      dot.dataset.tooltip = tooltip;
      setDotTip(dot, entries);
    }
    const label = messages.join(' ');
    if (dot.getAttribute('aria-label') !== label) dot.setAttribute('aria-label', label);
    return dot;
  }

  // One field's dot, and the screen-reader half of its feature problems,
  // which are also written into the control's label (a build or v090 problem
  // is announced from the dot alone, as it always was).
  function presentField(wrapper, entries, featureEntries) {
    wrapper.classList.add('has-field-error');
    const dot = presentErrorDot(wrapper, entries);
    if (!featureEntries.length) return dot;
    wrapper.classList.add('feature-has-field-error');

    // The Additional ROM dot sits inside a button, whose children a screen
    // reader does not announce, and the indicator rewrites its own label on
    // every render. So the button points at the dot for its description
    // instead of having the message folded into its label.
    if (wrapper.matches('.additional-rom-controls')) {
      if (!dot) return null;
      dot.id = 'additional-rom-error-dot';
      dot.parentElement.setAttribute('aria-describedby', dot.id);
      dot.parentElement.setAttribute('aria-invalid', 'true');
      return dot;
    }

    const control = wrapper.querySelector('input, textarea, select, button, .readonly-id');
    if (!control) return dot;
    if (control.dataset.featureOriginalAriaLabel === undefined) {
      control.dataset.featureOriginalAriaLabel = control.getAttribute('aria-label') || '';
    }
    const original = control.dataset.featureOriginalAriaLabel;
    control.setAttribute('aria-label', `${original ? `${original}. ` : ''}${featureEntries.map(entryText).join(' ')}`);
    control.setAttribute('aria-invalid', 'true');
    return dot;
  }

  // Each field's dot entries, keyed by its wrapper, in the order they are
  // added, each once; the feature ones are also kept apart for the label.
  function collectFieldEntries() {
    const fields = new Map();
    const add = (wrapper, issue) => {
      if (!wrapper) return;
      const field = fields.get(wrapper) || { entries: [], feature: [] };
      const entry = { title: issue.title, message: issue.message };
      const lists = issue.system === 'feature' ? [field.entries, field.feature] : [field.entries];
      lists.forEach(list => {
        if (!list.some(known => dotText(known) === dotText(entry))) list.push(entry);
      });
      fields.set(wrapper, field);
    };
    return { fields, add };
  }

  // Draws every field's dot, then removes what no longer has a problem: a dot
  // not drawn this pass and a wrapper no longer marked. Scoped to the builder,
  // so the Additional ROM and Additional Checksums dialogs, which draw their
  // own dots, are never touched.
  function presentFields(container, fields) {
    const drawn = new Set();
    fields.forEach((field, wrapper) => {
      const dot = presentField(wrapper, field.entries, field.feature);
      if (dot) drawn.add(dot);
    });
    container.querySelectorAll('.field-error-dot').forEach(dot => {
      if (!drawn.has(dot)) dot.remove();
    });
    container.querySelectorAll('.has-field-error').forEach(wrapper => {
      if (!fields.has(wrapper)) wrapper.classList.remove('has-field-error');
    });
  }

  function decorateCurrentFields() {
    if (!accordionContext?.container?.isConnected) return;
    const ctx = window.VPS_MAIN?.validationContext?.();
    if (!ctx || !window.VPS_VALIDATION) return;

    const { container, steps } = accordionContext;
    const issues = window.VPS_VALIDATION.collectAllErrors(ctx);
    clearFeaturePresentation();
    const { fields, add } = collectFieldEntries();

    // Only the open tab is in the DOM, so only its dots can be drawn.
    const panel = container.querySelector('.config-tab-panel');
    const step = steps.find(candidate => candidate.id === panel?.dataset.step);
    if (step) {
      const onStep = system => issues.filter(issue => issue.system === system && issue.stepId === step.id);

      // An error with no field of its own (the long YAML line) goes on the
      // tab's first read-only field, in its own words. Until decision 5 that
      // dot said only "This section contains an unresolved validation error.",
      // and only when nothing else on the tab had a dot. So does an error whose
      // field is not on the page (none today), so a tab that counts an error
      // always shows its dot.
      const fallback = step.fields.find(field => field.readonly)
        || step.fields.find(field => !field.advanced)
        || step.fields[0];
      const drawnOn = fieldName => (fieldName && findFieldWrapper(container, fieldName) ? fieldName : fallback?.yml_field);
      const addOnStep = issue => {
        const fieldName = drawnOn(issue.fieldName);
        if (fieldName) add(findFieldWrapper(container, fieldName), issue);
      };
      onStep('build').filter(issue => issue.type === 'error').forEach(addOnStep);
      onStep('v090').forEach(addOnStep);
    }

    issues.filter(issue => issue.system === 'feature').forEach(issue => {
      // Scoped to the ROM tab: the VPX tab's Additional Passwords control
      // shares the .additional-rom-controls class, and an unscoped lookup put
      // Additional ROM errors on it whenever the VPX tab was open (2026-10-04).
      const wrapper = issue.fieldName === 'additionalRoms'
        ? document.querySelector('#config-panel-rom .additional-rom-controls')
        : document.getElementById(`field-${issue.fieldName}`)?.closest('.field');
      if (wrapper && container.contains(wrapper)) add(wrapper, issue);
    });

    presentFields(container, fields);
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

  // For the controllers that change state outside an input or change event
  // (an archive scan finishing, a dialog saving) and redraw at once. setTip
  // lets a dialog that draws its own dots give them the same tooltip.
  window.VPS_ERROR_DOTS = Object.freeze({ refresh: decorateCurrentFields, setTip: setDotTip });

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

  // Clamped asset-detail values expose their full text as a hover tooltip.
  // Measured on hover rather than at render for the same reason as the hint
  // above: .asset-detail is display:none until its row is opened, and a hidden
  // element measures as zero (see the detached-node trap in VPXS UI Gotchas).
  document.addEventListener('mouseover', event => {
    const value = event.target instanceof Element ? event.target.closest('.asset-detail-value') : null;
    const cell = value?.closest('.asset-detail-cell');
    if (!cell) return;
    const clipped = value.scrollHeight > value.clientHeight + 1
      || value.scrollWidth > value.clientWidth + 1;
    if (clipped) cell.dataset.tooltip = value.textContent;
    else delete cell.dataset.tooltip;
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
