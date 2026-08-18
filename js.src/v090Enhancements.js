(() => {
  'use strict';

  const UI = window.VPS_UI;
  const { CATEGORY_CONFIG, WIZARD_STEPS } = window.VPS_YML_FIELDS || {};
  if (!UI || !CATEGORY_CONFIG || !Array.isArray(WIZARD_STEPS)) return;

  const STATUS_KEYS = ['green', 'yellow', 'orange', 'red', 'neutral'];
  const PRIORITY = { neutral: 0, green: 1, yellow: 2, orange: 3, red: 4 };
  const COLOR_FIELDS = ['coloredROMChecksum', 'coloredROMChecksumSecondary'];
  const colorExtensions = Object.create(null);

  const baseRenderTableStrip = UI.renderTableStrip.bind(UI);
  const baseRenderAssetMatrix = UI.renderAssetMatrix.bind(UI);
  const baseRenderAccordions = UI.renderAccordions.bind(UI);

  let latestSelections = null;
  let latestValues = null;
  let latestAccordion = null;
  let refreshFrame = 0;

  function queueRefresh() {
    if (refreshFrame) return;
    refreshFrame = window.requestAnimationFrame(() => {
      refreshFrame = 0;
      enhanceGameVpsId();
      enhanceAssetBadges();
      enhanceColorRomFields();
      decorateCustomValidation();
      refreshPreviewBreakdown();
    });
  }

  function hasOtherConfiguredAsset(selections, values) {
    return Object.entries(CATEGORY_CONFIG).some(([category, config]) => (
      category !== 'tableFiles'
      && (Boolean(selections?.[category]) || Boolean(config.bundleField && values?.[config.bundleField] === true))
    ));
  }

  function armConfigPanelWithoutVpx(selections, values) {
    if (!selections || selections.tableFiles || !hasOtherConfiguredAsset(selections, values)) return;

    Object.defineProperty(selections, 'tableFiles', {
      configurable: true,
      enumerable: false,
      get() {
        delete selections.tableFiles;
        return '__v090-config-panel__';
      },
      set(value) {
        delete selections.tableFiles;
        if (value !== undefined && value !== null && value !== '') selections.tableFiles = value;
      }
    });
  }

  UI.renderTableStrip = function renderTableStripV090(...args) {
    const result = baseRenderTableStrip(...args);
    queueRefresh();
    return result;
  };

  UI.renderAssetMatrix = function renderAssetMatrixV090(container, record, selections, values, callbacks) {
    latestSelections = selections;
    latestValues = values;
    const result = baseRenderAssetMatrix(container, record, selections, values, callbacks);
    armConfigPanelWithoutVpx(selections, values);
    queueRefresh();
    return result;
  };

  UI.renderAccordions = function renderAccordionsV090(container, steps, values, callbacks) {
    latestValues = values;

    const result = baseRenderAccordions(container, steps, values, callbacks);
    latestAccordion = { container, steps, values, callbacks };
    queueRefresh();
    return result;
  };

  async function copyText(text, button) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('Clipboard access is unavailable.');
      }
      button.classList.add('copied');
      button.dataset.tooltip = 'Copied';
      window.setTimeout(() => {
        button.classList.remove('copied');
        button.dataset.tooltip = 'Copy Game VPS ID';
      }, 1100);
    } catch (error) {
      console.warn('Unable to copy Game VPS ID', error);
    }
  }

  function enhanceGameVpsId() {
    const field = document.getElementById('field-tableVPSId');
    if (!field || field.classList.contains('readonly-code-line')) return;

    const value = String(latestValues?.tableVPSId || field.textContent || '').trim();
    const code = document.createElement('code');
    code.className = 'readonly-code-value';
    code.textContent = value;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'readonly-copy-button';
    button.dataset.tooltip = 'Copy Game VPS ID';
    button.setAttribute('aria-label', 'Copy Game VPS ID');
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2"/><rect x="4" y="7" width="12" height="14" rx="2"/></svg>';
    button.addEventListener('click', () => copyText(value, button));

    field.classList.add('readonly-code-line');
    field.setAttribute('role', 'group');
    field.setAttribute('aria-label', `Game VPS ID ${value}`);
    field.replaceChildren(code, button);
  }

  function configForBadge(badge) {
    return Object.values(CATEGORY_CONFIG).find(config => config.label === badge.textContent.trim());
  }

  function jumpToConfig(stepId) {
    const tab = document.getElementById(`config-tab-${stepId}`);
    if (!tab || tab.disabled) return;
    tab.click();
    window.requestAnimationFrame(() => {
      document.getElementById('builderSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      tab.focus({ preventScroll: true });
    });
  }

  function enhanceAssetBadges() {
    document.querySelectorAll('#tableBadges .asset-badge').forEach(badge => {
      badge.removeAttribute('title');
      if (!badge.classList.contains('state-green')) return;
      const config = configForBadge(badge);
      if (!config) return;

      if (badge.tagName === 'BUTTON') {
        badge.dataset.tooltip = `Jump to ${config.label}`;
        return;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = `${badge.className} can-jump`;
      button.textContent = badge.textContent;
      button.dataset.tooltip = `Jump to ${config.label}`;
      button.setAttribute('aria-label', `${config.label}: ready. Jump to ${config.label} tab.`);
      button.addEventListener('click', () => jumpToConfig(config.stepId));
      badge.replaceWith(button);
    });
  }

  function getExtension(filename) {
    return String(filename || '').toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  }

  function colorFieldName(wrapper) {
    if (wrapper?.classList.contains('field-color-checksum')) return 'coloredROMChecksum';
    if (wrapper?.classList.contains('field-color-secondary')) return 'coloredROMChecksumSecondary';
    return '';
  }

  function otherColorField(fieldName) {
    return fieldName === 'coloredROMChecksum' ? 'coloredROMChecksumSecondary' : 'coloredROMChecksum';
  }

  function allowedColorExtensions(fieldName) {
    const paired = document.getElementById('field-coloredROMPin2DMD')?.checked === true;
    if (!paired) return fieldName === 'coloredROMChecksum' ? ['.crz', '.pal', '.pac', '.cromc'] : [];
    const otherExtension = colorExtensions[otherColorField(fieldName)];
    return ['.pal', '.vni'].filter(extension => extension !== otherExtension);
  }

  function updateColorHints(preserveField = '') {
    const fields = [
      ['coloredROMChecksum', document.querySelector('.field-color-checksum .checksum-drop-hint')],
      ['coloredROMChecksumSecondary', document.querySelector('.field-color-secondary .checksum-drop-hint')]
    ];
    fields.forEach(([fieldName, hint]) => {
      if (!hint || fieldName === preserveField) return;
      // Never clobber an in-flight or completed drop status — this runs on
      // every DOM refresh, and rewriting these made drops look unresponsive.
      if (hint.classList.contains('error')
        || /^Processing /.test(hint.textContent)
        || /MD5 calculated/.test(hint.textContent)) return;
      const allowed = allowedColorExtensions(fieldName);
      // The primary field also accepts archives, which are scanned for the
      // Color ROM file(s) inside.
      const display = fieldName === 'coloredROMChecksum' && allowed.length
        ? [...allowed, '.zip', '.rar', '.7z']
        : allowed;
      hint.textContent = display.length
        ? `Drop ${display.join(' / ')} file to calculate MD5`
        : 'Enable PAL/VNI to use a second checksum';
    });
  }

  function enhanceColorRomFields() {
    const sources = latestValues?.__checksumSources || {};
    COLOR_FIELDS.forEach(fieldName => {
      const extension = sources[fieldName]?.extension?.toLowerCase();
      if (extension) colorExtensions[fieldName] = extension;
    });

    const secondary = document.querySelector('.field-color-secondary');
    if (secondary && !secondary.querySelector('.checksum-inline-hint')) {
      const status = secondary.querySelector('.checksum-drop-status');
      if (status) {
        const hint = document.createElement('span');
        hint.className = 'checksum-inline-hint';
        hint.append(document.createTextNode('('));
        const em = document.createElement('em');
        em.textContent = 'ROM name';
        hint.append(em, document.createTextNode(')'));
        status.appendChild(hint);
      }
    }
    updateColorHints();
  }

  function readValue(fieldName) {
    if (latestValues && Object.prototype.hasOwnProperty.call(latestValues, fieldName)) {
      return latestValues[fieldName];
    }
    const control = document.getElementById(`field-${fieldName}`);
    if (!control) return '';
    if (control.matches('input[type="checkbox"]')) return control.checked;
    return control.value ?? control.textContent ?? '';
  }

  function hasText(value) {
    return Array.isArray(value)
      ? value.some(item => String(item || '').trim())
      : String(value ?? '').trim().length > 0;
  }

  function stepEnabled(stepId) {
    const step = WIZARD_STEPS.find(candidate => candidate.id === stepId);
    return Boolean(step && latestAccordion?.callbacks?.isEnabled?.(step));
  }

  function customValidationErrors() {
    const errors = [];
    const add = (stepId, fieldName, title, message) => errors.push({ stepId, fieldName, title, message });
    const pair = (stepId, urlField, versionField, label) => {
      if (!stepEnabled(stepId)) return;
      const hasUrl = hasText(readValue(urlField));
      const hasVersion = hasText(readValue(versionField));
      if (hasUrl && !hasVersion) add(stepId, versionField, `${label} version override is required`, `Add ${label} Version Override when using ${label} URL Override.`);
      if (hasVersion && !hasUrl) add(stepId, urlField, `${label} URL override is required`, `Add ${label} URL Override when using ${label} Version Override.`);
    };

    pair('rom', 'romUrlOverride', 'romVersionOverride', 'ROM');
    pair('coloredRom', 'coloredROMUrlOverride', 'coloredROMVersionOverride', 'Color ROM');
    pair('vpuPatch', 'diffUrlOverride', 'diffVersionOverride', 'Patch');

    if (stepEnabled('b2s') && hasText(readValue('backglassUrlOverride'))) {
      if (!hasText(readValue('backglassAuthorsOverride'))) {
        add('b2s', 'backglassAuthorsOverride', 'Backglass authors override is required', 'Add at least one Backglass Authors Override when using Backglass URL Override.');
      }
      if (!hasText(readValue('backglassImageOverride'))) {
        add('b2s', 'backglassImageOverride', 'Backglass image override is required', 'Add Backglass Image Override when using Backglass URL Override.');
      }
    }

    if (stepEnabled('vpuPatch') && !hasText(readValue('diffChecksum'))) {
      add('vpuPatch', 'diffChecksum', 'VPU Patch Checksum is required', 'Add a valid MD5 value for VPU Patch Checksum.');
    }
    return errors;
  }

  function fieldWrapper(fieldName) {
    return document.getElementById(`field-${fieldName}`)?.closest('.field') || null;
  }

  function clearCustomFieldDots() {
    document.querySelectorAll('.field-error-dot.v090-error-dot').forEach(dot => {
      const wrapper = dot.closest('.field');
      dot.remove();
      if (!wrapper?.querySelector('.field-error-dot')) wrapper?.classList.remove('has-field-error');
    });
  }

  function addCustomFieldDot(error) {
    const wrapper = fieldWrapper(error.fieldName);
    if (!wrapper) return;
    wrapper.classList.add('has-field-error');
    const dot = document.createElement('span');
    dot.className = 'field-error-dot v090-error-dot';
    dot.dataset.tooltip = error.message;
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', error.message);
    dot.tabIndex = 0;
    wrapper.appendChild(dot);
  }

  function decorateCustomValidation() {
    document.querySelectorAll('.field-error-dot[title]').forEach(dot => {
      dot.dataset.tooltip = dot.getAttribute('title') || dot.getAttribute('aria-label') || '';
      dot.removeAttribute('title');
      dot.tabIndex = 0;
    });

    clearCustomFieldDots();
    const errors = customValidationErrors();
    const activeStep = document.querySelector('#accordionStack .config-tab-panel')?.dataset.step;
    errors.filter(error => error.stepId === activeStep).forEach(addCustomFieldDot);

    // Tab-level has-error/has-warning classes are now written exclusively by
    // main.js's refreshTabStatuses(), which merges this same customValidationErrors()
    // output alongside base and feature validation into one canonical per-tab
    // status. Duplicating that write here used to race with it.
  }

  function appendCustomErrorsToDialog() {
    const errors = customValidationErrors();
    if (!errors.length) return;
    const list = document.querySelector('#validationBody .validation-list');
    if (!list) return;
    list.querySelector('.validation-item.success')?.remove();
    const existing = new Set([...list.querySelectorAll('.validation-item strong')].map(node => node.textContent));
    errors.forEach(error => {
      if (existing.has(error.title)) return;
      const item = document.createElement('li');
      item.className = 'validation-item error v090-validation-item';
      const title = document.createElement('strong');
      title.textContent = error.title;
      const message = document.createElement('span');
      message.textContent = error.message;
      item.append(title, message);
      list.appendChild(item);
    });
  }

  function openValidationWithCustomErrors() {
    document.getElementById('validateBtn')?.click();
    window.setTimeout(appendCustomErrorsToDialog, 0);
  }

  function firstErrorStep() {
    const custom = customValidationErrors();
    for (const step of WIZARD_STEPS) {
      if (!latestAccordion?.callbacks?.isEnabled?.(step)) continue;
      const internal = latestAccordion.callbacks.getStatus?.(step)?.className === 'error';
      if (internal || custom.some(error => error.stepId === step.id)) return step.id;
    }
    return '';
  }

  function navigateToFirstError() {
    decorateCustomValidation();
    const stepId = firstErrorStep();
    if (stepId) {
      jumpToConfig(stepId);
      window.setTimeout(() => {
        const panel = document.getElementById(`config-panel-${stepId}`);
        const target = panel?.querySelector('.field.has-field-error input:not(:disabled), .field.has-field-error textarea:not(:disabled), .field.has-field-error select:not(:disabled), .field.has-field-error button, .field.has-field-error .readonly-id')
          || panel?.querySelector('input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), .readonly-id');
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target?.focus?.({ preventScroll: true });
      }, 70);
      return;
    }

    const asset = document.querySelector('#assetMatrix .asset-status.state-red')?.closest('.asset-row');
    asset?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    asset?.querySelector('select:not(:disabled), input:not(:disabled), button:not(:disabled)')?.focus({ preventScroll: true });
  }

  function stateKey(element) {
    return STATUS_KEYS.find(key => element.classList.contains(`state-${key}`)) || 'neutral';
  }

  function emptyCounts() {
    return { green: 0, yellow: 0, orange: 0, red: 0, neutral: 0 };
  }

  function collectAssetCounts() {
    const counts = emptyCounts();
    document.querySelectorAll('#assetMatrix .asset-status').forEach(status => {
      if (/unavailable/i.test(status.textContent || '')) return;
      counts[stateKey(status)] += 1;
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

  function statusItems(counts, type) {
    const labels = type === 'assets'
      ? { green: 'Ready', yellow: 'Caution', orange: 'Action', red: 'Error', neutral: 'Not included' }
      : { green: 'Ready', yellow: 'Caution', orange: 'Warnings', red: 'Errors', neutral: 'Not included' };
    return STATUS_KEYS.filter(key => counts[key] > 0).map(key => ({ key, label: labels[key], count: counts[key] }));
  }

  function appendStatusGroup(target, title, items) {
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

  function refreshPreviewBreakdown() {
    const dot = document.getElementById('previewStatusDot');
    const breakdown = document.getElementById('previewStatusBreakdown');
    if (!dot || !breakdown) return;

    const assets = collectAssetCounts();
    const config = collectConfigCounts();
    const assetItems = statusItems(assets, 'assets');
    const configItems = statusItems(config, 'config');
    const overall = STATUS_KEYS.reduce((highest, key) => {
      const total = assets[key] + config[key];
      return total > 0 && PRIORITY[key] > PRIORITY[highest] ? key : highest;
    }, 'neutral');

    dot.className = `preview-dot state-${overall}`;
    dot.tabIndex = 0;
    dot.setAttribute('role', 'button');
    dot.removeAttribute('title');
    dot.setAttribute('aria-label', 'YAML build status. Activate to open the first validation error.');
    breakdown.replaceChildren();
    appendStatusGroup(breakdown, 'Assets', assetItems);
    appendStatusGroup(breakdown, 'Configuration', configItems);
  }

  function initHelpTabs() {
    const tabs = [...document.querySelectorAll('[data-help-tab]')];
    const panels = [...document.querySelectorAll('[data-help-panel]')];
    if (!tabs.length || !panels.length) return;

    const activate = name => {
      tabs.forEach(tab => {
        const active = tab.dataset.helpTab === name;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.tabIndex = active ? 0 : -1;
      });
      panels.forEach(panel => {
        const active = panel.dataset.helpPanel === name;
        panel.classList.toggle('active', active);
        panel.hidden = !active;
      });
    };

    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activate(tab.dataset.helpTab));
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let next = index;
        if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        activate(tabs[next].dataset.helpTab);
        tabs[next].focus();
      });
    });
  }

  document.addEventListener('drop', event => {
    const wrapper = event.target instanceof Element
      ? event.target.closest('.field-color-checksum, .field-color-secondary')
      : null;
    if (!wrapper || document.getElementById('field-coloredROMPin2DMD')?.checked !== true) return;
    const fieldName = colorFieldName(wrapper);
    const extension = getExtension(event.dataTransfer?.files?.[0]?.name);
    if (!fieldName || !extension) return;
    const otherExtension = colorExtensions[otherColorField(fieldName)];
    if (extension === otherExtension) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.__v090Blocked = true;
      const hint = wrapper.querySelector('.checksum-drop-hint');
      if (hint) {
        hint.classList.add('error');
        hint.textContent = `That extension is already used. Drop ${allowedColorExtensions(fieldName).join(' / ')} instead.`;
      }
    }
  }, true);

  document.addEventListener('drop', event => {
    if (event.__v090Blocked) return;
    const wrapper = event.target instanceof Element
      ? event.target.closest('.field-color-checksum, .field-color-secondary')
      : null;
    if (!wrapper) return;
    const fieldName = colorFieldName(wrapper);
    const extension = getExtension(event.dataTransfer?.files?.[0]?.name);
    if (!fieldName || !allowedColorExtensions(fieldName).includes(extension)) return;
    colorExtensions[fieldName] = extension;
    window.setTimeout(() => updateColorHints(fieldName), 0);
  });

  document.addEventListener('change', event => {
    if (event.target?.id === 'field-coloredROMPin2DMD') {
      delete colorExtensions.coloredROMChecksum;
      delete colorExtensions.coloredROMChecksumSecondary;
      window.setTimeout(() => updateColorHints(), 0);
    }
    queueRefresh();
  }, true);

  document.addEventListener('input', queueRefresh, true);

  document.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button) return;

    if (button.id === 'validateBtn') {
      window.setTimeout(appendCustomErrorsToDialog, 0);
      return;
    }

    if ((button.id === 'drawerCopyBtn' || button.id === 'downloadBtn') && customValidationErrors().length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openValidationWithCustomErrors();
    }
  }, true);

  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return;
    if (event.shiftKey && customValidationErrors().length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openValidationWithCustomErrors();
    } else {
      window.setTimeout(appendCustomErrorsToDialog, 0);
    }
  }, true);

  function init() {
    initHelpTabs();
    const dot = document.getElementById('previewStatusDot');
    dot?.addEventListener('click', navigateToFirstError);
    dot?.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      navigateToFirstError();
    });

    queueRefresh();
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(records => {
        const relevant = records.some(record => {
          const target = record.target instanceof Element ? record.target : record.target.parentElement;
          return !target?.closest('#previewStatusBreakdown');
        });
        if (relevant) queueRefresh();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  window.VPS_V090_VALIDATION = Object.freeze({ errors: customValidationErrors });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
