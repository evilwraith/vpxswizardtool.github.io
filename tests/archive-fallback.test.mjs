// Which archive formats the streaming reader handles itself, and which it
// declines so the caller falls back to libarchive.
//
// This started life as a diagnostic that printed a table and asserted nothing.
// The distinction it prints is load-bearing and was mis-read once already:
// fixtures/pup-test.rar is RAR4, not RAR5, so it does NOT exercise the
// streaming RAR5 path — it falls back. The RAR5 path is covered separately by
// rar5-streaming.test.mjs against fixtures/pup-rar5.rar.
//
// "Returns null" is the contract for "I cannot read this, use libarchive".
// It must stay distinguishable from "read it, found nothing".

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { check, report, repoPath } from './harness.mjs';

global.window = {};
global.document = { createElement: () => ({ style: {} }) };
require(repoPath('js.src', 'utilities.js'));
const u = global.window.VPS_UTILS;

function blob(buf) {
  return {
    size: buf.length,
    arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
    slice(start, end) {
      const from = Math.max(0, Math.min(start | 0, buf.length));
      const to = Math.max(from, Math.min(end === undefined ? buf.length : end | 0, buf.length));
      const part = buf.subarray(from, to);
      return {
        size: part.length,
        arrayBuffer: () => Promise.resolve(part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength))
      };
    }
  };
}

const listing = async name =>
  u.listArchiveEntryPaths(blob(new Uint8Array(readFileSync(repoPath('fixtures', name)))));

// ── formats the streaming reader declines ─────────────────────────────────
const rar4 = await listing('pup-test.rar');
check('RAR4 is declined so libarchive handles it', rar4 === null,
  'got ' + JSON.stringify(rar4) + ' - if this now parses, the RAR4/RAR5 split has changed');

const sevenZip = await listing('pup-test.7z');
check('7z is declined so libarchive handles it', sevenZip === null,
  'got ' + JSON.stringify(sevenZip));

// ── formats it reads itself ───────────────────────────────────────────────
const zip = await listing('pup-test.zip');
check('ZIP is read by the streaming reader', Array.isArray(zip) && zip.length === 3,
  'got ' + JSON.stringify(zip));
check('ZIP directories are derived', JSON.stringify(u.extractArchiveDirectories(zip)) ===
  JSON.stringify(['Another', 'Top', 'Top/Sub']));

const single = await listing('stern-rom-single.zip');
check('single-ROM Stern zip lists its entries', Array.isArray(single) && single.length === 2,
  'got ' + JSON.stringify(single));
check('a flat zip yields no directories', u.extractArchiveDirectories(single).length === 0);

const multi = await listing('stern-rom-multi.zip');
check('multi-ROM Stern zip lists its entries', Array.isArray(multi) && multi.length === 3,
  'got ' + JSON.stringify(multi));
check('flat multi-ROM zip yields no directories', u.extractArchiveDirectories(multi).length === 0);

report('archive format fallback');
