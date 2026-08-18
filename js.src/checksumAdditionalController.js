(() => {
  'use strict';
  const runtime = window.VPS_FEATURE_RUNTIME;
  const fields = window.VPS_YML_FIELDS;
  const utils = window.VPS_UTILS;
  if (!runtime || !fields || !utils) return;

  const { WIZARD_STEPS } = fields;
  const { isMd5Hash } = utils;

  // Every checksum field that gets the additional-checksum icon + modal.
  // Color ROM's primary checksum is included; its dedicated PAL/VNI
  // secondary field (coloredROMChecksumSecondary) is a separate mechanism
  // and is left untouched.
  const TARGET_FIELDS = [
    'vpxChecksum',
    'backglassChecksum',
    'romChecksum',
    'coloredROMChecksum',
    'pupChecksum',
    'altSoundChecksum',
    'diffChecksum'
  ];

  let activeField = null;

  function fieldDefinition(yml_field) {
    for (const step of WIZARD_STEPS) {
      const field = (step.fields || []).find(candidate => candidate.yml_field === yml_field);
      if (field) return field;
    }
    return { yml_field };
  }

  function fieldLabel(yml_field) {
    return fieldDefinition(yml_field).name || yml_field;
  }

  function fullValues(yml_field) {
    const raw = runtime.state.values?.[yml_field];
    if (Array.isArray(raw)) return raw.map(value => String(value || '').trim()).filter(Boolean);
    const single = String(raw || '').trim();
    return single ? [single] : [];
  }

  function additionalValues(yml_field) {
    return fullValues(yml_field).slice(1);
  }

  function commit(yml_field, additionalList) {
    const primary = fullValues(yml_field)[0] || '';
    const combined = [primary, ...additionalList].map(value => value.trim()).filter(Boolean);
    let next;
    if (!combined.length) next = undefined;
    else if (combined.length === 1) next = combined[0];
    else next = combined;
    runtime.state.callbacks?.onChange?.(yml_field, next, fieldDefinition(yml_field));
  }

  // A plain hover-tooltip (data-tooltip + ::before) gets clipped by the
  // dialog body's overflow:auto whenever the row is near the top of a
  // scrolled list, since the tooltip renders above the dot and escapes the
  // scroll container's bounds. Position-fixed + JS-placed avoids that
  // entirely, regardless of how far down the (unlimited-length) list a row
  // sits. Deliberately uses data-msg, not data-tooltip, so the shared
  // CSS-only tooltip component elsewhere in the app doesn't also fire here.
  function tooltipHost() {
    let host = document.getElementById('checksumAdditionalTooltip');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'checksumAdditionalTooltip';
    host.className = 'checksum-additional-tooltip';
    host.hidden = true;
    // Must live inside the <dialog> itself, not document.body — an open
    // <dialog> renders in the browser's top layer, which paints above the
    // rest of the document regardless of z-index, so a body-appended
    // sibling could never appear above it.
    dialog().appendChild(host);
    return host;
  }

  function showTooltip(dot) {
    const host = tooltipHost();
    host.textContent = dot.dataset.msg || '';
    host.hidden = false;
    const dotRect = dot.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    let left = dotRect.right - hostRect.width;
    left = Math.max(8, Math.min(left, window.innerWidth - hostRect.width - 8));
    let top = dotRect.top - hostRect.height - 7;
    if (top < 8) top = dotRect.bottom + 7;
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
  }

  function hideTooltip() {
    const host = document.getElementById('checksumAdditionalTooltip');
    if (host) host.hidden = true;
  }

  function validateRow(row, input) {
    const value = input.value.trim();
    const valid = !value || isMd5Hash(value);
    row.classList.toggle('has-field-error', !valid);
    let dot = row.querySelector('.field-error-dot');
    if (!valid) {
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'field-error-dot';
        dot.setAttribute('role', 'img');
        dot.tabIndex = 0;
        dot.addEventListener('mouseenter', () => showTooltip(dot));
        dot.addEventListener('mouseleave', hideTooltip);
        dot.addEventListener('focus', () => showTooltip(dot));
        dot.addEventListener('blur', hideTooltip);
        row.appendChild(dot);
      }
      const message = 'Checksum must contain exactly 32 hexadecimal characters.';
      dot.dataset.msg = message;
      dot.setAttribute('aria-label', message);
    } else {
      dot?.remove();
    }
    return valid;
  }

  function renumber(container) {
    [...container.querySelectorAll('.checksum-additional-row')].forEach((row, index) => {
      const label = `Additional Checksum ${index + 1}`;
      row.querySelector('label').textContent = label;
      row.querySelector('input').placeholder = label;
    });
  }

  function addRow(container, initialValue = '') {
    const row = document.createElement('div');
    row.className = 'field field-wide checksum-additional-row';

    const label = document.createElement('label');
    label.className = 'visually-hidden';

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 32;
    input.autocomplete = 'off';
    input.value = initialValue ? initialValue.toUpperCase() : '';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'checksum-additional-remove';
    removeBtn.setAttribute('aria-label', 'Remove checksum');
    removeBtn.innerHTML = closeIconSvg();

    row.append(label, input, removeBtn);
    container.appendChild(row);
    renumber(container);

    let wasEmpty = !initialValue;

    input.addEventListener('input', () => {
      const upper = input.value.toUpperCase();
      if (upper !== input.value) {
        const selectionStart = input.selectionStart;
        const selectionEnd = input.selectionEnd;
        input.value = upper;
        try { input.setSelectionRange(selectionStart, selectionEnd); } catch (_) { /* no-op */ }
      }
      validateRow(row, input);
      const isEmptyNow = !input.value.trim();
      if (wasEmpty && !isEmptyNow && row === container.lastElementChild) {
        wasEmpty = false;
        addRow(container, '');
      } else if (!wasEmpty && isEmptyNow) {
        wasEmpty = true;
      }
    });

    removeBtn.addEventListener('click', () => {
      row.remove();
      if (!container.querySelector('.checksum-additional-row')) addRow(container, '');
      renumber(container);
    });

    if (initialValue) validateRow(row, input);
    return row;
  }

  function dialog() {
    let node = document.getElementById('checksumAdditionalDialog');
    if (node) return node;
    node = document.createElement('dialog');
    node.id = 'checksumAdditionalDialog';
    node.className = 'app-dialog checksum-additional-dialog';
    node.setAttribute('aria-labelledby', 'checksumAdditionalTitle');
    node.innerHTML = `
      <div class="dialog-header">
        <div><p class="eyebrow">Checksum</p><h2 id="checksumAdditionalTitle">Additional Checksums</h2></div>
        <button class="dialog-close" data-checksum-additional-close type="button" aria-label="Close additional checksums">${closeIconSvg()}</button>
      </div>
      <div class="dialog-body checksum-additional-body">
        <div class="checksum-additional-list" id="checksumAdditionalList"></div>
        <div class="checksum-additional-dialog-actions">
          <button class="text-btn" data-checksum-additional-close type="button">Cancel</button>
          <button class="text-btn preview-primary" id="checksumAdditionalSave" type="button">Save</button>
        </div>
      </div>`;
    document.body.appendChild(node);
    node.querySelectorAll('[data-checksum-additional-close]').forEach(button => button.addEventListener('click', () => node.close()));
    node.addEventListener('click', event => { if (event.target === node) node.close(); });
    node.querySelector('#checksumAdditionalSave').addEventListener('click', save);
    return node;
  }

  function open(yml_field) {
    activeField = yml_field;
    const node = dialog();
    node.querySelector('#checksumAdditionalTitle').textContent = `Additional ${fieldLabel(yml_field)}`;
    const container = node.querySelector('#checksumAdditionalList');
    container.replaceChildren();
    additionalValues(yml_field).forEach(value => addRow(container, value));
    addRow(container, '');
    if (typeof node.showModal === 'function') node.showModal();
    else node.setAttribute('open', '');
    container.querySelector('input')?.focus();
  }

  function save() {
    if (!activeField) return;
    const node = dialog();
    const rows = [...node.querySelectorAll('.checksum-additional-row')];
    let hasError = false;
    const values = [];
    rows.forEach(row => {
      const input = row.querySelector('input');
      const value = input.value.trim();
      if (!value) return;
      if (!validateRow(row, input)) { hasError = true; return; }
      values.push(value);
    });
    if (hasError) return;
    commit(activeField, values);
    node.close();
    render();
    runtime.schedule();
  }

  function iconSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>';
  }

  // A text "×" glyph sits inconsistently within its own font metrics across
  // fonts/browsers, so it never quite lands in the center of a place-items:
  // center button — an SVG X is drawn on an exact grid and centers cleanly.
  function closeIconSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  }

  function render() {
    TARGET_FIELDS.forEach(yml_field => {
      const input = document.getElementById(`field-${yml_field}`);
      const wrapper = input?.closest('.field');
      if (!wrapper) return;

      let btn = wrapper.querySelector('.checksum-additional-btn');
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'checksum-additional-btn';
        btn.innerHTML = iconSvg();
        btn.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          open(yml_field);
        });
        wrapper.appendChild(btn);
      }

      // Color ROM's PAL/VNI mode owns the primary field via its own
      // primary+secondary mechanism — hide this modal's icon while that
      // mode is active rather than layering a second, conflicting mechanism
      // on top of it. Switching PAL/VNI on already clears the primary
      // checksum (main.js handleFieldChange), so nothing is stranded.
      const hideForColorRom = yml_field === 'coloredROMChecksum' && runtime.state.values?.coloredROMPin2DMD === true;
      btn.hidden = hideForColorRom;
      if (hideForColorRom) return;

      // The visible input only ever shows the primary (index 0). Saving the
      // modal can promote an additional entry into that slot (e.g. when the
      // primary was empty) without anything else re-rendering this input, so
      // sync it here — skipped while the user is actively typing in it.
      if (document.activeElement !== input) {
        const displayed = fullValues(yml_field)[0]?.toUpperCase() || '';
        if (input.value !== displayed) input.value = displayed;
      }

      const extra = additionalValues(yml_field);
      btn.classList.toggle('has-additional', extra.length > 0);
      btn.dataset.count = String(extra.length);
      const label = fieldLabel(yml_field);
      if (extra.length) {
        const tooltip = `${extra.length} additional checksum${extra.length === 1 ? '' : 's'} — click to edit`;
        btn.dataset.tooltip = tooltip;
        btn.setAttribute('aria-label', `${extra.length} additional checksums for ${label}. Activate to edit.`);
      } else {
        btn.dataset.tooltip = 'Add additional checksum';
        btn.setAttribute('aria-label', `Add additional checksum for ${label}`);
      }
    });
  }

  window.VPS_CHECKSUM_ADDITIONAL = Object.freeze({ render, open, additionalValues });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', dialog, { once: true });
  else dialog();
})();
