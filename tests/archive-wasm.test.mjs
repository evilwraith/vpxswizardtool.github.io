// Real decompression, in a real browser, against real archives.
//
// Every other archive test in this folder stubs the engines. This one does
// not: it opens the shipped index.html in headless Chrome (tests/browser.mjs)
// and pushes each fixture through window.VPS_UI.extractArchiveEntryChecksum -
// the same call a checksum drop makes - so the vendored libarchive and unrar
// WASM, the RAR routing, the password unlocking and the MD5 worker all run
// for real. Until 2026-09-30 all of this had only ever been proved by hand.
//
// THE ORACLE IS INDEPENDENT OF THE APP. The expected MD5s below came from
// extracting the same fixtures with WinRAR's UnRAR.exe and 7-Zip's 7z.exe, not
// from anything this app computed, so a wrong answer cannot agree with itself.
//
// The encrypted fixtures all use the password FIXTURE_PASSWORD. They were
// rebuilt on 2026-09-30 because the original password was never recorded;
// the recipe is in the vault note "Archive Size Limits".
//
// Which engine ran is read from the app's own console.warn: the RAR dispatcher
// logs "falling back to unrar" when libarchive refuses. Only a solid RAR4 may
// ever produce it - anything else reaching unrar is a whole-file read the
// routing exists to avoid.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { check, report, repoPath } from './harness.mjs';
import { openApp } from './browser.mjs';

const FIXTURE_PASSWORD = 'right-one';
const FALLBACK = 'falling back to unrar';
const OFFLINE_DB = /^Unable to preload the VPS database/;

// From UnRAR.exe / 7z.exe, 2026-09-30.
const VPX = 'C2AE45891918805A8DFE3E08688C6200';     // TheMatrix.vpx, 262144 bytes
const PACK = {
  '.vpx': ['tlk35.vpx', '782634763E73FFB06C30AD06A6A12360'],
  '.mp4': ['intro.mp4', 'EB17FCDA320B822CBCAFFA0945C1D5EE'],
  '.pup': ['screens.pup', 'FD95068AA3B557FBDB675150B09FE85D'],
  '.js': ['helper.js', 'DC6B7DADB546473695754EF272CD17B5']
};
// The Stern fixture's .bin is committed loose too, so hash that.
const STERN_BIN = createHash('md5').update(readFileSync(repoPath('fixtures', 'stern-rom.bin'))).digest('hex').toUpperCase();

const app = await openApp();
const pageErrors = [];

// Runs one extraction in the page and reports what came back, including
// the error flags the dispatcher relies on, plus any fallback it logged.
async function extract(fixture, extension, options = {}) {
  const before = app.warnings.length;
  const errorsBefore = app.errors.length;
  const result = await app.run(async (fixture, extension, options) => {
    const response = await fetch('fixtures/' + fixture);
    if (!response.ok) return { missing: true };
    const name = fixture.split('/').pop();
    const file = new File([await response.blob()], name);
    try {
      return { value: await window.VPS_UI.extractArchiveEntryChecksum(file, extension, options) };
    } catch (error) {
      return {
        error: String(error?.message || error),
        archiveLocked: error?.archiveLocked === true,
        archiveWasRead: error?.archiveWasRead === true
      };
    }
  }, fixture, extension, options);
  result.fellBack = app.warnings.slice(before).some(text => text.includes(FALLBACK));
  // Only errors raised DURING this extraction count, less one known one: the
  // page's VPS database preload fails because the browser is deliberately
  // offline, and it lands asynchronously - usually during the first
  // extraction - so it is excluded by its text rather than by timing.
  pageErrors.push(...app.errors.slice(errorsBefore)
    .filter(text => !OFFLINE_DB.test(text))
    .map(text => fixture + ': ' + text));
  return result;
}

const show = result => JSON.stringify(result);

