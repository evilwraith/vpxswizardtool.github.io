(() => {
  'use strict';

  const { CATEGORY_CONFIG, WIZARD_STEPS } = window.VPS_YML_FIELDS || {};
  const SEARCH = window.VPS_SEARCH;
  if (!CATEGORY_CONFIG || !Array.isArray(WIZARD_STEPS) || !SEARCH) return;

  const MAX_FILE_BYTES = 2 * 1024 * 1024;
  const IMPORT_TIMEOUT_MS = 30000;
  const DROP_ACTIVE_CLASS = 'is-dragover';
  const DROP_LOADING_CLASS = 'is-loading';

  let dropZone = null;
  let fileInput = null;
  let dragDepth = 0;
  let toast = null;
  let toastTitle = null;
  let toastMessage = null;
  let toastActions = null;
  let toastHideTimer = null;
  let toastRemoveTimer = null;
  let importing = false;
  // "Always this session" choice for outdated-field removal; resets on reload.
  let alwaysRemoveOutdatedFields = false;
  let pendingPromptResolve = null;
  let pendingPromptFallback = null;

  function hasCurrentBuild() {
    const workspace = document.getElementById('workspace');
    return Boolean(workspace && !workspace.hidden && document.querySelector('#tableStrip .table-id'));
  }

  function isYmlFile(file) {
    return file instanceof File && /\.yml$/i.test(file.name);
  }

  function stripInlineComment(value) {
    let single = false;
    let double = false;
    let escaped = false;

    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\' && double) {
        escaped = true;
        continue;
      }
      if (char === "'" && !double) single = !single;
      else if (char === '"' && !single) double = !double;
      else if (char === '#' && !single && !double && (index === 0 || /\s/.test(value[index - 1]))) {
        return value.slice(0, index).trimEnd();
      }
    }

    return value.trimEnd();
  }

  function parseQuotedScalar(value) {
    if (value.startsWith('"')) {
      if (!value.endsWith('"')) throw new Error('A double-quoted YAML value is not closed.');
      try {
        return JSON.parse(value);
      } catch (_) {
        return value.slice(1, -1)
          .replace(/\\"/g, '"')
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\\\/g, '\\');
      }
    }

    if (value.startsWith("'")) {
      if (!value.endsWith("'")) throw new Error('A single-quoted YAML value is not closed.');
      return value.slice(1, -1).replace(/''/g, "'");
    }

    return null;
  }

  function splitFlowSequence(value) {
    const body = value.slice(1, -1).trim();
    if (!body) return [];

    const output = [];
    let token = '';
    let single = false;
    let double = false;
    let escaped = false;

    for (const char of body) {
      if (escaped) {
        token += char;
        escaped = false;
        continue;
      }
      if (char === '\\' && double) {
        token += char;
        escaped = true;
        continue;
      }
      if (char === "'" && !double) single = !single;
      else if (char === '"' && !single) double = !double;

      if (char === ',' && !single && !double) {
        output.push(parseScalar(token.trim()));
        token = '';
      } else {
        token += char;
      }
    }
    output.push(parseScalar(token.trim()));
    return output;
  }

  function parseScalar(rawValue) {
    const value = stripInlineComment(String(rawValue || '').trim());
    if (!value) return '';

    const quoted = parseQuotedScalar(value);
    if (quoted !== null) return quoted;
    if (value.startsWith('[') && value.endsWith(']')) return splitFlowSequence(value);
    if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
    if (/^(null|~)$/i.test(value)) return null;
    if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
    if (/^-?(?:\d+\.\d*|\d*\.\d+)$/.test(value)) return Number.parseFloat(value);
    return value;
  }

  function foldBlock(lines, literal) {
    if (literal) return lines.join('\n').replace(/\n+$/, '');

    const paragraphs = [];
    let current = [];
    lines.forEach(line => {
      if (line === '') {
        if (current.length) {
          paragraphs.push(current.join(' '));
          current = [];
        }
        paragraphs.push('');
      } else {
        current.push(line);
      }
    });
    if (current.length) paragraphs.push(current.join(' '));
    return paragraphs.join('\n').replace(/\n+$/, '');
  }

  function parseFlatYaml(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('The YML file is empty.');
    if (text.includes('\0')) throw new Error('The selected file does not appear to be plain-text YML.');

    const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
    const output = {};
    let index = 0;

    while (index < lines.length) {
      const rawLine = lines[index];
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed === '---' || trimmed === '...' || trimmed.startsWith('#')) {
        index += 1;
        continue;
      }

      if (/^\s/.test(rawLine)) {
        throw new Error(`Unexpected indentation near line ${index + 1}. Only top-level VPXS fields are supported.`);
      }

      const match = rawLine.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
      if (!match) throw new Error(`Could not parse YML line ${index + 1}: ${trimmed}`);

      const key = match[1];
      const inlineValue = (match[2] || '').trim();
      if (Object.prototype.hasOwnProperty.call(output, key)) {
        throw new Error(`Duplicate YML field: ${key}`);
      }
      index += 1;

      if (/^[>|][+-]?$/.test(inlineValue)) {
        const literal = inlineValue.startsWith('|');
        const blockLines = [];
        while (index < lines.length && (/^\s/.test(lines[index]) || !lines[index].trim())) {
          const line = lines[index];
          if (!line.trim()) blockLines.push('');
          else blockLines.push(line.replace(/^ {2}/, ''));
          index += 1;
        }
        output[key] = foldBlock(blockLines, literal);
        continue;
      }

      if (!inlineValue) {
        const list = [];
        while (index < lines.length) {
          const listMatch = lines[index].match(/^\s+-\s*(.*)$/);
          if (!listMatch) break;
          list.push(parseScalar(listMatch[1]));
          index += 1;
        }
        output[key] = list.length ? list : '';
        continue;
      }

      output[key] = parseScalar(inlineValue);
    }

    return output;
  }

  function allSupportedKeys() {
    // vpxArchiveFormat is DERIVED, not edited: prepareData mirrors it from
    // specialDMDArchiveFormat when a DMD is bundled. It belongs to no field, so
    // without seeding it here a bundled YML would import with it reported as an
    // outdated key and stripped.
    const keys = new Set(['tableVPSId', 'enabled', 'nsfw', 'vpxArchiveFormat']);
    WIZARD_STEPS.forEach(step => {
      (step.fields || []).forEach(field => {
        keys.add(field.yml_field);
        (field.items || []).forEach(item => keys.add(item.yml_field));
      });
      if (step.bundleField) keys.add(step.bundleField);
      if (step.overrideField) keys.add(step.overrideField);
    });
    Object.values(CATEGORY_CONFIG).forEach(config => {
      if (config.idField) keys.add(config.idField);
      if (config.bundleField) keys.add(config.bundleField);
      if (config.nsfwField) keys.add(config.nsfwField);
      if (config.overrideField) keys.add(config.overrideField);
    });
    return keys;
  }

  function valuePresent(value) {
    if (Array.isArray(value)) return value.length > 0;
    return typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null && value !== '';
  }

  function normalizeImportedData(parsed) {
    const supported = allSupportedKeys();
    const values = {};
    const ignored = [];

    Object.entries(parsed).forEach(([key, value]) => {
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

    // Checksums are uppercase throughout the app; normalise imported ones so
    // the fields and regenerated YAML agree.
    [
      'vpxChecksum', 'backglassChecksum', 'romChecksum', 'coloredROMChecksum',
      'coloredROMChecksumSecondary', 'pupChecksum', 'diffChecksum', 'altSoundChecksum'
    ].forEach(key => {
      const value = values[key];
      if (typeof value === 'string') values[key] = value.toUpperCase();
      else if (Array.isArray(value)) values[key] = value.map(item => String(item).toUpperCase());
    });

    // vpxMagic is stored base64 in the YML and plain in the builder, and it
    // carries either one password or a list of them. Decode every entry, then
    // spread them back across the builder's slots. Without this a round-trip
    // (import then download) would encode a second time - and the old
    // `typeof === 'string'` guard would skip a list outright, importing the
    // base64 as if it were the password.
    if (values.vpxMagic !== undefined && values.vpxMagic !== null) {
      const utils = window.VPS_UTILS || {};
      const decode = utils.decodeVpxMagic || (entry => entry);
      const raw = Array.isArray(values.vpxMagic) ? values.vpxMagic : [values.vpxMagic];
      const plain = raw.map(entry => decode(entry));
      if (utils.distributeVpxMagic) utils.distributeVpxMagic(plain, values);
      else values.vpxMagic = plain[0] || '';
    }

    // Preserve `enabled: false` from the imported YAML (checkbox will render
    // as checked). Anything else (missing, or `enabled: true`) is normalised
    // to "not disabled" and left absent from `values`, so it never round-trips
    // back into the generated YAML as `enabled: true`.
    if (values.enabled !== false) delete values.enabled;

    // Override is deliberately never written to the YAML (OMIT_FROM_YAML) —
    // it's a builder-only convenience, so a table exported while in Override
    // mode carries no direct signal of that on re-import. Re-infer it: no
    // VPS ID for the category, not Bundled, but at least one of the step's
    // overrideRequiredFields has a value.
    Object.values(CATEGORY_CONFIG).forEach(config => {
      if (!config.overrideField) return;
      const step = WIZARD_STEPS.find(candidate => candidate.id === config.stepId);
      if (!step?.overrideRequiredFields?.length) return;
      const hasId = valuePresent(values[config.idField]);
      const isBundled = Boolean(step.bundleField) && values[step.bundleField] === true;
      const hasOverrideData = step.overrideRequiredFields.some(key => valuePresent(values[key]));
      if (!hasId && !isBundled && hasOverrideData) values[config.overrideField] = true;
    });

    return { values, ignored };
  }

  function ensureToast() {
    if (toast?.isConnected) return toast;

    toast = document.createElement('div');
    toast.id = 'ymlImportToast';
    toast.className = 'vps-db-toast yml-import-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-atomic', 'true');
    toast.hidden = true;

    const indicator = document.createElement('span');
    indicator.className = 'vps-db-toast-indicator';
    indicator.setAttribute('aria-hidden', 'true');

    const copy = document.createElement('div');
    copy.className = 'vps-db-toast-copy';
    toastTitle = document.createElement('strong');
    toastTitle.className = 'vps-db-toast-title';
    toastMessage = document.createElement('span');
    toastMessage.className = 'vps-db-toast-message';
    copy.append(toastTitle, toastMessage);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'vps-db-toast-close';
    close.setAttribute('aria-label', 'Dismiss YML import status');
    close.textContent = '×';
    close.addEventListener('click', () => {
      if (pendingPromptResolve) {
        const resolve = pendingPromptResolve;
        const fallback = pendingPromptFallback;
        pendingPromptResolve = null;
        pendingPromptFallback = null;
        resolve(fallback);
        return;
      }
      hideToast();
    });

    toastActions = document.createElement('div');
    toastActions.className = 'yml-import-toast-actions';

    toast.append(indicator, copy, close, toastActions);
    document.body.appendChild(toast);
    return toast;
  }

  function hideToast() {
    window.clearTimeout(toastHideTimer);
    window.clearTimeout(toastRemoveTimer);
    if (!toast || toast.hidden) return;
    toast.classList.remove('is-visible');
    toastRemoveTimer = window.setTimeout(() => {
      if (toast) toast.hidden = true;
    }, 320);
  }

  function showToast(state, title, message) {
    ensureToast();
    window.clearTimeout(toastHideTimer);
    window.clearTimeout(toastRemoveTimer);
    pendingPromptResolve = null;
    pendingPromptFallback = null;

    const dbToast = document.getElementById('vpsDbToast');
    toast.classList.toggle('is-stacked', Boolean(dbToast && !dbToast.hidden && dbToast.classList.contains('is-visible')));
    toast.classList.remove('has-actions');
    toast.setAttribute('role', 'status');
    toastActions.replaceChildren();
    toast.dataset.state = state === 'loading' ? 'checking' : state === 'success' ? 'updated' : 'error';
    toastTitle.textContent = title;
    toastMessage.textContent = message;
    toast.hidden = false;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => toast.classList.add('is-visible'));
    });

    if (state !== 'loading') {
      toastHideTimer = window.setTimeout(hideToast, state === 'error' ? 6500 : 4600);
    }
  }

  // Shows a sticky toast with action buttons and resolves with the clicked
  // choice's value. Dismissing (the × button, or Escape) resolves with the
  // first choice's value, treated as the safe/default outcome.
  function promptToast(title, message, choices) {
    ensureToast();
    window.clearTimeout(toastHideTimer);
    window.clearTimeout(toastRemoveTimer);

    return new Promise(resolve => {
      const dbToast = document.getElementById('vpsDbToast');
      toast.classList.toggle('is-stacked', Boolean(dbToast && !dbToast.hidden && dbToast.classList.contains('is-visible')));
      toast.classList.add('has-actions');
      toast.setAttribute('role', 'alertdialog');
      toast.dataset.state = 'error';
      toastTitle.textContent = title;
      toastMessage.textContent = message;
      toastActions.replaceChildren();

      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        pendingPromptResolve = null;
        pendingPromptFallback = null;
        hideToast();
        resolve(value);
      };

      choices.forEach(choice => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `text-btn${choice.variant ? ` ${choice.variant}` : ''}`;
        button.textContent = choice.label;
        button.addEventListener('click', () => finish(choice.value));
        toastActions.appendChild(button);
      });

      pendingPromptResolve = finish;
      pendingPromptFallback = choices[0]?.value ?? null;

      toast.hidden = false;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => toast.classList.add('is-visible'));
      });
    });
  }

  function truncateKeyList(keys, limit = 6) {
    if (keys.length <= limit) return keys.join(', ');
    return `${keys.slice(0, limit).join(', ')} (+${keys.length - limit} more)`;
  }

  // Two-step confirmation for outdated/unsupported YML keys: first asks
  // whether to strip them and continue or cancel the import outright; if the
  // user chooses to strip them, asks whether that choice should apply just
  // this once or automatically for every import in the rest of the session.
  async function confirmOutdatedFields(fileName, ignored) {
    if (alwaysRemoveOutdatedFields) return true;

    const removeChoice = await promptToast(
      `${ignored.length} outdated field${ignored.length === 1 ? '' : 's'} found`,
      `${fileName} includes fields VPXS no longer supports: ${truncateKeyList(ignored)}. Remove them and continue loading?`,
      [
        { label: 'Cancel', value: 'cancel', variant: 'danger-btn' },
        { label: 'Remove', value: 'remove', variant: 'preview-primary' }
      ]
    );
    if (removeChoice !== 'remove') return false;

    const scopeChoice = await promptToast(
      'Remove outdated fields',
      'Strip them from this file only, or automatically for every YML you open this session?',
      [
        { label: 'Just this once', value: 'once' },
        { label: 'Always this session', value: 'always', variant: 'preview-primary' }
      ]
    );
    if (scopeChoice === 'always') alwaysRemoveOutdatedFields = true;
    return true;
  }

  function waitFor(predicate, message, timeout = IMPORT_TIMEOUT_MS) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        try {
          const result = predicate();
          if (result) {
            resolve(result);
            return;
          }
        } catch (_) {
          // Keep waiting while the interface rerenders.
        }
        if (Date.now() - started >= timeout) {
          reject(new Error(message));
          return;
        }
        window.setTimeout(check, 40);
      };
      check();
    });
  }

  function nextPaint() {
    return new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
  }

  async function findTableRecord(tableId) {
    const database = await window.fetchVPSDB();
    const record = SEARCH.findExactRecord(database, tableId);
    if (!record || String(record.id || '').trim().toLowerCase() !== String(tableId).trim().toLowerCase()) {
      throw new Error(`Table VPS ID “${tableId}” was not found in the current VPS database.`);
    }
    return record;
  }

  function validateImportedAssetIds(record, values) {
    const selections = {};
    Object.entries(CATEGORY_CONFIG).forEach(([category, config]) => {
      const importedId = String(values[config.idField] ?? '').trim();
      if (importedId) selections[category] = importedId;
    });

    Object.entries(CATEGORY_CONFIG).forEach(([category, config]) => {
      const importedId = selections[category];
      if (!importedId) return;
      const items = window.VPS_UTILS.getCategoryItems(record, category, config, { selections });
      const item = items.find(candidate => String(candidate?.id || '') === importedId);
      if (!item || window.VPS_UTILS.isItemBroken(item)) {
        throw new Error(`${config.label} VPS ID “${importedId}” is not available for this table.`);
      }
    });
  }

  async function clearCurrentBuild() {
    const clearButton = document.getElementById('changeTableBtn');
    if (!clearButton || !hasCurrentBuild()) return;
    clearButton.click();
    await waitFor(
      () => document.getElementById('workspace')?.hidden === true,
      'The current build could not be cleared.'
    );
  }

  async function loadTable(tableId) {
    const input = document.getElementById('idInput');
    const form = document.getElementById('searchForm');
    if (!input || !form) throw new Error('The table search controls are unavailable.');

    input.value = tableId;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => {
      const workspace = document.getElementById('workspace');
      const loadedId = document.querySelector('#tableStrip .table-id')?.textContent?.trim();
      return workspace && !workspace.hidden && loadedId === tableId;
    }, `The table ${tableId} could not be loaded.`);
  }

  function categoryOrder() {
    const entries = Object.entries(CATEGORY_CONFIG);
    return entries.sort(([left], [right]) => {
      if (left === 'tableFiles') return -1;
      if (right === 'tableFiles') return 1;
      if (left === 'vpuPatchFiles') return 1;
      if (right === 'vpuPatchFiles') return -1;
      return 0;
    });
  }

  async function selectImportedAssets(values) {
    for (const [category, config] of categoryOrder()) {
      const importedId = String(values[config.idField] ?? '').trim();
      if (!importedId) continue;

      const row = await waitFor(
        () => document.querySelector(`#assetMatrix .asset-row[data-category="${category}"]`),
        `The ${config.label} selector is unavailable.`
      );
      const select = row.querySelector('select');
      const option = [...select.options].find(candidate => candidate.value === importedId && !candidate.disabled);
      if (!option) {
        throw new Error(`${config.label} VPS ID “${importedId}” is not available for this table.`);
      }

      select.value = importedId;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(
        () => document.querySelector(`#assetMatrix .asset-row[data-category="${category}"] select`)?.value === importedId,
        `${config.label} VPS ID “${importedId}” could not be selected.`
      );
      await nextPaint();
    }

    for (const [category, config] of Object.entries(CATEGORY_CONFIG)) {
      if (!config.bundleField || values[config.bundleField] !== true) continue;
      const checkbox = await waitFor(
        () => document.querySelector(`#assetMatrix .asset-row[data-category="${category}"] .bundle-toggle input`),
        `The ${config.label} bundled option is unavailable.`
      );
      if (!checkbox.checked) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        await nextPaint();
      }
    }

    // Override is inferred in normalizeImportedData (never a literal YAML
    // key) — click the checkbox the same way Bundled's is clicked above, so
    // the tab unlocks before loadImportedFields tries to fill its fields.
    for (const [category, config] of Object.entries(CATEGORY_CONFIG)) {
      if (!config.overrideField || values[config.overrideField] !== true) continue;
      const checkbox = await waitFor(
        () => document.querySelector(`#assetMatrix .asset-row[data-category="${category}"] .override-toggle input`),
        `The ${config.label} override option is unavailable.`
      );
      if (!checkbox.checked) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        await nextPaint();
      }
    }

    // The DMD row's dropdown holds a TYPE, not a VPS ID, so the idField loop at
    // the top skips it - and it only unlocks once Bundled or Override is
    // ticked, which the two loops above have just done. It has to be set here,
    // before loadImportedFields: the DMD tab stays disabled until a type is
    // chosen, and loadImportedFields skips a disabled tab's fields entirely.
    const dmdType = String(values.specialDMDType ?? '').trim();
    if (dmdType) {
      const dmdSelect = document.querySelector('#assetMatrix .asset-row[data-category="specialDMD"] select');
      if (dmdSelect && !dmdSelect.disabled) {
        dmdSelect.value = dmdType;
        dmdSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await nextPaint();
      }
    }
  }

  function fieldByKey(key) {
    for (const step of WIZARD_STEPS) {
      const field = (step.fields || []).find(candidate => candidate.yml_field === key);
      if (field) return field;
    }
    return null;
  }

  // A control holds ONE string, so every imported list value is flattened the
  // moment its input event fires - vpxChecksum's second entry was being lost
  // exactly this way. These go straight back to state once the controls have
  // had their turn, bypassing the DOM entirely.
  function restoreListValues(values) {
    const onChange = window.VPS_FEATURE_RUNTIME?.state?.callbacks?.onChange;
    if (typeof onChange !== 'function') return;
    Object.entries(values).forEach(([key, value]) => {
      if (!Array.isArray(value) || value.length < 2) return;
      const field = fieldByKey(key);
      // `array` fields (testers, author overrides) round-trip correctly as a
      // comma-separated string and must NOT be forced back into a list.
      if (!field || field.type === 'array') return;
      onChange(key, value, { yml_field: key, type: field.type || 'str' });
    });
    window.VPS_CHECKSUM_ADDITIONAL?.render?.();
  }

  function fieldValueForControl(field, value) {
    if (field.type === 'array' && Array.isArray(value)) return value.map(String).join(', ');
    if (value === null || value === undefined) return '';
    return String(value);
  }

  async function setField(field, value) {
    // invertBoolean fields (Wizard Disabled backed by `enabled`) must be
    // driven even when the key is absent from the YML: absence means "not
    // disabled", which has to override the checked-by-default checkbox.
    if (field.readonly || field.disabled || (value === undefined && !field.invertBoolean)) return;
    const control = document.getElementById(`field-${field.yml_field}`);
    if (!control || control.disabled) return;

    if (field.type === 'bool') {
      const checked = field.invertBoolean
        ? (value === false || String(value).toLowerCase() === 'false')
        : (value === true || String(value).toLowerCase() === 'true');
      if (control.checked !== checked) {
        control.checked = checked;
        control.dispatchEvent(new Event('change', { bubbles: true }));
        await nextPaint();
      }
      return;
    }

    const nextValue = fieldValueForControl(field, value);
    control.value = nextValue;
    const eventName = control.tagName === 'SELECT' ? 'change' : 'input';
    control.dispatchEvent(new Event(eventName, { bubbles: true }));
    await nextPaint();
  }

  async function loadImportedFields(values) {
    const builder = await waitFor(
      () => {
        const section = document.getElementById('builderSection');
        return section && !section.hidden ? section : null;
      },
      'The Configuration Panel did not become available. Confirm the YML includes a valid VPX selection.'
    );

    for (const step of WIZARD_STEPS) {
      const tab = document.getElementById(`config-tab-${step.id}`);
      if (!tab || tab.disabled) continue;

      tab.click();
      await waitFor(
        () => document.querySelector(`#accordionStack .config-tab-panel[data-step="${step.id}"]`),
        `${step.label} configuration could not be opened.`
      );

      const fields = [...(step.fields || [])].sort((left, right) => {
        if (left.yml_field === 'coloredROMPin2DMD') return -1;
        if (right.yml_field === 'coloredROMPin2DMD') return 1;
        return 0;
      });
      for (const field of fields) {
        await setField(field, values[field.yml_field]);
      }
    }

    const mainTab = document.getElementById('config-tab-main');
    if (mainTab && !mainTab.disabled) mainTab.click();
    builder.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function importYmlFile(file) {
    if (importing) return;
    if (!isYmlFile(file)) {
      showToast('error', 'YML file required', 'Only files ending in .yml can be opened.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      showToast('error', 'YML file is too large', 'Select a .yml file smaller than 2 MB.');
      return;
    }

    if (hasCurrentBuild()) {
      const replace = window.confirm('A table build is currently loaded. Clear it and replace it with the dropped YML file?');
      if (!replace) return;
    }

    importing = true;
    dropZone?.classList.add(DROP_LOADING_CLASS);
    showToast('loading', 'Opening YML file', `Parsing ${file.name} and preparing the editor…`);

    try {
      const text = await file.text();
      const parsed = parseFlatYaml(text);
      const { values, ignored } = normalizeImportedData(parsed);

      if (ignored.length) {
        const proceed = await confirmOutdatedFields(file.name, ignored);
        if (!proceed) {
          showToast('error', 'Import cancelled', `${file.name} was not loaded because it contains outdated fields.`);
          return;
        }
      }

      const tableId = String(values.tableVPSId ?? '').trim();
      const vpxId = String(values.vpxVPSId ?? '').trim();

      if (!tableId) throw new Error('The YML file does not contain tableVPSId.');
      if (!vpxId) throw new Error('The YML file does not contain vpxVPSId, which is required to open the Configuration Panel.');

      showToast('loading', 'Loading table data', `Finding ${tableId} and matching its selected assets…`);
      const record = await findTableRecord(tableId);
      validateImportedAssetIds(record, values);
      await clearCurrentBuild();
      await loadTable(tableId);
      await selectImportedAssets(values);
      await loadImportedFields(values);
      restoreListValues(values);
      // vpxMagicAdditional is a customRenderer field with no DOM control,
      // so loadImportedFields cannot reach it - the same reason
      // additionalRoms needs its own bridge. Without this, every password
      // past the third is silently lost on import.
      window.VPS_MAGIC_PASSWORDS?.applyImported?.(values.vpxMagicAdditional);

      const ignoredMessage = ignored.length
        ? ` Loaded successfully; ${ignored.length} outdated field${ignored.length === 1 ? ' was' : 's were'} removed.`
        : ' The file is ready to continue editing.';
      showToast('success', 'YML loaded for editing', `${file.name}.${ignoredMessage}`);
    } catch (error) {
      console.error('YML import failed', error);
      showToast('error', 'YML could not be loaded', error?.message || 'The file could not be parsed.');
    } finally {
      importing = false;
      dropZone?.classList.remove(DROP_LOADING_CLASS, DROP_ACTIVE_CLASS);
      dragDepth = 0;
      if (fileInput) fileInput.value = '';
    }
  }

  function bindDropArea() {
    dropZone = document.getElementById('ymlImportDrop');
    fileInput = document.getElementById('ymlImportInput');
    if (!dropZone || !fileInput) return;

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !pendingPromptResolve) return;
      const resolve = pendingPromptResolve;
      const fallback = pendingPromptFallback;
      pendingPromptResolve = null;
      pendingPromptFallback = null;
      resolve(fallback);
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) importYmlFile(file);
    });

    dropZone.addEventListener('dragenter', event => {
      event.preventDefault();
      dragDepth += 1;
      dropZone.classList.add(DROP_ACTIVE_CLASS);
    });

    dropZone.addEventListener('dragover', event => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      dropZone.classList.add(DROP_ACTIVE_CLASS);
    });

    dropZone.addEventListener('dragleave', event => {
      event.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) dropZone.classList.remove(DROP_ACTIVE_CLASS);
    });

    dropZone.addEventListener('drop', event => {
      event.preventDefault();
      dragDepth = 0;
      dropZone.classList.remove(DROP_ACTIVE_CLASS);
      const files = [...(event.dataTransfer?.files || [])];
      if (files.length !== 1) {
        showToast('error', 'Choose one YML file', 'Drop exactly one .yml file at a time.');
        return;
      }
      importYmlFile(files[0]);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindDropArea, { once: true });
  } else {
    bindDropArea();
  }
})();
