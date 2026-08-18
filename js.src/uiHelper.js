(() => {
  'use strict';

  const {
    formatDate,
    getCoverUrl,
    getItemLabel,
    isItemBroken,
    getItemUrl,
    getCategoryItems,
    getAssetState,
    extractArchiveDirectories,
    listArchiveEntryPaths,
    replacePrimaryChecksum
  } = window.VPS_UTILS;
  const { CATEGORY_CONFIG } = window.VPS_YML_FIELDS;

  function element(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== '') node.textContent = text;
    return node;
  }


  function md5ArrayBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    const length = bytes.length;
    const paddedLength = (((length + 8) >>> 6) + 1) * 64;
    const data = new Uint8Array(paddedLength);
    data.set(bytes);
    data[length] = 0x80;
    const bitLength = length * 8;
    const view = new DataView(data.buffer);
    view.setUint32(paddedLength - 8, bitLength >>> 0, true);
    view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;
    const shifts = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
    const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0);
    const rotateLeft = (value, amount) => ((value << amount) | (value >>> (32 - amount))) >>> 0;

    for (let offset = 0; offset < paddedLength; offset += 64) {
      const words = Array.from({ length: 16 }, (_, index) => view.getUint32(offset + index * 4, true));
      let a = a0, b = b0, c = c0, d = d0;
      for (let index = 0; index < 64; index += 1) {
        let f, g;
        if (index < 16) { f = (b & c) | (~b & d); g = index; }
        else if (index < 32) { f = (d & b) | (~d & c); g = (5 * index + 1) % 16; }
        else if (index < 48) { f = b ^ c ^ d; g = (3 * index + 5) % 16; }
        else { f = c ^ (b | ~d); g = (7 * index) % 16; }
        const nextD = d;
        d = c;
        c = b;
        b = (b + rotateLeft((a + f + constants[index] + words[g]) >>> 0, shifts[index])) >>> 0;
        a = nextD;
      }
      a0 = (a0 + a) >>> 0;
      b0 = (b0 + b) >>> 0;
      c0 = (c0 + c) >>> 0;
      d0 = (d0 + d) >>> 0;
    }

    return [a0, b0, c0, d0].map(value =>
      [0, 8, 16, 24].map(shift => ((value >>> shift) & 0xff).toString(16).padStart(2, '0')).join('')
    ).join('');
  }

  function createMd5Worker() {
    // Streaming MD5 worker. Accepts incremental chunks so files larger than the
    // single-ArrayBuffer allocation limit (~2 GB in Chrome) can still be hashed.
    // Protocol:
    //   { type: 'init' }                    -> reset state
    //   { type: 'chunk', buffer: ArrayBuffer } -> feed bytes (transferable)
    //   { type: 'finish' }                  -> emit { checksum } or { error }
    const workerSource = `
      'use strict';
      let a0, b0, c0, d0;
      let buffered = new Uint8Array(0);
      let totalLength = 0;
      const shifts = new Uint8Array([7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21]);
      const constants = new Uint32Array(64);
      for (let i = 0; i < 64; i += 1) constants[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
      function rotate(value, amount) { return ((value << amount) | (value >>> (32 - amount))) >>> 0; }
      function processBlocks(bytes, byteCount) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, byteCount);
        const words = new Uint32Array(16);
        for (let offset = 0; offset < byteCount; offset += 64) {
          for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4, true);
          let a = a0, b = b0, c = c0, d = d0;
          for (let i = 0; i < 64; i += 1) {
            let f, g;
            if (i < 16) { f = (b & c) | (~b & d); g = i; }
            else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
            else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
            else { f = c ^ (b | ~d); g = (7 * i) & 15; }
            const nextD = d;
            d = c; c = b;
            b = (b + rotate((a + f + constants[i] + words[g]) >>> 0, shifts[i])) >>> 0;
            a = nextD;
          }
          a0 = (a0 + a) >>> 0;
          b0 = (b0 + b) >>> 0;
          c0 = (c0 + c) >>> 0;
          d0 = (d0 + d) >>> 0;
        }
      }
      function reset() {
        a0 = 0x67452301; b0 = 0xefcdab89; c0 = 0x98badcfe; d0 = 0x10325476;
        buffered = new Uint8Array(0);
        totalLength = 0;
      }
      reset();
      self.onmessage = function (event) {
        try {
          const message = event.data;
          if (message && message.type === 'init') { reset(); return; }
          if (message && message.type === 'chunk') {
            const chunk = new Uint8Array(message.buffer);
            totalLength += chunk.length;
            let combined;
            if (buffered.length === 0) {
              combined = chunk;
            } else {
              combined = new Uint8Array(buffered.length + chunk.length);
              combined.set(buffered, 0);
              combined.set(chunk, buffered.length);
            }
            const completeBytes = combined.length - (combined.length % 64);
            if (completeBytes > 0) processBlocks(combined, completeBytes);
            const leftover = combined.subarray(completeBytes);
            buffered = leftover.length > 0 ? new Uint8Array(leftover) : new Uint8Array(0);
            return;
          }
          if (message && message.type === 'finish') {
            const bitLength = totalLength * 8;
            const remaining = buffered.length;
            const paddedLength = (((remaining + 8) >>> 6) + 1) * 64;
            const padded = new Uint8Array(paddedLength);
            padded.set(buffered);
            padded[remaining] = 0x80;
            const view = new DataView(padded.buffer);
            view.setUint32(paddedLength - 8, bitLength >>> 0, true);
            view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);
            processBlocks(padded, paddedLength);
            const checksum = [a0, b0, c0, d0].map(function (value) {
              return [0, 8, 16, 24].map(function (shift) {
                return ((value >>> shift) & 0xff).toString(16).padStart(2, '0');
              }).join('');
            }).join('');
            self.postMessage({ checksum: checksum });
          }
        } catch (error) {
          self.postMessage({ error: error && error.message ? error.message : 'MD5 calculation failed.' });
        }
      };
    `;
    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    const worker = new Worker(workerUrl);
    URL.revokeObjectURL(workerUrl);
    return worker;
  }

  function calculateMd5FromBlob(blob) {
    return new Promise((resolve, reject) => {
      if (typeof Worker === 'undefined' || typeof blob?.stream !== 'function') {
        // Fallback: slurp whole file (only works for files under ~2 GB in Chrome).
        blob.arrayBuffer()
          .then(buffer => resolve(md5ArrayBuffer(buffer).toUpperCase()))
          .catch(reject);
        return;
      }

      const worker = createMd5Worker();
      let settled = false;
      const done = value => { if (settled) return; settled = true; worker.terminate(); resolve(value); };
      const fail = error => { if (settled) return; settled = true; worker.terminate(); reject(error); };

      worker.addEventListener('message', event => {
        if (event.data?.error) fail(new Error(event.data.error));
        else if (event.data?.checksum !== undefined) done(String(event.data.checksum).toUpperCase());
      });
      worker.addEventListener('error', event => {
        fail(event.error || new Error(event.message || 'MD5 worker failed.'));
      });

      worker.postMessage({ type: 'init' });

      (async () => {
        let reader;
        try {
          reader = blob.stream().getReader();
          while (!settled) {
            const { done: streamDone, value } = await reader.read();
            if (streamDone) break;
            const buffer = (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength)
              ? value.buffer
              : value.slice().buffer;
            worker.postMessage({ type: 'chunk', buffer: buffer }, [buffer]);
          }
          if (!settled) worker.postMessage({ type: 'finish' });
        } catch (error) {
          const sizeMb = blob?.size ? (blob.size / (1024 * 1024)).toFixed(1) : '?';
          const reason = error?.name === 'NotReadableError'
            ? `browser could not read the file (${sizeMb} MB) \u2014 file may be locked, on a slow drive, or the download is incomplete`
            : (error?.message || error?.name || 'unknown read error');
          fail(new Error(`MD5 read failed: ${reason}`));
        } finally {
          try { reader?.releaseLock?.(); } catch (_) { /* ignore */ }
        }
      })();
    });
  }

  function getFileExtension(filename) {
    const match = String(filename || '').toLowerCase().match(/\.[^.]+$/);
    return match ? match[0] : '';
  }

  let archiveModulePromise = null;

  function loadArchiveModule() {
    if (!archiveModulePromise) {
      const moduleUrl = new URL('vendor/libarchive/libarchive.js', document.baseURI).href;
      const workerUrl = new URL('vendor/libarchive/worker-bundle.js', document.baseURI).href;
      archiveModulePromise = import(moduleUrl).then(module => {
        module.Archive.init({ workerUrl });
        return module.Archive;
      });
    }
    return archiveModulePromise;
  }

  async function readArchiveDirectories(file) {
    // Fast path: streaming header parsers (currently RAR5) that work for archives
    // of any size — they never load the whole file into memory.
    try {
      const streamedEntries = await listArchiveEntryPaths(file);
      if (streamedEntries && streamedEntries.length > 0) {
        return extractArchiveDirectories(streamedEntries);
      }
    } catch (error) {
      console.warn('Streaming archive parse failed, falling back to libarchive:', error);
    }

    const Archive = await loadArchiveModule();
    // Fallback path: libarchive.js. It requires the whole file in a single
    // ArrayBuffer, which fails for files larger than ~2 GB. Reading here (on
    // the main thread) lets us catch the NotReadableError with useful info
    // instead of it surfacing as an uncaught rejection inside the worker.
    let source;
    try {
      const buffer = await file.arrayBuffer();
      source = new Blob([buffer], { type: file.type || 'application/octet-stream' });
    } catch (error) {
      const sizeMb = file?.size ? (file.size / (1024 * 1024)).toFixed(1) : '?';
      const reason = error?.name === 'NotReadableError'
        ? `archive is too large to browse in-browser (${sizeMb} MB) \u2014 enter the directory manually`
        : (error?.message || error?.name || 'unknown read error');
      const friendly = new Error(`Could not browse "${file?.name || 'archive'}": ${reason}.`);
      friendly.cause = error;
      throw friendly;
    }
    const archive = await Archive.open(source);
    try {
      const entries = await archive.getFilesArray();
      return extractArchiveDirectories(entries);
    } finally {
      try { await archive.close(); } catch (_) { /* worker may already be closed */ }
    }
  }

  const ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z'];

  let unrarModulePromise = null;

  function loadUnrarModule() {
    // libarchive.js cannot decompress RAR entries, so RAR extraction goes
    // through node-unrar-js (vendored WASM build of the official unrar lib).
    if (!unrarModulePromise) {
      const moduleUrl = new URL('vendor/unrar/unrar.bundle.js', document.baseURI).href;
      const wasmUrl = new URL('vendor/unrar/unrar.wasm', document.baseURI).href;
      unrarModulePromise = Promise.all([
        import(moduleUrl),
        fetch(wasmUrl).then(response => {
          if (!response.ok) throw new Error('Could not load the RAR extraction engine (unrar.wasm).');
          return response.arrayBuffer();
        })
      ]).then(([module, wasmBinary]) => ({ module, wasmBinary }));
    }
    return unrarModulePromise;
  }

  async function extractRarEntries(file, selectNames) {
    const { module, wasmBinary } = await loadUnrarModule();
    const data = await file.arrayBuffer();
    const extractor = await module.createExtractorFromData({ wasmBinary, data });
    const names = [...extractor.getFileList().fileHeaders]
      .filter(header => !header.flags?.directory)
      .map(header => String(header.name || ''));
    const wanted = selectNames(names);
    if (!wanted.length) return [];
    const extracted = [...extractor.extract({ files: wanted }).files];
    return wanted.map(name => {
      const entry = extracted.find(candidate => String(candidate?.fileHeader?.name || '') === name && candidate?.extraction);
      if (!entry) throw new Error(`Could not extract "${name}" from "${file.name}".`);
      return { name, blob: new Blob([entry.extraction]) };
    });
  }

  async function extractLibarchiveEntries(file, selectNames) {
    const Archive = await loadArchiveModule();
    let source;
    try {
      const buffer = await file.arrayBuffer();
      source = new Blob([buffer], { type: file.type || 'application/octet-stream' });
    } catch (error) {
      const sizeMb = file?.size ? (file.size / (1024 * 1024)).toFixed(1) : '?';
      const reason = error?.name === 'NotReadableError'
        ? `archive is too large to scan in-browser (${sizeMb} MB) — drop the contained file directly`
        : (error?.message || error?.name || 'unknown read error');
      const friendly = new Error(`Could not scan "${file?.name || 'archive'}": ${reason}.`);
      friendly.cause = error;
      throw friendly;
    }
    const archive = await Archive.open(source);
    try {
      const entries = (await archive.getFilesArray()) || [];
      const entryName = entry => `${String(entry?.path || '')}${String(entry?.file?.name || '')}`;
      const wanted = selectNames(entries.map(entryName));
      const output = [];
      for (const name of wanted) {
        const entry = entries.find(candidate => entryName(candidate) === name);
        if (!entry) throw new Error(`Could not extract "${name}" from "${file.name}".`);
        const blob = typeof entry.file.extract === 'function' ? await entry.file.extract() : entry.file;
        output.push({ name, blob });
      }
      return output;
    } finally {
      try { await archive.close(); } catch (_) { /* worker may already be closed */ }
    }
  }

  // selectNames receives every file entry name in the archive and returns the
  // names to extract (it may throw a user-facing Error instead).
  function extractArchiveEntries(file, selectNames) {
    return getFileExtension(file.name) === '.rar'
      ? extractRarEntries(file, selectNames)
      : extractLibarchiveEntries(file, selectNames);
  }

  async function extractArchiveEntryChecksum(file, targetExtension) {
    const wanted = String(targetExtension).toLowerCase();
    const matches = await extractArchiveEntries(file, names => {
      const target = names.find(name => name.toLowerCase().endsWith(wanted));
      if (!target) throw new Error(`No ${targetExtension} file found inside "${file.name}".`);
      return [target];
    });
    const { name, blob } = matches[0];
    const checksum = await calculateMd5FromBlob(blob);
    return { checksum, entryName: name.split('/').pop() };
  }

  const COLOR_ROM_EXTENSIONS = ['.pal', '.vni', '.crz', '.pac', '.cromc'];

  async function extractColorRomArchiveChecksums(file) {
    const entries = await extractArchiveEntries(file, names => {
      const matches = names.filter(name => COLOR_ROM_EXTENSIONS.includes(getFileExtension(name)));
      if (!matches.length) {
        throw new Error(`No Color ROM file (${COLOR_ROM_EXTENSIONS.join(' / ')}) found inside "${file.name}".`);
      }
      const pal = matches.find(name => getFileExtension(name) === '.pal');
      const vni = matches.find(name => getFileExtension(name) === '.vni');
      if (pal && vni) return [pal, vni];
      if (matches.length === 1) return matches;
      throw new Error(`"${file.name}" contains multiple Color ROM files — expected one file or a .pal/.vni pair.`);
    });
    const results = [];
    for (const entry of entries) {
      results.push({
        name: entry.name.split('/').pop(),
        extension: getFileExtension(entry.name),
        checksum: await calculateMd5FromBlob(entry.blob)
      });
    }
    return results;
  }

  function getChecksumExtensions(field, values) {
    if (field.checksumExtensionsByFlag) {
      const flagConfig = field.checksumExtensionsByFlag;
      const enabled = values[flagConfig.field] === true;
      return (flagConfig[String(enabled)] || []).map(extension => extension.toLowerCase());
    }
    return Array.isArray(field.checksumExtensions)
      ? field.checksumExtensions.map(extension => extension.toLowerCase())
      : [];
  }

  function populateDirectoryPicker(select, directories) {
    if (!select) return;
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = directories.length
      ? `Choose from ${directories.length} archive director${directories.length === 1 ? 'y' : 'ies'}…`
      : 'Drop a PUP Pack archive to browse directories';
    select.appendChild(placeholder);
    directories.forEach(directory => {
      const option = document.createElement('option');
      option.value = directory;
      option.textContent = directory;
      select.appendChild(option);
    });
    select.disabled = directories.length === 0;
  }

  function renderSuggestions(container, results, activeIndex, onSelect) {
    container.innerHTML = '';
    results.forEach((record, index) => {
      const button = element('button', `suggestion-item${index === activeIndex ? ' active' : ''}`);
      button.type = 'button';
      button.id = `suggestion-${index}`;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');
      button.append(
        element('span', 'suggestion-name', record.name || '[Unnamed table]'),
        element('span', 'suggestion-meta', record.id || 'No ID')
      );
      button.addEventListener('mousedown', event => {
        event.preventDefault();
        onSelect(record);
      });
      container.appendChild(button);
    });
    container.classList.toggle('active', results.length > 0);
  }

  function getInitials(name) {
    return String(name || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase();
  }

  function renderTableStrip(container, record, selections, values, badgeContainer, callbacks = {}) {
    const clearButton = container.querySelector('#changeTableBtn');
    container.replaceChildren();

    const cover = element('div', 'table-cover', getInitials(record?.name));
    const coverUrl = getCoverUrl(record);
    if (coverUrl) {
      const image = document.createElement('img');
      image.className = 'table-cover-image';
      image.src = coverUrl;
      image.alt = `${record?.name || 'Table'} artwork`;

      const preview = document.createElement('img');
      preview.className = 'table-cover-preview';
      preview.src = coverUrl;
      preview.alt = '';
      preview.setAttribute('aria-hidden', 'true');

      cover.tabIndex = 0;
      cover.setAttribute('aria-label', `Preview ${record?.name || 'table'} artwork`);
      image.addEventListener('error', () => {
        cover.removeAttribute('tabindex');
        cover.removeAttribute('aria-label');
        cover.replaceChildren(document.createTextNode(getInitials(record?.name)));
      }, { once: true });
      preview.addEventListener('error', () => preview.remove(), { once: true });
      cover.replaceChildren(image, preview);
    }

    const summary = element('div', 'table-summary');
    summary.appendChild(element('h1', '', record?.name || record?.id || 'Unknown table'));
    const meta = [];
    if (record?.manufacturer) meta.push(record.manufacturer);
    if (record?.year) meta.push(record.year);
    if (record?.id) meta.push(record.id);
    const metaLine = element('p', 'table-meta');
    metaLine.innerHTML = meta.map((part, index) => index === meta.length - 1
      ? `<span class="table-id">${escapeText(part)}</span>`
      : escapeText(part)).join(' · ');
    summary.appendChild(metaLine);

    if (badgeContainer) {
      badgeContainer.replaceChildren();
      Object.entries(CATEGORY_CONFIG).forEach(([category, config]) => {
        const assetState = getAssetState(record, category, config, selections, values);
        const canJump = assetState.key === 'green' && assetState.safe && Boolean(selections.tableFiles);
        const badge = element(canJump ? 'button' : 'span', `asset-badge state-${assetState.key}${canJump ? ' can-jump' : ''}`);
        if (canJump) {
          badge.type = 'button';
          badge.dataset.tooltip = `Jump to ${config.label}`;
          badge.title = `Jump to ${config.label}`;
          badge.setAttribute('aria-label', `${config.label}: ${assetState.label}. Jump to ${config.label} tab.`);
          badge.addEventListener('click', () => callbacks.onJump?.(config.stepId));
        } else {
          badge.setAttribute('aria-label', `${config.label}: ${assetState.label}`);
        }
        badge.textContent = config.label;
        badgeContainer.appendChild(badge);
      });
    }

    const nsfwToggle = element('label', 'nsfw-toggle table-nsfw-toggle');
    const nsfwCheck = document.createElement('input');
    nsfwCheck.type = 'checkbox';
    nsfwCheck.checked = values?.nsfw === true;
    nsfwCheck.setAttribute('aria-label', 'Mark this table NSFW');
    nsfwCheck.addEventListener('change', () => callbacks.onNsfw?.('nsfw', nsfwCheck.checked));
    nsfwToggle.append(nsfwCheck, document.createTextNode('NSFW'));

    container.append(cover, summary, nsfwToggle);
    if (clearButton) container.appendChild(clearButton);
  }

  function escapeText(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  }

  function appendAssetDetail(container, label, value) {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return;
    const block = element('div');
    block.append(element('strong', '', label), document.createTextNode(Array.isArray(value) ? value.join(', ') : String(value)));
    container.appendChild(block);
  }

  function getAssetImageUrl(item) {
    return item?.imgUrl || item?.imageUrl || item?.thumbnailUrl || item?.image || '';
  }

  function createAssetThumbnail(item, label) {
    const imageUrl = getAssetImageUrl(item);
    if (!imageUrl) return null;

    const thumbnail = element('span', 'asset-thumbnail');
    thumbnail.tabIndex = 0;
    thumbnail.setAttribute('aria-label', `Preview selected ${label} image`);

    const frame = element('span', 'asset-thumbnail-frame');
    const image = document.createElement('img');
    image.className = 'asset-thumbnail-image';
    image.src = imageUrl;
    image.alt = `${label} thumbnail`;

    const preview = document.createElement('img');
    preview.className = 'asset-thumbnail-preview';
    preview.src = imageUrl;
    preview.alt = '';
    preview.setAttribute('aria-hidden', 'true');

    image.addEventListener('error', () => thumbnail.remove(), { once: true });
    preview.addEventListener('error', () => preview.remove(), { once: true });
    frame.appendChild(image);
    thumbnail.append(frame, preview);
    return thumbnail;
  }

  function renderAssetMatrix(container, record, selections, values, callbacks) {
    container.innerHTML = '';

    Object.entries(CATEGORY_CONFIG).forEach(([category, config]) => {
      const assetState = getAssetState(record, category, config, selections, values);
      const items = assetState.items;
      const selectedId = selections[category] || '';
      const selectedItem = items.find(item => item.id === selectedId) || null;
      const bundled = Boolean(config.bundleField && values[config.bundleField]);
      const overridden = Boolean(config.overrideField && values[config.overrideField]);
      const detailOpen = callbacks.isDetailOpen(category);

      const row = element('div', `asset-row${selectedItem ? ' has-selection' : ''}${detailOpen ? ' details-open' : ''}`);
      row.dataset.category = category;
      const selectedItemUrl = selectedItem ? getItemUrl(selectedItem) : '';
      if (selectedItemUrl) {
        const nameLink = document.createElement('a');
        nameLink.className = 'asset-name';
        nameLink.href = selectedItemUrl;
        nameLink.target = '_blank';
        nameLink.rel = 'noopener noreferrer';
        nameLink.textContent = config.label;
        row.appendChild(nameLink);
      } else {
        row.appendChild(element('div', 'asset-name', config.label));
      }

      const select = document.createElement('select');
      select.setAttribute('aria-label', `Select ${config.singular}`);
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = items.length ? `No ${config.label} selected` : 'No Files Available';
      select.appendChild(placeholder);
      items.forEach(item => {
        const option = document.createElement('option');
        option.value = item.id || '';
        option.textContent = getItemLabel(item);
        option.disabled = isItemBroken(item);
        if (option.disabled) {
          option.textContent += ' · Broken';
          option.className = 'broken-option';
        }
        option.selected = option.value === selectedId;
        select.appendChild(option);
      });
      select.disabled = !items.length;
      select.addEventListener('change', () => callbacks.onSelect(category, select.value));

      const selectWrap = element('div', 'asset-select-wrap');
      selectWrap.appendChild(select);
      if (config.supportsImage && selectedItem) {
        const thumbnail = createAssetThumbnail(selectedItem, config.label);
        if (thumbnail) selectWrap.appendChild(thumbnail);
      }
      row.appendChild(selectWrap);

      if (config.bundleField || config.nsfwField || config.overrideField) {
        const toggles = element('div', 'asset-toggle-stack');
        if (config.bundleField) {
          const bundleLabel = element('label', 'bundle-toggle');
          const bundleCheck = document.createElement('input');
          bundleCheck.type = 'checkbox';
          bundleCheck.checked = bundled;
          bundleCheck.addEventListener('change', () => callbacks.onBundle(config.bundleField, bundleCheck.checked));
          bundleLabel.append(bundleCheck, document.createTextNode('Bundled'));
          toggles.appendChild(bundleLabel);
        }
        if (config.nsfwField) {
          const nsfwLabel = element('label', 'bundle-toggle nsfw-toggle');
          const nsfwCheck = document.createElement('input');
          nsfwCheck.type = 'checkbox';
          nsfwCheck.checked = values[config.nsfwField] === true;
          // The table-level NSFW flag owns the per-asset flags while checked.
          nsfwCheck.disabled = (!selectedId && !bundled && !overridden) || values.nsfw === true;
          nsfwCheck.setAttribute('aria-label', `Mark ${config.singular} NSFW`);
          nsfwCheck.addEventListener('change', () => callbacks.onNsfw?.(config.nsfwField, nsfwCheck.checked));
          nsfwLabel.append(nsfwCheck, document.createTextNode('NSFW'));
          toggles.appendChild(nsfwLabel);
        }
        if (config.overrideField) {
          const overrideLabel = element('label', 'bundle-toggle override-toggle');
          const overrideCheck = document.createElement('input');
          overrideCheck.type = 'checkbox';
          overrideCheck.checked = values[config.overrideField] === true;
          overrideCheck.setAttribute('aria-label', `Override ${config.singular} — unlock this tab without a VPS entry`);
          overrideCheck.addEventListener('change', () => callbacks.onOverride?.(config.overrideField, overrideCheck.checked));
          overrideLabel.append(overrideCheck, document.createTextNode('Override'));
          toggles.appendChild(overrideLabel);
        }
        row.appendChild(toggles);
      } else {
        row.appendChild(element('span'));
      }

      const status = element('div', `asset-status state-${assetState.key}`);
      status.append(element('span', 'status-dot'), document.createTextNode(assetState.label));
      row.appendChild(status);

      const infoButton = element('button', 'asset-info-button', detailOpen ? 'Hide info' : 'Info');
      infoButton.type = 'button';
      infoButton.disabled = !selectedItem;
      if (selectedItem) {
        infoButton.addEventListener('click', () => callbacks.onToggleDetail(category));
      } else {
        infoButton.setAttribute('aria-disabled', 'true');
      }
      row.appendChild(infoButton);

      const detail = element('div', 'asset-detail');
      if (selectedItem) {
        appendAssetDetail(detail, 'VPS ID', selectedItem.id);
        appendAssetDetail(detail, 'Version', selectedItem.version);
        appendAssetDetail(detail, 'Authors', selectedItem.authors);
        appendAssetDetail(detail, 'Format', selectedItem.tableFormat);
        appendAssetDetail(detail, 'File', selectedItem.fileName);
        appendAssetDetail(detail, 'Updated', formatDate(selectedItem.updatedAt));
        if (selectedItem.comment) detail.appendChild(element('div', 'asset-comment', selectedItem.comment));
      }
      row.appendChild(detail);
      container.appendChild(row);
    });
  }

  function getFieldLayoutClass(stepId, field) {
    const name = field.yml_field;
    if (stepId === 'main') {
      if (name === 'tableVPSId') return ' field-main-id field-id-standard';
      if (name === 'fps') return ' field-main-fps';
      if (name === 'enabled') return ' field-main-enabled field-checkbox-plain';
      if (name === 'tagline') return ' field-main-tagline';
      if (name === 'mainNotes') return ' field-main-notes field-textarea-three';
      if (name === 'testers') return ' field-main-testers field-textarea-three';
      if (name === 'tableNameOverride') return ' field-main-name-override field-wide';
      if (name === 'tableManufacturerOverride') return ' field-main-manufacturer-override';
      if (name === 'tableYearOverride') return ' field-main-year-override';
    }
    if (stepId === 'coloredRom') {
      if (name === 'coloredROMVPSId') return ' field-color-id field-id-standard';
      if (name === 'coloredROMChecksum') return ' field-color-checksum field-checksum-standard';
      if (name === 'coloredROMPin2DMD') return ' field-color-pin2dmd field-checkbox-plain';
      if (name === 'coloredROMChecksumSecondary') return ' field-color-secondary field-checksum-standard';
      if (name === 'coloredROMNotes') return ' field-color-notes field-textarea-three';
    }
    if (stepId === 'pup') {
      if (name === 'pupVPSId') return ' field-pup-id field-id-standard';
      if (name === 'pupChecksum') return ' field-pup-checksum field-checksum-standard';
      if (name === 'pupNotes') return ' field-pup-notes field-textarea-two';
      if (name === 'pupFileUrl') return ' field-pup-url';
      if (name === 'pupVersion') return ' field-pup-version';
      if (name === 'pupArchiveFormat') return ' field-pup-format';
      if (name === 'pupArchiveRoot') return ' field-pup-root';
      if (name === 'pupRequired') return ' field-pup-required field-checkbox-plain';
    }
    if (stepId === 'altSound') {
      if (name === 'altSoundVPSId') return ' field-alt-id field-id-standard';
      if (name === 'altSoundChecksum') return ' field-alt-checksum field-checksum-standard field-alt-sound-checksum checksum-drop-field';
      if (name === 'altSoundNotes') return ' field-alt-notes field-textarea-two';
      if (name === 'altSoundArchiveFormat') return ' field-alt-format';
      if (name === 'altSoundArchiveRoot') return ' field-alt-root';
    }
    if (field.readonly) return ' field-compact-id field-id-standard';
    if (/Checksum/i.test(field.name)) return ' field-checksum field-checksum-standard';
    if (field.multiline) return ' field-wide field-textarea-three';
    return field.wide ? ' field-wide' : '';
  }

  function createFieldControl(field, values, onChange, stepId) {
    const wrapper = element('div', `field${getFieldLayoutClass(stepId, field)}`);
    const value = values[field.yml_field] ?? '';
    const controlId = `field-${field.yml_field}`;

    if (field.type === 'bool') {
      const row = element('label', 'checkbox-row');
      row.htmlFor = controlId;
      const input = document.createElement('input');
      input.id = controlId;
      input.name = field.yml_field;
      input.type = 'checkbox';
      // invertBoolean fields (e.g. "Disable for Wizard" backed by `enabled`)
      // display the opposite sense of the stored value: checked means the
      // underlying field is explicitly false, and checking the box writes
      // false while unchecking it omits the key entirely.
      input.checked = field.invertBoolean ? value === false : value === true;
      input.disabled = Boolean(field.disabledUnless && values[field.disabledUnless] !== true);
      input.setAttribute('aria-label', field.name);
      input.addEventListener('change', () => {
        const nextValue = field.invertBoolean
          ? (input.checked ? false : undefined)
          : input.checked;
        onChange(field.yml_field, nextValue, field);
      });
      const label = field.stackedLabel
        ? element('span', 'checkbox-label-stacked', field.name.replace(' ', '\n'))
        : element('span', '', field.name);
      row.append(input, label);
      wrapper.appendChild(row);
      return wrapper;
    }

    if (field.type === 'array-options') {
      wrapper.appendChild(element('span', 'visually-hidden', field.name));
      const options = element('div', 'array-options');
      field.items.forEach(item => {
        const checked = values[item.yml_field] === true;
        const option = element('label', `array-option${checked ? ' checked' : ''}`);
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.addEventListener('change', () => onChange(item.yml_field, input.checked, item));
        option.append(input, element('span', '', item.name));
        options.appendChild(option);
      });
      wrapper.appendChild(options);
      return wrapper;
    }

    if (field.readonly) {
      const label = element('label', 'visually-hidden', field.name);
      label.htmlFor = controlId;
      wrapper.appendChild(label);
      const readonly = element('div', 'readonly-id', value || field.name);
      readonly.id = controlId;
      readonly.setAttribute('role', 'textbox');
      readonly.setAttribute('aria-label', field.name);
      readonly.setAttribute('aria-readonly', 'true');
      wrapper.appendChild(readonly);
      return wrapper;
    }

    let input;
    if (field.responsiveTextarea) {
      const responsiveWrap = element('div', 'responsive-text-control');
      const textInput = document.createElement('input');
      const textArea = document.createElement('textarea');
      textInput.type = 'text';
      textArea.rows = 3;
      [textInput, textArea].forEach(control => {
        control.id = control === textInput ? controlId : `${controlId}-mobile`;
        control.value = value;
        control.setAttribute('aria-label', field.name);
        control.placeholder = field.name;
        control.addEventListener('input', () => {
          const nextValue = control.value;
          textInput.value = nextValue;
          textArea.value = nextValue;
          onChange(field.yml_field, nextValue, field);
        });
      });
      const label = element('label', 'visually-hidden', field.name);
      label.htmlFor = controlId;
      wrapper.append(label, responsiveWrap);
      responsiveWrap.append(textInput, textArea);
      wrapper.classList.add('field-placeholder-only');
      return wrapper;
    } else if (field.multiline) {
      input = document.createElement('textarea');
      input.rows = 3;
    } else if (field.type === 'select') {
      input = document.createElement('select');
      field.options.forEach(optionConfig => {
        const option = document.createElement('option');
        option.value = optionConfig.value;
        option.textContent = optionConfig.label;
        input.appendChild(option);
      });
    } else {
      input = document.createElement('input');
      input.type = field.type === 'url' ? 'url' : 'text';
      if (field.type === 'int') {
        input.inputMode = 'numeric';
        input.pattern = '[0-9]*';
      }
    }

    const usesPlaceholderLabel = input.tagName !== 'SELECT';
    const label = element('label', usesPlaceholderLabel || field.hideLabel ? 'visually-hidden' : '');
    label.htmlFor = controlId;
    label.appendChild(element('span', '', field.name));
    wrapper.appendChild(label);

    const isChecksumField = /checksum/i.test(field.yml_field);
    input.id = controlId;
    input.value = Array.isArray(value) ? (value[0] || '') : value;
    if (isChecksumField && input.value) input.value = String(input.value).toUpperCase();
    input.setAttribute('aria-label', field.name);
    input.disabled = Boolean(field.disabled) || Boolean(field.disabledUnless && values[field.disabledUnless] !== true);
    if (usesPlaceholderLabel) {
      const hint = field.placeholder || (field.type === 'array' ? 'comma-separated' : '');
      input.placeholder = hint ? `${field.name} — ${hint}` : field.name;
      wrapper.classList.add('field-placeholder-only');
    }
    if (field.maxlength) input.maxLength = field.maxlength;

    const eventName = input.tagName === 'SELECT' ? 'change' : 'input';
    input.addEventListener(eventName, () => {
      let nextValue = input.value;
      if (field.type === 'int') {
        nextValue = nextValue.replace(/\D+/g, '').slice(0, field.maxlength || 3);
        input.value = nextValue;
      }
      if (isChecksumField) {
        const upper = nextValue.toUpperCase();
        if (upper !== nextValue) {
          const selectionStart = input.selectionStart;
          const selectionEnd = input.selectionEnd;
          input.value = upper;
          try { input.setSelectionRange(selectionStart, selectionEnd); } catch (_) { /* selects unsupported */ }
        }
        nextValue = upper;
        // Only the primary (index 0) is edited here — additional checksums
        // added via the checksum-additional modal must survive this edit.
        nextValue = replacePrimaryChecksum(values[field.yml_field], nextValue);
      }
      onChange(field.yml_field, nextValue, field);
    });

    if (field.directoryPicker) {
      const directories = Array.isArray(values.__pupArchiveDirectories) ? values.__pupArchiveDirectories : [];
      const picker = document.createElement('select');
      picker.id = `${controlId}-directory-select`;
      picker.className = 'archive-directory-select';
      picker.setAttribute('aria-label', 'Choose PUP Pack archive root from loaded directories');
      populateDirectoryPicker(picker, directories);
      picker.addEventListener('change', () => {
        if (!picker.value) return;
        input.value = picker.value;
        onChange(field.yml_field, picker.value, field);
      });
      wrapper.append(input, picker);
      return wrapper;
    }

    const allowed = getChecksumExtensions(field, values);
    if (allowed.length) {
      wrapper.classList.add('checksum-drop-field');
      const statusRow = element('span', 'checksum-drop-status');
      const loadingTrack = element('span', 'checksum-loading-track');
      loadingTrack.setAttribute('aria-hidden', 'true');
      loadingTrack.appendChild(element('span', 'checksum-loading-dot'));
      const hintExtensions = field.colorRomArchiveScan ? [...allowed, ...ARCHIVE_EXTENSIONS] : allowed;
      const dropHint = element('span', 'checksum-drop-hint', `Drop ${hintExtensions.join(' / ')} file to calculate MD5${field.archiveBrowser ? ' and browse folders' : ''}`);
      statusRow.append(loadingTrack, dropHint);
      const setDropState = active => wrapper.classList.toggle('checksum-drop-active', active);
      const setLoading = active => {
        wrapper.classList.toggle('checksum-is-loading', active);
        wrapper.setAttribute('aria-busy', active ? 'true' : 'false');
      };
      wrapper.addEventListener('dragenter', event => {
        if (input.disabled) return;
        event.preventDefault();
        setDropState(true);
      });
      wrapper.addEventListener('dragover', event => {
        if (input.disabled) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setDropState(true);
      });
      wrapper.addEventListener('dragleave', event => {
        if (!wrapper.contains(event.relatedTarget)) setDropState(false);
      });
      wrapper.addEventListener('drop', async event => {
        if (input.disabled) return;
        event.preventDefault();
        setDropState(false);
        const file = event.dataTransfer.files?.[0];
        if (!file) return;
        const extension = getFileExtension(file.name);
        const currentAllowed = getChecksumExtensions(field, values);
        const isColorArchiveDrop = Boolean(field.colorRomArchiveScan) && ARCHIVE_EXTENSIONS.includes(extension);
        if (!currentAllowed.includes(extension) && !isColorArchiveDrop) {
          const accepted = field.colorRomArchiveScan ? [...currentAllowed, ...ARCHIVE_EXTENSIONS] : currentAllowed;
          dropHint.textContent = `Invalid file type. Allowed: ${accepted.join(', ')}`;
          dropHint.classList.add('error');
          return;
        }
        dropHint.classList.remove('error');
        dropHint.textContent = `Processing ${file.name}…`;
        setLoading(true);

        if (isColorArchiveDrop) {
          try {
            const results = await extractColorRomArchiveChecksums(file);
            const pal = results.find(result => result.extension === '.pal');
            const vni = results.find(result => result.extension === '.vni');
            const palVniMode = Boolean(vni);
            if (palVniMode !== (values.coloredROMPin2DMD === true)) {
              // The mode-change handler resets both inputs and hints to match
              // surviving state (a kept .pal checksum stays put).
              onChange('coloredROMPin2DMD', palVniMode, { yml_field: 'coloredROMPin2DMD', type: 'bool' });
              const flag = document.getElementById('field-coloredROMPin2DMD');
              if (flag) flag.checked = palVniMode;
            }
            const primaryResult = pal || (palVniMode ? null : results[0]);
            const sources = { ...(values.__checksumSources || {}) };
            if (primaryResult) {
              input.value = primaryResult.checksum;
              onChange(field.yml_field, replacePrimaryChecksum(values[field.yml_field], primaryResult.checksum), field);
              sources[field.yml_field] = { name: primaryResult.name, extension: primaryResult.extension };
              dropHint.textContent = `MD5 calculated (${primaryResult.name}) from ${file.name}`;
            } else {
              // Lone .vni drop: restore the primary field's own state-driven
              // subtext instead of leaving "Processing…" behind.
              syncConditionalFields(values);
            }
            if (vni) {
              const secondaryInput = document.getElementById('field-coloredROMChecksumSecondary');
              if (secondaryInput) {
                secondaryInput.value = vni.checksum;
                secondaryInput.disabled = false;
              }
              onChange('coloredROMChecksumSecondary', vni.checksum, { yml_field: 'coloredROMChecksumSecondary', type: 'str' });
              sources.coloredROMChecksumSecondary = { name: vni.name, extension: '.vni' };
              const secondaryHint = document.querySelector('.field-color-secondary .checksum-drop-hint');
              if (secondaryHint) {
                secondaryHint.classList.remove('error');
                secondaryHint.textContent = `MD5 calculated (${vni.name}) from ${file.name}`;
              }
            }
            onChange('__checksumSources', sources, { uiOnly: true });
          } catch (error) {
            dropHint.classList.add('error');
            dropHint.textContent = error?.message || 'Archive scan failed.';
            console.warn('Color ROM archive scan failed:', error);
          }
          setLoading(false);
          return;
        }

        if (field.archiveFormatField && ARCHIVE_EXTENSIONS.includes(extension)) {
          const format = extension.slice(1);
          onChange(field.archiveFormatField, format, { yml_field: field.archiveFormatField, type: 'select' });
          const formatSelect = document.getElementById(`field-${field.archiveFormatField}`);
          if (formatSelect) formatSelect.value = format;
        }

        const isArchiveScanDrop = Boolean(field.archiveScanExtension) && ARCHIVE_EXTENSIONS.includes(extension);
        const checksumTask = isArchiveScanDrop
          ? extractArchiveEntryChecksum(file, field.archiveScanExtension)
          : calculateMd5FromBlob(file).then(checksum => ({ checksum }));
        const archiveTask = field.archiveBrowser
          ? readArchiveDirectories(file)
          : Promise.resolve(null);
        const [checksumResult, archiveResult] = await Promise.allSettled([checksumTask, archiveTask]);

        const messages = [];
        if (checksumResult.status === 'fulfilled' && checksumResult.value?.checksum) {
          input.value = checksumResult.value.checksum;
          onChange(field.yml_field, replacePrimaryChecksum(values[field.yml_field], checksumResult.value.checksum), field);
          const sources = { ...(values.__checksumSources || {}) };
          sources[field.yml_field] = { name: file.name, extension };
          onChange('__checksumSources', sources, { uiOnly: true });
          messages.push(checksumResult.value.entryName
            ? `MD5 calculated (${checksumResult.value.entryName})`
            : 'MD5 calculated');
        } else {
          const reason = checksumResult.reason?.message || 'MD5 failed';
          messages.push(reason);
          dropHint.classList.add('error');
          console.warn('MD5 failed:', checksumResult.reason);
        }

        if (field.archiveBrowser) {
          if (archiveResult.status === 'fulfilled') {
            const directories = archiveResult.value || [];
            onChange('__pupArchiveDirectories', directories, { uiOnly: true });
            populateDirectoryPicker(document.getElementById('field-pupArchiveRoot-directory-select'), directories);
            messages.push(directories.length
              ? `${directories.length} director${directories.length === 1 ? 'y' : 'ies'} loaded`
              : 'no directories found');
          } else {
            const reason = archiveResult.reason?.message || 'directory browse failed';
            messages.push(reason);
            dropHint.classList.add('error');
            console.warn('Archive browse failed:', archiveResult.reason);
          }
        }

        dropHint.textContent = `${messages.join(' · ')} from ${file.name}`;
        setLoading(false);
      });
      wrapper.append(input, statusRow);
      return wrapper;
    }

    wrapper.appendChild(input);
    return wrapper;
  }

  // Runs when PAL/VNI is toggled: it hard-resets the Color ROM checksum pair
  // to match state — surviving values (a kept .pal checksum) stay visible with
  // their calculated-from subtext, everything else returns to instructions.
  function syncConditionalFields(values) {
    const pin2dmd = values?.coloredROMPin2DMD === true;
    const sources = values?.__checksumSources || {};
    const primary = document.getElementById('field-coloredROMChecksum');
    const secondary = document.getElementById('field-coloredROMChecksumSecondary');
    if (primary) primary.value = values?.coloredROMChecksum ? String(values.coloredROMChecksum).toUpperCase() : '';
    if (secondary) {
      secondary.disabled = !pin2dmd;
      secondary.value = values?.coloredROMChecksumSecondary ? String(values.coloredROMChecksumSecondary).toUpperCase() : '';
    }

    const primaryHint = document.querySelector('.field-color-checksum .checksum-drop-hint');
    if (primaryHint) {
      primaryHint.classList.remove('error');
      if (values?.coloredROMChecksum && sources.coloredROMChecksum?.name) {
        primaryHint.textContent = `MD5 calculated from ${sources.coloredROMChecksum.name}`;
      } else {
        const allowed = pin2dmd ? ['.pal', '.vni'] : ['.crz', '.pal', '.pac', '.cromc'];
        primaryHint.textContent = `Drop ${[...allowed, ...ARCHIVE_EXTENSIONS].join(' / ')} file to calculate MD5`;
      }
    }

    const secondaryHint = document.querySelector('.field-color-secondary .checksum-drop-hint');
    if (secondaryHint) {
      secondaryHint.classList.remove('error');
      if (pin2dmd && values?.coloredROMChecksumSecondary && sources.coloredROMChecksumSecondary?.name) {
        secondaryHint.textContent = `MD5 calculated from ${sources.coloredROMChecksumSecondary.name}`;
      } else {
        secondaryHint.textContent = pin2dmd
          ? 'Drop .vni file to calculate MD5'
          : 'Enable PAL/VNI to use a second checksum';
      }
    }
  }

  function appendFields(target, fields, values, onChange, stepId) {
    fields.forEach(field => target.appendChild(createFieldControl(field, values, onChange, stepId)));
  }

  function renderAccordions(container, steps, values, callbacks) {
    container.innerHTML = '';
    container.className = 'configuration-tabs';

    const enabledSteps = steps.filter(step => callbacks.isEnabled(step));
    let activeId = callbacks.getActiveStep();
    if (!enabledSteps.some(step => step.id === activeId)) activeId = enabledSteps[0]?.id || 'main';

    const tabList = element('div', 'config-tab-list');
    tabList.setAttribute('role', 'tablist');
    tabList.setAttribute('aria-label', 'Configuration sections');

    steps.forEach(step => {
      const enabled = callbacks.isEnabled(step);
      const active = enabled && step.id === activeId;
      const status = callbacks.getStatus(step);
      const tab = element('button', `config-tab${active ? ' active' : ''}`, step.label);
      tab.type = 'button';
      tab.id = `config-tab-${step.id}`;
      tab.dataset.step = step.id;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.setAttribute('aria-controls', `config-panel-${step.id}`);
      tab.disabled = !enabled;
      if (status.className === 'error' || status.className === 'warning') {
        tab.classList.add(`has-${status.className}`);
        tab.title = status.label;
        const marker = element('span', 'config-tab-alert');
        marker.setAttribute('aria-hidden', 'true');
        tab.appendChild(marker);
        tab.setAttribute('aria-label', `${step.label}: ${status.label}`);
      } else if (status.className === 'ready') {
        tab.classList.add('has-ready');
      }
      tab.addEventListener('click', () => callbacks.onActivate(step.id));
      tabList.appendChild(tab);
    });
    container.appendChild(tabList);

    const step = steps.find(candidate => candidate.id === activeId) || enabledSteps[0];
    if (!step) return;

    const panel = element('section', 'config-tab-panel');
    panel.id = `config-panel-${step.id}`;
    panel.dataset.step = step.id;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `config-tab-${step.id}`);

    const commonFields = step.fields.filter(field => !field.advanced);
    const advancedFields = step.fields.filter(field => field.advanced);
    const grid = element('div', `field-grid field-grid-${step.id}`);
    appendFields(grid, commonFields, values, callbacks.onChange, step.id);
    panel.appendChild(grid);

    if (advancedFields.length) {
      const advanced = element('details', 'advanced-fields compact-advanced');
      advanced.open = true;
      const advancedSummary = document.createElement('summary');
      advancedSummary.append(
        element('span', 'advanced-chevron', '›'),
        element('span', 'advanced-label', 'Advanced Config')
      );
      advanced.appendChild(advancedSummary);
      const advancedGrid = element('div', `field-grid advanced-grid advanced-grid-${step.id}`);
      appendFields(advancedGrid, advancedFields, values, callbacks.onChange, step.id);
      advanced.appendChild(advancedGrid);
      panel.appendChild(advanced);
    }

    const actions = element('div', 'section-actions');
    const clear = element('button', 'clear-section-btn', 'Clear section');
    clear.type = 'button';
    clear.addEventListener('click', () => callbacks.onClear(step));
    actions.appendChild(clear);
    panel.appendChild(actions);
    container.appendChild(panel);
  }

  window.VPS_UI = {
    element,
    renderSuggestions,
    renderTableStrip,
    renderAssetMatrix,
    renderAccordions,
    syncConditionalFields
  };
})();
