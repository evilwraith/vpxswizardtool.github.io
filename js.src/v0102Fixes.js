(() => {
  'use strict';

  const STATUS_KEYS = ['green', 'yellow', 'orange', 'red', 'neutral'];
  const PRIORITY = { neutral: 0, green: 1, yellow: 2, orange: 3, red: 4 };
  let refreshFrame = 0;

  function stateKey(element) {
    return STATUS_KEYS.find(key => element?.classList.contains(`state-${key}`)) || 'neutral';
  }

  function emptyCounts() {
    return { green: 0, yellow: 0, orange: 0, red: 0, neutral: 0 };
  }

  function isUnusedAvailableAsset(row, status) {
    if (stateKey(status) !== 'yellow' || !/available/i.test(status.textContent || '')) return false;

    const selected = String(row?.querySelector('select')?.value || '').trim();
    const bundled = row?.querySelector('.bundle-toggle input[type="checkbox"]')?.checked === true;
    return !selected && !bundled;
  }

  function collectAssetCounts() {
    const counts = emptyCounts();

    document.querySelectorAll('#assetMatrix .asset-row').forEach(row => {
      const status = row.querySelector('.asset-status');
      if (!status || /unavailable/i.test(status.textContent || '')) return;
      if (isUnusedAvailableAsset(row, status)) return;
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

    return STATUS_KEYS
      .filter(key => counts[key] > 0)
      .map(key => ({ key, label: labels[key], count: counts[key] }));
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

  function refreshPreviewStatus() {
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

  function queuePreviewRefresh() {
    if (refreshFrame) return;
    refreshFrame = window.requestAnimationFrame(() => {
      refreshFrame = 0;
      window.requestAnimationFrame(refreshPreviewStatus);
    });
  }

  // Guards only the #builderSection element's own scrollIntoView, instead of
  // patching Element.prototype for the entire page. Any call site (main.js,
  // v090Enhancements.js, ymlImport.js) that scrolls builderSection into view
  // is still suppressed while an import is loading; every other element on
  // the page is completely unaffected.
  function preventImportAutoScroll() {
    const builderSection = document.getElementById('builderSection');
    if (!builderSection || builderSection.__v0102ScrollGuarded) return;

    const originalScrollIntoView = builderSection.scrollIntoView.bind(builderSection);

    builderSection.scrollIntoView = (...args) => {
      const importControl = document.getElementById('ymlImportDrop');
      const isImporting = importControl?.classList.contains('is-loading') === true;

      if (isImporting) return undefined;
      return originalScrollIntoView(...args);
    };

    builderSection.__v0102ScrollGuarded = true;
  }

  function observeStatusSources() {
    if (typeof MutationObserver === 'undefined') return;

    const observer = new MutationObserver(queuePreviewRefresh);
    const assetMatrix = document.getElementById('assetMatrix');
    const accordionStack = document.getElementById('accordionStack');
    const preview = document.getElementById('previewYaml');

    if (assetMatrix) observer.observe(assetMatrix, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'value', 'checked'] });
    if (accordionStack) observer.observe(accordionStack, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled'] });
    if (preview) observer.observe(preview, { childList: true, subtree: true, characterData: true });
  }

  function init() {
    preventImportAutoScroll();
    observeStatusSources();
    document.addEventListener('input', queuePreviewRefresh, true);
    document.addEventListener('change', queuePreviewRefresh, true);
    queuePreviewRefresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
