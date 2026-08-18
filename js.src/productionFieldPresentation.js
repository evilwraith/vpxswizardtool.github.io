(() => {
  'use strict';

  const UI = window.VPS_UI;
  const runtime = window.VPS_FEATURE_RUNTIME;
  const fields = window.VPS_YML_FIELDS;
  const utils = window.VPS_UTILS;
  if (!UI || !runtime || !fields || !utils) return;

  const { CATEGORY_CONFIG } = fields;
  const baseRenderAssetMatrix = UI.renderAssetMatrix.bind(UI);
  const baseRenderAccordions = UI.renderAccordions.bind(UI);
  const NEW_FIELD_IDS = [
    'tutorialVPSId',
    'altSoundVPSId',
    'altSoundChecksum',
    'diffNotes',
    'diffAuthorsOverride'
  ];
  const DATE_KEYS = [
    'updatedAt',
    'modifiedAt',
    'lastUpdated',
    'updated',
    'createdAt'
  ];

  let presentationFrame = 0;

  function dateValue(item) {
    if (!item || typeof item !== 'object') return 0;
    for (const key of DATE_KEYS) {
      const raw = item[key];
      if (raw === undefined || raw === null || raw === '') continue;
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw < 100000000000 ? raw * 1000 : raw;
      }
      const parsed = Date.parse(String(raw));
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  }

  function sortRecentlyUpdated(items) {
    return (Array.isArray(items) ? items : [])
      .map((item, index) => ({ item, index, timestamp: dateValue(item) }))
      .sort((left, right) => right.timestamp - left.timestamp || left.index - right.index)
      .map(entry => entry.item);
  }

  function optionId(item) {
    return String(item?.id ?? item?.vpsId ?? '').trim();
  }

  function reorderSelect(select, items) {
    if (!select || !Array.isArray(items) || items.length < 2) return;

    const options = [...select.options];
    const emptyOptions = options.filter(option => option.value === '');
    const optionMap = new Map(options
      .filter(option => option.value !== '')
      .map(option => [String(option.value), option]));

    const sortedOptions = sortRecentlyUpdated(items)
      .map(item => optionMap.get(optionId(item)))
      .filter(Boolean);
    const sortedSet = new Set(sortedOptions);
    const remaining = options.filter(option => option.value !== '' && !sortedSet.has(option));
    const desired = [...emptyOptions, ...sortedOptions, ...remaining];

    if (desired.length !== options.length || desired.every((option, index) => option === options[index])) return;

    const selectedValue = select.value;
    select.replaceChildren(...desired);
    select.value = selectedValue;
  }

  function assetItems(category) {
    const config = CATEGORY_CONFIG[category];
    if (!config) return [];
    return utils.getCategoryItems(
      runtime.state.record,
      category,
      config,
      { selections: runtime.state.selections || {} }
    );
  }

  function sortAssetSelects() {
    document.querySelectorAll('#assetMatrix .asset-row[data-category]').forEach(row => {
      reorderSelect(row.querySelector('select'), assetItems(row.dataset.category));
    });
  }

  function sortTutorialSelect() {
    reorderSelect(
      document.getElementById('field-tutorialVPSId'),
      runtime.state.record?.tutorialFiles || []
    );
  }

  function sortAdditionalRomSelect() {
    reorderSelect(document.getElementById('additionalRomVpsId'), assetItems('romFiles'));
  }

  function hideNewFieldLabels() {
    NEW_FIELD_IDS.forEach(fieldId => {
      const control = document.getElementById(`field-${fieldId}`);
      const wrapper = control?.closest('.field');
      wrapper?.querySelector(':scope > label')?.classList.add('visually-hidden');
      if (fieldId === 'tutorialVPSId') wrapper?.classList.add('field-main-tutorial');
    });

    document.querySelectorAll('#additionalRomDialog .field > label')
      .forEach(label => label.classList.add('visually-hidden'));
  }

  function additionalRomName(item, entry, index) {
    return String(
      item?.name
      || item?.romName
      || item?.title
      || item?.version
      || item?.fileName
      || entry?.vpsId
      || `Additional ROM ${index + 1}`
    ).trim();
  }

  function decorateAdditionalRomIndicator() {
    const entries = window.VPS_ADDITIONAL_ROMS?.entries?.() || [];
    const indicator = document.querySelector('.additional-rom-indicator');
    const entry = entries[0];
    if (!indicator || !entry) return;

    const items = assetItems('romFiles');
    const item = items.find(candidate => optionId(candidate) === String(entry.vpsId || ''));
    const name = additionalRomName(item, entry, 0);
    const detail = String(entry.checksum || '').trim() || 'Checksum missing';
    const tooltip = `${name} · ${detail}`;
    if (indicator.dataset.tooltip !== tooltip) indicator.dataset.tooltip = tooltip;
    const label = `Additional ROM: ${name}. Activate to edit.`;
    if (indicator.getAttribute('aria-label') !== label) indicator.setAttribute('aria-label', label);
  }

  function applyPresentation() {
    presentationFrame = 0;
    sortAssetSelects();
    sortTutorialSelect();
    sortAdditionalRomSelect();
    hideNewFieldLabels();
    decorateAdditionalRomIndicator();
  }

  function schedulePresentation() {
    if (presentationFrame) return;
    presentationFrame = window.requestAnimationFrame(applyPresentation);
  }

  UI.renderAssetMatrix = function renderAssetMatrixWithPresentation(...args) {
    const result = baseRenderAssetMatrix(...args);
    schedulePresentation();
    return result;
  };

  UI.renderAccordions = function renderAccordionsWithPresentation(...args) {
    const result = baseRenderAccordions(...args);
    schedulePresentation();
    return result;
  };

  function init() {
    document.addEventListener('click', schedulePresentation, true);
    document.addEventListener('input', schedulePresentation, true);
    document.addEventListener('change', schedulePresentation, true);

    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(schedulePresentation);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    schedulePresentation();
  }

  window.VPS_PRODUCTION_FIELD_PRESENTATION = Object.freeze({
    sortRecentlyUpdated,
    refresh: schedulePresentation
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
