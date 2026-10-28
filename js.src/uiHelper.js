(() => {
  'use strict';

  const {
    formatDate,
    getCoverUrl,
    getItemLabel,
    isItemBroken,
    getItemUrl,
    getVpsListingUrl,
    getCategoryItems,
    getAssetState,
    extractArchiveDirectories,
    listArchiveEntryPaths,
    replacePrimaryChecksum,
    // The VPX Password slots double as the key ring for encrypted archives.
    collectVpxMagic
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

  // vendor/ ships at fixed, unhashed paths, so a browser that cached the
  // worker or the wasm keeps using it across deploys. A stale worker against a
  // newer wasm calls exports the binary does not have and throws *after* the
  // archive has opened and listed, which reads as a corrupt archive. The
  // vendored fork propagates this query string to libarchive.wasm internally,
  // so the two are always fetched as a matched pair.
  function archiveAssetUrl(path) {
    const url = new URL(path, document.baseURI);
    const stamp = window.VPS_APP_VERSION;
    if (stamp) url.search = `?v=${encodeURIComponent(stamp)}`;
    return url.href;
  }

  // A size failure surfaces differently depending on the browser and on which
  // limit is hit first: Chrome throws NotReadableError out of arrayBuffer(),
  // Firefox throws a TypeError out of the Blob constructor ("...larger than
  // 2 GB"). Matching only NotReadableError meant Firefox users saw the raw
  // browser text instead of the useful message, so match the symptom.
  function isArchiveTooLargeError(error) {
    if (error?.name === 'NotReadableError') return true;
    const message = String(error?.message || '');
    return /larger than 2\s*GB|exceeds the maximum|allocation size overflow|out of memory/i.test(message);
  }

  function archiveReadError(verb, remedy, file, error) {
    const sizeMb = file?.size ? (file.size / (1024 * 1024)).toFixed(1) : '?';
    const reason = isArchiveTooLargeError(error)
      ? `archive is too large to ${verb} in-browser (${sizeMb} MB) \u2014 ${remedy}`
      : (error?.message || error?.name || 'unknown read error');
    const friendly = new Error(`Could not ${verb} "${file?.name || 'archive'}": ${reason}.`);
    friendly.cause = error;
    return friendly;
  }

  function loadArchiveModule() {
    if (!archiveModulePromise) {
      const moduleUrl = archiveAssetUrl('vendor/libarchive/libarchive.js');
      const workerUrl = archiveAssetUrl('vendor/libarchive/worker-bundle.js');
      archiveModulePromise = import(moduleUrl).then(module => {
        module.Archive.init({ workerUrl });
        return module.Archive;
      });
    }
    return archiveModulePromise;
  }

  async function readArchiveDirectories(file, passwords) {
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

    // Fallback path: libarchive.js. The vendored fork mounts the file with
    // WORKERFS and reads only the blocks it needs, so the File is handed over
    // as-is. Do NOT reintroduce an arrayBuffer()/Blob round-trip here: it was
    // harmless when stock buffered the whole archive anyway, but it now
    // re-imposes the ~2 GB ceiling the fork exists to remove, and the Blob
    // constructor refuses a buffer that large before libarchive is ever
    // reached. See vendor/libarchive/VERSION.md.
    const { archive, entries } = await openArchiveUnlocked(
      file, passwords, 'browse', 'enter the directory manually');
    try {
      return extractArchiveDirectories(entries);
    } finally {
      try { await archive.close(); } catch (_) { /* worker may already be closed */ }
    }
  }

  const ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z'];

  let unrarModulePromise = null;

  function loadUnrarModule() {
    // Fallback engine for RAR only. libarchive DOES decompress RAR4 and RAR5
    // (measured 2026-08-26/27, extracted bytes compared against WinRAR), so it
    // is tried first in extractArchiveEntries. What it refuses outright is a
    // SOLID RAR4 - "RAR solid archive support unavailable" - and node-unrar-js
    // (the vendored WASM build of the official unrar lib) is the only engine
    // here that reads one. It does a whole-file read, so it is the
    // size-limited path and must stay the exception rather than the default.
    if (!unrarModulePromise) {
      const moduleUrl = archiveAssetUrl('vendor/unrar/unrar.bundle.js');
      const wasmUrl = archiveAssetUrl('vendor/unrar/unrar.wasm');
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

  async function extractRarEntries(file, selectNames, options = {}) {
    const { module, wasmBinary } = await loadUnrarModule();
    const data = await file.arrayBuffer();
    const passwords = (Array.isArray(options.passwords) ? options.passwords : [])
      .map(entry => String(entry ?? '').trim())
      .filter(Boolean);

    // unrar DOES fix the password at construction, so unlike libarchive each
    // attempt needs a fresh extractor. That is cheap here: it is rebuilt from
    // the ArrayBuffer already in memory, so the whole-file read above happens
    // once no matter how many passwords are tried. This path only runs for a
    // solid RAR4, the one archive libarchive refuses.
    let sawPasswordError = false;
    for (const password of [null, ...passwords]) {
      const extractor = await module.createExtractorFromData(
        password === null ? { wasmBinary, data } : { wasmBinary, data, password });
      try {
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
      } catch (error) {
        // A selector throw ("no .vpx inside") and a genuine corruption are both
        // real answers - only a password complaint is worth another attempt.
        if (!isPassphraseError(error)) throw error;
        sawPasswordError = true;
      }
    }
    throw archiveLockedError(file, passwords);
  }

  // ---- Encrypted archives -------------------------------------------------
  //
  // The vendored fork decrypts ZIP (AES-256 and legacy ZipCrypto) and every RAR
  // variant including solid RAR5. It cannot decrypt 7z and never will. The full
  // measured matrix is in vendor/libarchive/VERSION.md; three findings from
  // 2026-08-27 dictate the shape of the code below, and each was measured
  // rather than assumed:
  //
  //   * WHERE a wrong password is reported depends on the format.
  //     Header-encrypted RAR (-hp) answers at LISTING, straight out of the
  //     header. ZIP and data-encrypted RAR (-p) list happily under ANY
  //     password and only fail when an entry is actually read. So a successful
  //     listing is NOT proof that an archive is unlocked.
  //   * Validity is therefore settled by decrypting the SMALLEST entry rather
  //     than the one we want: 3-19 ms on ZIP, 36-177 ms on RAR, and
  //     independent of archive size. Probing does not disturb a later
  //     extraction on the same handle - that was checked explicitly.
  //   * ONE open archive accepts repeated usePassword() calls, RAR included.
  //     Never re-open per attempt. Re-opening is node-unrar-js's constraint,
  //     not libarchive's, and believing otherwise is what made trying a
  //     password list look too expensive to offer.

  function isPassphraseError(error) {
    // libarchive says "Passphrase required" / "Incorrect passphrase"; unrar
    // says "Wrong password is specified" and puts its code on `reason`.
    const text = `${String(error?.message || '')} ${String(error?.reason || '')}`;
    return /passphrase|password/i.test(text);
  }

  // libarchive's way of saying "this is encrypted and I have no cipher for
  // it". In practice that means 7z, in both its modes: "The archive header is
  // encrypted, but currently not supported" (-mhe=on, thrown at listing) and
  // "The file content is encrypted, but currently not supported" (plain AES,
  // thrown when an entry is read). Neither is a wrong password, so trying more
  // passwords is pointless - it is a hard refusal, and the user needs telling
  // that rather than being sent to check a password that was never the problem.
  function isUnsupportedEncryptionError(error) {
    return /encrypted, but currently not supported/i.test(String(error?.message || ''));
  }

  // The cheapest entries to test a password against, smallest first.
  //
  // ZERO-BYTE ENTRIES ARE EXCLUDED, and that exclusion is load-bearing. An
  // empty file has no bytes to decrypt, so it proves nothing either way - and
  // worse, libarchive fails one outright on RAR4 with "Zero window size is
  // invalid" EVEN WHEN THE PASSWORD IS CORRECT. Probing one is exactly what
  // made a real table pack report a wrong password on 2026-08-27: the pack
  // held a zero-byte placeholder, it sorted first, it failed, and every other
  // entry in the archive decrypted fine.
  //
  // Several candidates are returned rather than one because a single entry can
  // fail for reasons that have nothing to do with the password, and one such
  // entry must never be able to condemn the whole archive.
  function probeCandidates(entries, limit = 3) {
    return (entries || [])
      .filter(entry => entry?.file
        && typeof entry.file.extract === 'function'
        && typeof entry.file.size === 'number'
        && entry.file.size > 0)
      .sort((a, b) => a.file.size - b.file.size)
      .slice(0, limit);
  }

  // Kept as the single-candidate view of the same rule.
  function smallestExtractableEntry(entries) {
    return probeCandidates(entries, 1)[0] || null;
  }

  // Does the archive actually decrypt under whatever password is set now?
  // Returns 'ok', 'locked' (wrong or missing password - try another), or
  // 'unsupported' (no cipher exists; stop immediately).
  async function probeArchive(entries) {
    const candidates = probeCandidates(entries);
    // Nothing worth probing (an archive of only empty files, say). Say 'ok'
    // and let the real extraction report the truth rather than inventing a
    // password problem out of an archive we never actually tested.
    if (!candidates.length) return 'ok';
    for (const candidate of candidates) {
      try {
        await candidate.file.extract();
        return 'ok';
      } catch (error) {
        // No cipher exists for this format; more attempts cannot help.
        if (isUnsupportedEncryptionError(error)) return 'unsupported';
      }
    }
    return 'locked';
  }

  // Never carries the engine's own text. A wrong password on a -p archive fails
  // with decompression garbage - "Unsupported block header size", "Invalid
  // location to Huffman tree specified" - which means nothing to anyone and
  // reads like a corrupt file.
  function archiveLockedError(file, passwords) {
    const name = file?.name || 'archive';
    const count = passwords.length;
    let reason;
    if (getFileExtension(name) === '.7z') {
      // libarchive has never decrypted 7z and no upstream commit addresses it.
      reason = 'encrypted 7z archives cannot be opened in the browser \u2014 extract it and drop the file from inside instead';
    } else if (!count) {
      reason = 'it is password protected \u2014 add the password under VPX Password in Advanced Config, then drop the file again';
    } else {
      reason = `none of your ${count} saved password${count === 1 ? '' : 's'} opened it \u2014 check VPX Password in Advanced Config`;
    }
    const error = new Error(`Could not open "${name}": ${reason}.`);
    error.archiveLocked = true;
    // A locked archive must never fall through to unrar: it has no password
    // either, so the only result would be a whole-file read that fails anyway.
    error.archiveWasRead = true;
    return error;
  }

  // Opens `file` and, when it is encrypted, unlocks it with the first password
  // in `passwords` that works. Returns { archive, entries, usedPassword }; the
  // CALLER owns closing the archive.
  async function openArchiveUnlocked(file, passwords, verb, remedy) {
    const Archive = await loadArchiveModule();
    const list = (Array.isArray(passwords) ? passwords : [])
      .map(entry => String(entry ?? '').trim())
      .filter(Boolean);

    let archive;
    try {
      archive = await Archive.open(file);
    } catch (error) {
      throw archiveReadError(verb, remedy, file, error);
    }

    // `null` first: an unencrypted archive costs nothing extra this way, and
    // one saved password is the overwhelmingly common encrypted case.
    for (const password of [null, ...list]) {
      try {
        if (password !== null) await archive.usePassword(password);
        const entries = await archive.getFilesArray();
        let encrypted = false;
        try { encrypted = (await archive.hasEncryptedData()) === true; } catch (_) { /* older builds */ }
        // Nothing encrypted: return without probing. Probing every ordinary
        // archive would cost a decrypt on every drop AND misreport an
        // unrelated read failure as a password problem.
        //
        // 7z is the exception and must always be probed: hasEncryptedData()
        // returns FALSE for an AES-encrypted 7z, so trusting it there would
        // hand back an archive that fails later with the engine's own words.
        if (!encrypted && getFileExtension(file.name) !== '.7z') {
          return { archive, entries, usedPassword: password };
        }
        const verdict = await probeArchive(entries);
        if (verdict === 'ok') return { archive, entries, usedPassword: password };
        if (verdict === 'unsupported') {
          try { await archive.close(); } catch (_) { /* worker may already be closed */ }
          throw archiveLockedError(file, list);
        }
      } catch (error) {
        if (error?.archiveLocked) throw error;
        if (isUnsupportedEncryptionError(error)) {
          // A header-encrypted 7z fails here rather than at the probe. Same
          // hard refusal, so say so in our own words instead of leaking
          // "The archive header is encrypted, but currently not supported".
          try { await archive.close(); } catch (_) { /* worker may already be closed */ }
          throw archiveLockedError(file, list);
        }
        if (!isPassphraseError(error)) {
          // A genuine read failure - corrupt file, unsupported format, solid
          // RAR4. Not a password problem, so let the caller deal with it.
          try { await archive.close(); } catch (_) { /* worker may already be closed */ }
          throw archiveReadError(verb, remedy, file, error);
        }
        // Locked, or wrong password. Keep going down the list on this handle.
      }
    }

    try { await archive.close(); } catch (_) { /* worker may already be closed */ }
    throw archiveLockedError(file, list);
  }

  async function extractLibarchiveEntries(file, selectNames, options = {}) {
    // As in readArchiveDirectories: hand the File straight to the fork so its
    // lazy WORKERFS mount engages. Buffering here would cap the scan at ~2 GB.
    const { archive, entries } = await openArchiveUnlocked(
      file, options.passwords, 'scan', 'drop the contained file directly');
    try {
      const entryName = entry => `${String(entry?.path || '')}${String(entry?.file?.name || '')}`;
      // selectNames throws a user-facing "no matching file inside" error. That
      // means the archive was read fine, so it must NOT trigger the RAR
      // fallback in extractArchiveEntries - re-reading a multi-GB archive
      // through unrar to arrive at the identical message is exactly the
      // whole-file read this routing exists to avoid. Tag it so the caller can
      // tell it apart from a genuine read failure.
      let wanted;
      try {
        wanted = selectNames(entries.map(entryName));
      } catch (selectionError) {
        if (selectionError && typeof selectionError === 'object') {
          selectionError.archiveWasRead = true;
        }
        throw selectionError;
      }
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
  //
  // Everything goes to libarchive, which mounts the file lazily and so has no
  // size ceiling. RAR keeps unrar as a fallback for the one case libarchive
  // refuses - a solid RAR4 - so a failed RAR read is retried there before
  // giving up. A selector error is not a read failure and never retries.
  async function extractArchiveEntries(file, selectNames, options = {}) {
    if (getFileExtension(file.name) !== '.rar') {
      return extractLibarchiveEntries(file, selectNames, options);
    }
    try {
      return await extractLibarchiveEntries(file, selectNames, options);
    } catch (error) {
      if (error && error.archiveWasRead) throw error;
      console.warn('libarchive could not read this RAR, falling back to unrar:', error);
      try {
        return await extractRarEntries(file, selectNames, options);
      } catch (fallbackError) {
        // Surface the fallback's error: it is what the user saw before this
        // routing existed, and for an archive neither engine can read unrar's
        // message is usually the more accurate of the two. Keep libarchive's
        // as the cause so the first failure is still reachable in the console.
        if (fallbackError && typeof fallbackError === 'object' && !fallbackError.cause) {
          fallbackError.cause = error;
        }
        throw fallbackError;
      }
    }
  }

  // requireExactlyOne is opt-in and only set for manufacturer-driven scans.
  // With it, anything other than a single match extracts nothing and returns
  // null, leaving the caller to hash the archive whole — a Stern SPIKE archive
  // often carries several .bin files, and silently hashing the first would
  // produce a confident wrong checksum. Without it the original behavior is
  // unchanged: first match wins, no match throws.
  async function extractArchiveEntryChecksum(file, targetExtension, options = {}) {
    const wanted = String(targetExtension).toLowerCase();
    const matches = await extractArchiveEntries(file, names => {
      const targets = names.filter(name => name.toLowerCase().endsWith(wanted));
      if (options.requireExactlyOne) return targets.length === 1 ? targets : [];
      if (!targets.length) throw new Error(`No ${targetExtension} file found inside "${file.name}".`);
      return [targets[0]];
    }, options);
    if (!matches.length) return null;
    const { name, blob } = matches[0];
    const checksum = await calculateMd5FromBlob(blob);
    return { checksum, entryName: name.split('/').pop() };
  }

  const COLOR_ROM_EXTENSIONS = ['.pal', '.vni', '.crz', '.pac', '.cromc'];

  async function extractColorRomArchiveChecksums(file, options = {}) {
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
    }, options);
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

  // A manufacturer rule wins over everything else on the field. Manufacturer
  // Override is checked first so a mis-tagged VPS record can be corrected by
  // hand — same precedence readmeGenerator already uses.
  function getManufacturerRule(field, values) {
    if (!field || !field.manufacturerRules) return null;
    // Case-insensitive: the VPS record is always exactly "Stern", but the
    // Manufacturer Override is typed by hand and "stern" must still match.
    const manufacturer = String(values?.tableManufacturerOverride || values?.__tableManufacturer || '')
      .trim().toLowerCase();
    if (!manufacturer) return null;
    const match = Object.keys(field.manufacturerRules)
      .find(name => name.toLowerCase() === manufacturer);
    return match ? field.manufacturerRules[match] : null;
  }

  function getArchiveScanExtension(field, values) {
    const rule = getManufacturerRule(field, values);
    return rule?.archiveScanExtension || field?.archiveScanExtension || '';
  }

  function getChecksumExtensions(field, values) {
    const rule = getManufacturerRule(field, values);
    if (Array.isArray(rule?.checksumExtensions)) {
      return rule.checksumExtensions.map(extension => extension.toLowerCase());
    }
    if (field.checksumExtensionsByFlag) {
      const flagConfig = field.checksumExtensionsByFlag;
      const enabled = values[flagConfig.field] === true;
      return (flagConfig[String(enabled)] || []).map(extension => extension.toLowerCase());
    }
    return Array.isArray(field.checksumExtensions)
      ? field.checksumExtensions.map(extension => extension.toLowerCase())
      : [];
  }

  // ── Shared archive directory picker ──────────────────────────────────────
  // A PUP pack can carry hundreds of folders, which makes an all-at-once
  // dropdown unusable. Show the top two levels first — the archive root is
  // almost always one of them — and hide the rest behind a LOAD MORE row.
  //
  // This is a custom control rather than a native <select> because a select
  // closes the instant anything inside it is chosen, so LOAD MORE cost a
  // second click just to reopen the list. Here the list grows in place with
  // the panel still open. Every directory selector in the app builds from
  // this one factory — see altSoundArchiveController.js for the other caller.
  const DIRECTORY_PICKER_DEPTH = 2;
  const DIRECTORY_PICKER_TYPEAHEAD_MS = 700;
  const DIRECTORY_PICKER_MAX_HEIGHT = 320;
  // Keyed by element id rather than by node, so expansion survives the
  // accordion re-renders that replace the control wholesale.
  const expandedDirectoryPickers = new Set();

  function directoryDepth(directory) {
    return String(directory || '').split('/').filter(Boolean).length;
  }

  function sameDirectoryList(a, b) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return false;
    }
    return true;
  }

  // config: { id, ariaLabel, emptyText, onSelect, getValue }
  function createDirectoryPicker(config) {
    const { id, ariaLabel, emptyText, onSelect, getValue } = config || {};
    const panelId = `${id}-panel`;

    const wrapper = element('div', 'archive-directory-picker');
    const trigger = element('button', 'archive-directory-select archive-directory-trigger');
    trigger.type = 'button';
    trigger.id = id;
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', panelId);
    if (ariaLabel) trigger.setAttribute('aria-label', ariaLabel);
    const triggerText = element('span', 'archive-directory-trigger-text');
    const chevron = element('span', 'archive-directory-chevron', '▾');
    chevron.setAttribute('aria-hidden', 'true');
    trigger.append(triggerText, chevron);

    const panel = element('div', 'archive-directory-panel');
    panel.id = panelId;
    panel.setAttribute('role', 'listbox');
    if (ariaLabel) panel.setAttribute('aria-label', ariaLabel);
    panel.hidden = true;

    wrapper.append(trigger, panel);

    const state = { all: [], rows: [], open: false, activeIndex: -1, typed: '', typedAt: 0 };

    function currentValue() {
      return typeof getValue === 'function' ? String(getValue() || '') : '';
    }

    function visibleDirectories() {
      if (expandedDirectoryPickers.has(id)) return state.all;
      const shallow = state.all.filter(directory => directoryDepth(directory) <= DIRECTORY_PICKER_DEPTH);
      // An archive whose folders are all deep would otherwise show an empty
      // list behind a LOAD MORE row, so fall back to showing everything.
      return (shallow.length > 0 && shallow.length < state.all.length) ? shallow : state.all;
    }

    function hiddenCount() {
      return state.all.length - visibleDirectories().length;
    }

    function syncTrigger() {
      const hidden = hiddenCount();
      triggerText.textContent = !state.all.length
        ? (emptyText || 'Drop an archive to browse directories')
        : (hidden > 0
          ? `Showing ${state.all.length - hidden} of ${state.all.length} archive directories…`
          : `Choose from ${state.all.length} archive director${state.all.length === 1 ? 'y' : 'ies'}…`);
      trigger.disabled = state.all.length === 0;
    }

    function positionPanel() {
      if (!state.open) return;
      // The control lives inside .config-accordion, which clips its children.
      // position:fixed escapes that, and there is no transformed ancestor to
      // break it. Re-measured on scroll and resize because the page scrolls
      // under a sticky YAML preview.
      if (!trigger.isConnected) { close({ silent: true }); return; }
      const rect = trigger.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 8;
      const above = rect.top - 8;
      const flip = below < 160 && above > below;
      const maxHeight = Math.max(120, Math.min(DIRECTORY_PICKER_MAX_HEIGHT, flip ? above : below));
      panel.style.left = `${Math.round(rect.left)}px`;
      panel.style.width = `${Math.round(rect.width)}px`;
      panel.style.maxHeight = `${Math.round(maxHeight)}px`;
      if (flip) {
        panel.style.top = 'auto';
        panel.style.bottom = `${Math.round(window.innerHeight - rect.top + 4)}px`;
      } else {
        panel.style.bottom = 'auto';
        panel.style.top = `${Math.round(rect.bottom + 4)}px`;
      }
    }

    function setActive(index) {
      if (!state.rows.length) return;
      const next = Math.max(0, Math.min(index, state.rows.length - 1));
      state.rows.forEach((row, position) => row.classList.toggle('is-active', position === next));
      state.activeIndex = next;
      const row = state.rows[next];
      trigger.setAttribute('aria-activedescendant', row.id);
      row.scrollIntoView({ block: 'nearest' });
    }

    function renderRows() {
      const directories = visibleDirectories();
      const selected = currentValue();
      panel.replaceChildren();
      state.rows = [];

      directories.forEach(directory => {
        const row = element('button', 'archive-directory-option', directory);
        row.type = 'button';
        row.setAttribute('role', 'option');
        row.dataset.value = directory;
        const isSelected = directory === selected;
        row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        if (isSelected) row.classList.add('is-selected');
        // mousedown rather than click, matching renderSuggestions: preventing
        // the default keeps focus on the trigger, so the panel is never torn
        // down underneath a click that is still in flight.
        row.addEventListener('mousedown', event => {
          event.preventDefault();
          choose(directory);
        });
        panel.appendChild(row);
        state.rows.push(row);
      });

      const hidden = hiddenCount();
      if (hidden > 0) {
        const more = element('button', 'archive-directory-more', `... LOAD MORE (${hidden} deeper) ...`);
        more.type = 'button';
        more.setAttribute('role', 'option');
        more.setAttribute('aria-selected', 'false');
        more.dataset.loadMore = 'true';
        more.addEventListener('mousedown', event => {
          event.preventDefault();
          expand();
        });
        panel.appendChild(more);
        state.rows.push(more);
      }

      state.rows.forEach((row, index) => { row.id = `${panelId}-option-${index}`; });
    }

    function expand() {
      // Land the highlight on the first folder the expansion actually reveals,
      // so the eye goes to new information instead of back to the top. The
      // revealed folders interleave with the shallow ones rather than being
      // appended, so this cannot be done by index arithmetic.
      const wasVisible = new Set(state.rows.map(row => row.dataset.value).filter(Boolean));
      expandedDirectoryPickers.add(id);
      renderRows();
      syncTrigger();
      positionPanel();
      const revealed = state.rows.findIndex(row => row.dataset.value && !wasVisible.has(row.dataset.value));
      setActive(revealed >= 0 ? revealed : 0);
    }

    function onDocumentPointerDown(event) {
      if (wrapper.contains(event.target)) return;
      close({ silent: true });
    }

    function open() {
      if (state.open || trigger.disabled) return;
      state.open = true;
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      renderRows();
      positionPanel();
      const selected = currentValue();
      const index = state.rows.findIndex(row => row.dataset.value === selected);
      setActive(index >= 0 ? index : 0);
      window.addEventListener('scroll', positionPanel, true);
      window.addEventListener('resize', positionPanel);
      document.addEventListener('pointerdown', onDocumentPointerDown, true);
    }

    function close(options) {
      if (!state.open) return;
      state.open = false;
      panel.hidden = true;
      panel.replaceChildren();
      state.rows = [];
      state.activeIndex = -1;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant');
      window.removeEventListener('scroll', positionPanel, true);
      window.removeEventListener('resize', positionPanel);
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
      if (!options?.silent && trigger.isConnected) {
        try { trigger.focus(); } catch (_) { /* focus is best-effort */ }
      }
    }

    function choose(directory) {
      close({ silent: true });
      if (typeof onSelect === 'function') onSelect(directory);
      syncTrigger();
    }

    function typeahead(key) {
      const now = Date.now();
      state.typed = (now - state.typedAt > DIRECTORY_PICKER_TYPEAHEAD_MS) ? key : state.typed + key;
      state.typedAt = now;
      const needle = state.typed.toLowerCase();
      const index = state.rows.findIndex(row => String(row.dataset.value || '').toLowerCase().startsWith(needle));
      if (index >= 0) setActive(index);
    }

    trigger.addEventListener('click', () => {
      if (state.open) close();
      else open();
    });

    trigger.addEventListener('keydown', event => {
      if (!state.open) {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
        return;
      }
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          close();
          break;
        case 'ArrowDown':
          event.preventDefault();
          setActive(state.activeIndex + 1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          setActive(state.activeIndex - 1);
          break;
        case 'Home':
          event.preventDefault();
          setActive(0);
          break;
        case 'End':
          event.preventDefault();
          setActive(state.rows.length - 1);
          break;
        case 'Tab':
          close({ silent: true });
          break;
        case 'Enter':
        case ' ': {
          event.preventDefault();
          const row = state.rows[state.activeIndex];
          if (!row) break;
          if (row.dataset.loadMore === 'true') expand();
          else choose(row.dataset.value);
          break;
        }
        default:
          if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            typeahead(event.key);
          }
      }
    });

    function setDirectories(directories, options) {
      const next = Array.isArray(directories) ? directories : [];
      const collapse = options?.collapse === true;
      // Alt Sound repopulates from a requestAnimationFrame pass on every
      // click, input, change and DOM mutation. An unchanged list must touch
      // nothing at all, or the panel would be rebuilt out from under the user
      // on the very click that opened it.
      if (!collapse && sameDirectoryList(state.all, next)) return;
      if (collapse) expandedDirectoryPickers.delete(id);
      state.all = next;
      if (state.open) {
        if (collapse) {
          close({ silent: true });
        } else {
          renderRows();
          positionPanel();
          setActive(0);
        }
      }
      syncTrigger();
    }

    const controller = { element: wrapper, trigger, setDirectories, close };
    // Reached by id at call time rather than held as a reference: in this
    // codebase any node that outlives a synchronous block may already be
    // detached. See "Hold selectors, not nodes" in VPXS UI Gotchas.
    wrapper.__vpsDirectoryPicker = controller;
    trigger.__vpsDirectoryPicker = controller;

    syncTrigger();
    return controller;
  }

  function getDirectoryPicker(id) {
    return document.getElementById(id)?.__vpsDirectoryPicker || null;
  }

  // A checksum drop keeps running while the user switches tabs, but switching
  // tabs runs renderAccordions() and replaces the whole field. The spinner
  // class and the progress message were written onto those nodes, so both went
  // with them — and the job's own completion handler then wrote its result into
  // a node that was no longer on screen. The status lives here instead, keyed
  // by the input's id, and is repainted whenever the field is rebuilt.
  // Hold selectors, not nodes.
  const checksumStatuses = new Map();

  // Per-field job generation. A drop bumps its field's counter when it starts
  // and captures the new value, then only writes its result back if the
  // counter still matches. One mechanism kills two races: a Clear (tab, table
  // or full reset) bumps the counter so an in-flight hash or directory scan
  // lands nowhere, and a second drop on the same field supersedes the first
  // instead of the two fighting over it.
  const checksumGenerations = new Map();

  function paintChecksumStatus(wrapper, hint, status) {
    if (!wrapper) return;
    const loading = status?.loading === true;
    wrapper.classList.toggle('checksum-is-loading', loading);
    wrapper.setAttribute('aria-busy', loading ? 'true' : 'false');
    if (!hint) return;
    if (status?.message) {
      hint.textContent = status.message;
      hint.classList.toggle('error', status.error === true);
      return;
    }
    // No stored status means "back to instructions". The old code only wrote
    // when there WAS a message, so a cleared field kept whatever the last drop
    // had left behind - the reported Clear bug. The instruction text varies per
    // field, so it is captured on the node when the hint is built.
    const fallback = hint.dataset?.defaultHint;
    if (typeof fallback === 'string') {
      hint.textContent = fallback;
      hint.classList.remove('error');
    }
  }

  // Always re-queries, so it reaches whichever node is on screen right now.
  function applyChecksumStatus(fieldId) {
    const wrapper = document.getElementById(fieldId)?.closest('.field');
    if (!wrapper) return;
    paintChecksumStatus(wrapper, wrapper.querySelector('.checksum-drop-hint'), checksumStatuses.get(fieldId));
  }

  function getChecksumGeneration(fieldId) {
    return checksumGenerations.get(fieldId) || 0;
  }

  // Call at the start of a drop. The returned token is what that drop's
  // completion handler checks itself against before writing anything.
  function beginChecksumJob(fieldId) {
    const next = getChecksumGeneration(fieldId) + 1;
    checksumGenerations.set(fieldId, next);
    return next;
  }

  function isChecksumGenerationCurrent(fieldId, token) {
    return getChecksumGeneration(fieldId) === token;
  }

  // Clears stored statuses and invalidates any job still running against those
  // fields. Called with a list of ids for one tab's Clear section, and with no
  // argument at all for a whole-build reset (table Clear / preview Clear).
  function resetChecksumStatuses(fieldIds) {
    const ids = Array.isArray(fieldIds)
      ? fieldIds
      : [...new Set([...checksumStatuses.keys(), ...checksumGenerations.keys()])];
    ids.forEach(fieldId => {
      checksumGenerations.set(fieldId, getChecksumGeneration(fieldId) + 1);
      checksumStatuses.delete(fieldId);
      applyChecksumStatus(fieldId);
    });
  }

  function setChecksumStatus(fieldId, status) {
    if (status) checksumStatuses.set(fieldId, status);
    else checksumStatuses.delete(fieldId);
    applyChecksumStatus(fieldId);
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
    // The title links to the table's VPS listing, matching the asset-row names.
    // Without an id there is nothing to link to, so it stays plain text.
    const titleText = record?.name || record?.id || 'Unknown table';
    const heading = element('h1');
    const listingUrl = getVpsListingUrl(record?.id);
    if (listingUrl) {
      const titleLink = document.createElement('a');
      titleLink.className = 'table-title-link';
      titleLink.href = listingUrl;
      titleLink.target = '_blank';
      titleLink.rel = 'noopener noreferrer';
      titleLink.textContent = titleText;
      heading.appendChild(titleLink);
    } else {
      heading.textContent = titleText;
    }
    summary.appendChild(heading);
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
        // VPX, B2S, ROM and DMD do not need the width a full word needs.
        if (String(config.label).length <= 3) badge.classList.add('is-short');
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

  // Returns whether anything was rendered, so the caller can lay the grid out
  // around a column that turned out to be empty.
  //
  // The value goes in its own element rather than a bare text node because the
  // detail row is height-capped and the value is what gets line-clamped; a text
  // node cannot carry the clamp or be measured for the overflow tooltip.
  function appendAssetDetail(container, label, value) {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return false;
    const block = element('div', 'asset-detail-cell');
    block.dataset.detail = label;
    const text = Array.isArray(value) ? value.join(', ') : String(value);
    block.append(element('strong', '', label), element('span', 'asset-detail-value', text));
    container.appendChild(block);
    return true;
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

  // The DMD row is deliberately not built by the generic loop in
  // renderAssetMatrix. A DMD has no VPS entry, so it gets no name link, no info
  // button and no detail panel, and its dropdown picks a *type* rather than a
  // VPS asset — which is why the value is written to values.specialDMDType
  // through the normal field-change path and never into `selections`. Keeping it
  // out of `selections` is exactly what stops getAssetState's Conflict branch
  // firing the moment a type is chosen alongside Bundled or Override.
  function appendDmdAssetRow(container, config, assetState, values, callbacks) {
    const bundled = values[config.bundleField] === true;
    const overridden = values[config.overrideField] === true;
    const unlocked = bundled || overridden;

    const row = element('div', 'asset-row asset-row-dmd');
    row.dataset.category = 'specialDMD';
    row.appendChild(element('div', 'asset-name', config.label));

    // assetState.items holds the DMD types the selected VPX actually declares,
    // so an empty list means either no VPX is chosen yet or the chosen one
    // carries no DMD tag. Both read the same to the user: nothing to configure.
    const declared = (assetState.items || []).length > 0;

    const select = document.createElement('select');
    select.setAttribute('aria-label', `Select ${config.singular} type`);
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = unlocked
      ? 'Select DMD Type'
      : declared ? 'Bundled w/ VPX or Override' : 'No DMD Available';
    select.appendChild(placeholder);
    (config.dmdTypes || []).forEach(type => {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = type;
      option.selected = String(values.specialDMDType || '') === type;
      select.appendChild(option);
    });
    // Every type is always offered; the table's tags drive the status light
    // only. The control stays locked until the user declares a shape, because
    // the type is meaningless until then.
    select.disabled = !unlocked;
    select.addEventListener('change', () => callbacks.onChange?.('specialDMDType', select.value));

    const selectWrap = element('div', 'asset-select-wrap');
    selectWrap.appendChild(select);
    row.appendChild(selectWrap);

    const toggles = element('div', 'asset-toggle-stack');

    const bundleLabel = element('label', 'bundle-toggle');
    const bundleCheck = document.createElement('input');
    bundleCheck.type = 'checkbox';
    bundleCheck.checked = bundled;
    bundleCheck.addEventListener('change', () => callbacks.onBundle(config.bundleField, bundleCheck.checked));
    bundleLabel.append(bundleCheck, document.createTextNode('Bundled'));
    toggles.appendChild(bundleLabel);

    const nsfwLabel = element('label', 'bundle-toggle nsfw-toggle');
    const nsfwCheck = document.createElement('input');
    nsfwCheck.type = 'checkbox';
    nsfwCheck.checked = values[config.nsfwField] === true;
    // The table-level NSFW flag owns the per-asset flags while checked.
    nsfwCheck.disabled = !unlocked || values.nsfw === true;
    nsfwCheck.setAttribute('aria-label', `Mark ${config.singular} NSFW`);
    nsfwCheck.addEventListener('change', () => callbacks.onNsfw?.(config.nsfwField, nsfwCheck.checked));
    nsfwLabel.append(nsfwCheck, document.createTextNode('NSFW'));
    toggles.appendChild(nsfwLabel);

    const overrideLabel = element('label', 'bundle-toggle override-toggle');
    const overrideCheck = document.createElement('input');
    overrideCheck.type = 'checkbox';
    overrideCheck.checked = overridden;
    overrideCheck.setAttribute('aria-label', `Override ${config.singular} — unlock this tab without a VPS entry`);
    overrideCheck.addEventListener('change', () => callbacks.onOverride?.(config.overrideField, overrideCheck.checked));
    overrideLabel.append(overrideCheck, document.createTextNode('Override'));
    toggles.appendChild(overrideLabel);

    row.appendChild(toggles);

    const status = element('div', `asset-status state-${assetState.key}`);
    status.append(element('span', 'status-dot'), document.createTextNode(assetState.label));
    row.appendChild(status);

    // No info button and no detail panel — both need a VPS item and a DMD has
    // none. The empty span holds the row's fifth grid column so the DMD row
    // lines up with the seven above it.
    row.appendChild(element('span'));

    container.appendChild(row);
  }

  function renderAssetMatrix(container, record, selections, values, callbacks) {
    container.innerHTML = '';

    Object.entries(CATEGORY_CONFIG).forEach(([category, config]) => {
      const assetState = getAssetState(record, category, config, selections, values);
      if (config.customAssetRow === 'dmd') {
        appendDmdAssetRow(container, config, assetState, values, callbacks);
        return;
      }
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

      // The label never changes, so the button never changes width. The open
      // state is carried entirely by the red outline from `is-open`.
      const infoButton = element('button', `asset-info-button${detailOpen ? ' is-open' : ''}`, 'Info');
      infoButton.type = 'button';
      // Both states read "Info" and the only visual difference is a border
      // colour, so the open/closed distinction has to reach assistive tech
      // some other way.
      infoButton.setAttribute('aria-expanded', detailOpen ? 'true' : 'false');
      infoButton.setAttribute('aria-label', `${detailOpen ? 'Hide' : 'Show'} ${config.singular} info`);
      infoButton.disabled = !selectedItem;
      if (selectedItem) {
        infoButton.addEventListener('click', () => callbacks.onToggleDetail(category));
      } else {
        infoButton.setAttribute('aria-disabled', 'true');
      }
      row.appendChild(infoButton);

      const detail = element('div', 'asset-detail');
      if (selectedItem) {
        // Five columns, in this order, narrow enough to sit on one row.
        appendAssetDetail(detail, 'VPS ID', selectedItem.id);
        appendAssetDetail(detail, 'Version', selectedItem.version);
        appendAssetDetail(detail, 'Created', formatDate(selectedItem.createdAt));
        appendAssetDetail(detail, 'Authors', selectedItem.authors);
        const hasFormat = appendAssetDetail(detail, 'Format', selectedItem.tableFormat);
        // No format to show: Authors takes the freed column rather than every
        // column growing, since Authors is the one that actually runs long.
        if (!hasFormat) detail.classList.add('asset-detail-no-format');
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
    // The DMD tab uses the default field grid, so this carries sizing only:
    // two rows (72px) to match PUP Notes, rather than the three-row default
    // every other multiline field falls through to.
    if (stepId === 'dmd' && name === 'specialDMDNotes') return ' field-wide field-textarea-two';
    if (field.readonly) return ' field-compact-id field-id-standard';
    if (/Checksum/i.test(field.name)) return ' field-checksum field-checksum-standard';
    if (field.multiline) return ' field-wide field-textarea-three';
    return field.wide ? ' field-wide' : '';
  }

  // Three ways a field can be locked: outright, UNLESS another value is true,
  // or WHEN another value is true. The third is what lets a shape switch lock
  // the keys that shape does not carry - the DMD tab uses it so ticking Bundled
  // greys the four standalone-only fields instead of letting them be filled in
  // and silently dropped at serialize time.
  function fieldIsDisabled(field, values) {
    if (field.disabled) return true;
    if (field.disabledUnless && values[field.disabledUnless] !== true) return true;
    if (field.disabledWhen && values[field.disabledWhen] === true) return true;
    return false;
  }

  // Each tab keeps its OWN loaded directory list. The key is derived from the
  // step id, which already matches the two that existed before this was
  // generalised: pup -> __pupArchiveDirectories, altSound ->
  // __altSoundArchiveDirectories. Sharing one key (and one hardcoded picker id)
  // meant a DMD archive drop repainted the PUP picker and overwrote PUP's list.
  function archiveDirectoriesKey(stepId) {
    return `__${stepId}ArchiveDirectories`;
  }

  function createFieldControl(field, values, onChange, stepId) {
    const wrapper = element('div', `field${getFieldLayoutClass(stepId, field)}`);
    // A mirrored field displays another field's value and stores nothing of
    // its own, so the two can never disagree.
    const mirror = field.mirrorFrom && values[field.mirrorFrom.when] === true
      ? values[field.mirrorFrom.field]
      : undefined;
    const value = mirror !== undefined
      ? (Array.isArray(mirror) ? (mirror[field.mirrorFrom.index] ?? '') : '')
      : (values[field.yml_field] ?? '');
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
      input.disabled = fieldIsDisabled(field, values);
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
    input.disabled = fieldIsDisabled(field, values);
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
      const directoriesKey = archiveDirectoriesKey(stepId);
      const directories = Array.isArray(values[directoriesKey]) ? values[directoriesKey] : [];
      // "PUP Pack Archive Root" -> "PUP Pack", "DMD Archive Root" -> "DMD".
      const assetName = String(field.name).replace(/\s*Archive Root$/i, '') || 'archive';
      const picker = createDirectoryPicker({
        id: `${controlId}-directory-select`,
        ariaLabel: `Choose ${assetName} archive root from loaded directories`,
        emptyText: `Drop a ${assetName} archive to browse directories`,
        getValue: () => input.value,
        onSelect: directory => {
          input.value = directory;
          onChange(field.yml_field, directory, field);
        }
      });
      picker.setDirectories(directories);
      wrapper.append(input, picker.element);
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
      // A field the current shape does not use explains itself rather than
      // inviting a drop it would ignore. Set before defaultHint is captured, so
      // clearing the status restores the explanation and not the invitation.
      if (input.disabled && field.disabledHint) {
        dropHint.textContent = field.disabledHint;
        statusRow.dataset.tooltip = field.disabledHint;
      }
      // paintChecksumStatus restores this when a field's status is cleared.
      dropHint.dataset.defaultHint = dropHint.textContent;
      statusRow.append(loadingTrack, dropHint);
      const setDropState = active => wrapper.classList.toggle('checksum-drop-active', active);
      // A drop still running from before a tab switch rebuilt this field is
      // repainted here, so the spinner and its message come back with the tab.
      paintChecksumStatus(wrapper, dropHint, checksumStatuses.get(controlId));
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
          setChecksumStatus(controlId, { message: `Invalid file type. Allowed: ${accepted.join(', ')}`, error: true });
          return;
        }
        const generation = beginChecksumJob(controlId);
        setChecksumStatus(controlId, { loading: true, message: `Processing ${file.name}…` });

        if (isColorArchiveDrop) {
          try {
            const results = await extractColorRomArchiveChecksums(file, { passwords: collectVpxMagic(values) });
            // Cleared, or superseded by a newer drop, while this ran.
            if (!isChecksumGenerationCurrent(controlId, generation)) return;
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
              setChecksumStatus(controlId, { message: `MD5 calculated (${primaryResult.name}) from ${file.name}` });
            } else {
              // Lone .vni drop: restore the primary field's own state-driven
              // subtext instead of leaving "Processing…" behind. Clearing the
              // stored status stops a later rebuild repainting "Processing…".
              setChecksumStatus(controlId, null);
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
              setChecksumStatus('field-coloredROMChecksumSecondary', { message: `MD5 calculated (${vni.name}) from ${file.name}` });
            }
            onChange('__checksumSources', sources, { uiOnly: true });
          } catch (error) {
            if (!isChecksumGenerationCurrent(controlId, generation)) return;
            setChecksumStatus(controlId, { message: error?.message || 'Archive scan failed.', error: true });
            console.warn('Color ROM archive scan failed:', error);
          }
          return;
        }

        if (field.archiveFormatField && ARCHIVE_EXTENSIONS.includes(extension)) {
          const format = extension.slice(1);
          onChange(field.archiveFormatField, format, { yml_field: field.archiveFormatField, type: 'select' });
          const formatSelect = document.getElementById(`field-${field.archiveFormatField}`);
          if (formatSelect) formatSelect.value = format;
        }

        // One archive holding both the VPX and its DMD. Everything below is
        // gated on this being non-null, so a normal drop takes the same path it
        // always has.
        const pairing = field.bundledPairing
          && values[field.bundledPairing.when] === true
          && ARCHIVE_EXTENSIONS.includes(extension)
          ? field.bundledPairing
          : null;

        const scanExtension = getArchiveScanExtension(field, values);
        // Only a manufacturer-driven scan is allowed to fall back. A table
        // archive with no .vpx inside really is an error; a Stern archive
        // without exactly one .bin is just an ordinary archive to hash whole.
        const scanMayFallBack = Boolean(getManufacturerRule(field, values)?.archiveScanExtension);
        const hashWholeFile = () => calculateMd5FromBlob(file).then(checksum => ({ checksum }));
        const isArchiveScanDrop = Boolean(scanExtension) && ARCHIVE_EXTENSIONS.includes(extension);
        const scanFallback = () => hashWholeFile().then(value => ({ ...value, scannedWhole: scanExtension }));
        const checksumTask = isArchiveScanDrop
          ? extractArchiveEntryChecksum(file, scanExtension,
            { requireExactlyOne: scanMayFallBack, passwords: collectVpxMagic(values) })
            .then(result => result || scanFallback())
            .catch(error => {
              // An archive that cannot be opened (corrupt, encrypted, too large
              // to scan in-browser) is indistinguishable from one without a
              // single match, so it takes the same route rather than failing a
              // drop that would have worked on a non-Stern table. Only the
              // manufacturer path may do this: a table archive with no .vpx
              // inside is a genuine error and still surfaces as one.
              // A locked archive IS now distinguishable from one without a
              // match, so it must say so rather than quietly hashing the
              // wrapper - the user has a password to add and no way to guess
              // that from a checksum that silently came from the wrong bytes.
              if (error?.archiveLocked) throw error;
              if (!scanMayFallBack) throw error;
              console.warn('Archive scan failed, hashing the archive whole:', error);
              return scanFallback();
            })
          : hashWholeFile();
        // A bundled drop browses folders too, for the DMD tab's picker, even
        // though the VPX checksum field is not itself an archive browser.
        const archiveTask = (field.archiveBrowser || pairing)
          ? readArchiveDirectories(file, collectVpxMagic(values))
          : Promise.resolve(null);
        // The whole archive's own MD5, alongside the .vpx extracted from it.
        const pairedHashTask = pairing ? calculateMd5FromBlob(file) : Promise.resolve(null);
        const [checksumResult, archiveResult, pairedHashResult] =
          await Promise.allSettled([checksumTask, archiveTask, pairedHashTask]);
        // Cleared, or superseded by a newer drop, while this ran: the build
        // this result belongs to is gone, so none of it may be written back.
        if (!isChecksumGenerationCurrent(controlId, generation)) return;

        const messages = [];
        let hadError = false;
        // An archive with no folders inside it is not a bundle, it is just a
        // .vpx in a zip - so it earns no second hash and no cross-writes.
        const pairedDirectories = pairing && archiveResult.status === 'fulfilled'
          ? (archiveResult.value || [])
          : [];
        const pairedHash = pairing && pairedDirectories.length && pairedHashResult.status === 'fulfilled'
          ? String(pairedHashResult.value || '').trim()
          : '';

        if (checksumResult.status === 'fulfilled' && checksumResult.value?.checksum) {
          input.value = checksumResult.value.checksum;
          if (pairedHash) {
            // Exactly the pair the bundled shape calls for, and in that order:
            // the .vpx inside is the primary (it is what this field shows, and
            // what a non-bundled drop has always produced), the archive's own
            // MD5 is the second entry. Any earlier "additional" values are
            // replaced rather than kept - in this shape the list IS the pair.
            onChange(field.yml_field, [checksumResult.value.checksum, pairedHash], field);
            // The archive's format is the DMD's format too - the user answers it
            // once, on the DMD tab, and prepareData mirrors it to
            // vpxArchiveFormat at write time rather than asking twice. Written
            // HERE, behind the same folder check as the hash: a .vpx sitting in
            // a bare zip is not a bundle and must set nothing at all.
            const pairedFormat = extension.slice(1);
            onChange(pairing.formatField, pairedFormat, { yml_field: pairing.formatField, type: 'select' });
            const pairedSelect = document.getElementById(`field-${pairing.formatField}`);
            if (pairedSelect) pairedSelect.value = pairedFormat;
            // Nothing is written to the DMD checksum: it mirrors this list's
            // second entry, so it follows automatically - including when the
            // user edits the additional checksum by hand later.
            const pairedInput = document.getElementById(`field-${pairing.checksumField}`);
            if (pairedInput) pairedInput.value = pairedHash.toUpperCase();
            messages.push('archive MD5 paired');
          } else {
            onChange(field.yml_field, replacePrimaryChecksum(values[field.yml_field], checksumResult.value.checksum), field);
          }
          const sources = { ...(values.__checksumSources || {}) };
          sources[field.yml_field] = { name: file.name, extension };
          onChange('__checksumSources', sources, { uiOnly: true });
          messages.push(checksumResult.value.entryName
            ? `MD5 calculated (${checksumResult.value.entryName})`
            : checksumResult.value.scannedWhole
              ? `MD5 calculated (whole archive — no single ${checksumResult.value.scannedWhole} inside)`
              : 'MD5 calculated');
        } else {
          const reason = checksumResult.reason?.message || 'MD5 failed';
          messages.push(reason);
          hadError = true;
          console.warn('MD5 failed:', checksumResult.reason);
        }

        if (field.archiveBrowser || pairing) {
          if (archiveResult.status === 'fulfilled') {
            const directories = archiveResult.value || [];
            // A bundled drop fills the DMD tab's list, not this tab's.
            onChange(pairing ? pairing.directoriesKey : archiveDirectoriesKey(stepId),
              directories, { uiOnly: true });
            // A freshly dropped archive starts collapsed, even if the previous
            // one had been expanded. The picker is addressed through the field's
            // own archiveRootField: hardcoding PUP's id here is what made a DMD
            // drop repaint the PUP picker and leave the DMD one empty until a
            // tab switch rebuilt it from state.
            const rootField = pairing ? pairing.rootField : field.archiveRootField;
            if (rootField) {
              getDirectoryPicker(`field-${rootField}-directory-select`)
                ?.setDirectories(directories, { collapse: true });
            }
            messages.push(directories.length
              ? `${directories.length} director${directories.length === 1 ? 'y' : 'ies'} loaded`
              : 'no directories found');
          } else {
            const reason = archiveResult.reason?.message || 'directory browse failed';
            messages.push(reason);
            hadError = true;
            console.warn('Archive browse failed:', archiveResult.reason);
          }
        }

        // The success wording reads "MD5 calculated (x.vpx) from pack.rar". A
        // failure already names the file inside its own sentence, so appending
        // it again produced "Could not open "pack.rar": ... drop the file
        // again. from pack.rar". Only the success path earns the suffix.
        setChecksumStatus(controlId, {
          message: hadError ? messages.join(' · ') : `${messages.join(' · ')} from ${file.name}`,
          error: hadError
        });
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
    // Shared with altSoundArchiveController: every directory selector in the
    // app is built from this one factory rather than each rolling its own.
    createDirectoryPicker,
    getDirectoryPicker,
    // Shared with altSoundArchiveController: an in-flight checksum drop has to
    // survive the tab switch that rebuilds the field it was started from.
    setChecksumStatus,
    applyChecksumStatus,
    // Shared with main.js (all three Clear paths) and with the two controllers
    // that run their own checksum drops outside this file.
    resetChecksumStatuses,
    beginChecksumJob,
    isChecksumGenerationCurrent,
    renderTableStrip,
    renderAssetMatrix,
    renderAccordions,
    syncConditionalFields,
    // Shared with additionalRomsController: it renders its own checksum drop
    // field, and without these it would have to duplicate the unrar/libarchive
    // machinery to support the same manufacturer rules.
    getManufacturerRule,
    getChecksumExtensions,
    getArchiveScanExtension,
    extractArchiveEntryChecksum,
    calculateMd5FromBlob,
    // Shared with altSoundArchiveController: it loads the same vendored
    // worker and reports the same size failures, and a second copy of either
    // is exactly how the two drifted apart before.
    archiveAssetUrl,
    archiveReadError,
    isArchiveTooLargeError
  };
})();
