(() => {
  'use strict';
  const UI = window.VPS_UI;
  const fields = window.VPS_YML_FIELDS;
  const utils = window.VPS_UTILS;
  const runtime = window.VPS_FEATURE_RUNTIME;
  if (!UI || !fields || !utils || !runtime) return;

  const { CATEGORY_CONFIG } = fields;
  const { getCategoryItems, getItemLabel, isItemBroken, normalizeArray } = utils;
  const renderAssets = UI.renderAssetMatrix.bind(UI);
  const renderConfig = UI.renderAccordions.bind(UI);
  let controlFrame = 0;

  function authors(item) {
    const names = normalizeArray(item?.authors ?? item?.author);
    return names.length ? names.join(', ') : 'Unknown author';
  }

  function optionLabel(item, format) {
    const id = String(item?.id || 'Unknown ID');
    if (format === 'id-author') return `${id} · ${authors(item)}`;
    if (format === 'id-version-author') return `${id} · ${String(item?.version || '—')} · ${authors(item)}`;
    return getItemLabel(item);
  }

  function renderableSteps(steps, record) {
    return steps.map(step => ({
      ...step,
      fields: (step.fields || [])
        .filter(field => !field.customRenderer)
        .map(field => {
          if (!field.dynamicOptionsSource) return field;
          const rawItems = Array.isArray(record?.[field.dynamicOptionsSource]) ? record[field.dynamicOptionsSource] : [];
          const items = (utils.sortByUpdatedDesc ? utils.sortByUpdatedDesc(rawItems) : rawItems);
          const isEmpty = items.length === 0;
          return {
            ...field,
            disabled: isEmpty,
            options: [
              {
                label: isEmpty
                  ? `No ${field.name.replace(/ VPS ID$/i, '')}s available`
                  : `Select ${field.name.replace(/ VPS ID$/i, '')}`,
                value: ''
              },
              ...items.map(item => ({
                label: optionLabel(item, field.optionFormat),
                value: String(item?.id || '')
              }))
            ]
          };
        })
    }));
  }

  function relabelAssetOptions(container, record, selections) {
    Object.entries(CATEGORY_CONFIG).forEach(([category, config]) => {
      if (!config.optionFormat) return;
      const select = container.querySelector(`.asset-row[data-category="${utils.cssEscape(category)}"] select`);
      if (!select) return;
      const items = getCategoryItems(record, category, config, { selections });
      [...select.options].slice(1).forEach(option => {
        const item = items.find(candidate => String(candidate?.id || '') === option.value);
        if (!item) return;
        option.textContent = optionLabel(item, config.optionFormat) + (isItemBroken(item) ? ' · Broken' : '');
      });
    });
  }

  function applyControlCorrections() {
    controlFrame = 0;
    document.getElementById('field-tutorialVPSId')?.closest('.field')?.classList.add('field-main-tutorial');
    window.VPS_FEATURE_VALIDATION?.refresh?.();
    // Re-run after the capture-phase refreshFeatureUi call below, since that
    // one can fire before the target's own change handler has updated state
    // on the same event (e.g. toggling Color ROM's PAL/VNI checkbox) —
    // without this deferred pass the additional-checksum icon's visibility
    // would lag one event behind.
    window.VPS_CHECKSUM_ADDITIONAL?.render?.();
  }

  function scheduleControlCorrections() {
    if (controlFrame) return;
    controlFrame = window.requestAnimationFrame(() => {
      controlFrame = window.requestAnimationFrame(applyControlCorrections);
    });
  }

  function refreshFeatureUi() {
    window.VPS_ADDITIONAL_ROMS?.render?.();
    // Deliberately NOT called here — see applyControlCorrections. This
    // function also runs from capture-phase document input/change listeners
    // (below), which fire before the target field's own handler updates
    // state on the same event. Reading state that early — e.g. during YML
    // import, which sets a checksum input's .value programmatically without
    // focusing it, so the focus-guard in render() doesn't help — would
    // sync the input back to its still-stale (empty) value right before the
    // real handler even reads it, clobbering the value it was about to set.
    scheduleControlCorrections();
  }

  UI.renderAssetMatrix = function (container, record, selections, values, callbacks) {
    runtime.update({ record, selections, values });
    const result = renderAssets(container, record, selections, values, callbacks);
    relabelAssetOptions(container, record, selections);
    refreshFeatureUi();
    return result;
  };

  UI.renderAccordions = function (container, steps, values, callbacks) {
    runtime.update({ values, callbacks });
    const result = renderConfig(container, renderableSteps(steps, runtime.state.record), values, callbacks);
    refreshFeatureUi();
    return result;
  };

  document.addEventListener('input', refreshFeatureUi, true);
  document.addEventListener('change', refreshFeatureUi, true);

  window.VPS_PRODUCTION_UI_EXTENSIONS = Object.freeze({
    refresh: refreshFeatureUi,
    scheduleControlCorrections
  });
})();
