(() => {
  'use strict';
  const runtime = window.VPS_FEATURE_RUNTIME;
  const utils = window.VPS_UTILS;
  if (!runtime || !utils) return;
  const { isMd5Hash, normalizeArray } = utils;

  function errors() {
    const output = [];
    const add = (stepId, fieldName, title, message) => output.push({ stepId, fieldName, title, message });
    const { selections, values } = runtime.state;

    const altSoundSelected = Boolean(selections?.altSoundFiles || values?.altSoundVPSId);
    const altSoundBundled = values?.altSoundBundled === true;
    const altSoundOverride = values?.altSoundOverride === true;
    const altSoundUrl = String(values?.altSoundUrlOverride || '').trim();
    const altSoundVersion = String(values?.altSoundVersionOverride || '').trim();
    const altSoundActive = altSoundSelected || altSoundBundled || Boolean(altSoundUrl || altSoundVersion);
    // Checksum and Archive Format are required whenever the tab is enabled
    // at all — selected, bundled, or overridden — same as PUP Pack's
    // unconditionally-required fields.
    const altSoundEnabled = altSoundActive || altSoundOverride;

    if (altSoundEnabled) {
      const checksums = normalizeArray(values?.altSoundChecksum);
      if (!checksums.length) {
        add('altSound', 'altSoundChecksum', 'Alt Sound Checksum is required', 'Add at least one valid MD5 value whenever Alt Sound is selected, overridden, or bundled.');
      } else if (checksums.some(checksum => !isMd5Hash(checksum))) {
        add('altSound', 'altSoundChecksum', 'Alt Sound Checksum is invalid', 'Every Alt Sound checksum must contain exactly 32 hexadecimal characters.');
      }
      if (!String(values?.altSoundArchiveFormat || '').trim()) {
        add('altSound', 'altSoundArchiveFormat', 'Alt Sound Archive Format is required', 'Choose ZIP, RAR, or 7Z.');
      }
    }

    if (altSoundSelected && altSoundUrl) {
      add('altSound', 'altSoundUrlOverride', 'Choose one Alt Sound source', 'Use either Alt Sound VPS ID or Alt Sound URL Override, not both.');
    }
    if (altSoundUrl && !altSoundVersion) {
      add('altSound', 'altSoundVersionOverride', 'Alt Sound Version Override is required', 'Add Alt Sound Version Override whenever Alt Sound URL Override is used.');
    }
    if (altSoundVersion && !altSoundUrl) {
      add('altSound', 'altSoundUrlOverride', 'Alt Sound URL Override is required', 'Add Alt Sound URL Override whenever Alt Sound Version Override is used.');
    }
    if (altSoundBundled && !String(values?.altSoundNotes || '').trim()) {
      add('altSound', 'altSoundNotes', 'Alt Sound Notes are required', 'Add Alt Sound Notes when the Alt Sound ships inside the table download.');
    }
    if (altSoundUrl && !String(values?.altSoundNotes || '').trim()) {
      add('altSound', 'altSoundNotes', 'Alt Sound Notes are required', 'Add Alt Sound Notes when using Alt Sound URL Override.');
    }
    if (altSoundBundled && !String(values?.altSoundArchiveRoot || '').trim()) {
      add('altSound', 'altSoundArchiveRoot', 'Alt Sound Archive Root is required', 'Choose the Alt Sound root folder from the uploaded Alt Sound archive.');
    }
    // Bundled means the Alt Sound ships inside the table's own download —
    // no external Authors/URL/Version Override needed, only Notes and
    // Archive Root (above). Override (no VPS entry) still requires the
    // full Advanced Config set via fields.js's overrideRequiredFields.

    const tutorialId = String(values?.tutorialVPSId || '').trim();
    if (tutorialId && !runtime.state.record?.tutorialFiles?.some(item => String(item?.id || '') === tutorialId)) {
      add('main', 'tutorialVPSId', 'Tutorial VPS ID is unavailable', 'Choose an available tutorial for this table.');
    }

    window.VPS_ADDITIONAL_ROMS?.entries?.().forEach((entry, index) => {
      window.VPS_ADDITIONAL_ROMS.validateEntry(entry, index).forEach(message => {
        add('rom', 'additionalRoms', `Additional ROM ${index + 1} needs attention`, message);
      });
    });
    return output;
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

  function clearPresentation() {
    document.querySelectorAll('.feature-has-field-error').forEach(wrapper => {
      wrapper.classList.remove('feature-has-field-error');
      wrapper.removeAttribute('data-feature-error-message');
      wrapper.removeAttribute('data-feature-error-count');
      const control = wrapper.matches('.additional-rom-controls')
        ? wrapper.querySelector('.additional-rom-add')
        : wrapper.querySelector('input, textarea, select, button, .readonly-id');
      restoreControlLabel(control);
      if (!wrapper.querySelector('.field-error-dot')) {
        wrapper.classList.remove('has-field-error');
        wrapper.removeAttribute('data-error-count');
      }
    });
  }

  function presentField(wrapper, messages) {
    if (!wrapper || !messages.length) return;
    wrapper.classList.add('has-field-error', 'feature-has-field-error');
    wrapper.dataset.errorCount = String(messages.length);
    wrapper.dataset.featureErrorCount = String(messages.length);
    wrapper.dataset.featureErrorMessage = messages.join(' ');

    const control = wrapper.matches('.additional-rom-controls')
      ? wrapper.querySelector('.additional-rom-add')
      : wrapper.querySelector('input, textarea, select, button, .readonly-id');
    if (!control) return;
    if (control.dataset.featureOriginalAriaLabel === undefined) {
      control.dataset.featureOriginalAriaLabel = control.getAttribute('aria-label') || '';
    }
    const original = control.dataset.featureOriginalAriaLabel;
    control.setAttribute('aria-label', `${original ? `${original}. ` : ''}${messages.join(' ')}`);
    control.setAttribute('aria-invalid', 'true');
  }

  function refresh() {
    clearPresentation();
    const grouped = new Map();

    errors().forEach(error => {
      const key = `${error.stepId}:${error.fieldName}`;
      const messages = grouped.get(key) || [];
      if (!messages.includes(error.message)) messages.push(error.message);
      grouped.set(key, messages);
    });

    grouped.forEach((messages, key) => {
      const fieldName = key.slice(key.indexOf(':') + 1);
      const wrapper = fieldName === 'additionalRoms'
        ? document.querySelector('.additional-rom-controls')
        : document.getElementById(`field-${fieldName}`)?.closest('.field');
      presentField(wrapper, messages);
    });
  }

  let bypassClick = false;

  function appendToDialog(currentErrors) {
    const dialog = document.getElementById('validationDialog');
    const body = document.getElementById('validationBody');
    if (!dialog || !body) return;
    let list = body.querySelector('.validation-list');
    if (!list) {
      list = document.createElement('ul');
      list.className = 'validation-list';
      body.replaceChildren(list);
    }
    list.querySelector('.validation-item.success')?.remove();
    const existing = new Set([...list.querySelectorAll('.validation-item strong')].map(node => node.textContent));
    currentErrors.forEach(error => {
      if (existing.has(error.title)) return;
      existing.add(error.title);
      const item = document.createElement('li');
      item.className = 'validation-item error feature-validation-item';
      const title = document.createElement('strong');
      title.textContent = error.title;
      const message = document.createElement('span');
      message.textContent = error.message;
      item.append(title, message);
      list.appendChild(item);
    });
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    refresh();
  }

  function runOriginalValidation(currentErrors) {
    bypassClick = true;
    document.getElementById('validateBtn')?.click();
    bypassClick = false;
    window.setTimeout(() => appendToDialog(currentErrors), 0);
  }

  function init() {
    document.addEventListener('click', event => {
      if (bypassClick) return;
      const action = event.target instanceof Element
        ? event.target.closest('#validateBtn, #drawerCopyBtn, #downloadBtn')
        : null;
      if (!action) return;
      const current = errors();
      if (!current.length) return;
      if (action.id === 'validateBtn') {
        window.setTimeout(() => appendToDialog(current), 0);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      runOriginalValidation(current);
    }, true);

    document.addEventListener('keydown', event => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return;
      const current = errors();
      if (!current.length) return;
      if (event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        runOriginalValidation(current);
      } else {
        window.setTimeout(() => appendToDialog(current), 0);
      }
    }, true);
  }

  window.VPS_FEATURE_VALIDATION = Object.freeze({ errors, refresh, appendToDialog });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();