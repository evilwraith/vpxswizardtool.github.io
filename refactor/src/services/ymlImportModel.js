(() => {
  'use strict';

  const { CATEGORY_CONFIG, WIZARD_STEPS } = window.VPS_YML_FIELDS || {};
  const assetCatalog = window.VPS_ASSET_CATALOG || window.VPS_UTILS;
  if (!CATEGORY_CONFIG || !Array.isArray(WIZARD_STEPS) || !assetCatalog) return;

  function allSupportedKeys() {
    const keys = new Set(['tableVPSId', 'enabled']);
    WIZARD_STEPS.forEach(step => {
      (step.fields || []).forEach(field => {
        keys.add(field.yml_field);
        (field.items || []).forEach(item => keys.add(item.yml_field));
      });
      if (step.bundleField) keys.add(step.bundleField);
    });
    Object.values(CATEGORY_CONFIG).forEach(config => {
      if (config.idField) keys.add(config.idField);
      if (config.bundleField) keys.add(config.bundleField);
    });
    return keys;
  }

  function normalizeImportedData(parsed) {
    const supported = allSupportedKeys();
    const values = {};
    const ignored = [];

    Object.entries(parsed || {}).forEach(([key, value]) => {
      if (!supported.has(key)) {
        ignored.push(key);
        return;
      }
      values[key] = value;
    });

    ['testers', 'backglassAuthorsOverride'].forEach(key => {
      if (Array.isArray(values[key])) values[key] = values[key].map(String).join(', ');
    });

    if (Array.isArray(values.coloredROMChecksum)) {
      const checksums = values.coloredROMChecksum.map(value => String(value ?? '').trim()).filter(Boolean);
      values.coloredROMChecksum = checksums[0] || '';
      values.coloredROMChecksumSecondary = checksums[1] || '';
      if (checksums.length > 1) values.coloredROMPin2DMD = true;
    }

    // Preserve `enabled: false` from the imported YAML. Anything else
    // (missing, or `enabled: true`) is normalised to "not disabled" and left
    // absent so it never round-trips back into generated YAML as `enabled: true`.
    if (values.enabled !== false) delete values.enabled;
    return { values, ignored };
  }

  function selectionsFromValues(values = {}) {
    const selections = {};
    Object.entries(CATEGORY_CONFIG).forEach(([category, config]) => {
      const importedId = String(values[config.idField] ?? '').trim();
      if (importedId) selections[category] = importedId;
    });
    return selections;
  }

  function validateImportedAssetIds(record, values) {
    const selections = selectionsFromValues(values);

    Object.entries(CATEGORY_CONFIG).forEach(([category, config]) => {
      const importedId = selections[category];
      if (!importedId) return;
      const items = assetCatalog.getCategoryItems(record, category, config, { selections });
      const item = items.find(candidate => String(candidate?.id || '') === importedId);
      if (!item || assetCatalog.isItemBroken(item)) {
        throw new Error(`${config.label} VPS ID “${importedId}” is not available for this table.`);
      }
    });

    return selections;
  }

  function categoryOrder() {
    return Object.entries(CATEGORY_CONFIG).sort(([left], [right]) => {
      if (left === 'tableFiles') return -1;
      if (right === 'tableFiles') return 1;
      if (left === 'vpuPatchFiles') return 1;
      if (right === 'vpuPatchFiles') return -1;
      return 0;
    });
  }

  window.VPS_YML_IMPORT_MODEL = Object.freeze({
    allSupportedKeys,
    normalizeImportedData,
    selectionsFromValues,
    validateImportedAssetIds,
    categoryOrder
  });
})();