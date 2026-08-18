(() => {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Wraps CSS.escape with a manual fallback (same approach the CSSOM spec's
  // own polyfill uses) for browsers that don't implement it, so selector
  // lookups by ID/name degrade instead of throwing a ReferenceError.
  function cssEscape(value) {
    const input = String(value ?? '');
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(input);
    }
    return input.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
  }

  function humanize(key) {
    return String(key ?? '')
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^./, char => char.toUpperCase())
      .trim();
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  function itemUrlEntries(item) {
    const urls = item?.urls;
    if (Array.isArray(urls)) return urls;
    if (urls && typeof urls === 'object') return Object.values(urls);
    return [];
  }

  function isUrlEntryBroken(entry) {
    return Boolean(entry) && (entry.broken === true || entry.broken === 'true');
  }

  // An item counts as broken only when every one of its links is broken (or
  // it has no usable link at all) — a single broken mirror no longer
  // disqualifies an item that still has a working alternate link.
  function isItemBroken(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.broken === true || item.broken === 'true') return true;

    const entries = itemUrlEntries(item);
    if (!entries.length) return false;
    return !entries.some(entry => entry && typeof entry.url === 'string' && entry.url.trim() && !isUrlEntryBroken(entry));
  }

  function getItemUrl(item) {
    if (!item || typeof item !== 'object') return '';
    const list = itemUrlEntries(item);
    const usable = list.find(entry => entry && typeof entry.url === 'string' && entry.url.trim() && !isUrlEntryBroken(entry));
    return (usable || list.find(entry => entry && typeof entry.url === 'string' && entry.url.trim()))?.url?.trim() || '';
  }

  const EXCLUDED_VPX_FORMATS = new Set(['FP', 'FX', 'FX2', 'FX3']);

  function normalizeList(value) {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null || value === '') return [];
    return [value];
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
    const overridden = Boolean(config.overrideField && values?.[config.overrideField] === true);

    if (selectedId && (bundled || overridden)) {
      return { key: 'orange', label: 'Conflict', active: true, safe: false, items };
    }
    if (selectedId || bundled || overridden) {
      return {
        key: 'green',
        label: selectedId ? 'Selected' : bundled ? 'Bundled' : 'Override',
        active: true,
        safe: true,
        items
      };
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

  function normalizeArray(value) {
    if (Array.isArray(value)) {
      return value.map(item => String(item).trim()).filter(Boolean);
    }
    if (typeof value !== 'string') return [];
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }

  function wrapText(text, maxLength = 120) {
    const sourceLines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const output = [];

    sourceLines.forEach(sourceLine => {
      const words = sourceLine.trim().split(/\s+/).filter(Boolean);
      if (!words.length) {
        output.push('');
        return;
      }

      let line = '';
      words.forEach(word => {
        const candidate = line ? `${line} ${word}` : word;
        if (candidate.length > maxLength && line) {
          output.push(line);
          line = word;
        } else {
          line = candidate;
        }
      });
      if (line) output.push(line);
    });

    return output;
  }

  function cleanYamlString(value) {
    return String(value).replace(/"/g, "'").trim();
  }

  function isMd5Hash(value) {
    return typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value.trim());
  }

  function normalizeChecksumValue(value) {
    if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
    if (value === undefined || value === null || value === '') return [];
    return [String(value).trim()].filter(Boolean);
  }

  // Checksum fields can hold a plain string (one checksum) or an array (the
  // primary plus "additional" ones added via the checksum-additional modal —
  // see js.src/checksumAdditionalController.js). Anything that edits the
  // primary value directly (typing, or a file-drop MD5 calculation) must
  // replace only index 0 and keep the rest, or those additional entries are
  // silently dropped.
  function replacePrimaryChecksum(current, next) {
    const value = String(next || '').trim();
    if (!Array.isArray(current) || current.length < 2) return value;
    const rest = current.slice(1).map(item => String(item || '').trim()).filter(Boolean);
    const combined = value ? [value, ...rest] : rest;
    return combined.length > 1 ? combined : (combined[0] || '');
  }

  function buildYaml(values, options = {}) {
    const data = { ...values };
    const omit = options.omit instanceof Set ? options.omit : new Set(options.omit || []);

    // `enabled` is only written to YAML when the user explicitly opts in to
    // "Disable for Wizard" (enabled === false). Any other state (undefined /
    // true) is treated as "not disabled" and is omitted from the output.

    // Deprecated applyFix values must never leak into newly generated YAML.
    delete data.bass;
    delete data.applyFixes;

    // PAL/VNI mode produces the two-checksum list expected by the upstream schema.
    // In Serum/CRZ mode, coloredROMPin2DMD is omitted entirely.
    const primaryColorChecksum = Array.isArray(data.coloredROMChecksum)
      ? data.coloredROMChecksum[0]
      : data.coloredROMChecksum;
    const secondaryColorChecksum = data.coloredROMChecksumSecondary
      ?? (Array.isArray(data.coloredROMChecksum) ? data.coloredROMChecksum[1] : '');
    if (data.coloredROMPin2DMD === true) {
      const checksums = [primaryColorChecksum, secondaryColorChecksum]
        .map(value => String(value || '').trim())
        .filter(Boolean);
      if (checksums.length) data.coloredROMChecksum = checksums;
      else delete data.coloredROMChecksum;
    } else {
      delete data.coloredROMPin2DMD;
      if (primaryColorChecksum) data.coloredROMChecksum = String(primaryColorChecksum).trim();
      else delete data.coloredROMChecksum;
    }
    delete data.coloredROMChecksumSecondary;

    ['testers', 'backglassAuthorsOverride'].forEach(key => {
      const normalized = normalizeArray(data[key]);
      if (normalized.length) data[key] = normalized;
      else delete data[key];
    });

    ['fps', 'tableYearOverride'].forEach(key => {
      if (data[key] === '' || data[key] === undefined || data[key] === null) {
        delete data[key];
        return;
      }
      const parsed = Number.parseInt(data[key], 10);
      if (Number.isFinite(parsed)) data[key] = parsed;
      else delete data[key];
    });

    const entries = Object.entries(data)
      .filter(([key, value]) => {
        if (omit.has(key) || key.startsWith('__') || key.endsWith('_check')) return false;
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'string') return value.trim() !== '';
        if (typeof value === 'number') return Number.isFinite(value);
        if (typeof value === 'boolean') return key === 'enabled' ? value === false : value === true;
        return false;
      })
      .sort(([left], [right]) => left.localeCompare(right));

    let yaml = '---\n';

    entries.forEach(([name, value]) => {
      if (Array.isArray(value)) {
        yaml += `${name}:\n`;
        value.forEach(item => {
          yaml += `  - "${cleanYamlString(item)}"\n`;
        });
        return;
      }

      if (typeof value === 'number' || typeof value === 'boolean') {
        yaml += `${name}: ${value}\n`;
        return;
      }

      const cleanValue = cleanYamlString(value);
      const isUrlField = name.endsWith('UrlOverride') || name.endsWith('FileUrl');

      if (isUrlField) {
        if (cleanValue.length > 120) {
          yaml += '# yamllint disable-line rule:line-length\n';
        }
        yaml += `${name}: "${cleanValue.replace(/\n+/g, ' ')}"\n`;
        return;
      }

      if (cleanValue.includes('\n') || cleanValue.length > 120) {
        yaml += `${name}: >-\n`;
        wrapText(cleanValue, 120).forEach(line => {
          yaml += line ? `  ${line}\n` : '  \n';
        });
        return;
      }

      yaml += `${name}: "${cleanValue}"\n`;
    });

    return yaml;
  }

  function highlightYaml(yaml) {
    return String(yaml)
      .split('\n')
      .map(line => {
        if (line.startsWith('#') || line === '---') {
          return `<span class="yml-comment">${escapeHtml(line)}</span>`;
        }

        const listMatch = line.match(/^(\s*-\s+)(.*)$/);
        if (listMatch) {
          return `${escapeHtml(listMatch[1])}<span class="yml-value">${escapeHtml(listMatch[2])}</span>`;
        }

        const keyMatch = line.match(/^(\s*)([^:#][^:]*):(.*)$/);
        if (!keyMatch) return escapeHtml(line);

        return `${escapeHtml(keyMatch[1])}<span class="yml-key">${escapeHtml(keyMatch[2])}</span>:<span class="yml-value">${escapeHtml(keyMatch[3])}</span>`;
      })
      .join('\n');
  }

  function safeFilename(value, fallback = 'output') {
    const cleaned = String(value || fallback)
      .trim()
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '');
    return cleaned || fallback;
  }

  function downloadText(text, filename, mimeType = 'text/yaml') {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 100);
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Clipboard access is unavailable.');
  }

  function formatDateDMY(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${day}.${month}.${date.getUTCFullYear()}`;
  }

  function getItemLabel(item) {
    if (!item) return '';
    const id = item.id || 'Unknown ID';
    const version = item.version ? String(item.version).replace(/^v/i, '') : '—';
    return `${id} · ${version} · ${formatDateDMY(item.createdAt)}`;
  }

  function extractArchiveDirectories(entries) {
    const directories = [];
    (Array.isArray(entries) ? entries : []).forEach(entry => {
      const path = String(entry?.path || '')
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '');
      if (!path) return;
      const segments = path.split('/').filter(Boolean);
      for (let index = 1; index <= segments.length; index += 1) {
        directories.push(segments.slice(0, index).join('/'));
      }
    });
    return [...new Set(directories)]
      .filter(Boolean)
      .sort((left, right) => {
        const depthDifference = left.split('/').length - right.split('/').length;
        return depthDifference || left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
      });
  }

  // -----------------------------------------------------------------------
  // Streaming RAR5 entry lister.
  //
  // Walks the archive header-by-header using `blob.slice()` reads so it never
  // has to load the whole file into memory. This is the only way to browse
  // archives larger than ~2 GB in-browser (Chrome's Blob.arrayBuffer limit).
  // Returns an array of `{ path }` entries compatible with
  // `extractArchiveDirectories`, or `null` if the blob isn't a RAR5 archive.
  // -----------------------------------------------------------------------

  function readRarVint(bytes, offset) {
    let value = 0n;
    let shift = 0n;
    let pos = offset;
    while (pos < bytes.length) {
      const b = bytes[pos];
      pos += 1;
      value |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return { value, next: pos };
      shift += 7n;
      if (shift > 63n) throw new Error('vint overflow');
    }
    throw new Error('vint truncated');
  }

  async function readSlice(blob, offset, length) {
    const buf = await blob.slice(offset, offset + length).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function listRar5EntryPaths(blob) {
    if (!blob || typeof blob.slice !== 'function' || typeof blob.arrayBuffer !== 'function') return null;
    const total = blob.size;
    if (total < 8) return null;

    const sig = await readSlice(blob, 0, 8);
    // RAR5 signature: 52 61 72 21 1A 07 01 00
    const isRar5 = sig[0] === 0x52 && sig[1] === 0x61 && sig[2] === 0x72 && sig[3] === 0x21
                && sig[4] === 0x1A && sig[5] === 0x07 && sig[6] === 0x01 && sig[7] === 0x00;
    if (!isRar5) return null;

    const decoder = new TextDecoder('utf-8', { fatal: false });
    const entries = [];
    let offset = 8;
    let iterations = 0;
    const MAX_ITERATIONS = 200000; // safety cap
    const MAX_HEADER_BYTES = 1024 * 1024; // any single header block

    while (offset < total && iterations < MAX_ITERATIONS) {
      iterations += 1;

      // Start with a small window, then grow if the header body doesn't fit.
      let windowSize = 512;
      let bytes = await readSlice(blob, offset, Math.min(windowSize, total - offset));
      if (bytes.length < 5) break;

      let headerSize;
      let headerBodyStart;
      let attempts = 0;
      while (true) {
        try {
          const info = readRarVint(bytes, 4); // skip 4-byte CRC
          headerSize = Number(info.value);
          headerBodyStart = info.next;
          break;
        } catch (_) {
          attempts += 1;
          if (attempts > 3) return entries; // give up gracefully
          windowSize *= 4;
          if (windowSize > MAX_HEADER_BYTES) return entries;
          bytes = await readSlice(blob, offset, Math.min(windowSize, total - offset));
          if (bytes.length < 5) return entries;
        }
      }

      const headerEnd = headerBodyStart + headerSize;
      if (headerSize < 0 || headerEnd > MAX_HEADER_BYTES) return entries;

      if (headerEnd > bytes.length) {
        const need = Math.min(headerEnd, total - offset);
        bytes = await readSlice(blob, offset, need);
        if (bytes.length < headerEnd) return entries;
      }

      let pos = headerBodyStart;
      let headerType;
      let headerFlags;
      let dataSize = 0;
      try {
        const typeInfo = readRarVint(bytes, pos); pos = typeInfo.next;
        const flagsInfo = readRarVint(bytes, pos); pos = flagsInfo.next;
        headerType = Number(typeInfo.value);
        headerFlags = Number(flagsInfo.value);
        if (headerFlags & 0x01) { // HF_EXTRA
          const extraInfo = readRarVint(bytes, pos); pos = extraInfo.next;
        }
        if (headerFlags & 0x02) { // HF_DATA
          const dataInfo = readRarVint(bytes, pos); pos = dataInfo.next;
          const raw = dataInfo.value;
          // Cap at Number.MAX_SAFE_INTEGER; for realistic archives this is fine.
          dataSize = raw > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(raw);
        }
      } catch (_) {
        return entries;
      }

      // Type 2 = file header, has a filename we care about.
      if (headerType === 2) {
        try {
          const fileFlagsInfo = readRarVint(bytes, pos); pos = fileFlagsInfo.next;
          const fileFlags = Number(fileFlagsInfo.value);
          const unpackedInfo = readRarVint(bytes, pos); pos = unpackedInfo.next; // unpacked size
          const attrInfo = readRarVint(bytes, pos); pos = attrInfo.next;         // attributes
          if (fileFlags & 0x02) pos += 4; // mtime
          if (fileFlags & 0x04) pos += 4; // data CRC32
          const compInfo = readRarVint(bytes, pos); pos = compInfo.next;         // compression info
          const hostOsInfo = readRarVint(bytes, pos); pos = hostOsInfo.next;     // host OS
          const nameLenInfo = readRarVint(bytes, pos); pos = nameLenInfo.next;
          const nameLen = Number(nameLenInfo.value);
          if (nameLen > 0 && pos + nameLen <= bytes.length) {
            const name = decoder.decode(bytes.subarray(pos, pos + nameLen));
            if (name) entries.push({ path: name });
          }
        } catch (_) { /* skip malformed entry */ }
      }

      if (headerType === 5) break; // End of archive marker

      offset += headerEnd + dataSize;
    }

    return entries;
  }

  async function listArchiveEntryPaths(blob) {
    // Try format-specific streaming parsers first (works for archives of any size).
    // Returns null if the format isn't one we can stream — caller should fall back.
    try {
      const rar5 = await listRar5EntryPaths(blob);
      if (rar5) return rar5;
    } catch (_) { /* fall through to null */ }
    return null;
  }

  window.VPS_UTILS = {
    escapeHtml,
    humanize,
    formatDate,
    isItemBroken,
    getItemUrl,
    isExcludedVpxFormat,
    isVpuPatchItem,
    getParentId,
    getCategoryItems,
    sortByUpdatedDesc,
    getAssetState,
    getCoverUrl,
    normalizeArray,
    wrapText,
    buildYaml,
    highlightYaml,
    safeFilename,
    downloadText,
    copyText,
    getItemLabel,
    formatDateDMY,
    isMd5Hash,
    normalizeChecksumValue,
    replacePrimaryChecksum,
    extractArchiveDirectories,
    listArchiveEntryPaths,
    cssEscape
  };
})();
