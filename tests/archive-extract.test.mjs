// The "pull one known file out of an archive and hash it" path — the Stern
// .bin scan. Drives the REAL extractArchiveEntryChecksum, sliced out of the
// shipped js.src/uiHelper.js at run time so it cannot drift from a copy.
//
// Why this exists: rar5-streaming.test.mjs and archive-fallback.test.mjs cover
// *listing* an archive (listArchiveEntryPaths). Extraction is a different
// function and had no coverage at all, despite being the one that can hand a
// user a wrong checksum rather than an error.
//
// The rule under test is requireExactlyOne. A Stern SPIKE archive often carries
// several .bin files, so "first match wins" would produce a confident wrong
// checksum. Exactly one match extracts; anything else must extract nothing and
// return null so the caller hashes the archive whole instead.
//
// What this does NOT cover: the actual decompression. That is libarchive/unrar
// WASM in a browser worker, and it belongs to the headless-browser harness that
// does not exist yet. The extractor is stubbed here, and the stub is fed the
// real entry names read out of the real fixtures, so the selection rule is
// exercised against genuine archive contents.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { check, report, repoPath } from './harness.mjs';

// ── slice the real source ──────────────────────────────────────────────────
const source = readFileSync(repoPath('js.src', 'uiHelper.js'), 'utf8');
const START = '  // requireExactlyOne is opt-in';
const start = source.indexOf(START);
const anchor = source.indexOf('return { checksum, entryName:', start);
const blockEnd = source.indexOf('\n  }', anchor) + '\n  }'.length;
const block = source.slice(start, blockEnd);

check('the extractArchiveEntryChecksum block was located in uiHelper.js',
  start !== -1 && anchor !== -1 && block.includes('async function extractArchiveEntryChecksum'),
  'markers moved — update the slice in this test');

const build = (extractArchiveEntries, calculateMd5FromBlob) =>
  new Function('extractArchiveEntries', 'calculateMd5FromBlob',
    block + '\n; return extractArchiveEntryChecksum;')(extractArchiveEntries, calculateMd5FromBlob);

// ── real fixture contents ──────────────────────────────────────────────────
// Entry names are read out of each zip's central directory rather than typed
// in, so a regenerated fixture cannot quietly invalidate the test.
function entryNames(fixture) {
  const b = readFileSync(repoPath('fixtures', fixture));
  let i = b.length - 22;
  while (i >= 0 && b.readUInt32LE(i) !== 0x06054b50) i -= 1;
  const count = b.readUInt16LE(i + 10);
  let off = b.readUInt32LE(i + 16);
  const names = [];
  for (let k = 0; k < count; k += 1) {
    const nl = b.readUInt16LE(off + 28);
    const el = b.readUInt16LE(off + 30);
    const cl = b.readUInt16LE(off + 32);
    names.push(b.toString('utf8', off + 46, off + 46 + nl));
    off += 46 + nl + el + cl;
  }
  return names;
}

const SINGLE = entryNames('stern-rom-single.zip');
const MULTI = entryNames('stern-rom-multi.zip');
const NONE = entryNames('stern-rom-none.zip');

check('single fixture has exactly one .bin', SINGLE.filter(n => n.endsWith('.bin')).length === 1,
  JSON.stringify(SINGLE));
check('multi fixture has several .bin', MULTI.filter(n => n.endsWith('.bin')).length === 3,
  JSON.stringify(MULTI));
check('none fixture has no .bin', NONE.filter(n => n.endsWith('.bin')).length === 0,
  JSON.stringify(NONE));

const ROM_BYTES = readFileSync(repoPath('fixtures', 'stern-rom.bin'));
const ROM_MD5 = createHash('md5').update(ROM_BYTES).digest('hex').toUpperCase();

// ── stubs ──────────────────────────────────────────────────────────────────
// Records what the selector was shown, and returns real bytes for whatever it
// picked, so the hash asserted below is a genuine MD5 of genuine content.
function extractorOver(names) {
  const calls = [];
  const fn = async (file, selectNames) => {
    calls.push(names.slice());
    const wanted = selectNames(names.slice());
    return wanted.map(name => ({ name, blob: ROM_BYTES }));
  };
  fn.calls = calls;
  return fn;
}

const hashBlob = async blob => createHash('md5').update(blob).digest('hex').toUpperCase();

const file = name => ({ name, size: ROM_BYTES.length });

// ── requireExactlyOne: the rule that prevents a wrong checksum ─────────────
{
  const extractor = extractorOver(SINGLE);
  const run = build(extractor, hashBlob);
  const result = await run(file('spike.zip'), '.bin', { requireExactlyOne: true });
  check('one .bin inside extracts', result !== null, 'got null');
  check('the extracted entry is the .bin, not the readme',
    result?.entryName === SINGLE.find(n => n.endsWith('.bin')),
    'got ' + JSON.stringify(result?.entryName));
  check('the checksum is the MD5 of the extracted bytes, uppercase',
    result?.checksum === ROM_MD5, 'got ' + result?.checksum + ' want ' + ROM_MD5);
  check('the selector was shown every entry in the archive',
    JSON.stringify(extractor.calls[0]) === JSON.stringify(SINGLE));
}

{
  const run = build(extractorOver(MULTI), hashBlob);
  const result = await run(file('spike.zip'), '.bin', { requireExactlyOne: true });
  check('several .bin inside extracts NOTHING rather than guessing', result === null,
    'got ' + JSON.stringify(result) + ' — this is the confident-wrong-checksum bug');
}

{
  const run = build(extractorOver(NONE), hashBlob);
  const result = await run(file('spike.zip'), '.bin', { requireExactlyOne: true });
  check('no .bin inside returns null so the caller hashes the archive whole',
    result === null, 'got ' + JSON.stringify(result));
}

// ── without requireExactlyOne: documented legacy behaviour, unchanged ──────
{
  const run = build(extractorOver(MULTI), hashBlob);
  const result = await run(file('any.zip'), '.bin');
  check('without the flag, first match still wins',
    result?.entryName === MULTI[0], 'got ' + JSON.stringify(result?.entryName));
}

{
  const run = build(extractorOver(NONE), hashBlob);
  let threw = null;
  try { await run(file('any.zip'), '.bin'); } catch (error) { threw = error; }
  check('without the flag, no match throws', threw instanceof Error, 'got ' + threw);
  check('the throw names the extension and the file',
    /\.bin/.test(threw?.message || '') && /any\.zip/.test(threw?.message || ''),
    'got ' + threw?.message);
}

// ── details that are easy to regress ──────────────────────────────────────
{
  const run = build(extractorOver(['DIR/Sub/GAME_V1.90.BIN']), hashBlob);
  const result = await run(file('x.zip'), '.bin', { requireExactlyOne: true });
  check('extension matching is case-insensitive', result !== null, 'got null for .BIN');
  check('entryName drops the directory prefix', result?.entryName === 'GAME_V1.90.BIN',
    'got ' + JSON.stringify(result?.entryName));
}

report('archive entry extraction');
