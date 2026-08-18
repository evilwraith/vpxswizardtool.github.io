(() => {
  'use strict';

  const {
    CATEGORY_CONFIG,
    WIZARD_STEPS,
    OMIT_FROM_YAML,
    PRESET_FIELDS
  } = window.VPS_YML_FIELDS;
  const {
    buildYaml,
    highlightYaml,
    safeFilename,
    downloadText,
    copyText,
    isItemBroken,
    getCategoryItems,
    getAssetState,
    normalizeArray,
    isMd5Hash,
    normalizeChecksumValue
  } = window.VPS_UTILS;
  const SEARCH = window.VPS_SEARCH;
  const UI = window.VPS_UI;

  const STORAGE = {
    theme: 'vpxs-yml-theme',
    preferences: 'vpxs-yml-workspace-preferences-v2',
    draft: 'vpxs-yml-current-draft-v2',
    recent: 'vpxs-yml-recent-builds-v2'
  };

  const state = {
    database: null,
    record: null,
    selections: {},
    values: {},
    yaml: '---\n',
    openSteps: new Set(),
    activeStep: 'main',
    openAssetDetails: new Set(),
    recent: [],
    carryValues: {},
    validation: { errors: [], warnings: [] }
  };

  const dom = {};
  let suggestionTimer = null;
  let autosaveTimer = null;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cacheDom();
    initTheme();
    loadPreferences();
    loadRecent();
    bindDialogs();
    bindSearch();
    bindWorkspaceControls();
    bindKeyboardShortcuts();
    updatePreview();
    restoreDraft();
  }

  function cacheDom() {
    const ids = [
      'searchForm', 'idInput', 'searchBtn', 'suggestions', 'searchStatus', 'emptyState',
      'workspace', 'tableStrip', 'tableBadges', 'assetMatrix', 'changeTableBtn', 'builderSection',
      'accordionStack',
      'previewDrawer', 'previewYaml', 'previewLineCount', 'previewStatusDot', 'drawerCopyBtn',
      'validateBtn', 'downloadBtn', 'previewClearBtn', 'helpBtn', 'recentBtn',
      'helpDialog', 'validationDialog', 'validationBody', 'recentDialog', 'recentBody', 'clearHistoryBtn',
      'themeToggle', 'themeKnob'
    ];
    ids.forEach(id => { dom[id] = document.getElementById(id); });
  }

  function readStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function removeStorage(key) {
    try { localStorage.removeItem(key); } catch (_) { /* no-op */ }
  }

  function initTheme() {
    let savedTheme = null;
    try { savedTheme = localStorage.getItem(STORAGE.theme); } catch (_) { /* no-op */ }
    const preferred = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    setTheme(savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : preferred, false);
    dom.themeToggle.addEventListener('click', () => {
      setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
    });
  }

  function setTheme(theme, persist) {
    document.documentElement.dataset.theme = theme;
    dom.themeKnob.textContent = theme === 'dark' ? '🌙' : '☀️';
    dom.themeToggle.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
    dom.themeToggle.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
    if (persist) {
      try { localStorage.setItem(STORAGE.theme, theme); } catch (_) { /* no-op */ }
    }
  }

  function loadPreferences() {
    const preferences = readStorage(STORAGE.preferences, {});
    if (typeof preferences.activeStep === 'string') {
      state.activeStep = preferences.activeStep;
    }
  }

  function savePreferences() {
    writeStorage(STORAGE.preferences, {
      activeStep: state.activeStep
    });
  }


  function loadRecent() {
    const recent = readStorage(STORAGE.recent, []);
    state.recent = Array.isArray(recent) ? recent : [];
  }

  function bindDialogs() {
    dom.helpBtn.addEventListener('click', () => openDialog(dom.helpDialog));
    dom.recentBtn.addEventListener('click', () => {
      renderRecentDialog();
      openDialog(dom.recentDialog);
    });
    dom.clearHistoryBtn.addEventListener('click', () => {
      if (!state.recent.length) return;
      if (!window.confirm('Clear all recent build history? This cannot be undone.')) return;
      state.recent = [];
      removeStorage(STORAGE.recent);
      renderRecentDialog();
    });

    document.querySelectorAll('[data-close-dialog]').forEach(button => {
      button.addEventListener('click', () => button.closest('dialog')?.close());
    });

    document.querySelectorAll('dialog').forEach(dialog => {
      dialog.addEventListener('click', event => {
        if (event.target === dialog) dialog.close();
      });
    });
  }

  function openDialog(dialog) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function bindSearch() {
    dom.searchForm.addEventListener('submit', event => {
      event.preventDefault();
      searchCurrentInput();
    });

    dom.idInput.addEventListener('input', () => {
      window.clearTimeout(suggestionTimer);
      suggestionTimer = window.setTimeout(updateSuggestions, 120);
    });

    dom.idInput.addEventListener('keydown', event => {
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && SEARCH.state.results.length) {
        event.preventDefault();
        SEARCH.moveActive(event.key === 'ArrowDown' ? 1 : -1);
        renderSuggestions();
        const active = dom.suggestions.querySelector('.suggestion-item.active');
        dom.idInput.setAttribute('aria-activedescendant', active?.id || '');
        return;
      }
      if (event.key === 'Enter' && SEARCH.getActive()) {
        event.preventDefault();
        selectRecord(SEARCH.getActive());
        return;
      }
      if (event.key === 'Escape') closeSuggestions();
    });

    document.addEventListener('click', event => {
      if (!dom.suggestions.contains(event.target) && event.target !== dom.idInput) closeSuggestions();
    });
  }

  async function getDatabase() {
    if (state.database) return state.database;
    state.database = await window.fetchVPSDB();
    return state.database;
  }

  async function updateSuggestions() {
    const value = dom.idInput.value.trim();
    if (!value) {
      closeSuggestions();
      setSearchStatus('');
      return;
    }
    try {
      const data = await getDatabase();
      if (dom.idInput.value.trim() !== value) return;
      SEARCH.setResults(SEARCH.filterSuggestions(data, value));
      renderSuggestions();
    } catch (error) {
      closeSuggestions();
      setSearchStatus(error.message, true);
    }
  }

  function renderSuggestions() {
    UI.renderSuggestions(dom.suggestions, SEARCH.state.results, SEARCH.state.activeIndex, selectRecord);
    const open = SEARCH.state.results.length > 0;
    dom.idInput.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) dom.idInput.removeAttribute('aria-activedescendant');
  }

  function closeSuggestions() {
    window.clearTimeout(suggestionTimer);
    suggestionTimer = null;
    SEARCH.clear();
    dom.suggestions.innerHTML = '';
    dom.suggestions.classList.remove('active');
    dom.idInput.setAttribute('aria-expanded', 'false');
    dom.idInput.removeAttribute('aria-activedescendant');
  }

  async function searchCurrentInput() {
    const query = dom.idInput.value.trim();
    if (!query) {
      setSearchStatus('Enter a VPS table ID or table name.', true);
      dom.idInput.focus();
      return;
    }

    setSearchLoading(true);
    setSearchStatus(`Searching for “${query}”…`);
    try {
      const data = await getDatabase();
      const exact = SEARCH.findExactRecord(data, query);
      if (exact) {
        selectRecord(exact);
        return;
      }
      const matches = SEARCH.filterSuggestions(data, query);
      SEARCH.setResults(matches);
      renderSuggestions();
      if (matches.length === 1) selectRecord(matches[0]);
      else if (matches.length > 1) setSearchStatus(`Found ${matches.length} matches. Choose one.`);
      else setSearchStatus(`No VPS table matched “${query}”.`, true);
    } catch (error) {
      setSearchStatus(error.message, true);
    } finally {
      setSearchLoading(false);
    }
  }

  function setSearchLoading(loading) {
    dom.searchBtn.disabled = loading;
    dom.searchBtn.textContent = loading ? 'Loading…' : 'Search';
  }

  function setSearchStatus(message, isError = false) {
    dom.searchStatus.textContent = message;
    dom.searchStatus.classList.toggle('error', isError);
  }

  function getAvailableCategoryItems(category) {
    const config = CATEGORY_CONFIG[category];
    return config ? getCategoryItems(state.record, category, config, { selections: state.selections }) : [];
  }

  function clearAssetSelection(category) {
    const config = CATEGORY_CONFIG[category];
    if (!config) return;
    delete state.selections[category];
    delete state.values[config.idField];
    if (config.nsfwField && state.values[config.bundleField] !== true) delete state.values[config.nsfwField];
    state.openAssetDetails.delete(category);
    const step = WIZARD_STEPS.find(candidate => candidate.id === config.stepId);
    if (step) clearStepData(step, { preserveId: false, preserveBundle: true, preserveOverride: true, rerender: false });
  }

  function sanitizeAssetSelections() {
    Object.keys(CATEGORY_CONFIG).forEach(category => {
      const selectedId = state.selections[category];
      if (!selectedId) return;
      const isAvailable = getAvailableCategoryItems(category).some(item => String(item?.id || '') === selectedId);
      if (!isAvailable) clearAssetSelection(category);
    });
  }

  function syncVpuPatchSelection() {
    const selectedPatch = state.selections.vpuPatchFiles;
    if (!selectedPatch) return;
    const isAvailable = getAvailableCategoryItems('vpuPatchFiles')
      .some(item => String(item?.id || '') === selectedPatch);
    if (!isAvailable) clearAssetSelection('vpuPatchFiles');
  }

  function migrateBuildValues(input = {}) {
    const values = { ...input };

    if (values.vpuPatchVPSId && !values.diffVPSId) values.diffVPSId = values.vpuPatchVPSId;
    if (values.vpuPatchChecksum && !values.diffChecksum) values.diffChecksum = values.vpuPatchChecksum;
    delete values.vpuPatchVPSId;
    delete values.vpuPatchChecksum;

    if (Array.isArray(values.coloredROMChecksum)) {
      const checksums = values.coloredROMChecksum.map(value => String(value || '').trim()).filter(Boolean);
      values.coloredROMChecksum = checksums[0] || '';
      values.coloredROMChecksumSecondary = checksums[1] || '';
      if (checksums.length > 1) values.coloredROMPin2DMD = true;
    }

    if (values.coloredROMPin2DMD !== true) {
      delete values.coloredROMChecksumSecondary;
    }

    return values;
  }

  function selectRecord(record, options = {}) {
    const baseValues = options.values ? {} : (state.carryValues || {});
    state.record = record;
    state.selections = options.selections ? { ...options.selections } : {};
    state.values = migrateBuildValues({ ...baseValues, ...(options.values || {}), tableVPSId: record.id || '' });
    state.openAssetDetails = new Set(options.openAssetDetails || []);
    state.openSteps = new Set();
    state.activeStep = options.activeStep || state.activeStep || 'main';
    sanitizeAssetSelections();

    Object.entries(CATEGORY_CONFIG).forEach(([category, config]) => {
      const selected = state.selections[category];
      if (selected) state.values[config.idField] = selected;
    });

    pruneDisabledStepData();
    dom.idInput.value = record.id || record.name || '';
    closeSuggestions();
    setSearchStatus(`Loaded ${record.name || record.id || 'table'}.`);
    renderWorkspace();
    scheduleAutosave();
  }

  function renderWorkspace() {
    const hasRecord = Boolean(state.record);
    dom.emptyState.hidden = hasRecord;
    dom.workspace.hidden = !hasRecord;
    if (!hasRecord) return;

    UI.renderTableStrip(dom.tableStrip, state.record, state.selections, state.values, dom.tableBadges, { onJump: activateConfigTab, onNsfw: handleNsfwChange });
    UI.renderAssetMatrix(dom.assetMatrix, state.record, state.selections, state.values, {
      onSelect: handleAssetSelection,
      onBundle: handleBundleChange,
      onNsfw: handleNsfwChange,
      onOverride: handleOverrideChange,
      onToggleDetail: toggleAssetDetail,
      isDetailOpen: category => state.openAssetDetails.has(category)
    });

    const hasVpx = Boolean(state.selections.tableFiles);
    dom.builderSection.hidden = !hasVpx;
    updatePreview();
    updateValidationSummary();
    if (hasVpx) renderAccordions();
    dom.previewDrawer.setAttribute('aria-hidden', hasRecord ? 'false' : 'true');
  }

  function renderAccordions() {
    UI.renderAccordions(dom.accordionStack, WIZARD_STEPS, state.values, {
      isEnabled: isStepEnabled,
      getActiveStep: () => state.activeStep,
      onActivate: stepId => {
        state.activeStep = stepId;
        savePreferences();
        renderAccordions();
      },
      getStatus: getSectionStatus,
      onChange: handleFieldChange,
      onClear: step => clearStepData(step, { preserveId: true, preserveBundle: true, preserveOverride: true })
    });
  }

  function activateConfigTab(stepId) {
    const step = WIZARD_STEPS.find(candidate => candidate.id === stepId);
    if (!step || !isStepEnabled(step)) return;
    state.activeStep = stepId;
    savePreferences();
    renderAccordions();
    window.requestAnimationFrame(() => {
      dom.builderSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.getElementById(`config-tab-${stepId}`)?.focus({ preventScroll: true });
    });
  }

  function handleAssetSelection(category, itemId) {
    const config = CATEGORY_CONFIG[category];
    if (!config) return;
    const previous = state.selections[category] || '';

    if (itemId) {
      state.selections[category] = itemId;
      state.values[config.idField] = itemId;
    } else {
      delete state.selections[category];
      delete state.values[config.idField];
      if (config.nsfwField && state.values[config.bundleField] !== true) delete state.values[config.nsfwField];
      state.openAssetDetails.delete(category);
    }

    if (category === 'tableFiles') syncVpuPatchSelection();

    if (previous !== itemId) {
      const step = WIZARD_STEPS.find(candidate => candidate.id === config.stepId);
      if (step) clearStepData(step, { preserveId: true, preserveBundle: true, preserveOverride: true, rerender: false });
    }
    if (!itemId && !state.values[config.bundleField]) {
      const step = WIZARD_STEPS.find(candidate => candidate.id === config.stepId);
      if (step) clearStepData(step, { preserveId: false, preserveBundle: true, preserveOverride: true, rerender: false });
    }

    renderWorkspace();
    markChanged();
  }

  function handleBundleChange(fieldName, checked) {
    state.values[fieldName] = checked;
    const step = WIZARD_STEPS.find(candidate => candidate.bundleField === fieldName);
    // Bundled and Override are mutually exclusive — not native radio inputs
    // (either can be independently unchecked, leaving both off), but turning
    // one on always turns the other off.
    if (checked && step?.overrideField) state.values[step.overrideField] = false;
    if (!checked && step && !state.selections[step.category] && state.values[step.overrideField] !== true) {
      clearStepData(step, { preserveId: false, preserveBundle: false, preserveOverride: true, rerender: false });
      const config = Object.values(CATEGORY_CONFIG).find(candidate => candidate.bundleField === fieldName);
      if (config?.nsfwField) delete state.values[config.nsfwField];
    }
    renderWorkspace();
    markChanged();
  }

  function handleOverrideChange(fieldName, checked) {
    state.values[fieldName] = checked;
    const step = WIZARD_STEPS.find(candidate => candidate.overrideField === fieldName);
    if (checked && step?.bundleField) state.values[step.bundleField] = false;
    if (!checked && step && !state.selections[step.category] && state.values[step.bundleField] !== true) {
      clearStepData(step, { preserveId: false, preserveBundle: true, preserveOverride: false, rerender: false });
      const config = Object.values(CATEGORY_CONFIG).find(candidate => candidate.overrideField === fieldName);
      if (config?.nsfwField) delete state.values[config.nsfwField];
    }
    renderWorkspace();
    markChanged();
  }

  function handleNsfwChange(fieldName, checked) {
    if (checked) state.values[fieldName] = true;
    else delete state.values[fieldName];
    if (fieldName === 'nsfw' && checked) {
      // The table-level flag is exclusive: it replaces the per-asset flags,
      // which are cleared so they never coexist with `nsfw: true` in the YAML.
      Object.values(CATEGORY_CONFIG).forEach(config => {
        if (config.nsfwField) delete state.values[config.nsfwField];
      });
    }
    renderWorkspace();
    markChanged();
  }

  function toggleAssetDetail(category) {
    if (state.openAssetDetails.has(category)) state.openAssetDetails.delete(category);
    else state.openAssetDetails.add(category);
    renderWorkspace();
  }

  function isStepEnabled(step) {
    if (step.always) return true;
    if (step.category && state.selections[step.category]) return true;
    if (step.bundleField && state.values[step.bundleField] === true) return true;
    if (step.overrideField && state.values[step.overrideField] === true) return true;
    return false;
  }


  function handleFieldChange(key, value) {
    if (key.startsWith('__')) {
      state.values[key] = value;
      markChanged();
      return;
    }

    const previous = state.values[key];
    state.values[key] = value;

    if (key === 'coloredROMPin2DMD' && previous !== value) {
      const sources = { ...(state.values.__checksumSources || {}) };
      // A .pal checksum is valid in both modes, so it survives the toggle;
      // anything else (or a typed checksum with unknown provenance) is
      // cleared along with the secondary slot.
      const keepPrimary = String(sources.coloredROMChecksum?.extension || '').toLowerCase() === '.pal';
      if (!keepPrimary) {
        delete state.values.coloredROMChecksum;
        delete sources.coloredROMChecksum;
      }
      delete state.values.coloredROMChecksumSecondary;
      delete sources.coloredROMChecksumSecondary;
      state.values.__checksumSources = sources;
      UI.syncConditionalFields(state.values);
    }

    UI.renderTableStrip(dom.tableStrip, state.record, state.selections, state.values, dom.tableBadges, { onJump: activateConfigTab, onNsfw: handleNsfwChange });
    updatePreview();
    updateValidationSummary();
    refreshTabStatuses();
    markChanged();
  }

  function clearStepData(step, options = {}) {
    const preserveId = options.preserveId === true;
    const preserveBundle = options.preserveBundle === true;
    const preserveOverride = options.preserveOverride === true;

    const checksumSources = { ...(state.values.__checksumSources || {}) };
    step.fields.forEach(field => {
      if (field.readonly && preserveId) return;
      delete state.values[field.yml_field];
      delete state.values[`${field.yml_field}_check`];
      delete checksumSources[field.yml_field];
      if (Array.isArray(field.items)) {
        field.items.forEach(item => {
          delete state.values[item.yml_field];
          delete checksumSources[item.yml_field];
        });
      }
    });
    if (Object.keys(checksumSources).length) state.values.__checksumSources = checksumSources;
    else delete state.values.__checksumSources;
    if (step.id === 'pup') delete state.values.__pupArchiveDirectories;
    if (!preserveBundle && step.bundleField) delete state.values[step.bundleField];
    if (!preserveOverride && step.overrideField) delete state.values[step.overrideField];

    if (options.rerender !== false) {
      renderWorkspace();
      markChanged();
    }
  }

  function pruneDisabledStepData() {
    WIZARD_STEPS.forEach(step => {
      if (!isStepEnabled(step)) clearStepData(step, { preserveId: false, preserveBundle: true, preserveOverride: true, rerender: false });
    });
  }

  function getExtendedStepErrors(stepId) {
    const featureErrors = window.VPS_FEATURE_VALIDATION?.errors?.() || [];
    const v090Errors = window.VPS_V090_VALIDATION?.errors?.() || [];
    return [...featureErrors, ...v090Errors].filter(entry => entry.stepId === stepId);
  }

  function getSectionStatus(step) {
    if (!isStepEnabled(step)) return { label: 'Not included', className: 'disabled' };
    const stepErrors = state.validation.errors.filter(entry => entry.stepId === step.id);
    const stepWarnings = state.validation.warnings.filter(entry => entry.stepId === step.id);
    const extendedErrorCount = getExtendedStepErrors(step.id).length;
    const errorCount = stepErrors.length + extendedErrorCount;
    if (errorCount) return { label: `${errorCount} error${errorCount === 1 ? '' : 's'}`, className: 'error' };
    if (stepWarnings.length) return { label: `${stepWarnings.length} warning${stepWarnings.length === 1 ? '' : 's'}`, className: 'warning' };

    const keys = [];
    step.fields.forEach(field => {
      keys.push(field.yml_field);
      if (Array.isArray(field.items)) field.items.forEach(item => keys.push(item.yml_field));
    });
    const count = keys.filter(key => {
      const value = state.values[key];
      return value === true || (typeof value === 'string' && value.trim() !== '');
    }).length;
    return { label: count ? `${count} value${count === 1 ? '' : 's'}` : 'Ready', className: 'ready' };
  }

  function validateBuild() {
    const errors = [];
    const warnings = [];
    const addError = (stepId, title, message) => errors.push(issue('error', stepId, title, message));
    const addWarning = (stepId, title, message) => warnings.push(issue('warning', stepId, title, message));
    const hasText = value => typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null;

    if (!state.record) addError('main', 'No table selected', 'Search for and load a VPS table first.');
    if (!state.values.tableVPSId) addError('main', 'Missing table VPS ID', 'The selected table does not have a usable VPS ID.');
    if (!state.selections.tableFiles || !state.values.vpxVPSId) {
      addError('vpx', 'VPX file required', 'Select a VPX file before copying or downloading the configuration.');
    }

    const fpsRaw = state.values.fps;
    if (fpsRaw === '' || fpsRaw === undefined || fpsRaw === null) {
      addError('main', 'FPS is required', 'Enter the table frame rate as an integer.');
    } else if (!/^\d+$/.test(String(fpsRaw)) || !Number.isInteger(Number(fpsRaw))) {
      addError('main', 'FPS must be an integer', 'Use numbers only for FPS.');
    }

    const testers = normalizeArray(state.values.testers);
    if (!testers.length) {
      addError('main', 'Testers are required', 'Enter at least one tester; separate multiple names with commas.');
    }

    Object.entries(CATEGORY_CONFIG).forEach(([category, config]) => {
      const selectedId = state.selections[category];
      const items = getCategoryItems(state.record, category, config, { selections: state.selections });
      const item = items.find(candidate => String(candidate.id || '') === String(selectedId || ''));

      if (config.bundleField && selectedId && state.values[config.bundleField] === true) {
        addWarning(config.stepId, `${config.label} selected and bundled`, 'Choose either a separate VPS entry or bundled status unless both are intentionally required.');
      }
      if (selectedId && !item) {
        addError(config.stepId, `${config.label} ID is unavailable`, 'Choose an available VPS entry before copying or downloading.');
      } else if (item && isItemBroken(item)) {
        addError(config.stepId, `${config.label} entry is broken`, 'Choose another database entry before copying or downloading.');
      }
    });

    const validateChecksum = (key, stepId, label, options = {}) => {
      const rawValue = options.value !== undefined ? options.value : state.values[key];
      const hashes = normalizeChecksumValue(rawValue);
      if (options.required && !hashes.length) {
        addError(stepId, `${label} is required`, `Add a valid MD5 value for ${label}.`);
        return;
      }
      if (!hashes.length) return;
      if (Array.isArray(rawValue) && hashes.length < 2) {
        addError(stepId, `${label} list is invalid`, 'Use a plain string for one checksum or a list containing at least two checksums.');
      }
      hashes.forEach(hash => {
        if (!isMd5Hash(hash)) {
          addError(stepId, `${label} is not a valid MD5`, 'Each checksum must contain exactly 32 hexadecimal characters.');
        }
      });
    };

    validateChecksum('vpxChecksum', 'vpx', 'VPX Checksum', { required: true });

    const backglassOffered = Boolean(
      state.selections.b2sFiles || hasText(state.values.backglassUrlOverride) || state.values.backglassBundled === true
    );
    validateChecksum('backglassChecksum', 'b2s', 'Backglass Checksum', { required: backglassOffered });
    if (hasText(state.values.backglassUrlOverride) && !hasText(state.values.backglassNotes)) {
      addError('b2s', 'Backglass Notes are required', 'Add Backglass Notes when using Backglass URL Override.');
    }
    // Bundled means the Backglass ships inside the table's own download, so
    // no external URL/Authors/Image Override is needed — only Notes saying
    // where to find it. Override (no VPS entry at all) still requires the
    // full Advanced Config set via the generic overrideRequiredFields loop.
    if (state.values.backglassBundled === true && !hasText(state.values.backglassNotes)) {
      addError('b2s', 'Bundled Backglass needs notes', 'Describe the bundled Backglass and where it is located.');
    }

    const romOffered = Boolean(
      state.selections.romFiles || hasText(state.values.romUrlOverride) || state.values.romBundled === true
    );
    validateChecksum('romChecksum', 'rom', 'ROM Checksum', { required: romOffered });
    if (hasText(state.values.romUrlOverride) && state.values.romVPSId) {
      addError('rom', 'ROM ID conflicts with URL override', 'Use either ROM ID or ROM URL Override, not both.');
    }
    if (hasText(state.values.romUrlOverride) && !hasText(state.values.romVersionOverride)) {
      addError('rom', 'ROM version override is required', 'Add ROM Version Override when using ROM URL Override.');
    }
    if (hasText(state.values.romUrlOverride) && !hasText(state.values.romNotes)) {
      addError('rom', 'ROM Notes are required', 'Add ROM Notes when using ROM URL Override.');
    }
    // Bundled means the ROM ships inside the table's own download — no
    // external URL/Version Override needed, only Notes. Override (no VPS
    // entry) still requires the full set via overrideRequiredFields below.
    if (state.values.romBundled === true && !hasText(state.values.romNotes)) {
      addError('rom', 'Bundled ROM needs notes', 'Describe the bundled ROM and where it is located.');
    }

    const colorOffered = Boolean(
      state.selections.altColorFiles || hasText(state.values.coloredROMUrlOverride) || state.values.coloredROMBundled === true
    );
    const colorRawValue = state.values.coloredROMChecksum;
    const colorPrimary = String(Array.isArray(colorRawValue) ? (colorRawValue[0] ?? '') : (colorRawValue ?? '')).trim();
    const colorSecondary = String(state.values.coloredROMChecksumSecondary || '').trim();
    // Outside PAL/VNI mode, coloredROMChecksum may hold additional checksums
    // added via the checksum-additional modal — pass it through as-is
    // (string or array) instead of collapsing to just the primary value.
    const colorValue = state.values.coloredROMPin2DMD === true
      ? [colorPrimary, colorSecondary].filter(Boolean)
      : colorRawValue;
    validateChecksum('coloredROMChecksum', 'coloredRom', 'Color ROM Checksum', {
      required: colorOffered,
      value: colorValue
    });
    if (state.values.coloredROMPin2DMD === true && (!colorPrimary || !colorSecondary)) {
      addError('coloredRom', 'PAL/VNI requires two checksums', 'Add the .pal checksum and the .vni checksum.');
    }
    if (hasText(state.values.coloredROMUrlOverride) && !hasText(state.values.coloredROMNotes)) {
      addError('coloredRom', 'Color ROM Notes are required', 'Add Color ROM Notes when using Color ROM URL Override.');
    }
    // Bundled means the Color ROM ships inside the table's own download —
    // no external URL/Version Override needed, only Notes. Override (no
    // VPS entry) still requires the full set via overrideRequiredFields.
    if (state.values.coloredROMBundled === true && !hasText(state.values.coloredROMNotes)) {
      addError('coloredRom', 'Bundled Color ROM needs notes', 'Describe the bundled Color ROM and where it is located.');
    }

    const pupOffered = Boolean(
      state.selections.pupPackFiles || hasText(state.values.pupFileUrl) || state.values.pupBundled === true || state.values.pupOverride === true
    );
    validateChecksum('pupChecksum', 'pup', 'PUP Pack Checksum', { required: pupOffered });
    if (state.values.pupBundled === true && !hasText(state.values.pupNotes)) {
      addError('pup', 'Bundled PUP Pack needs notes', 'Describe the bundled PUP Pack and where it is located.');
    }
    if (isStepEnabled(WIZARD_STEPS.find(step => step.id === 'pup'))) {
      [
        ['pupVersion', 'PUP Pack Version'],
        ['pupArchiveRoot', 'PUP Pack Archive Root'],
        ['pupArchiveFormat', 'PUP Pack Archive Format']
      ].forEach(([key, label]) => {
        if (!hasText(state.values[key])) {
          addError('pup', `${label} is required`, `Add ${label} before copying or downloading.`);
        }
      });
    }

    validateChecksum('diffChecksum', 'vpuPatch', 'VPU Patch Checksum');
    if (hasText(state.values.diffUrlOverride) && !hasText(state.values.diffNotes)) {
      addError('vpuPatch', 'Patch Notes are required', 'Add Patch Notes when using Patch URL Override.');
    }
    // Bundled means the VPU Patch ships inside the table's own download —
    // no external URL/Authors/Version Override needed, only Notes. Override
    // (no VPS entry) still requires the full set via overrideRequiredFields.
    if (state.values.diffBundled === true && !hasText(state.values.diffNotes)) {
      addError('vpuPatch', 'Bundled VPU Patch needs notes', 'Describe the bundled VPU Patch and where it is located.');
    }

    // Override unlocks a tab without a VPS ID; in exchange every field that
    // would otherwise have come from the VPS DB (each step's declared
    // overrideRequiredFields — its Advanced Config overrides, plus PUP
    // Notes) must be filled in by hand.
    WIZARD_STEPS.forEach(step => {
      if (!step.overrideField || state.values[step.overrideField] !== true) return;
      (step.overrideRequiredFields || []).forEach(key => {
        if (hasText(state.values[key])) return;
        const label = step.fields.find(field => field.yml_field === key)?.name || key;
        addError(step.id, `${label} is required`, `Add ${label} — Override requires every Advanced Config field since there is no VPS entry to pull it from.`);
      });
    });

    const yamlLines = state.yaml.split('\n');
    const longLine = yamlLines.find((line, index) => {
      if (line.length <= 120) return false;
      const previous = yamlLines[index - 1] || '';
      return previous.trim() !== '# yamllint disable-line rule:line-length';
    });
    if (longLine) {
      addError('main', 'YAML line exceeds 120 characters', 'Shorten the value or use a supported URL field so the generated file passes yamllint.');
    }

    state.validation = { errors, warnings };
    return state.validation;
  }

  function issue(type, stepId, title, message) {
    return { type, stepId, title, message };
  }

  function updateValidationSummary() {
    validateBuild();
  }

  function refreshTabStatuses() {
    dom.accordionStack.querySelectorAll('.config-tab').forEach(tab => {
      const step = WIZARD_STEPS.find(candidate => candidate.id === tab.dataset.step);
      if (!step) return;
      const status = getSectionStatus(step);
      tab.classList.remove('has-error', 'has-warning', 'has-ready');
      let marker = tab.querySelector('.config-tab-alert');
      if (status.className === 'error' || status.className === 'warning') {
        tab.classList.add(`has-${status.className}`);
        tab.title = status.label;
        if (!marker) {
          marker = document.createElement('span');
          marker.className = 'config-tab-alert';
          marker.setAttribute('aria-hidden', 'true');
          tab.appendChild(marker);
        }
        tab.setAttribute('aria-label', `${step.label}: ${status.label}`);
      } else {
        marker?.remove();
        tab.removeAttribute('title');
        tab.setAttribute('aria-label', step.label);
        if (status.className === 'ready') tab.classList.add('has-ready');
      }
    });
  }

  function showValidationDialog() {
    validateBuild();
    dom.validationBody.innerHTML = '';
    const all = [...state.validation.errors, ...state.validation.warnings];
    const list = document.createElement('ul');
    list.className = 'validation-list';
    if (!all.length) {
      const item = document.createElement('li');
      item.className = 'validation-item success';
      item.innerHTML = '<strong>Everything looks good.</strong><span>The build is ready to copy or download.</span>';
      list.appendChild(item);
    } else {
      all.forEach(entry => {
        const item = document.createElement('li');
        item.className = `validation-item ${entry.type}`;
        const title = document.createElement('strong');
        title.textContent = entry.title;
        const message = document.createElement('span');
        message.textContent = entry.message;
        item.append(title, message);
        list.appendChild(item);
      });
    }
    dom.validationBody.appendChild(list);
    renderAccordions();
    openDialog(dom.validationDialog);
  }

  function getOverallAssetState() {
    if (!state.record) return { key: 'neutral', label: 'No table loaded' };
    const priority = { neutral: 0, green: 1, yellow: 2, orange: 3, red: 4 };
    return Object.entries(CATEGORY_CONFIG)
      .map(([category, config]) => getAssetState(state.record, category, config, state.selections, state.values))
      .reduce((highest, current) => priority[current.key] > priority[highest.key] ? current : highest, { key: 'neutral', label: 'Unavailable' });
  }

  function updatePreviewStatusDot() {
    const overall = getOverallAssetState();
    dom.previewStatusDot.className = `preview-dot state-${overall.key}`;
    dom.previewStatusDot.title = overall.label;
    dom.previewStatusDot.setAttribute('aria-label', `Overall asset status: ${overall.label}`);
  }

  function updatePreview() {
    state.yaml = buildYaml(state.values, { omit: OMIT_FROM_YAML });
    dom.previewYaml.innerHTML = highlightYaml(state.yaml);
    const lineCount = state.yaml.trimEnd().split('\n').length;
    dom.previewLineCount.textContent = `${lineCount} ${lineCount === 1 ? 'LINE' : 'LINES'}`;
    updatePreviewStatusDot();
  }

  async function copyYaml(button) {
    validateBuild();
    if (state.validation.errors.length) {
      showValidationDialog();
      return;
    }
    try {
      await copyText(state.yaml);
      addRecentBuild('Copied');
      const previous = button.textContent;
      button.textContent = 'Copied';
      window.setTimeout(() => { button.textContent = previous; }, 1200);
    } catch (error) {
      setSearchStatus(error.message, true);
    }
  }

  function bindWorkspaceControls() {
    dom.changeTableBtn.addEventListener('click', () => startNext({ clearDraft: true, status: 'Build cleared. Search for another table.' }));
    dom.drawerCopyBtn.addEventListener('click', () => copyYaml(dom.drawerCopyBtn));
    dom.validateBtn.addEventListener('click', showValidationDialog);
    dom.downloadBtn.addEventListener('click', downloadYaml);
    dom.previewClearBtn.addEventListener('click', () => startNext({ clearDraft: true, status: 'Build cleared. Search for another table.' }));
  }

  function downloadYaml() {
    validateBuild();
    if (state.validation.errors.length) {
      showValidationDialog();
      return;
    }

    const filename = `${safeFilename(state.record?.id || 'output')}_table-config.yml`;
    downloadText(state.yaml, filename);
    state.carryValues = extractPresetValues(state.values);
    addRecentBuild('Downloaded', filename);
    setSearchStatus(`${filename} downloaded.`);
  }

  function startNext({ clearDraft = false, status = 'Search for another table.' } = {}) {
    if (clearDraft) removeStorage(STORAGE.draft);
    state.record = null;
    state.selections = {};
    state.values = {};
    // Clear is an explicit full reset — unlike a plain Download (which
    // intentionally leaves carryValues in place so the next similar table
    // keeps FPS/Testers/etc.), it must not let those carry into whatever
    // gets searched next.
    state.carryValues = {};
    state.openAssetDetails.clear();
    state.validation = { errors: [], warnings: [] };
    updatePreview();
    dom.workspace.hidden = true;
    dom.emptyState.hidden = false;
    dom.idInput.value = '';
    setSearchStatus(status);
    dom.idInput.focus();
  }

  function extractPresetValues(values) {
    const output = {};
    PRESET_FIELDS.forEach(key => {
      const value = values[key];
      if (value === true || (typeof value === 'string' && value.trim() !== '')) output[key] = value;
    });
    return output;
  }

  function getCurrentFilename() {
    return `${safeFilename(state.record?.id || 'output')}_table-config.yml`;
  }

  function addRecentBuild(action = 'Saved', filename = getCurrentFilename()) {
    if (!state.record) return false;
    const entry = {
      id: state.record.id || '',
      name: state.record.name || state.record.id || 'Unknown table',
      completedAt: new Date().toISOString(),
      action,
      filename,
      yaml: state.yaml,
      snapshot: {
        version: 3,
        record: state.record,
        selections: { ...state.selections },
        values: { ...state.values },
        activeStep: state.activeStep,
        openAssetDetails: [...state.openAssetDetails]
      }
    };
    state.recent = [entry, ...state.recent.filter(item => item.id !== entry.id)].slice(0, 8);
    return writeStorage(STORAGE.recent, state.recent);
  }

  async function copyRecentYaml(entry, button) {
    if (!entry.yaml) return;
    try {
      await copyText(entry.yaml);
      const previous = button.textContent;
      button.textContent = 'Copied';
      window.setTimeout(() => { button.textContent = previous; }, 1000);
    } catch (error) {
      setSearchStatus(error.message, true);
    }
  }

  function editRecentBuild(entry) {
    if (entry.snapshot?.record && entry.snapshot?.values) {
      dom.recentDialog.close();
      selectRecord(entry.snapshot.record, {
        selections: entry.snapshot.selections || {},
        values: entry.snapshot.values || {},
        activeStep: entry.snapshot.activeStep || 'main',
        openAssetDetails: entry.snapshot.openAssetDetails || [],
        restored: true
      });
      setSearchStatus(`Restored ${entry.name} from Recent Build History.`);
      return;
    }

    dom.recentDialog.close();
    dom.idInput.value = entry.id;
    searchCurrentInput();
  }

  function renderRecentDialog() {
    dom.recentBody.innerHTML = '';
    if (!state.recent.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-dialog';
      empty.textContent = 'Copied and downloaded builds will appear here.';
      dom.recentBody.appendChild(empty);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'recent-list';
    state.recent.forEach(entry => {
      const item = document.createElement('li');
      item.className = 'recent-item';
      const text = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = entry.name;
      const meta = document.createElement('small');
      const action = entry.action ? `${entry.action} · ` : '';
      meta.textContent = `${entry.id} · ${action}${new Date(entry.completedAt).toLocaleString()}`;
      text.append(title, meta);
      const actions = document.createElement('div');
      actions.className = 'recent-actions';

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'text-btn';
      edit.textContent = entry.snapshot ? 'Edit' : 'Load table';
      edit.addEventListener('click', () => editRecentBuild(entry));
      actions.appendChild(edit);

      if (entry.yaml) {
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'text-btn';
        copy.textContent = 'Copy';
        copy.addEventListener('click', () => copyRecentYaml(entry, copy));

        const download = document.createElement('button');
        download.type = 'button';
        download.className = 'text-btn';
        download.textContent = 'Download';
        download.addEventListener('click', () => downloadText(entry.yaml, entry.filename || `${safeFilename(entry.id || 'output')}_table-config.yml`));
        actions.append(copy, download);
      }

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'text-btn danger-btn';
      remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete ${entry.name} from recent build history`);
      remove.addEventListener('click', () => {
        state.recent = state.recent.filter(candidate => candidate !== entry);
        writeStorage(STORAGE.recent, state.recent);
        renderRecentDialog();
      });
      actions.appendChild(remove);
      item.append(text, actions);
      list.appendChild(item);
    });
    dom.recentBody.appendChild(list);
  }

  function markChanged() {
    scheduleAutosave();
  }

  function scheduleAutosave() {
    window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(saveDraft, 350);
  }

  function saveDraft() {
    if (!state.record) return;
    writeStorage(STORAGE.draft, {
      version: 2,
      savedAt: new Date().toISOString(),
      record: state.record,
      selections: state.selections,
      values: state.values,
      activeStep: state.activeStep,
      openAssetDetails: [...state.openAssetDetails]
    });
  }

  function restoreDraft() {
    const draft = readStorage(STORAGE.draft, null);
    if (!draft?.record || !draft?.values) return;
    selectRecord(draft.record, {
      selections: draft.selections || {},
      values: draft.values || {},
      activeStep: draft.activeStep || 'main',
      openAssetDetails: draft.openAssetDetails || [],
      restored: true
    });
    setSearchStatus(`Restored ${draft.record.name || draft.record.id || 'your previous build'}.`);
  }

  function bindKeyboardShortcuts() {
    document.addEventListener('keydown', event => {
      const target = event.target;
      const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;

      if (event.key === '/' && !isTyping) {
        event.preventDefault();
        dom.idInput.focus();
        dom.idInput.select();
        return;
      }


      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        if (event.shiftKey) downloadYaml();
        else showValidationDialog();
      }
    });
  }
})();
