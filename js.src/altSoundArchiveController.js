(() => {
  'use strict';

  const runtime = window.VPS_FEATURE_RUNTIME;
  const utils = window.VPS_UTILS;
  if (!runtime || !utils) return;

  const ALLOWED_EXTENSIONS = ['.zip', '.rar', '.7z'];
  let archiveModulePromise = null;
  let refreshFrame = 0;

  function getFileExtension(filename) {
    return String(filename || '').toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  }

  function md5ArrayBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    const length = bytes.length;
    const total = (((length + 8) >>> 6) + 1) * 64;
    const data = new Uint8Array(total);
    data.set(bytes);
    data[length] = 0x80;
    const view = new DataView(data.buffer);
    const bits = length * 8;
    view.setUint32(total - 8, bits >>> 0, true);
    view.setUint32(total - 4, Math.floor(bits / 0x100000000), true);

    const shifts = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
    const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0);
    const rotate = (value, amount) => ((value << amount) | (value >>> (32 - amount))) >>> 0;
    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    for (let offset = 0; offset < total; offset += 64) {
      const words = Array.from({ length: 16 }, (_, index) => view.getUint32(offset + index * 4, true));
      let a = a0;
      let b = b0;
      let c = c0;
      let d = d0;

      for (let index = 0; index < 64; index += 1) {
        let f;
        let g;
        if (index < 16) {
          f = (b & c) | ((~b) & d);
          g = index;
        } else if (index < 32) {
          f = (d & b) | ((~d) & c);
          g = (5 * index + 1) % 16;
        } else if (index < 48) {
          f = b ^ c ^ d;
          g = (3 * index + 5) % 16;
        } else {
          f = c ^ (b | (~d));
          g = (7 * index) % 16;
        }
        const previousD = d;
        d = c;
        c = b;
        b = (b + rotate((a + f + constants[index] + words[g]) >>> 0, shifts[index])) >>> 0;
        a = previousD;
      }

      a0 = (a0 + a) >>> 0;
      b0 = (b0 + b) >>> 0;
      c0 = (c0 + c) >>> 0;
      d0 = (d0 + d) >>> 0;
    }

    return [a0, b0, c0, d0].map(value => [0, 8, 16, 24]
      .map(shift => ((value >>> shift) & 0xff).toString(16).padStart(2, '0')).join('')).join('');
  }

  function createMd5Worker() {
    // Streaming MD5 worker: accepts incremental chunks so files larger than the
    // single-ArrayBuffer allocation limit (~2 GB in Chrome) can still be hashed.
    const source = `'use strict';let a0,b0,c0,d0,buffered=new Uint8Array(0),totalLength=0;const shifts=new Uint8Array([7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21]),constants=new Uint32Array(64);for(let i=0;i<64;i++)constants[i]=Math.floor(Math.abs(Math.sin(i+1))*4294967296)>>>0;function rotate(v,n){return((v<<n)|(v>>>(32-n)))>>>0}function processBlocks(bytes,byteCount){const view=new DataView(bytes.buffer,bytes.byteOffset,byteCount),words=new Uint32Array(16);for(let offset=0;offset<byteCount;offset+=64){for(let i=0;i<16;i++)words[i]=view.getUint32(offset+i*4,true);let a=a0,b=b0,c=c0,d=d0;for(let i=0;i<64;i++){let f,g;if(i<16){f=(b&c)|((~b)&d);g=i}else if(i<32){f=(d&b)|((~d)&c);g=(5*i+1)&15}else if(i<48){f=b^c^d;g=(3*i+5)&15}else{f=c^(b|(~d));g=(7*i)&15}const nD=d;d=c;c=b;b=(b+rotate((a+f+constants[i]+words[g])>>>0,shifts[i]))>>>0;a=nD}a0=(a0+a)>>>0;b0=(b0+b)>>>0;c0=(c0+c)>>>0;d0=(d0+d)>>>0}}function reset(){a0=1732584193;b0=4023233417;c0=2562383102;d0=271733878;buffered=new Uint8Array(0);totalLength=0}reset();self.onmessage=function(event){try{const m=event.data;if(m&&m.type==='init'){reset();return}if(m&&m.type==='chunk'){const chunk=new Uint8Array(m.buffer);totalLength+=chunk.length;let combined;if(buffered.length===0){combined=chunk}else{combined=new Uint8Array(buffered.length+chunk.length);combined.set(buffered,0);combined.set(chunk,buffered.length)}const completeBytes=combined.length-(combined.length%64);if(completeBytes>0)processBlocks(combined,completeBytes);const leftover=combined.subarray(completeBytes);buffered=leftover.length>0?new Uint8Array(leftover):new Uint8Array(0);return}if(m&&m.type==='finish'){const bits=totalLength*8,remaining=buffered.length,total=(((remaining+8)>>>6)+1)*64,padded=new Uint8Array(total);padded.set(buffered);padded[remaining]=128;const view=new DataView(padded.buffer);view.setUint32(total-8,bits>>>0,true);view.setUint32(total-4,Math.floor(bits/4294967296),true);processBlocks(padded,total);const checksum=[a0,b0,c0,d0].map(v=>[0,8,16,24].map(s=>((v>>>s)&255).toString(16).padStart(2,'0')).join('')).join('');self.postMessage({checksum})}}catch(error){self.postMessage({error:error&&error.message?error.message:'MD5 calculation failed.'})}};`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    return worker;
  }

  function calculateMd5(blob) {
    return new Promise((resolve, reject) => {
      // Accept a raw ArrayBuffer for backward compatibility.
      const source = blob instanceof Blob ? blob : new Blob([blob]);
      if (typeof Worker === 'undefined' || typeof source.stream !== 'function') {
        source.arrayBuffer()
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
          reader = source.stream().getReader();
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
          const sizeMb = source?.size ? (source.size / (1024 * 1024)).toFixed(1) : '?';
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

  async function readDirectories(file) {
    // Fast path: streaming header parsers (currently RAR5) work for archives
    // of any size — they never load the whole file into memory.
    try {
      const streamedEntries = await utils.listArchiveEntryPaths?.(file);
      if (streamedEntries && streamedEntries.length > 0) {
        return utils.extractArchiveDirectories(streamedEntries);
      }
    } catch (error) {
      console.warn('Streaming archive parse failed, falling back to libarchive:', error);
    }

    const Archive = await loadArchiveModule();
    // Fallback path: libarchive.js. Requires the whole file in memory; will
    // fail for files larger than ~2 GB.
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
      return utils.extractArchiveDirectories(await archive.getFilesArray());
    } finally {
      try { await archive.close(); } catch (_) { /* worker may already be closed */ }
    }
  }

  function ensureDirectorySelect() {
    const rootInput = document.getElementById('field-altSoundArchiveRoot');
    const grid = rootInput?.closest('.field-grid-altSound');
    if (!grid) return null;

    let wrapper = grid.querySelector(':scope > .field-alt-directory');
    if (wrapper) return wrapper.querySelector('select');

    wrapper = document.createElement('div');
    wrapper.className = 'field field-alt-directory';
    const label = document.createElement('label');
    label.className = 'visually-hidden';
    label.htmlFor = 'field-altSoundArchiveRoot-directory-select';
    label.textContent = 'Alt Sound Archive Directory';
    const select = document.createElement('select');
    select.id = 'field-altSoundArchiveRoot-directory-select';
    select.className = 'archive-directory-select';
    select.setAttribute('aria-label', 'Choose Alt Sound archive root from loaded directories');
    select.addEventListener('change', () => {
      if (!select.value) return;
      const input = document.getElementById('field-altSoundArchiveRoot');
      if (input) input.value = select.value;
      runtime.state.callbacks?.onChange?.('altSoundArchiveRoot', select.value, {
        yml_field: 'altSoundArchiveRoot', type: 'str'
      });
      select.value = '';
    });
    wrapper.append(label, select);
    grid.appendChild(wrapper);
    return select;
  }

  function populateRootSelect() {
    const select = ensureDirectorySelect();
    if (!select) return;

    const directories = Array.isArray(runtime.state.values?.__altSoundArchiveDirectories)
      ? runtime.state.values.__altSoundArchiveDirectories
      : [];
    const desiredValues = ['', ...directories];
    const currentValues = [...select.options].map(option => option.value);

    if (currentValues.length !== desiredValues.length || currentValues.some((value, index) => value !== desiredValues[index])) {
      const placeholder = directories.length
        ? `Choose from ${directories.length} archive director${directories.length === 1 ? 'y' : 'ies'}…`
        : 'Drop an Alt Sound archive to browse directories';
      select.replaceChildren();
      select.add(new Option(placeholder, ''));
      directories.forEach(directory => select.add(new Option(directory, directory)));
    }

    select.disabled = directories.length === 0;
  }

  // The format select intentionally starts on its placeholder ("Alt Sound
  // Archive Format") and is only populated by the user or by an archive drop —
  // never forced to a default value.
  function syncFormatSelect() {
    const { values } = runtime.state;
    if (!values) return;
    const select = document.getElementById('field-altSoundArchiveFormat');
    if (select && values.altSoundArchiveFormat && select.value !== values.altSoundArchiveFormat) {
      select.value = values.altSoundArchiveFormat;
    }
  }

  function decorateChecksumField() {
    // Only the primary checksum lives in this input — additional ones (added
    // via js.src/checksumAdditionalController.js) are index 1+ and are never
    // displayed here, matching every other checksum field in the app.
    const input = document.getElementById('field-altSoundChecksum');
    const wrapper = input?.closest('.field');
    if (!input || !wrapper) return;

    let status = wrapper.querySelector(':scope > .checksum-drop-status');
    if (!status) {
      status = document.createElement('span');
      status.className = 'checksum-drop-status';
      status.innerHTML = '<span class="checksum-loading-track" aria-hidden="true"><span class="checksum-loading-dot"></span></span><span class="checksum-drop-hint">Drop .zip / .rar / .7z file to calculate MD5 and browse folders</span>';
      wrapper.appendChild(status);
    }

    if (wrapper.dataset.altSoundArchiveBound === 'true') return;
    wrapper.dataset.altSoundArchiveBound = 'true';
    const hint = status.querySelector('.checksum-drop-hint');
    const setActive = active => wrapper.classList.toggle('checksum-drop-active', active);
    const setLoading = active => {
      wrapper.classList.toggle('checksum-is-loading', active);
      wrapper.setAttribute('aria-busy', active ? 'true' : 'false');
    };

    wrapper.addEventListener('dragenter', event => {
      event.preventDefault();
      setActive(true);
    });
    wrapper.addEventListener('dragover', event => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setActive(true);
    });
    wrapper.addEventListener('dragleave', event => {
      if (!wrapper.contains(event.relatedTarget)) setActive(false);
    });
    wrapper.addEventListener('drop', async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      setActive(false);
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;

      const extension = getFileExtension(file.name);
      if (!ALLOWED_EXTENSIONS.includes(extension)) {
        hint.textContent = `Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`;
        hint.classList.add('error');
        return;
      }

      hint.classList.remove('error');
      hint.textContent = `Processing ${file.name}…`;
      setLoading(true);

      const format = extension.slice(1);
      runtime.state.callbacks?.onChange?.('altSoundArchiveFormat', format, {
        yml_field: 'altSoundArchiveFormat', type: 'select'
      });
      const formatSelect = document.getElementById('field-altSoundArchiveFormat');
      if (formatSelect) formatSelect.value = format;

      const checksumTask = calculateMd5(file);
      const directoryTask = readDirectories(file);
      const [checksumResult, directoryResult] = await Promise.allSettled([checksumTask, directoryTask]);
      const messages = [];

      if (checksumResult.status === 'fulfilled' && checksumResult.value) {
        input.value = checksumResult.value;
        const nextValue = utils.replacePrimaryChecksum(runtime.state.values?.altSoundChecksum, checksumResult.value);
        runtime.state.callbacks?.onChange?.('altSoundChecksum', nextValue, {
          yml_field: 'altSoundChecksum', type: 'str'
        });
        const sources = { ...(runtime.state.values?.__checksumSources || {}) };
        sources.altSoundChecksum = { name: file.name, extension };
        runtime.state.callbacks?.onChange?.('__checksumSources', sources, { uiOnly: true });
        messages.push('MD5 calculated');
      } else {
        const reason = checksumResult.reason?.message || 'MD5 failed';
        messages.push(reason);
        hint.classList.add('error');
        console.warn('MD5 failed:', checksumResult.reason);
      }

      if (directoryResult.status === 'fulfilled') {
        const directories = directoryResult.value || [];
        runtime.state.callbacks?.onChange?.('__altSoundArchiveDirectories', directories, { uiOnly: true });
        populateRootSelect();
        messages.push(directories.length
          ? `${directories.length} director${directories.length === 1 ? 'y' : 'ies'} loaded`
          : 'no directories found');
      } else {
        const reason = directoryResult.reason?.message || 'directory browse failed';
        messages.push(reason);
        hint.classList.add('error');
        console.warn('Archive browse failed:', directoryResult.reason);
      }

      hint.textContent = `${messages.join(' · ')} from ${file.name}`;
      setLoading(false);
      window.VPS_FEATURE_VALIDATION?.refresh?.();
    }, true);
  }

  function apply() {
    refreshFrame = 0;
    decorateChecksumField();
    populateRootSelect();
    syncFormatSelect();
  }

  function schedule() {
    if (refreshFrame) return;
    refreshFrame = window.requestAnimationFrame(apply);
  }

  function init() {
    document.addEventListener('click', schedule, true);
    document.addEventListener('input', schedule, true);
    document.addEventListener('change', schedule, true);
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(schedule);
      observer.observe(document.getElementById('accordionStack') || document.body, { childList: true, subtree: true });
    }
    schedule();
  }

  window.VPS_ALT_SOUND_ARCHIVE = Object.freeze({
    calculateMd5,
    readDirectories,
    refresh: schedule
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();