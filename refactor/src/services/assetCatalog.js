(() => {
  'use strict';

  const EXCLUDED_VPX_FORMATS = new Set(['FP', 'FX', 'FX2', 'FX3']);

  function normalizeList(value) {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null || value === '') return [];
    return [value];
  }

  function isItemBroken(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.broken === true || item.broken === 'true') return true;

    const urls = item.urls;
    if (Array.isArray(urls)) {
      return urls.some(url => url && (url.broken === true || url.broken === 'true'));
    }
    if (urls && typeof urls === 'object') {
      return Object.values(urls).some(url => url && (url.broken === true || url.broken === 'true'));
    }
    return false;
  }

  function isExcludedVpxFormat(item) {
    return normalizeList(item?.tableFormat)
      .some(format => EXCLUDED_VPX_FORMATS.has(String(format).trim().toUpperCase()));
  }

  function isVpuPatchItem(item) {
    const features = item?.features ?? item?.Features;
    return normalizeList(features)
      .some(feature => String(feature).trim().toLowerCase().includes('vpu patch'));
  }

  function getParentId(item) {
    return String(item?.parentId ?? item?.parentID ?? item?.parentid ?? '').trim();
  }

  function uniqueItems(items) {
    const unique = new Map();
    items.filter(Boolean).forEach((item, index) => {
      const key = String(item?.id ?? `__index_${index}`);
      if (!unique.has(key)) unique.set(key, item);
    });
    return [...unique.values()];
  }

  const ITEM_UPDATED_KEYS = ['updatedAt', 'modifiedAt', 'lastUpdated', 'updated', 'createdAt'];

  function itemUpdatedTimestamp(item) {
    if (!item || typeof item !== 'object') return 0;
    for (const key of ITEM_UPDATED_KEYS) {
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

  function sortByUpdatedDesc(items) {
    if (!Array.isArray(items) || items.length < 2) return Array.isArray(items) ? items.slice() : [];
    return items
      .map((item, index) => ({ item, index, timestamp: itemUpdatedTimestamp(item) }))
      .sort((left, right) => right.timestamp - left.timestamp || left.index - right.index)
      .map(entry => entry.item);
  }

  function getCategoryItems(record, category, config = {}, context = {}) {
    if (!record) return [];

    if (category === 'tableFiles') {
      const tableFiles = Array.isArray(record.tableFiles) ? record.tableFiles : [];
      return sortByUpdatedDesc(tableFiles.filter(item => !isExcludedVpxFormat(item) && !isVpuPatchItem(item)));
    }

    if (category === 'vpuPatchFiles') {
      const sourceFields = Array.isArray(config.sourceFields) && config.sourceFields.length
        ? config.sourceFields
        : [category];
      const direct = sourceFields.flatMap(field => Array.isArray(record?.[field]) ? record[field] : []);
      const inferred = (Array.isArray(record.tableFiles) ? record.tableFiles : []).filter(isVpuPatchItem);
      const selectedVpxId = String(context?.selections?.tableFiles ?? context?.selectedVpxId ?? '').trim();

      return sortByUpdatedDesc(uniqueItems([...direct, ...inferred]).filter(item => {
        const parentId = getParentId(item);
        return !parentId || (selectedVpxId && parentId === selectedVpxId);
      }));
    }

    const sourceFields = Array.isArray(config.sourceFields) && config.sourceFields.length
      ? config.sourceFields
      : [category];
    for (const field of sourceFields) {
      if (Array.isArray(record?.[field])) return sortByUpdatedDesc(record[field]);
    }
    return [];
  }

  function getAssetState(record, category, config = {}, selections = {}, values = {}) {
    const items = getCategoryItems(record, category, config, { selections });
    const selectedId = String(selections?.[category] || '').trim();
    const bundled = Boolean(config.bundleField && values?.[config.bundleField] === true);

    if (selectedId && bundled) {
      return { key: 'orange', label: 'Conflict', active: true, safe: false, items };
    }
    if (selectedId || bundled) {
      return { key: 'green', label: selectedId ? 'Selected' : 'Bundled', active: true, safe: true, items };
    }
    if (!items.length) {
      return { key: 'neutral', label: 'Unavailable', active: false, safe: false, items };
    }
    if (config.required) {
      return { key: 'red', label: 'Required', active: true, safe: false, items };
    }
    return { key: 'yellow', label: 'Available', active: true, safe: false, items };
  }

  function getCoverUrl(record) {
    const groups = ['tableFiles', 'b2sFiles', 'romFiles', 'altColorFiles', 'pupPackFiles', 'vpuPatchFiles', 'mediaPackFiles'];
    return record?.imgUrl || groups.map(group => record?.[group]?.[0]?.imgUrl).find(Boolean) || '';
  }

  window.VPS_ASSET_CATALOG = {
    isItemBroken,
    isExcludedVpxFormat,
    isVpuPatchItem,
    getParentId,
    getCategoryItems,
    getAssetState,
    getCoverUrl
  };
})();
