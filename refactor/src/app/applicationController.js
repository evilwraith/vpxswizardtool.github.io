(() => {
  'use strict';

  const fields = window.VPS_YML_FIELDS;
  const utilities = window.VPS_UTILS;
  const SEARCH = window.VPS_SEARCH;
  const UI = window.VPS_UI;
  const store = window.VPS_APP_STORE;
  const persistence = window.VPS_PERSISTENCE_CONTROLLER;
  const fileOutput = window.VPS_FILE_OUTPUT;
  const validationDialog = window.VPS_VALIDATION_DIALOG;
  const outputController = window.VPS_OUTPUT_CONTROLLER;

  if (!fields || !utilities || !SEARCH || !UI || !store || !persistence
    || !fileOutput || !validationDialog || !outputController) return;

  const {
    CATEGORY_CONFIG,
    WIZARD_STEPS,
    PRESET_FIELDS
  } = fields;
  const {
    getCategoryItems
  } = utilities;

  const runtime = {
    database: null,
    carryValues: {},
    suggestionTimer: 0,
    renderFrame: 0,
    initialized: false,
    unsubscribe: null
  };

  const dom = {};

  function snapshot() {
    return store.getSnapshot();
  }

  function cacheDom() {
    const ids = [
      'searchForm', 'idInput', 'searchBtn', 'suggestions', 'searchStatus', 'emptyState',
      'workspace', 'tableStrip', 'tableBadges', 'assetMatrix', 'changeTableBtn', 'builderSection',
      'accordionStack', 'previewDrawer', 'drawerCopyBtn', 'validateBtn', 'downloadNextBtn',
      'helpBtn', 'recentBtn', 'helpDialog', 'validationDialog', 'recentDialog', 'recentBody',
      'clearHistoryBtn'
    ];
    ids.forEach(id => { dom[id] = document.getElementById(id); });
  }

  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function setSearchStatus(message, isError = false) {
    if (!dom.searchStatus) return;
    dom.searchStatus.textContent = message;
    dom.searchStatus.classList.toggle('error', isError);
  }

  function setSearchLoading(loading) {
    if (!dom.searchBtn) return;
    dom.searchBtn.disabled = loading;
    dom.searchBtn.textContent = loading ? 'Loading…' : 'Search';
  }

  async function getDatabase() {
    if (runtime.database) return runtime.database;
    runtime.database = await window.fetchVPSDB();
    return runtime.database;
  }

  function closeSuggestions() {
    window.clearTimeout(runtime.suggestionTimer);
    runtime.suggestionTimer = 0;
    SEARCH.clear();
    if (!dom.suggestions || !dom.idInput) return;
    dom.suggestions.replaceChildren();
    dom.suggestions.classList.remove('active');
    dom.idInput.setAttribute('aria-expanded', 'false');
    dom.idInput.removeAttribute('aria-activedescendant');
  }

  function renderSuggestions() {
    UI.renderSuggestions(
      dom.suggestions,
      SEARCH.state.results,
      SEARCH.state.activeIndex,
      record => selectRecord(record)
    );
    const open = SEARCH.state.results.length > 0;
    dom.idInput.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) dom.idInput.removeAttribute('aria-activedescendant');
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
      setSearchStatus(error?.message || 'Suggestions could not be loaded.', true);
    }
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
      setSearchStatus(error?.message || 'The table search failed.', true);
    } finally {
      setSearchLoading(false);
    }
  }

  function migrateBuildValues(input = {}) {
    const values = { ...input };

    if (values.vpuPatchVPSId && !values.diffVPSId) values.diffVPSId = values.vpuPatchVPSId;
    if (values.vpuPatchChecksum && !values.diffChecksum) values.diffChecksum = values.vpuPatchChecksum;
    delete values.vpuPatchVPSId;
    delete values.vpuPatchChecksum;

    if (Array.isArray(values.coloredROMChecksum)) {
      const checksums = values.coloredROMChecksum
        .map(value => String(value || '').trim())
        .filter(Boolean);
      values.coloredROMChecksum = checksums[0] || '';
      values.coloredROMChecksumSecondary = checksums[1] || '';
      if (checksums.length > 1) values.coloredROMPin2DMD = true;
    }

    if (values.coloredROMPin2DMD !== true) delete values.coloredROMChecksumSecondary;
    return values;
  }

  function isStepEnabled(step, stateSnapshot = snapshot()) {
    if (!step) return false;
    const selections = stateSnapshot.build?.selections || {};
    const values = stateSnapshot.build?.values || {};
    if (step.always) return true;
    if (step.category && selections[step.category]) return true;
    if (step.bundleField && values[step.bundleField] === true) return true;
    return false;
  }

  function clearStepValues(values, step, options = {}) {
    const next = { ...values };
    const preserveId = options.preserveId === true;
    const preserveBundle = options.preserveBundle === true;
    const checksumSources = { ...(next.__checksumSources || {}) };

    (step?.fields || []).forEach(field => {
      if (field.readonly && preserveId) return;
      delete next[field.yml_field];
      delete next[`${field.yml_field}_check`];
      delete checksumSources[field.yml_field];
      if (Array.isArray(field.items)) {
        field.items.forEach(item => {
          delete next[item.yml_field];
          delete checksumSources[item.yml_field];
        });
      }
    });

    if (Object.keys(checksumSources).length) next.__checksumSources = checksumSources;
    else delete next.__checksumSources;
    if (step?.id === 'pup') delete next.__pupArchiveDirectories;
    if (!preserveBundle && step?.bundleField) delete next[step.bundleField];
    return next;
  }

  function categoryItems(record, selections, category) {
    const config = CATEGORY_CONFIG[category];
    return config
      ? getCategoryItems(record, category, config, { selections })
      : [];
  }

  function clearAssetSelectionContext(context, category) {
    const config = CATEGORY_CONFIG[category];
    if (!config) return;

    delete context.selections[category];
    delete context.values[config.idField];
    context.openAssetDetails.delete(category);

    const step = WIZARD_STEPS.find(candidate => candidate.id === config.stepId);
    if (step) {
      context.values = clearStepValues(context.values, step, {
        preserveId: false,
        preserveBundle: true
      });
    }
  }

  function sanitizeAssetSelections(context) {
    Object.keys(CATEGORY_CONFIG).forEach(category => {
      const selectedId = String(context.selections[category] || '');
      if (!selectedId) return;
      const available = categoryItems(context.record, context.selections, category)
        .some(item => String(item?.id || '') === selectedId);
      if (!available) clearAssetSelectionContext(context, category);
    });
  }

  function syncVpuPatchSelection(context) {
    const selectedPatch = String(context.selections.vpuPatchFiles || '');
    if (!selectedPatch) return;

    const available = categoryItems(context.record, context.selections, 'vpuPatchFiles')
      .some(item => String(item?.id || '') === selectedPatch);
    if (!available) clearAssetSelectionContext(context, 'vpuPatchFiles');
  }

  function pruneDisabledStepData(context) {
    WIZARD_STEPS.forEach(step => {
      const testSnapshot = {
        build: {
          selections: context.selections,
          values: context.values
        }
      };
      if (!isStepEnabled(step, testSnapshot)) {
        context.values = clearStepValues(context.values, step, {
          preserveId: false,
          preserveBundle: true
        });
      }
    });
  }

  function selectRecord(record, options = {}) {
    if (!record) return false;

    const current = snapshot();
    const baseValues = options.values ? {} : runtime.carryValues;
    const context = {
      record,
      selections: { ...(options.selections || {}) },
      values: migrateBuildValues({
        ...baseValues,
        ...(options.values || {}),
        tableVPSId: record.id || ''
      }),
      openAssetDetails: new Set(options.openAssetDetails || [])
    };

    sanitizeAssetSelections(context);

    Object.entries(CATEGORY_CONFIG).forEach(([category, config]) => {
      const selected = context.selections[category];
      if (selected) context.values[config.idField] = selected;
    });

    pruneDisabledStepData(context);

    const activeStep = options.activeStep
      || current.ui?.activeStep
      || persistence.loadPreferences()?.activeStep
      || 'main';

    store.replace({
      build: {
        record: context.record,
        selections: context.selections,
        values: context.values,
        yaml: current.build?.yaml || '---\n'
      },
      ui: {
        activeStep,
        openAssetDetails: [...context.openAssetDetails]
      },
      validation: {
        errors: [],
        warnings: []
      }
    }, { source: options.source || 'app:selectRecord' });

    dom.idInput.value = record.id || record.name || '';
    closeSuggestions();
    setSearchStatus(`Loaded ${record.name || record.id || 'table'}.`);
    return true;
  }

  function getSectionStatus(step, stateSnapshot) {
    if (!isStepEnabled(step, stateSnapshot)) {
      return { label: 'Not included', className: 'disabled' };
    }

    const errors = stateSnapshot.validation?.errors || [];
    const warnings = stateSnapshot.validation?.warnings || [];
    const stepErrors = errors.filter(entry => entry.stepId === step.id);
    const stepWarnings = warnings.filter(entry => entry.stepId === step.id);
    if (stepErrors.length) {
      return {
        label: `${stepErrors.length} error${stepErrors.length === 1 ? '' : 's'}`,
        className: 'error'
      };
    }
    if (stepWarnings.length) {
      return {
        label: `${stepWarnings.length} warning${stepWarnings.length === 1 ? '' : 's'}`,
        className: 'warning'
      };
    }

    const values = stateSnapshot.build?.values || {};
    const keys = [];
    (step.fields || []).forEach(field => {
      keys.push(field.yml_field);
      if (Array.isArray(field.items)) {
        field.items.forEach(item => keys.push(item.yml_field));
      }
    });

    const count = keys.filter(key => {
      const value = values[key];
      if (value === true) return true;
      if (Array.isArray(value)) return value.length > 0;
      return typeof value === 'string' && value.trim() !== '';
    }).length;

    return {
      label: count ? `${count} value${count === 1 ? '' : 's'}` : 'Ready',
      className: 'ready'
    };
  }

  function activateConfigTab(stepId) {
    const current = snapshot();
    const step = WIZARD_STEPS.find(candidate => candidate.id === stepId);
    if (!step || !isStepEnabled(step, current)) return false;

    store.setUi({ activeStep: stepId }, { source: 'app:activateStep' });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        dom.builderSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById(`config-tab-${stepId}`)?.focus({ preventScroll: true });
      });
    });
    return true;
  }

  function handleAssetSelection(category, itemId) {
    const config = CATEGORY_CONFIG[category];
    if (!config) return;

    const current = snapshot();
    const context = {
      record: current.build.record,
      selections: { ...current.build.selections },
      values: { ...current.build.values },
      openAssetDetails: new Set(current.ui.openAssetDetails || [])
    };
    const previous = String(context.selections[category] || '');

    if (itemId) {
      context.selections[category] = itemId;
      context.values[config.idField] = itemId;
    } else {
      delete context.selections[category];
      delete context.values[config.idField];
      context.openAssetDetails.delete(category);
    }

    if (category === 'tableFiles') syncVpuPatchSelection(context);

    if (previous !== String(itemId || '')) {
      const step = WIZARD_STEPS.find(candidate => candidate.id === config.stepId);
      if (step) {
        context.values = clearStepValues(context.values, step, {
          preserveId: true,
          preserveBundle: true
        });
      }
    }

    if (!itemId && (!config.bundleField || context.values[config.bundleField] !== true)) {
      const step = WIZARD_STEPS.find(candidate => candidate.id === config.stepId);
      if (step) {
        context.values = clearStepValues(context.values, step, {
          preserveId: false,
          preserveBundle: true
        });
      }
    }

    store.setBuild({
      selections: context.selections,
      values: context.values
    }, { source: 'app:assetSelection' });

    if (!itemId) {
      store.setUi({
        openAssetDetails: [...context.openAssetDetails]
      }, { source: 'app:assetDetailClose' });
    }
  }

  function handleBundleChange(fieldName, checked) {
    const current = snapshot();
    let values = { ...current.build.values };
    values[fieldName] = checked;

    const step = WIZARD_STEPS.find(candidate => candidate.bundleField === fieldName);
    if (!checked && step && !current.build.selections[step.category]) {
      values = clearStepValues(values, step, {
        preserveId: false,
        preserveBundle: false
      });
    }

    store.setBuild({ values }, { source: 'app:bundleChange' });
  }

  function toggleAssetDetail(category) {
    const current = snapshot();
    const open = new Set(current.ui.openAssetDetails || []);
    if (open.has(category)) open.delete(category);
    else open.add(category);
    store.setUi({ openAssetDetails: [...open] }, { source: 'app:assetDetail' });
  }

  function handleFieldChange(key, value) {
    const current = snapshot();
    const values = { ...current.build.values };

    if (key.startsWith('__')) {
      values[key] = value;
      store.setBuild({ values }, { source: 'app:internalFieldChange' });
      return;
    }

    const previous = values[key];
    values[key] = value;

    if (key === 'coloredROMPin2DMD' && previous !== value) {
      delete values.coloredROMChecksum;
      delete values.coloredROMChecksumSecondary;
      const sources = { ...(values.__checksumSources || {}) };
      delete sources.coloredROMChecksum;
      delete sources.coloredROMChecksumSecondary;
      if (Object.keys(sources).length) values.__checksumSources = sources;
      else delete values.__checksumSources;
      UI.syncConditionalFields?.(values);
    }

    store.setBuild({ values }, { source: 'app:fieldChange' });
  }

  function clearStepData(step, options = {}) {
    const current = snapshot();
    const values = clearStepValues(current.build.values, step, options);
    store.setBuild({ values }, { source: 'app:clearStep' });
  }

  function renderAccordions(stateSnapshot) {
    UI.renderAccordions(
      dom.accordionStack,
      WIZARD_STEPS,
      stateSnapshot.build.values,
      {
        isEnabled: step => isStepEnabled(step, stateSnapshot),
        getActiveStep: () => stateSnapshot.ui.activeStep,
        onActivate: activateConfigTab,
        getStatus: step => getSectionStatus(step, stateSnapshot),
        onChange: handleFieldChange,
        onClear: step => clearStepData(step, {
          preserveId: true,
          preserveBundle: true
        })
      }
    );
  }

  function renderWorkspace(stateSnapshot = snapshot()) {
    if (!runtime.initialized) return;

    const record = stateSnapshot.build?.record || null;
    const selections = stateSnapshot.build?.selections || {};
    const values = stateSnapshot.build?.values || {};
    const hasRecord = Boolean(record);

    dom.emptyState.hidden = hasRecord;
    dom.workspace.hidden = !hasRecord;
    dom.previewDrawer?.setAttribute('aria-hidden', hasRecord ? 'false' : 'true');

    if (!hasRecord) {
      dom.builderSection.hidden = true;
      return;
    }

    UI.renderTableStrip(
      dom.tableStrip,
      record,
      selections,
      values,
      dom.tableBadges,
      { onJump: activateConfigTab }
    );

    UI.renderAssetMatrix(
      dom.assetMatrix,
      record,
      selections,
      values,
      {
        onSelect: handleAssetSelection,
        onBundle: handleBundleChange,
        onToggleDetail: toggleAssetDetail,
        isDetailOpen: category => (stateSnapshot.ui.openAssetDetails || []).includes(category)
      }
    );

    const hasVpx = Boolean(selections.tableFiles);
    dom.builderSection.hidden = !hasVpx;
    if (hasVpx) renderAccordions(stateSnapshot);
    else dom.accordionStack.replaceChildren();
  }

  function scheduleRender() {
    if (!runtime.initialized || runtime.renderFrame) return;
    runtime.renderFrame = window.requestAnimationFrame(() => {
      runtime.renderFrame = 0;
      renderWorkspace(snapshot());
    });
  }

  function extractPresetValues(values = {}) {
    const output = {};
    PRESET_FIELDS.forEach(key => {
      const value = values[key];
      if (value === true || (typeof value === 'string' && value.trim() !== '')) {
        output[key] = value;
      }
    });
    return output;
  }

  function startNext(options = {}) {
    const clearDraft = options.clearDraft === true;
    const status = options.status || 'Search for another table.';

    if (clearDraft) persistence.clearDraft();
    store.clearBuild({ source: 'app:clearBuild' });

    dom.idInput.value = '';
    closeSuggestions();
    setSearchStatus(status);
    dom.idInput.focus();
  }

  async function copyYaml() {
    await outputController.copy(dom.drawerCopyBtn);
  }

  function downloadAndStartNext() {
    const result = outputController.download();
    if (!result.ok) return result;

    runtime.carryValues = extractPresetValues(result.snapshot.build.values);
    startNext({
      clearDraft: true,
      status: 'YML downloaded and build cleared. Ready for the next table.'
    });
    return result;
  }

  async function copyRecentYaml(entry, button) {
    if (!entry?.yaml) return;
    try {
      await fileOutput.copyText(entry.yaml);
      const previous = button.textContent;
      button.textContent = 'Copied';
      window.setTimeout(() => {
        if (button.isConnected) button.textContent = previous;
      }, 1000);
    } catch (error) {
      setSearchStatus(error?.message || 'The saved YAML could not be copied.', true);
    }
  }

  function editRecentBuild(entry) {
    if (entry?.snapshot?.record && entry.snapshot.values) {
      dom.recentDialog.close();
      selectRecord(entry.snapshot.record, {
        selections: entry.snapshot.selections || {},
        values: entry.snapshot.values || {},
        activeStep: entry.snapshot.activeStep || 'main',
        openAssetDetails: entry.snapshot.openAssetDetails || [],
        restored: true,
        source: 'app:recentRestore'
      });
      setSearchStatus(`Restored ${entry.name} from Recent Build History.`);
      return;
    }

    dom.recentDialog.close();
    dom.idInput.value = entry?.id || '';
    searchCurrentInput();
  }

  function renderRecentDialog() {
    dom.recentBody.replaceChildren();
    const recent = persistence.getRecent();

    if (!recent.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-dialog';
      empty.textContent = 'Copied and downloaded builds will appear here.';
      dom.recentBody.appendChild(empty);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'recent-list';

    recent.forEach(entry => {
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
        download.addEventListener('click', () => {
          fileOutput.downloadText(
            entry.yaml,
            entry.filename || window.VPS_BUILD_PERSISTENCE.currentFilename({
              build: { record: { id: entry.id } }
            })
          );
        });

        actions.append(copy, download);
      }

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'text-btn danger-btn';
      remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete ${entry.name} from recent build history`);
      remove.addEventListener('click', () => {
        persistence.removeRecent(entry.completedAt);
        renderRecentDialog();
      });
      actions.appendChild(remove);

      item.append(text, actions);
      list.appendChild(item);
    });

    dom.recentBody.appendChild(list);
  }

  function bindDialogs() {
    dom.helpBtn.addEventListener('click', () => openDialog(dom.helpDialog));
    dom.recentBtn.addEventListener('click', () => {
      renderRecentDialog();
      openDialog(dom.recentDialog);
    });

    dom.clearHistoryBtn.addEventListener('click', () => {
      const recent = persistence.getRecent();
      if (!recent.length) return;
      if (!window.confirm('Clear all recent build history? This cannot be undone.')) return;
      persistence.clearRecent();
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

  function bindSearch() {
    dom.searchForm.addEventListener('submit', event => {
      event.preventDefault();
      searchCurrentInput();
    });

    dom.idInput.addEventListener('input', () => {
      window.clearTimeout(runtime.suggestionTimer);
      runtime.suggestionTimer = window.setTimeout(updateSuggestions, 120);
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
      if (!dom.suggestions.contains(event.target) && event.target !== dom.idInput) {
        closeSuggestions();
      }
    });
  }

  function bindWorkspaceControls() {
    dom.changeTableBtn.addEventListener('click', () => {
      startNext({
        clearDraft: true,
        status: 'Build cleared. Search for another table.'
      });
    });
    dom.drawerCopyBtn.addEventListener('click', copyYaml);
    dom.validateBtn.addEventListener('click', () => validationDialog.show());
    dom.downloadNextBtn.addEventListener('click', downloadAndStartNext);
  }

  function bindKeyboardShortcuts() {
    document.addEventListener('keydown', event => {
      const target = event.target;
      const isTyping = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement;

      if (event.key === '/' && !isTyping) {
        event.preventDefault();
        dom.idInput.focus();
        dom.idInput.select();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        if (event.shiftKey) downloadAndStartNext();
        else validationDialog.show();
      }
    });
  }

  function restorePreferences() {
    const preferences = persistence.loadPreferences();
    if (typeof preferences.activeStep === 'string' && preferences.activeStep) {
      store.setUi({ activeStep: preferences.activeStep }, {
        source: 'app:preferencesRestore'
      });
    }
  }

  function restoreDraft() {
    const draft = persistence.loadDraft();
    if (!draft?.record || !draft.values) return false;

    selectRecord(draft.record, {
      selections: draft.selections || {},
      values: draft.values || {},
      activeStep: draft.activeStep || 'main',
      openAssetDetails: draft.openAssetDetails || [],
      restored: true,
      source: 'app:draftRestore'
    });
    setSearchStatus(`Restored ${draft.record.name || draft.record.id || 'your previous build'}.`);
    return true;
  }

  function init() {
    if (runtime.initialized) return;
    cacheDom();
    runtime.initialized = true;

    outputController.configure({ reportStatus: setSearchStatus });
    bindDialogs();
    bindSearch();
    bindWorkspaceControls();
    bindKeyboardShortcuts();

    runtime.unsubscribe = store.subscribe((nextState, metadata) => {
      const changed = metadata?.changedSections || [];
      if (changed.some(section => (
        section === 'build'
        || section === 'yaml'
        || section === 'ui'
        || section === 'validation'
      ))) {
        scheduleRender();
      }
    });

    restorePreferences();
    renderWorkspace(snapshot());
    restoreDraft();
  }

  window.VPS_APPLICATION_CONTROLLER = Object.freeze({
    init,
    getState: snapshot,
    getDatabase,
    search: searchCurrentInput,
    selectRecord,
    activateConfigTab,
    clearBuild: startNext,
    renderNow: () => renderWorkspace(snapshot()),
    renderRecent: renderRecentDialog,
    copyYaml,
    downloadAndStartNext,
    isStepEnabled
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
