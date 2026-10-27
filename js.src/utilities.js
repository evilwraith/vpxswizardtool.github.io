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

  // The VPS website's own listing page for a table. Lives here rather than at
  // the call site so the one external URL the app links to is written once.
  const VPS_LISTING_BASE = 'https://virtualpinballspreadsheet.github.io/games';

  function getVpsListingUrl(id) {
    const value = String(id ?? '').trim();
    return value ? `${VPS_LISTING_BASE}?game=${encodeURIComponent(value)}` : '';
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

    if (category === 'specialDMD') {
      // A DMD has no VPS entry of its own — it is declared as a feature on the
      // VPX file. These pseudo-items exist ONLY to drive the asset row's status
      // light: Available when the table declares a DMD, Unavailable when it
      // does not. They deliberately do NOT feed the row's dropdown, which always
      // offers every config.dmdTypes entry, because VPS feature tags are not
      // reliably labelled and a wrong tag must not block the user.
      const types = Array.isArray(config.dmdTypes) ? config.dmdTypes : [];
      const selectedVpxId = String(context?.selections?.tableFiles ?? context?.selectedVpxId ?? '').trim();
      // A DMD belongs to one specific VPX, so with no VPX chosen there is
      // nothing to declare it. Falling back to "scan every table file" here lit
      // the row up as Available on a fresh search, before any VPX was picked.
      if (!selectedVpxId) return [];
      const tableFiles = Array.isArray(record.tableFiles) ? record.tableFiles : [];
      const source = tableFiles.filter(item => String(item?.id ?? '').trim() === selectedVpxId);
      const declared = new Set();
      source.forEach(item => {
        normalizeList(item?.features ?? item?.Features).forEach(feature => {
          const label = String(feature).trim().toLowerCase();
          const match = types.find(type => type.toLowerCase() === label);
          if (match) declared.add(match);
        });
      });
      return types.filter(type => declared.has(type)).map(type => ({ id: type, name: type }));
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
  // silently dropped. Clearing the primary leaves index 0 blank rather than
  // promoting an additional entry into it; on the VPX tab that entry can be an
  // archive MD5 (Jason, 2026-10-13).
  function replacePrimaryChecksum(current, next) {
    const value = String(next || '').trim();
    if (!Array.isArray(current)) return value;
    const rest = current.slice(1).map(item => String(item || '').trim()).filter(Boolean);
    return rest.length ? [value, ...rest] : value;
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
    // The UPDATED date, not the created one: what matters when choosing between
    // versions is when the file last changed. Resolved through
    // itemUpdatedTimestamp rather than reading item.updatedAt directly, because
    // VPS records are inconsistent about which key carries it - that helper
    // already walks updatedAt / modifiedAt / lastUpdated / updated and falls
    // back to createdAt, so a record without an update stamp still shows a date
    // instead of an em-dash.
    return `${id} · ${version} · ${formatDateDMY(itemUpdatedTimestamp(item))}`;
  }

  function extractArchiveDirectories(entries) {
    const directories = [];
    (Array.isArray(entries) ? entries : []).forEach(entry => {
      let path = String(entry?.path || '')
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '');
      if (!path) return;
      // The streaming listers report one entry per archive member, so `path`
      // ends in that member's own name. A file contributes only its parent
      // folders — `PUPVideos/Matrix/intro.mp4` is not a choosable archive root.
      // libarchive's entries already carry a directory-only prefix and leave
      // `isFile` undefined, so they fall through untouched.
      if (entry?.isFile === true) {
        const cut = path.lastIndexOf('/');
        if (cut === -1) return;
        path = path.slice(0, cut);
        if (!path) return;
      }
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
            // FHFL_DIRECTORY (0x01) marks a directory entry; everything else
            // is a file, whose own name must not become a directory.
            if (name) entries.push({ path: name, isFile: (fileFlags & 0x01) === 0 });
          }
        } catch (_) { /* skip malformed entry */ }
      }

      if (headerType === 5) break; // End of archive marker

      offset += headerEnd + dataSize;
    }

    return entries;
  }

  // -----------------------------------------------------------------------
  // Streaming ZIP entry lister.
  //
  // A ZIP keeps its table of contents — the "central directory" — at the END
  // of the file, and every record in it carries that entry's full path. So
  // listing an archive means reading a few kilobytes from the tail instead of
  // the whole file, which is the only way to browse archives past Chrome's
  // ~2 GB Blob.arrayBuffer ceiling. Handles ZIP64 (over 4 GB, or over 65535
  // entries). Returns `{ path, isFile }` entries compatible with
  // `extractArchiveDirectories`, or `null` if the blob isn't a ZIP.
  // -----------------------------------------------------------------------

  const ZIP_LOCAL_SIG = 0x04034b50;     // PK\x03\x04 — first local file header
  const ZIP_CENTRAL_SIG = 0x02014b50;   // PK\x01\x02 — central directory record
  const ZIP_EOCD_SIG = 0x06054b50;      // PK\x05\x06 — end of central directory
  const ZIP64_EOCD_SIG = 0x06064b50;    // PK\x06\x06 — ZIP64 end of central directory
  const ZIP64_LOCATOR_SIG = 0x07064b50; // PK\x06\x07 — ZIP64 EOCD locator

  const ZIP_EOCD_MIN = 22;              // an EOCD with no trailing comment
  const ZIP_MAX_COMMENT = 0xffff;       // comment length is a 16-bit field
  const ZIP_MAX_CD_BYTES = 64 * 1024 * 1024; // sanity cap (~half a million entries)
  const ZIP_MAX_ENTRIES = 500000;       // safety cap on the walk

  async function listZipEntryPaths(blob) {
    if (!blob || typeof blob.slice !== 'function' || typeof blob.arrayBuffer !== 'function') return null;
    const total = blob.size;
    if (total < ZIP_EOCD_MIN) return null;

    // A ZIP opens with a local file header, or (when empty) the EOCD itself.
    const head = await readSlice(blob, 0, 4);
    if (head.length < 4) return null;
    const headSig = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(0, true);
    if (headSig !== ZIP_LOCAL_SIG && headSig !== ZIP_EOCD_SIG) return null;

    // The EOCD is at most 22 bytes plus a 64 KB comment, so it is always in
    // the tail. Scan backwards for its signature.
    const tailLength = Math.min(total, ZIP_EOCD_MIN + ZIP_MAX_COMMENT);
    const tail = await readSlice(blob, total - tailLength, tailLength);
    const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

    let eocd = -1;
    for (let index = tail.length - ZIP_EOCD_MIN; index >= 0; index -= 1) {
      if (tailView.getUint32(index, true) === ZIP_EOCD_SIG) { eocd = index; break; }
    }
    if (eocd === -1) return null;

    let cdSize = tailView.getUint32(eocd + 12, true);
    let cdOffset = tailView.getUint32(eocd + 16, true);
    const entryCount = tailView.getUint16(eocd + 10, true);

    // ZIP64: the 32-bit fields saturate and a locator sits just before the
    // EOCD, pointing at a record that holds the real 64-bit values.
    const saturated = entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff;
    const locator = eocd - 20;
    if (saturated && locator >= 0 && tailView.getUint32(locator, true) === ZIP64_LOCATOR_SIG) {
      const zip64Offset = Number(tailView.getBigUint64(locator + 8, true));
      if (zip64Offset >= 0 && zip64Offset + 56 <= total) {
        const zip64 = await readSlice(blob, zip64Offset, 56);
        const zip64View = new DataView(zip64.buffer, zip64.byteOffset, zip64.byteLength);
        if (zip64.length >= 56 && zip64View.getUint32(0, true) === ZIP64_EOCD_SIG) {
          cdSize = Number(zip64View.getBigUint64(40, true));
          cdOffset = Number(zip64View.getBigUint64(48, true));
        }
      }
    }

    if (!(cdSize > 0) || cdOffset < 0 || cdOffset + cdSize > total) return null;
    if (cdSize > ZIP_MAX_CD_BYTES) return null;

    const cd = await readSlice(blob, cdOffset, cdSize);
    if (cd.length < cdSize) return null;
    const cdView = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
    // Names are CP437 unless flag bit 11 says UTF-8, but UTF-8 is the norm in
    // practice and a non-fatal decode degrades rather than throws.
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const entries = [];
    let pos = 0;

    while (pos + 46 <= cd.length && entries.length < ZIP_MAX_ENTRIES) {
      if (cdView.getUint32(pos, true) !== ZIP_CENTRAL_SIG) break;
      const nameLength = cdView.getUint16(pos + 28, true);
      const extraLength = cdView.getUint16(pos + 30, true);
      const commentLength = cdView.getUint16(pos + 32, true);
      const nameStart = pos + 46;
      if (nameStart + nameLength > cd.length) break;
      if (nameLength > 0) {
        const name = decoder.decode(cd.subarray(nameStart, nameStart + nameLength));
        // A trailing slash is how ZIP marks a directory entry.
        if (name) entries.push({ path: name, isFile: !name.endsWith('/') });
      }
      pos = nameStart + nameLength + extraLength + commentLength;
    }

    return entries;
  }

  async function listArchiveEntryPaths(blob) {
    // Try format-specific streaming parsers first (works for archives of any size).
    // Returns null if the format isn't one we can stream — caller should fall back.
    try {
      const rar5 = await listRar5EntryPaths(blob);
      if (rar5) return rar5;
    } catch (_) { /* fall through to the next parser */ }
    try {
      const zip = await listZipEntryPaths(blob);
      if (zip) return zip;
    } catch (_) { /* fall through to null */ }
    return null;
  }

  // vpxMagic - the "Password" field on the VPX tab - is typed and stored as
  // plain text and written to the YML base64-encoded. btoa alone cannot do
  // this: it throws on any character above U+00FF, and a password field is
  // exactly where those turn up. Encode to UTF-8 bytes first.
  function encodeVpxMagic(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  // The inverse, used on YML import so a round-trip does not double-encode.
  // A hand-written YML may carry a value that was never encoded, and atob
  // happily decodes plenty of ordinary words into garbage rather than
  // throwing, so a decode is only trusted when re-encoding it reproduces the
  // input byte for byte. Anything else is treated as already-plain text.
  // A plain password that IS valid base64 of valid UTF-8 is genuinely
  // ambiguous and decodes; nothing can distinguish those two cases.
  function decodeVpxMagic(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    try {
      const binary = atob(text);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return encodeVpxMagic(decoded) === text ? decoded : text;
    } catch (_) {
      return text;
    }
  }

  // The builder holds passwords in four places: vpxMagic (the original field),
  // vpxMagic2 and vpxMagic3 (revealed on demand in Advanced Config), and
  // vpxMagicAdditional (a list owned by the overflow dialog). The YML carries
  // ONE key. These two functions are the only place that mapping lives, for
  // the same reason encode and decode are shared: a second copy is how the two
  // halves of a round trip drift apart.
  const VPX_MAGIC_INLINE_KEYS = ['vpxMagic', 'vpxMagic2', 'vpxMagic3'];

  // State -> ordered list of plain-text passwords, blanks dropped. Dropping
  // blanks is what lets slot 2 be cleared without stranding slot 3.
  function collectVpxMagic(values) {
    const source = values || {};
    const extra = Array.isArray(source.vpxMagicAdditional) ? source.vpxMagicAdditional : [];
    return [...VPX_MAGIC_INLINE_KEYS.map(key => source[key]), ...extra]
      .map(entry => String(entry ?? '').trim())
      .filter(Boolean);
  }

  // The inverse, used on import: fill the inline slots in order, then overflow
  // the rest into the dialog's list. Mutates and returns `values`.
  function distributeVpxMagic(list, values) {
    const target = values || {};
    const clean = (Array.isArray(list) ? list : [list])
      .map(entry => String(entry ?? '').trim())
      .filter(Boolean);
    VPX_MAGIC_INLINE_KEYS.forEach((key, index) => {
      if (clean[index]) target[key] = clean[index];
      else delete target[key];
    });
    const overflow = clean.slice(VPX_MAGIC_INLINE_KEYS.length);
    if (overflow.length) target.vpxMagicAdditional = overflow;
    else delete target.vpxMagicAdditional;
    return target;
  }

  // The single decision about what the YML actually carries, kept here beside
  // the codec so a test can drive it without standing up prepareData's world.
  //
  // Returns undefined when there is nothing to write, a plain base64 string for
  // one password - byte-identical to what shipped before multi-password
  // support, so nothing already published changes - and a list for two or more.
  function buildVpxMagicOutput(values) {
    const encoded = collectVpxMagic(values).map(encodeVpxMagic).filter(Boolean);
    if (!encoded.length) return undefined;
    return encoded.length === 1 ? encoded[0] : encoded;
  }

  window.VPS_UTILS = {
    escapeHtml,
    humanize,
    formatDate,
    isItemBroken,
    getItemUrl,
    getVpsListingUrl,
    isExcludedVpxFormat,
    isVpuPatchItem,
    getParentId,
    getCategoryItems,
    sortByUpdatedDesc,
    getAssetState,
    getCoverUrl,
    normalizeArray,
    wrapText,
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
    cssEscape,
    // Shared so the serializer and the YML importer cannot drift apart.
    encodeVpxMagic,
    decodeVpxMagic,
    collectVpxMagic,
    distributeVpxMagic,
    buildVpxMagicOutput,
    VPX_MAGIC_INLINE_KEYS
  };
})();
