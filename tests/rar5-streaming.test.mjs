import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { check, report, repoPath } from './harness.mjs';
global.window = {}; global.document = { createElement: () => ({ style: {} }) };
require(repoPath('js.src', 'utilities.js'));
const u = global.window.VPS_UTILS;

// Whole-file read forbidden, exactly like a 3 GB file in Chrome.
function guarded(buf) {
  return {
    size: buf.length,
    arrayBuffer() { const e = new Error('The requested file could not be read'); e.name = 'NotReadableError'; return Promise.reject(e); },
    slice(start, end) {
      const from = Math.max(0, Math.min(start | 0, buf.length));
      const to = Math.max(from, Math.min(end === undefined ? buf.length : end | 0, buf.length));
      const p = buf.subarray(from, to);
      return { size: p.length, arrayBuffer: () => Promise.resolve(p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength)) };
    }
  };
}

const entries = await u.listArchiveEntryPaths(guarded(new Uint8Array(readFileSync(repoPath('fixtures', 'pup-rar5.rar')))));
console.log('entries:');
entries.forEach(e => console.log('  ' + (e.isFile ? 'file' : 'DIR ') + '  ' + e.path));
const dirs = u.extractArchiveDirectories(entries);
console.log('\ndirectories: ' + JSON.stringify(dirs, null, 1));

console.log();
check('RAR5 parsed without a whole-file read', Array.isArray(entries) && entries.length > 0);
check('directory entries flagged as directories', entries.some(e => e.isFile === false));
check('file entries flagged as files', entries.some(e => e.isFile === true));
check('no file name leaked into the directory list', !dirs.some(d => /\.(mp4|pup|txt|js)$/i.test(d)));
check('real folders present', ['TheMatrixPup','TheMatrixPup/PUPVideos','TheMatrixPup/PUPVideos/Attract','TheMatrixPup/PUPVideos/DMD','TheMatrixPup/scripts','TheMatrixPup/scripts/lib'].every(d => dirs.includes(d)));
check('exactly 6 directories, no extras', dirs.length === 6);
report('rar5 streaming reader');