try {
  check('the page exposes extractArchiveEntryChecksum',
    await app.run(() => typeof window.VPS_UI?.extractArchiveEntryChecksum === 'function'),
    'window.VPS_UI.extractArchiveEntryChecksum is missing - the app did not load');

  // -- plain archives: every RAR shape ---------------------------------------
  for (const [fixture, solidRar4] of [
    ['generated/rar4-plain.rar', false],
    ['generated/rar4-solid.rar', true],
    ['generated/rar5-plain.rar', false],
    ['generated/rar5-solid.rar', false]
  ]) {
    const result = await extract(fixture, '.vpx');
    check(fixture + ' decompresses to the WinRAR bytes', result.value?.checksum === VPX, show(result));
    check(fixture + ' names the entry it hashed', result.value?.entryName === 'TheMatrix.vpx', show(result));
    check(fixture + (solidRar4 ? ' reaches unrar - the one archive libarchive refuses'
                               : ' never reaches unrar'),
      result.fellBack === solidRar4,
      solidRar4 ? 'no fallback logged - is the solid RAR4 really being read by unrar?'
                : 'fell back to unrar - a whole-file read the routing should avoid');
  }

  // -- encrypted, right password ---------------------------------------------
  for (const fixture of [
    'generated/enc-rar4-p.rar', 'generated/enc-rar4-hp.rar',
    'generated/enc-rar5-p.rar', 'generated/enc-rar5-hp.rar',
    'generated/enc-zip-aes.zip', 'generated/enc-zip-legacy.zip'
  ]) {
    const result = await extract(fixture, '.vpx', { passwords: [FIXTURE_PASSWORD] });
    check(fixture + ' decrypts to the WinRAR bytes', result.value?.checksum === VPX, show(result));
    check(fixture + ' is decrypted by libarchive, not unrar', result.fellBack === false,
      'fell back to unrar');
  }

  // -- the password list is tried in order, on one handle -------------------
  // RAR4 -p is the noisy one: its listing succeeds under ANY password and only
  // the decrypt fails, with decompression garbage. -hp fails at the header.
  for (const fixture of ['generated/enc-rar4-p.rar', 'generated/enc-rar5-hp.rar', 'generated/enc-zip-legacy.zip']) {
    const result = await extract(fixture, '.vpx', { passwords: ['wrong-1', 'wrong-2', FIXTURE_PASSWORD] });
    check(fixture + ' opens with the third saved password', result.value?.checksum === VPX, show(result));
  }

  // -- encrypted, no password / wrong password -------------------------------
  for (const fixture of ['generated/enc-rar4-p.rar', 'generated/enc-rar5-hp.rar', 'generated/enc-zip-aes.zip']) {
    const none = await extract(fixture, '.vpx');
    check(fixture + ' with no password asks for one',
      /it is password protected/.test(none.error || ''), show(none));
    check(fixture + ' with no password is flagged locked', none.archiveLocked === true, show(none));
    check(fixture + ' with no password never falls back to unrar', none.fellBack === false,
      'a locked RAR was handed to unrar - a whole-file read that fails anyway');

    const wrong = await extract(fixture, '.vpx', { passwords: ['wrong-1', 'wrong-2'] });
    check(fixture + ' with wrong passwords counts them',
      /none of your 2 saved passwords opened it/.test(wrong.error || ''), show(wrong));
    check(fixture + ' never shows the engine\'s own error text',
      !/Huffman|block header|checksum error|Truncated|passphrase/i.test(wrong.error || ''), show(wrong));
  }

  // -- 7z encryption is refused in the app's words, both modes ---------------
  for (const fixture of ['generated/enc-7z.7z', 'generated/enc-7z-hdr.7z']) {
    const result = await extract(fixture, '.vpx', { passwords: [FIXTURE_PASSWORD] });
    check(fixture + ' is refused even with the right password',
      /encrypted 7z archives cannot be opened in the browser/.test(result.error || ''), show(result));
    check(fixture + ' does not leak libarchive\'s wording',
      !/currently not supported/.test(result.error || ''), show(result));
  }

  // -- a real-pack shape: the zero-byte placeholder must not condemn it ------
  // The empty entries sort first by size. Probing one fails on RAR4 even with
  // the right password ("Zero window size is invalid"), which is how a real
  // table pack once reported a wrong password. The pack carries FOUR empty
  // entries on purpose: the probe tries the three smallest, so with only two
  // a third candidate masked the loss of the skip-empty-entries rule and the
  // mutation survived. Each of the two defences is now caught on its own.
  for (const fixture of ['generated/pack-rar4-p.rar', 'generated/pack-rar5-p.rar']) {
    for (const [extension, [entryName, md5]] of Object.entries(PACK)) {
      const result = await extract(fixture, extension, { passwords: [FIXTURE_PASSWORD] });
      check(fixture + ' ' + entryName + ' decrypts to the WinRAR bytes',
        result.value?.checksum === md5 && result.value?.entryName === entryName, show(result));
    }
  }

  // -- the Stern rule: exactly one .bin, or nothing --------------------------
  {
    const single = await extract('stern-rom-single.zip', '.bin', { requireExactlyOne: true });
    check('a Stern archive with one .bin hashes that .bin',
      single.value?.checksum === STERN_BIN && single.value?.entryName === 'spike_game_v1.90.bin', show(single));

    const multi = await extract('stern-rom-multi.zip', '.bin', { requireExactlyOne: true });
    check('a Stern archive with several .bin extracts nothing rather than guess',
      'value' in multi && multi.value === null, show(multi));

    const none = await extract('stern-rom-none.zip', '.bin', { requireExactlyOne: true });
    check('a Stern archive with no .bin extracts nothing', 'value' in none && none.value === null, show(none));

    const legacy = await extract('stern-rom-none.zip', '.bin');
    check('without requireExactlyOne a missing .bin still throws',
      /No \.bin file found inside/.test(legacy.error || ''), show(legacy));
  }

  check('no page errors were raised by any extraction', pageErrors.length === 0,
    pageErrors.join('\n        '));
} finally {
  await app.close();
}

report('real WASM decompression (headless Chrome)');
