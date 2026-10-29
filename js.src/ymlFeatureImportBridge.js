(() => {
  'use strict';

  const runtime = window.VPS_FEATURE_RUNTIME;
  const fields = window.VPS_YML_FIELDS;
  if (!runtime || !fields) return;

  const MAX_WAIT_MS = 30000;
  // The nested object lists the flat importer cannot read. Each is cut out of
  // the file before the original importer runs and applied once it finishes.
  const BLOCKS = {
    additionalRoms: {
      label: 'Additional ROM',
      keys: new Set(['vpsId', 'checksum', 'versionOverride', 'urlOverride', 'bundled', 'notes'])
    },
    postInstallRename: {
      label: 'Post-Install Rename',
      keys: new Set(['source', 'destination'])
    }
  };
  let fileInput = null;
  let dropZone = null;
  let bypass = false;
  let processing = false;

  function stripInlineComment(value) {
    let single = false;
    let double = false;
    let escaped = false;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\' && double) {
        escaped = true;
        continue;
      }
      if (character === "'" && !double) single = !single;
      else if (character === '"' && !single) double = !double;
      else if (character === '#' && !single && !double && (index === 0 || /\s/.test(value[index - 1]))) {
        return value.slice(0, index).trimEnd();
      }
    }
    return value.trimEnd();
  }

  function parseScalar(raw) {
    const value = stripInlineComment(String(raw || '').trim());
    if (!value) return '';
    if (value.startsWith('"')) {
      if (!value.endsWith('"')) throw new Error('An Additional ROM double-quoted value is not closed.');
      try { return JSON.parse(value); } catch (_) { return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\'); }
    }
    if (value.startsWith("'")) {
      if (!value.endsWith("'")) throw new Error('An Additional ROM single-quoted value is not closed.');
      return value.slice(1, -1).replace(/''/g, "'");
    }
    return value;
  }

  // One list of flat objects. A property may hold a nested list of scalars
  // (a multi-checksum entry) or a folded/literal block (long notes), both
  // indented deeper than the property itself.
  function parseObjectList(lines, block) {
    const entries = [];
    let current = null;
    let propertyIndent = -1;
    let lastKey = '';
    let pending = null; // { kind: 'list' } or { kind: 'block', literal, lines }
    let sawContent = false;

    const finishPending = () => {
      if (pending?.kind === 'block' && current) {
        current[lastKey] = pending.literal ? pending.lines.join('\n') : pending.lines.join(' ');
      }
      pending = null;
    };
    const setProperty = (key, raw, offset) => {
      if (!block.keys.has(key)) throw new Error(`Unsupported ${block.label} field “${key}” near line ${offset + 1}.`);
      lastKey = key;
      const value = stripInlineComment(String(raw || '').trim());
      if (/^[>|][+-]?$/.test(value)) {
        pending = { kind: 'block', literal: value.startsWith('|'), lines: [] };
        current[key] = '';
      } else if (!value) {
        pending = { kind: 'list' };
        current[key] = [];
      } else {
        current[key] = parseScalar(value);
      }
    };

    lines.forEach((line, offset) => {
      if (!line.trim() || /^\s*#/.test(line)) return;
      sawContent = true;
      const indent = line.match(/^\s*/)[0].length;

      if (pending && current && indent > propertyIndent) {
        if (pending.kind === 'block') {
          pending.lines.push(line.trim());
          return;
        }
        const nested = line.match(/^\s+-\s+(.*)$/);
        if (nested) {
          current[lastKey].push(parseScalar(nested[1]));
          return;
        }
      }
      finishPending();

      const itemMatch = line.match(/^(\s{2,})-\s+([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
      if (itemMatch) {
        if (current) entries.push(current);
        current = {};
        propertyIndent = itemMatch[1].length + 2;
        setProperty(itemMatch[2], itemMatch[3], offset);
        return;
      }

      const propertyMatch = line.match(/^\s{4,}([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
      if (!propertyMatch || !current) {
        throw new Error(`Could not parse the ${block.label} block near line ${offset + 1}.`);
      }
      setProperty(propertyMatch[1], propertyMatch[2], offset);
    });

    finishPending();
    if (current) entries.push(current);
    if (sawContent && !entries.length) throw new Error(`The ${block.label} block does not contain any valid entries.`);
    return entries;
  }

  const text = value => String(value ?? '').trim();

  function normalizeAdditionalRomEntry(entry) {
    const checksum = Array.isArray(entry.checksum) ? entry.checksum.map(text).filter(Boolean) : text(entry.checksum);
    const normalized = {
      vpsId: text(entry.vpsId),
      // The dialog edits several checksums as one comma-separated field.
      checksum: Array.isArray(checksum) ? checksum.join(', ') : checksum,
      versionOverride: text(entry.versionOverride),
      urlOverride: text(entry.urlOverride),
      notes: text(entry.notes)
    };
    if (/^true$/i.test(text(entry.bundled))) normalized.bundled = true;
    return normalized;
  }

  function extractTableId(text) {
    const match = String(text).match(/^tableVPSId:\s*(.+)$/m);
    return match ? String(parseScalar(match[1])).trim() : '';
  }

  function extractFeatureBlock(source) {
    let lines = String(source).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = {};

    Object.entries(BLOCKS).forEach(([name, block]) => {
      const header = new RegExp(`^${name}:\\s*(?:\\[\\s*\\])?\\s*(?:#.*)?$`);
      const start = lines.findIndex(line => header.test(line));
      if (start < 0) return;
      let end = start + 1;
      while (end < lines.length && (!lines[end].trim() || /^\s/.test(lines[end]))) end += 1;
      const inlineEmpty = new RegExp(`^${name}:\\s*\\[\\s*\\]`).test(lines[start]);
      blocks[name] = inlineEmpty ? [] : parseObjectList(lines.slice(start + 1, end), block);
      lines = [...lines.slice(0, start), ...lines.slice(end)];
    });

    if (blocks.additionalRoms) blocks.additionalRoms = blocks.additionalRoms.map(normalizeAdditionalRomEntry);
    if (blocks.postInstallRename) {
      blocks.postInstallRename = window.VPS_UTILS?.formatPostInstallRename?.(blocks.postInstallRename)
        ?? blocks.postInstallRename.map(entry => `${text(entry.source)} -> ${text(entry.destination)}`).join('\n');
    }

    const strippedText = lines.join('\n');
    return { found: Object.keys(blocks).length > 0, blocks, strippedText, tableId: extractTableId(strippedText) };
  }

  function stepField(stepId, name) {
    return fields.WIZARD_STEPS.find(step => step.id === stepId)?.fields
      .find(field => field.yml_field === name) || { yml_field: name };
  }

  function transformedFile(source, text) {
    return new File([text], source.name, {
      type: source.type || 'text/yaml',
      lastModified: source.lastModified
    });
  }

  function assignFile(file) {
    if (typeof DataTransfer === 'function') {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
      return;
    }
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: Object.freeze([file])
    });
  }

  function dispatchToOriginal(file) {
    assignFile(file);
    bypass = true;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    bypass = false;
  }

  function waitFor(predicate, timeout = MAX_WAIT_MS, interval = 40) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        try {
          const value = predicate();
          if (value) {
            resolve(value);
            return;
          }
        } catch (_) {
          // The original importer is still transitioning between views.
        }
        if (Date.now() - started >= timeout) {
          reject(new Error('Timed out waiting for the original YML importer.'));
          return;
        }
        window.setTimeout(check, interval);
      };
      check();
    });
  }

  async function waitForOriginalImport(tableId) {
    await waitFor(() => dropZone.classList.contains('is-loading'), 3000);
    await waitFor(() => !dropZone.classList.contains('is-loading'));
    return waitFor(() => {
      const recordId = String(runtime.state.record?.id || '').trim();
      const hasCallbacks = typeof runtime.state.callbacks?.onChange === 'function';
      return hasCallbacks && (!tableId || recordId.toLowerCase() === tableId.toLowerCase());
    });
  }

  function additionalRomsDefinition() {
    return fields.WIZARD_STEPS.find(step => step.id === 'rom')?.fields
      .find(field => field.yml_field === 'additionalRoms') || { yml_field: 'additionalRoms', type: 'additional-roms' };
  }

  async function processFile(source) {
    processing = true;
    try {
      let extracted;
      try {
        extracted = extractFeatureBlock(await source.text());
      } catch (error) {
        console.warn('Nested block import preprocessing failed; using the original importer error path.', error);
        dispatchToOriginal(source);
        return;
      }

      const nextFile = extracted.found ? transformedFile(source, extracted.strippedText) : source;
      dispatchToOriginal(nextFile);
      if (!extracted.found) return;

      try {
        await waitForOriginalImport(extracted.tableId);
      } catch (_) {
        return;
      }

      const { additionalRoms, postInstallRename } = extracted.blocks;
      if (additionalRoms) {
        runtime.state.callbacks.onChange('additionalRoms', additionalRoms, additionalRomsDefinition());
        window.VPS_ADDITIONAL_ROMS?.render?.();
      }
      if (postInstallRename !== undefined) {
        runtime.state.callbacks.onChange('postInstallRename', postInstallRename, stepField('vpx', 'postInstallRename'));
        // A field change does not re-render the tab, so an open VPX tab would
        // keep showing the empty box it was drawn with.
        const control = document.getElementById('field-postInstallRename');
        if (control) {
          control.value = postInstallRename;
          control.closest('details')?.setAttribute('open', '');
        }
      }
      window.VPS_PRODUCTION_UI_EXTENSIONS?.scheduleControlCorrections?.();
    } finally {
      processing = false;
    }
  }

  function validYml(file) {
    return file instanceof File && /\.yml$/i.test(file.name);
  }

  function onInputChange(event) {
    if (bypass || processing) return;
    const file = fileInput.files?.[0];
    if (!validYml(file)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void processFile(file);
  }

  function onDrop(event) {
    if (bypass || processing) return;
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length !== 1 || !validYml(files[0])) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dropZone.classList.remove('is-dragover');
    void processFile(files[0]);
  }

  function bind() {
    fileInput = document.getElementById('ymlImportInput');
    dropZone = document.getElementById('ymlImportDrop');
    if (!fileInput || !dropZone) return;
    fileInput.addEventListener('change', onInputChange, true);
    dropZone.addEventListener('drop', onDrop, true);
  }

  window.VPS_YML_FEATURE_IMPORT = Object.freeze({ extractFeatureBlock });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
