(() => {
  'use strict';
  const runtime = window.VPS_FEATURE_RUNTIME;
  const fields = window.VPS_YML_FIELDS;
  const utils = window.VPS_UTILS;
  if (!runtime || !fields || !utils) return;

  const { CATEGORY_CONFIG, WIZARD_STEPS } = fields;
  const { getCategoryItems, getItemLabel, isItemBroken, isMd5Hash } = utils;
  let editingIndex = -1;

  function definition() {
    return WIZARD_STEPS.find(step => step.id === 'rom')?.fields
      .find(field => field.yml_field === 'additionalRoms') || { yml_field: 'additionalRoms' };
  }

  function entries() {
    return Array.isArray(runtime.state.values?.additionalRoms)
      ? runtime.state.values.additionalRoms.map(entry => ({ ...entry }))
      : [];
  }

  function allRoms() {
    return getCategoryItems(
      runtime.state.record,
      'romFiles',
      CATEGORY_CONFIG.romFiles,
      { selections: runtime.state.selections || {} }
    );
  }

  function choices(editIndex = -1) {
    const primary = String(runtime.state.selections?.romFiles || runtime.state.values?.romVPSId || '');
    const used = new Set(entries()
      .filter((_, index) => index !== editIndex)
      .map(entry => String(entry.vpsId || ''))
      .filter(Boolean));
    return allRoms()
      .filter(item => !isItemBroken(item))
      .filter(item => String(item?.id || '') !== primary)
      .filter(item => !used.has(String(item?.id || '')));
  }

  function validateEntryDetailed(entry, index = -1) {
    const errors = [];
    const add = (field, message) => errors.push({ field, message });
    // ROM Override means the primary ROM has no VPS DB entry at all — an
    // Additional ROM can't pull one from the DB either, so the picker is
    // disabled in the dialog (see open()) and not required here. The other
    // vpsId checks below are already gated on entry.vpsId being truthy, so
    // they naturally no-op once it's left empty.
    const overrideActive = runtime.state.values?.romOverride === true;
    if (!overrideActive && !entry.vpsId) add('vpsId', 'Select a ROM VPS ID.');
    if (!entry.checksum) add('checksum', 'Checksum is required.');
    else if (!isMd5Hash(entry.checksum)) add('checksum', 'Checksum must contain exactly 32 hexadecimal characters.');
    if (entry.urlOverride && !entry.versionOverride) add('versionOverride', 'Version Override is required when URL Override is used.');
    if (entry.versionOverride && !entry.urlOverride) add('urlOverride', 'URL Override is required when Version Override is used.');

    const primary = String(runtime.state.selections?.romFiles || runtime.state.values?.romVPSId || '');
    if (entry.vpsId && entry.vpsId === primary) add('vpsId', 'The primary ROM cannot also be an Additional ROM.');
    if (entry.vpsId && !allRoms().some(item => String(item?.id || '') === entry.vpsId)) {
      add('vpsId', 'The selected Additional ROM is not available for this table.');
    }
    if (entry.vpsId && entries().some((candidate, candidateIndex) => (
      candidateIndex !== index && String(candidate?.vpsId || '') === entry.vpsId
    ))) add('vpsId', 'That ROM is already in Additional ROMs.');
    return errors;
  }

  function validateEntry(entry, index = -1) {
    return validateEntryDetailed(entry, index).map(error => error.message);
  }

  const FIELD_CONTROL_IDS = {
    vpsId: 'additionalRomVpsId',
    checksum: 'additionalRomChecksum',
    versionOverride: 'additionalRomVersionOverride',
    urlOverride: 'additionalRomUrlOverride'
  };

  function clearFieldErrorPresentation(node) {
    node.querySelectorAll('.field.has-field-error').forEach(field => {
      field.classList.remove('has-field-error');
      field.removeAttribute('data-error-count');
      field.querySelector(':scope > .field-error-dot')?.remove();
    });
  }

  function presentFieldErrors(node, detailed) {
    clearFieldErrorPresentation(node);
    const grouped = new Map();
    detailed.forEach(({ field, message }) => {
      const messages = grouped.get(field) || [];
      if (!messages.includes(message)) messages.push(message);
      grouped.set(field, messages);
    });
    grouped.forEach((messages, field) => {
      const wrapper = node.querySelector(`#${FIELD_CONTROL_IDS[field]}`)?.closest('.field');
      if (!wrapper) return;
      wrapper.classList.add('has-field-error');
      wrapper.dataset.errorCount = String(messages.length);
      const dot = document.createElement('span');
      dot.className = 'field-error-dot';
      dot.dataset.tooltip = messages.join(' ');
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', messages.join(' '));
      dot.tabIndex = 0;
      wrapper.appendChild(dot);
    });
  }

  function md5(buffer) {
    const bytes = new Uint8Array(buffer);
    const length = bytes.length;
    const total = (((length + 8) >>> 6) + 1) * 64;
    const data = new Uint8Array(total);
    data.set(bytes);
    data[length] = 0x80;
    const view = new DataView(data.buffer);
    const bits = length * 8;
    view.setUint32(total - 8, bits >>> 0, true);
    view.setUint32(total - 4, Math.floor(bits / 0x100000000), true);
    const shifts = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
    const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0);
    const rotate = (value, amount) => ((value << amount) | (value >>> (32 - amount))) >>> 0;
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (let offset = 0; offset < total; offset += 64) {
      const words = new Uint32Array(16);
      for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, true);
      let a = a0, b = b0, c = c0, d = d0;
      for (let index = 0; index < 64; index += 1) {
        let f, g;
        if (index < 16) { f = (b & c) | ((~b) & d); g = index; }
        else if (index < 32) { f = (d & b) | ((~d) & c); g = (5 * index + 1) % 16; }
        else if (index < 48) { f = b ^ c ^ d; g = (3 * index + 5) % 16; }
        else { f = c ^ (b | (~d)); g = (7 * index) % 16; }
        const previousD = d;
        d = c;
        c = b;
        b = (b + rotate((a + f + constants[index] + words[g]) >>> 0, shifts[index])) >>> 0;
        a = previousD;
      }
      a0 = (a0 + a) >>> 0;
      b0 = (b0 + b) >>> 0;
      c0 = (c0 + c) >>> 0;
      d0 = (d0 + d) >>> 0;
    }
    return [a0, b0, c0, d0].map(value => [0,8,16,24]
      .map(shift => ((value >>> shift) & 0xff).toString(16).padStart(2, '0')).join('')).join('').toUpperCase();
  }

  function dialog() {
    let node = document.getElementById('additionalRomDialog');
    if (node) return node;
    node = document.createElement('dialog');
    node.id = 'additionalRomDialog';
    node.className = 'app-dialog additional-rom-dialog';
    node.setAttribute('aria-labelledby', 'additionalRomTitle');
    node.innerHTML = `
      <div class="dialog-header">
        <div><p class="eyebrow">ROM Configuration</p><h2 id="additionalRomTitle">Add Additional ROM</h2></div>
        <button class="dialog-close" data-additional-rom-close type="button" aria-label="Close additional ROM">×</button>
      </div>
      <div class="dialog-body additional-rom-body">
        <div class="field-grid additional-rom-grid">
          <div class="field field-wide"><label for="additionalRomVpsId"><span>VPS ID</span></label><select id="additionalRomVpsId"></select></div>
          <div class="field field-wide checksum-drop-field" id="additionalRomChecksumField">
            <label for="additionalRomChecksum"><span>Checksum</span></label>
            <input id="additionalRomChecksum" type="text" maxlength="32" placeholder="ROM Checksum" autocomplete="off">
            <span class="checksum-drop-status"><span class="checksum-drop-hint">Drop .zip / .rar / .7z file to calculate MD5</span></span>
          </div>
        </div>
        <details class="advanced-fields compact-advanced additional-rom-advanced" open>
          <summary><span class="advanced-chevron">›</span><span class="advanced-label">Advanced Config</span></summary>
          <div class="field-grid advanced-grid">
            <div class="field field-wide"><label for="additionalRomVersionOverride"><span>Version Override</span></label><input id="additionalRomVersionOverride" type="text" placeholder="ROM Version Override"></div>
            <div class="field field-wide"><label for="additionalRomUrlOverride"><span>URL Override</span></label><input id="additionalRomUrlOverride" type="url" placeholder="ROM URL Override"></div>
          </div>
        </details>
        <div class="additional-rom-dialog-actions">
          <button class="text-btn danger-btn" id="additionalRomRemove" type="button" hidden>Remove</button>
          <button class="text-btn" data-additional-rom-close type="button">Cancel</button>
          <button class="text-btn preview-primary" id="additionalRomSave" type="button">Save ROM</button>
        </div>
      </div>`;
    document.body.appendChild(node);
    node.querySelectorAll('[data-additional-rom-close]').forEach(button => button.addEventListener('click', () => node.close()));
    node.addEventListener('click', event => { if (event.target === node) node.close(); });
    node.querySelector('#additionalRomSave').addEventListener('click', save);
    node.querySelector('#additionalRomRemove').addEventListener('click', removeEditing);
    const checksumInput = node.querySelector('#additionalRomChecksum');
    checksumInput.addEventListener('input', () => {
      const upper = checksumInput.value.toUpperCase();
      if (upper === checksumInput.value) return;
      const selectionStart = checksumInput.selectionStart;
      const selectionEnd = checksumInput.selectionEnd;
      checksumInput.value = upper;
      try { checksumInput.setSelectionRange(selectionStart, selectionEnd); } catch (_) { /* no-op */ }
    });
    bindDrop(node);
    return node;
  }

  function bindDrop(node) {
    const wrapper = node.querySelector('#additionalRomChecksumField');
    const input = node.querySelector('#additionalRomChecksum');
    const hint = wrapper.querySelector('.checksum-drop-hint');
    const allowed = ['.zip', '.rar', '.7z'];
    const extension = name => String(name || '').toLowerCase().match(/\.[^.]+$/)?.[0] || '';
    ['dragenter', 'dragover'].forEach(type => wrapper.addEventListener(type, event => {
      event.preventDefault();
      wrapper.classList.add('checksum-drop-active');
    }));
    wrapper.addEventListener('dragleave', event => {
      if (!wrapper.contains(event.relatedTarget)) wrapper.classList.remove('checksum-drop-active');
    });
    wrapper.addEventListener('drop', async event => {
      event.preventDefault();
      wrapper.classList.remove('checksum-drop-active');
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      if (!allowed.includes(extension(file.name))) {
        hint.textContent = `Invalid file type. Allowed: ${allowed.join(', ')}`;
        hint.classList.add('error');
        return;
      }
      hint.classList.remove('error');
      hint.textContent = `Calculating MD5 for ${file.name}…`;
      wrapper.classList.add('checksum-is-loading');
      try {
        input.value = md5(await file.arrayBuffer());
        hint.textContent = `MD5 calculated from ${file.name}`;
      } catch (error) {
        hint.textContent = error?.message || 'MD5 calculation failed.';
        hint.classList.add('error');
      } finally {
        wrapper.classList.remove('checksum-is-loading');
      }
    });
  }

  function open(index = -1) {
    const node = dialog();
    editingIndex = index;
    const current = index >= 0 ? entries()[index] || {} : {};
    const select = node.querySelector('#additionalRomVpsId');
    // ROM Override means there's no VPS entry for the primary ROM — an
    // Additional ROM entry can't have one either, so the picker is disabled
    // and not populated (see validateEntryDetailed for the matching
    // not-required change).
    const overrideActive = runtime.state.values?.romOverride === true;
    select.replaceChildren(new Option(
      overrideActive ? 'Not needed — ROM Override is enabled' : 'Select an additional ROM', ''
    ));
    if (!overrideActive) {
      const items = choices(index);
      if (current.vpsId && !items.some(item => String(item?.id || '') === String(current.vpsId))) {
        items.unshift({ id: current.vpsId });
      }
      items.forEach(item => select.add(new Option(getItemLabel(item), String(item?.id || ''))));
    }
    select.value = String(current.vpsId || '');
    select.disabled = overrideActive;
    node.querySelector('#additionalRomChecksum').value = String(current.checksum || '');
    node.querySelector('#additionalRomVersionOverride').value = String(current.versionOverride || '');
    node.querySelector('#additionalRomUrlOverride').value = String(current.urlOverride || '');
    clearFieldErrorPresentation(node);
    node.querySelector('#additionalRomTitle').textContent = index >= 0 ? 'Edit Additional ROM' : 'Add Additional ROM';
    node.querySelector('#additionalRomRemove').hidden = index < 0;
    if (typeof node.showModal === 'function') node.showModal();
    else node.setAttribute('open', '');
    if (overrideActive) node.querySelector('#additionalRomChecksum').focus();
    else select.focus();
  }

  function removeEditing() {
    if (editingIndex < 0) return;
    const node = dialog();
    const next = entries();
    next.splice(editingIndex, 1);
    runtime.state.callbacks.onChange('additionalRoms', next, definition());
    node.close();
    render();
    runtime.schedule();
  }

  function save() {
    const node = dialog();
    const entry = {
      vpsId: node.querySelector('#additionalRomVpsId').value.trim(),
      checksum: node.querySelector('#additionalRomChecksum').value.trim(),
      versionOverride: node.querySelector('#additionalRomVersionOverride').value.trim(),
      urlOverride: node.querySelector('#additionalRomUrlOverride').value.trim()
    };
    const detailedErrors = validateEntryDetailed(entry, editingIndex);
    if (detailedErrors.length) {
      presentFieldErrors(node, detailedErrors);
      const firstInvalid = ['vpsId', 'checksum', 'versionOverride', 'urlOverride']
        .find(name => detailedErrors.some(error => error.field === name));
      if (firstInvalid) node.querySelector(`#${FIELD_CONTROL_IDS[firstInvalid]}`)?.focus();
      return;
    }
    clearFieldErrorPresentation(node);
    const next = entries();
    if (editingIndex >= 0) next[editingIndex] = entry;
    else next.push(entry);
    runtime.state.callbacks?.onChange?.('additionalRoms', next, definition());
    node.close();
    render();
    runtime.schedule();
  }

  const MAX_ADDITIONAL_ROMS = 1;

  function romIndicatorSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/></svg>';
  }

  function render() {
    const panel = document.getElementById('config-panel-rom');
    const advanced = panel?.querySelector('.compact-advanced');
    const summary = advanced?.querySelector(':scope > summary');
    if (!advanced || !summary || !runtime.state.callbacks) return;
    summary.classList.add('additional-rom-controls');

    let add = summary.querySelector('.additional-rom-add');
    if (!add) {
      add = document.createElement('button');
      add.type = 'button';
      add.className = 'additional-rom-add';
      add.textContent = '+';
      add.dataset.tooltip = 'ADD ADDITIONAL ROM';
      add.setAttribute('aria-label', 'Add Additional ROM');
      add.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        open();
      });
      summary.appendChild(add);
    }

    const current = entries();
    add.hidden = current.length >= MAX_ADDITIONAL_ROMS;

    let indicator = summary.querySelector('.additional-rom-indicator');
    if (!current.length) {
      indicator?.remove();
      return;
    }

    if (!indicator) {
      indicator = document.createElement('button');
      indicator.type = 'button';
      indicator.className = 'additional-rom-indicator';
      indicator.innerHTML = romIndicatorSvg();
      indicator.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        open(0);
      });
      summary.insertBefore(indicator, add);
    }
    const entry = current[0];
    const label = entry.vpsId || 'Additional ROM';
    const detail = entry.checksum || 'Checksum missing';
    indicator.dataset.tooltip = `${label} · ${detail}`;
    indicator.setAttribute('aria-label', `Additional ROM: ${label}. Activate to edit.`);
  }

  const api = Object.freeze({ entries, validateEntry, open, render });
  window.VPS_ADDITIONAL_ROMS = api;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', dialog, { once: true });
  else dialog();
})();
