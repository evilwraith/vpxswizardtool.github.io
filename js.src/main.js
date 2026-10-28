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
    getCategoryItems,
    getAssetState
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

    // Every writer keeps one checksum as a plain string and only two or more
    // as a list. A draft saved by an older build, or edited by hand, can still
    // hold a list of one, so it is brought into line here (Phase 2 decision 4,
    // Jason, 2026-10-12). The Color ROM checksum was split above.
    ['vpxChecksum', 'backglassChecksum', 'romChecksum', 'pupChecksum', 'altSoundChecksum', 'diffChecksum', 'specialDMDChecksum'].forEach(key => {
      if (!Array.isArray(values[key])) return;
      const checksums = values[key].map(value => String(value ?? '').trim()).filter(Boolean);
      if (checksums.length > 1) return;
      // Only a primary is promoted. A lone entry behind a blank first one is
      // a secondary (a bundled DMD's archive MD5 with the .vpx MD5 missing),
      // so the list is kept and the missing primary is still reported.
      if (checksums.length && !String(values[key][0] ?? '').trim()) return;
      if (checksums.length) values[key] = checksums[0];
      else delete values[key];
    });

    return values;
  }

  function selectRecord(record, options = {}) {
    const baseValues = options.values ? {} : (state.carryValues || {});
    state.record = record;
    state.selections = options.selections ? { ...options.selections } : {};
    state.values = migrateBuildValues({ ...baseValues, ...(options.values || {}), tableVPSId: record.id || '' });
    // Mirrored into values because the field renderer is handed state.values
    // and nothing else — renderAccordions' signature is re-wrapped by five
    // correction layers, so widening it is not worth the blast radius.
    // Kept out of the output by OMIT_FROM_YAML.
    state.values.__tableManufacturer = String(record.manufacturer || '');
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
      // The DMD row's dropdown writes specialDMDType straight through the
      // normal field path: it picks a type, not a VPS asset, so it must not go
      // through onSelect and land in `selections`. The extra renderWorkspace is
      // what lets the DMD tab unlock: handleFieldChange calls
      // refreshTabStatuses, which only repaints a tab's status classes and
      // never re-evaluates which tabs are enabled.
      onChange: (key, value) => {
        handleFieldChange(key, value);
        renderWorkspace();
      },
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

  // Which of a step's mirrored fields are live right now. A mirrored field is a
  // VIEW of another field's list entry rather than a value of its own - bundled,
  // the DMD checksum IS vpxChecksum's second entry - so the value lives on a tab
  // this step does not own, and a shape switch has to reach across to tear it
  // down. Nothing else in clearShapeDisabledFields leaves the step's own fields.
  //
  // Captured BEFORE the switch on purpose. Read afterwards, this cannot tell
  // "the user just left the bundled shape" from "the user was never in it", and
  // the second case must never touch a hand-entered additional checksum.
  function liveMirrors(step) {
    return (step?.fields || [])
      .filter(field => field.mirrorFrom && state.values[field.mirrorFrom.when] === true)
      .map(field => field.mirrorFrom);
  }

  // A shape switch takes the keys the new shape does not carry with it.
  // prepareData already drops them from the YAML and the fields are disabled
  // either way, but leaving the values on screen reads as "this is still set"
  // when the output has already let go of it.
  function clearShapeDisabledFields(step, mirrorsBefore = []) {
    if (!step) return;
    const shapeGated = (step.fields || []).some(field => field.disabledWhen);
    (step.fields || []).forEach(field => {
      if (field.disabledWhen && state.values[field.disabledWhen] === true) {
        delete state.values[field.yml_field];
      }
    });
    // Leaving a mirrored shape takes the borrowed entry with it. The bundled DMD
    // writes the archive MD5 into vpxChecksum's second slot; switch to Override
    // and the DMD carries its own checksum again, so that entry now describes an
    // archive this build bundles nothing into. It was staying behind on the VPX
    // tab as a stale "additional checksum" - the whole DMD side cleared and the
    // hash it had cross-written did not.
    //
    // Deliberately ahead of the shapeGated guard below: a mirror is a claim on
    // ANOTHER field's value, and it has to be released whether or not this step
    // also happens to gate its own fields on the shape.
    //
    // The index is counted on the list as stored, blank primary included:
    // ['', archiveMD5] is a bundled DMD whose .vpx MD5 is still missing.
    mirrorsBefore.forEach(mirror => {
      if (state.values[mirror.when] === true) return;
      const raw = state.values[mirror.field];
      if (!Array.isArray(raw) || raw.length <= mirror.index) return;
      const list = raw.map(item => String(item ?? '').trim());
      list.splice(mirror.index, 1);
      const primary = list[0] || '';
      const additional = list.slice(1).filter(Boolean);
      if (additional.length) state.values[mirror.field] = [primary, ...additional];
      else if (primary) state.values[mirror.field] = primary;
      else delete state.values[mirror.field];
    });
    // A step whose fields change with the shape is describing a DIFFERENT
    // archive in each one - bundled, it is the VPX's archive; standalone, it is
    // the asset's own. So everything derived from the old archive goes with the
    // switch: the loaded folder list, the root chosen inside it, and its
    // format. Leaving those behind is what left a stale Archive Root and
    // Archive Type pointing into a file no longer part of the build.
    //
    // A step with no shape-gated fields (PUP, Alt Sound) is deliberately left
    // alone: its archive means the same thing either way, so a Bundled toggle
    // must not cost the user the folder list they just loaded.
    if (!shapeGated) return;
    delete state.values[`__${step.id}ArchiveDirectories`];
    (step.fields || []).forEach(field => {
      if (field.directoryPicker) delete state.values[field.yml_field];
      if (field.archiveFormatField) delete state.values[field.archiveFormatField];
    });
  }

  function handleBundleChange(fieldName, checked) {
    const step = WIZARD_STEPS.find(candidate => candidate.bundleField === fieldName);
    // Read before the shape moves — see liveMirrors.
    const mirrorsBefore = liveMirrors(step);
    state.values[fieldName] = checked;
    // Bundled and Override are mutually exclusive — not native radio inputs
    // (either can be independently unchecked, leaving both off), but turning
    // one on always turns the other off.
    if (checked && step?.overrideField) state.values[step.overrideField] = false;
    clearShapeDisabledFields(step, mirrorsBefore);
    if (!checked && step && !state.selections[step.category] && state.values[step.overrideField] !== true) {
      clearStepData(step, { preserveId: false, preserveBundle: false, preserveOverride: true, rerender: false });
      const config = Object.values(CATEGORY_CONFIG).find(candidate => candidate.bundleField === fieldName);
      if (config?.nsfwField) delete state.values[config.nsfwField];
    }
    renderWorkspace();
    markChanged();
  }

  function handleOverrideChange(fieldName, checked) {
    const step = WIZARD_STEPS.find(candidate => candidate.overrideField === fieldName);
    // Read before the shape moves — see liveMirrors.
    const mirrorsBefore = liveMirrors(step);
    state.values[fieldName] = checked;
    if (checked && step?.bundleField) state.values[step.bundleField] = false;
    clearShapeDisabledFields(step, mirrorsBefore);
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
    // A step may demand one value before it is worth opening at all. The DMD
    // tab uses this: Bundled or Override says a DMD exists, but the tab cannot
    // be filled in until its type has been picked on the asset row.
    if (step.requiresValue && !String(state.values[step.requiresValue] ?? '').trim()) return false;
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
    // Drop hints and in-flight jobs are keyed by control id and live outside
    // `state` (uiHelper holds them so they survive the rebuild a tab switch
    // causes), so wiping values alone leaves stale text on screen and lets a
    // running hash write into the tab that was just cleared.
    const checksumFieldIds = [];
    step.fields.forEach(field => {
      checksumFieldIds.push(`field-${field.yml_field}`);
      if (Array.isArray(field.items)) field.items.forEach(item => checksumFieldIds.push(`field-${item.yml_field}`));
    });
    window.VPS_UI?.resetChecksumStatuses?.(checksumFieldIds);
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
    // Any tab that browses an archive drops its loaded directory list on
    // Clear. This used to name PUP explicitly, which left Alt Sound's list
    // (and later the DMD one) behind after a section was cleared.
    delete state.values[`__${step.id}ArchiveDirectories`];
    // Slots 2 and 3 collapse back out of sight, and the overflow list goes
    // with them - neither is reachable through step.fields alone.
    if (step.id === 'vpx') {
      delete state.values.__vpxMagicSlots;
      delete state.values.vpxMagicAdditional;
    }
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

  // The inputs every rule reads. Built fresh on each call, because selectRecord
  // and startNext replace state.values and state.selections outright.
  function validationContext() {
    return {
      record: state.record,
      selections: state.selections,
      values: state.values,
      yaml: state.yaml,
      isStepEnabled
    };
  }

  // The feature and v090 issues, read live from the rulebook on every call -
  // the two validators were queried the same way before the merge, which is
  // what lets the Additional ROM dialog change a tab's count without a field
  // change here.
  function extendedIssues() {
    return window.VPS_VALIDATION.collectAllErrors(validationContext())
      .filter(entry => entry.system === 'feature' || entry.system === 'v090');
  }

  function getExtendedStepErrors(stepId) {
    return extendedIssues().filter(entry => entry.stepId === stepId);
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

  // The build issues (the Validate dialog's own lines, the tab counts and the
  // blocking), from the merged rulebook (validationRules.js).
  function refreshValidation() {
    const build = window.VPS_VALIDATION.collectAllErrors(validationContext())
      .filter(entry => entry.system === 'build');
    state.validation = {
      errors: build.filter(entry => entry.type === 'error'),
      warnings: build.filter(entry => entry.type === 'warning')
    };
    return state.validation;
  }

  // The inputs every rule reads, for the scripts that draw from the rulebook
  // outside this file (the field dots, the jump to the first error).
  window.VPS_MAIN = Object.freeze({ validationContext });

  function updateValidationSummary() {
    refreshValidation();
  }

  // Anything that blocks Copy and Download. The feature and v090 issues used to
  // block by intercepting those clicks before this file saw them.
  function hasBlockingIssues() {
    return state.validation.errors.length > 0 || extendedIssues().length > 0;
  }

  function refreshTabStatuses() {
    dom.accordionStack.querySelectorAll('.config-tab').forEach(tab => {
      const step = WIZARD_STEPS.find(candidate => candidate.id === tab.dataset.step);
      if (!step) return;
      const status = getSectionStatus(step);
      tab.classList.remove('has-error', 'has-warning', 'has-ready');
      if (status.className === 'error' || status.className === 'warning') {
        tab.classList.add(`has-${status.className}`);
        tab.title = status.label;
        tab.setAttribute('aria-label', `${step.label}: ${status.label}`);
      } else {
        tab.removeAttribute('title');
        tab.setAttribute('aria-label', step.label);
        if (status.className === 'ready') tab.classList.add('has-ready');
      }
    });
  }

  function validationItem(entry, className) {
    const item = document.createElement('li');
    item.className = className;
    const title = document.createElement('strong');
    title.textContent = entry.title;
    const message = document.createElement('span');
    message.textContent = entry.message;
    item.append(title, message);
    return item;
  }

  function showValidationDialog() {
    refreshValidation();
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
      all.forEach(entry => list.appendChild(validationItem(entry, `validation-item ${entry.type}`)));
    }

    // The v090 and then the feature issues follow, each skipped when its title
    // and message are both already listed. Until 2026-10-05 the two validators
    // appended these themselves a moment after the dialog opened: v090 checks
    // against the build issues' lines alone, so two identical v090 lines both
    // show, while the feature validator also skips lines it has just added.
    // Until 2026-10-11 the skip compared titles alone, so an Additional ROM
    // entry with two problems listed only the first while its tab counted two.
    const extended = extendedIssues();
    const lineKey = (title, message) => `${title}\n${message}`;
    const appendExtended = (entries, className, rememberOwnLines) => {
      if (!entries.length) return;
      list.querySelector('.validation-item.success')?.remove();
      const listed = new Set([...list.querySelectorAll('.validation-item')]
        .map(item => lineKey(item.querySelector('strong')?.textContent, item.querySelector('span')?.textContent)));
      entries.forEach(entry => {
        const key = lineKey(entry.title, entry.message);
        if (listed.has(key)) return;
        if (rememberOwnLines) listed.add(key);
        list.appendChild(validationItem(entry, `validation-item error ${className}`));
      });
    };
    appendExtended(extended.filter(entry => entry.system === 'v090'), 'v090-validation-item', false);
    appendExtended(extended.filter(entry => entry.system === 'feature'), 'feature-validation-item', true);

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
    refreshValidation();
    if (hasBlockingIssues()) {
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
    refreshValidation();
    if (hasBlockingIssues()) {
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
    // Same reason as in clearStepData, for every field at once. This also
    // invalidates any hash or directory scan still running anywhere.
    window.VPS_UI?.resetChecksumStatuses?.();
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
