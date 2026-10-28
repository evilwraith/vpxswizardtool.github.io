import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { check, report, repoPath } from './harness.mjs';
global.window = {}; global.document = { createElement: () => ({ style: {} }) };
require(repoPath('js.src', 'utilities.js'));
const u = global.window.VPS_UTILS;

// Build a VIRTUAL 3 GB zip: real local headers at the front, a 3 GB gap of
// file data that is never read, then the real central directory relocated to
// the end with its recorded offset rewritten to match. This is structurally
// the same file Jason dropped (TheMatrixPup_0.99.0.zip, 3083.7 MB).
const src = new Uint8Array(readFileSync(repoPath('fixtures', 'pup-normal.zip')));
const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
let eocd = -1;
for (let i = src.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
const cdSize = view.getUint32(eocd + 12, true);
const cdOffset = view.getUint32(eocd + 16, true);

const GAP = 3_233_808_384 - cdOffset;            // pad the data region out to ~3083.7 MB
const tail = src.slice(cdOffset);                 // central directory + EOCD
const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
tailView.setUint32((eocd - cdOffset) + 16, cdOffset + GAP, true);  // rewrite recorded CD offset

const front = src.slice(0, cdOffset);
const TOTAL = front.length + GAP + tail.length;
let bytesServed = 0, sliceCalls = 0;

const virtualBlob = {
  size: TOTAL,
  arrayBuffer() { throw new Error('whole-file read attempted — this is the bug'); },
  slice(start, end) {
    sliceCalls++;
    const from = Math.max(0, Math.min(start, TOTAL));
    const to = Math.max(from, Math.min(end === undefined ? TOTAL : end, TOTAL));
    const out = new Uint8Array(to - from);
    for (let i = from; i < to; i++) {
      if (i < front.length) out[i - from] = front[i];
      else if (i >= front.length + GAP) out[i - from] = tail[i - front.length - GAP];
      // else: inside the gap, stays 0 (never actually needed)
    }
    bytesServed += out.length;
    return { size: out.length, arrayBuffer: () => Promise.resolve(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)) };
  }
};

console.log('Virtual archive size: ' + (TOTAL / (1024 * 1024)).toFixed(1) + ' MB');
const entries = await u.listArchiveEntryPaths(virtualBlob);
const dirs = u.extractArchiveDirectories(entries);

console.log('slice() calls:      ' + sliceCalls);
console.log('bytes actually read: ' + bytesServed + ' (' + (bytesServed / TOTAL * 100).toExponential(2) + '% of the file)');
console.log('entries found:      ' + (entries ? entries.length : null));
console.log('directories:        ' + JSON.stringify(dirs));

check('entries are listed from a 3 GB archive', !!entries && entries.length === 6,
  'got ' + (entries ? entries.length : entries));
check('all six directories found', dirs.length === 6);
check('nested directory present', dirs.includes('TheMatrixPup/PUPVideos/Attract'));
check('no file name listed as a directory', !dirs.some(d => /\.(mp4|pup|txt)$/i.test(d)));
check('under 200 KB actually read', bytesServed < 200 * 1024, 'read ' + bytesServed + ' bytes');

report('3 GB archive streaming');
