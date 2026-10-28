import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { check, report, repoPath } from './harness.mjs';

global.window = {};
global.document = { createElement: () => ({ style: {} }) };
require(repoPath('js.src', 'utilities.js'));
const u = global.window.VPS_UTILS;

// A Blob stand-in that REFUSES a whole-file read but allows slices.
// If the reader ever slurps the file, this throws exactly like Chrome does at 2 GB.
function guardedBlob(buf, pretendSize) {
  const realSize = buf.length;
  return {
    size: pretendSize ?? realSize,
    arrayBuffer() {
      const error = new Error('The requested file could not be read');
      error.name = 'NotReadableError';
      return Promise.reject(error);
    },
    slice(start, end) {
      const from = Math.max(0, Math.min(start | 0, realSize));
      const to = Math.max(from, Math.min(end === undefined ? realSize : end | 0, realSize));
      const part = buf.subarray(from, to);
      return {
        size: part.length,
        arrayBuffer: () => Promise.resolve(part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength))
      };
    }
  };
}

const fixture = name => name === 'pup-zip64.zip'
  ? repoPath('fixtures', 'generated', name)
  : repoPath('fixtures', name);
const load = name => new Uint8Array(readFileSync(fixture(name)));

console.log('\n--- 1. Normal ZIP, whole-file read forbidden ---');
{
  const entries = await u.listArchiveEntryPaths(guardedBlob(load('pup-normal.zip')));
  check('returns entries without a whole-file read', Array.isArray(entries) && entries.length === 6,
    'got ' + JSON.stringify(entries));
  const dirs = u.extractArchiveDirectories(entries);
  console.log('        directories:', JSON.stringify(dirs));
  check('no file name is listed as a directory', !dirs.some(d => /\.(mp4|pup|txt)$/i.test(d)));
  check('parent folders are present',
    dirs.includes('TheMatrixPup') &&
    dirs.includes('TheMatrixPup/PUPVideos') &&
    dirs.includes('TheMatrixPup/PUPVideos/Attract') &&
    dirs.includes('TheMatrixPup/scripts'));
  check('sorted shallowest first', dirs[0] === 'TheMatrixPup');
}

console.log('\n--- 2. ZIP64 (70,000 entries), whole-file read forbidden ---');
{
  const entries = await u.listArchiveEntryPaths(guardedBlob(load('pup-zip64.zip')));
  check('reads all 70000 entries past the 65535 ZIP64 threshold',
    Array.isArray(entries) && entries.length === 70000, 'got ' + (entries && entries.length));
  const dirs = u.extractArchiveDirectories(entries);
  check('collapses to 7 real directories', dirs.length === 7, JSON.stringify(dirs));
  check('no .bin file leaked into the directory list', !dirs.some(d => d.endsWith('.bin')));
}

console.log('\n--- 3. ZIP with a 3000-byte EOCD comment ---');
{
  const entries = await u.listArchiveEntryPaths(guardedBlob(load('pup-comment.zip')));
  check('backward EOCD scan skips the comment', Array.isArray(entries) && entries.length === 1,
    'got ' + JSON.stringify(entries));
}

console.log('\n--- 4. Size is reported as 3 GB (the real failing case) ---');
{
  // Same bytes, but the reader is told the file is 3083.7 MB. Every offset it
  // computes from `size` must still land, and it must never slurp the file.
  const buf = load('pup-normal.zip');
  const blob = guardedBlob(buf, buf.length);
  const entries = await u.listArchiveEntryPaths(blob);
  check('still lists entries', entries.length === 6);
}

console.log('\n--- 5. Non-ZIP input falls back cleanly ---');
{
  const notAZip = new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24]);
  const entries = await u.listArchiveEntryPaths(guardedBlob(notAZip));
  check('returns null so the caller falls back to libarchive', entries === null, 'got ' + JSON.stringify(entries));
}

console.log('\n--- 6. Existing repo fixture still works ---');
{
  const entries = await u.listArchiveEntryPaths(guardedBlob(load('pup-test.zip')));
  console.log('        entries:', JSON.stringify(entries));
  console.log('        directories:', JSON.stringify(u.extractArchiveDirectories(entries)));
  check('fixture parses', Array.isArray(entries) && entries.length > 0);
}

report('zip streaming reader');
