(() => {
  'use strict';

  const UI = window.VPS_UI;
  const { WIZARD_STEPS } = window.VPS_YML_FIELDS || {};
  if (!UI || !Array.isArray(WIZARD_STEPS)) return;

  const baseRenderTableStrip = UI.renderTableStrip.bind(UI);
  const baseRenderAccordions = UI.renderAccordions.bind(UI);

  let latestValues = null;
  let latestCallbacks = null;
  let correctionFrame = 0;

  function copyIconSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2"/><rect x="4" y="7" width="12" height="14" rx="2"/></svg>';
  }

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

  function addHeaderGameIdCopy(container, record) {
    const idText = String(record?.id || container?.querySelector('.table-id')?.textContent || '').trim();
    const idNode = container?.querySelector('.table-id');
    if (!idNode || !idText || container.querySelector('.table-id-copy-button')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'table-id-copy-button';
    button.dataset.tooltip = 'Copy Game VPS ID';
    button.setAttribute('aria-label', `Copy Game VPS ID ${idText}`);
    button.innerHTML = copyIconSvg();
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      copyText(idText, button);
    });

    idNode.insertAdjacentElement('afterend', button);
  }

  function applyColorChecksumPlaceholder(container = document) {
    const input = container.querySelector?.('#field-coloredROMChecksumSecondary')
      || document.getElementById('field-coloredROMChecksumSecondary');
    if (input) input.placeholder = 'Color ROM Checksum #2   (ROM name)';
  }

  function applyEnableTooltipCorrection() {
    const text = 'This option is disabled by default.';
    const enabledField = WIZARD_STEPS.find(step => step.id === 'main')?.fields
      .find(field => field.yml_field === 'enabled');
    if (enabledField) enabledField.tooltip = text;

    const tooltip = document.querySelector('.field-main-enabled .control-tooltip');
    if (tooltip && tooltip.textContent !== text) tooltip.textContent = text;
  }

  function applyCorrections(container = document) {
    applyColorChecksumPlaceholder(container);
    applyEnableTooltipCorrection();
  }

  function scheduleCorrections(container = document) {
    if (correctionFrame) return;
    correctionFrame = window.requestAnimationFrame(() => {
      correctionFrame = 0;
      applyCorrections(container);
    });
  }

  UI.renderTableStrip = function renderTableStripV091(container, record, ...rest) {
    const result = baseRenderTableStrip(container, record, ...rest);
    addHeaderGameIdCopy(container, record);
    return result;
  };

  UI.renderAccordions = function renderAccordionsV091(container, steps, values, callbacks) {
    latestValues = values;
    latestCallbacks = callbacks;
    const result = baseRenderAccordions(container, steps, values, callbacks);
    scheduleCorrections(container);
    return result;
  };

  function fieldDefinition(fieldName) {
    return WIZARD_STEPS
      .flatMap(step => step.fields || [])
      .find(field => field.yml_field === fieldName) || { yml_field: fieldName };
  }

  function clearColorChecksums() {
    const fieldNames = ['coloredROMChecksum', 'coloredROMChecksumSecondary'];
    const sources = { ...(latestValues?.__checksumSources || {}) };

    fieldNames.forEach(fieldName => {
      if (latestValues) delete latestValues[fieldName];
      delete sources[fieldName];

      const input = document.getElementById(`field-${fieldName}`);
      if (input) input.value = '';

      latestCallbacks?.onChange?.(fieldName, '', fieldDefinition(fieldName));
    });

    if (latestValues) {
      if (Object.keys(sources).length) latestValues.__checksumSources = sources;
      else delete latestValues.__checksumSources;
    }
    latestCallbacks?.onChange?.('__checksumSources', sources, { uiOnly: true });
    scheduleCorrections();
  }

  document.addEventListener('change', event => {
    if (event.target?.id === 'field-coloredROMPin2DMD' && !event.target.checked) {
      clearColorChecksums();
    }
    scheduleCorrections();
  }, true);

  document.addEventListener('input', event => {
    if (event.target?.id === 'field-coloredROMChecksumSecondary') {
      applyColorChecksumPlaceholder(event.target.closest('.field') || document);
    }
    scheduleCorrections();
  }, true);

  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('.clear-section-btn')) {
      window.setTimeout(() => scheduleCorrections(), 0);
    }
  }, true);

  function startCorrectionObserver() {
    if (typeof MutationObserver === 'undefined') return;
    const root = document.getElementById('accordionStack') || document.body;
    const observer = new MutationObserver(records => {
      const relevant = records.some(record => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        return target?.closest?.('#accordionStack');
      });
      if (relevant) scheduleCorrections();
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      applyEnableTooltipCorrection();
      scheduleCorrections();
      startCorrectionObserver();
    }, { once: true });
  } else {
    applyEnableTooltipCorrection();
    scheduleCorrections();
    startCorrectionObserver();
  }
})();
