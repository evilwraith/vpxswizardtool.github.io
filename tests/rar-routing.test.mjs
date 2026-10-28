// Which engine a RAR extraction goes to, and when it falls back.
//
// Before 2026-08-27 every .rar went straight to node-unrar-js, which does
// `await file.arrayBuffer()` and so failed outright on a RAR over ~2 GB. That
// was the last whole-file read in the app. libarchive reads lazily with no
// size ceiling and decompresses RAR4/RAR5 byte-perfectly (measured against
// WinRAR), so .rar now tries libarchive first and keeps unrar only for the one
// case libarchive refuses: a SOLID RAR4.
//
// Two behaviours here are load-bearing and both are easy to regress:
//
//   1. A selector error must NOT fall back. selectNames throws the user-facing
//      "no .vpx file found inside" error, which means the archive was read
//      perfectly well. Retrying that through unrar would re-read a multi-GB
//      archive to arrive at the identical message - reintroducing the exact
//      whole-file read this routing removes. extractLibarchiveEntries tags
//      those with archiveWasRead so the dispatcher can tell them apart.
//
//   2. When BOTH engines fail, the user must see unrar's error, not
//      libarchive's. That is the message they saw before this routing existed,
//      and for an archive neither engine can read it is usually the more
//      accurate of the two. libarchive's is kept as .cause.
//
// What this does NOT cover: the actual decompression. That is WASM in a
// browser worker. Both engines are stubbed here; the routing decision is the
// behaviour under test. archive-wasm.test.mjs runs the real engines in
// headless Chrome against the WinRAR-built fixtures, including which engine
// each RAR actually reached.

import { readFileSync } from 'node:fs';
import { check, report, repoPath } from './harness.mjs';

// -- slice the real source --------------------------------------------------
const source = readFileSync(repoPath('js.src', 'uiHelper.js'), 'utf8');

const LIB_START = '  async function extractLibarchiveEntries(file, selectNames, options = {}) {';
const DISPATCH_START = '  // selectNames receives every file entry name';
const DISPATCH_END = '  // requireExactlyOne is opt-in';

const libStart = source.indexOf(LIB_START);
const dispatchStart = source.indexOf(DISPATCH_START);
const dispatchEnd = source.indexOf(DISPATCH_END);

check('extractLibarchiveEntries was located in uiHelper.js', libStart !== -1,
  'marker moved - update the slice in this test');
check('extractArchiveEntries was located in uiHelper.js',
  dispatchStart !== -1 && dispatchEnd > dispatchStart,
  'markers moved - update the slice in this test');

const libBlock = source.slice(libStart, dispatchStart);
const dispatchBlock = source.slice(dispatchStart, dispatchEnd);

check('the sliced dispatcher is the async fallback version, not the old ternary',
  dispatchBlock.includes('async function extractArchiveEntries')
  && dispatchBlock.includes('archiveWasRead')
  && !dispatchBlock.includes('? extractRarEntries(file, selectNames)'),
  'the slice does not contain the routing under test');

// extractLibarchiveEntries delegates opening (and password unlocking) to
// openArchiveUnlocked, which has its own file: archive-password.test.mjs.
const buildLibarchive = openArchiveUnlocked =>
  new Function('openArchiveUnlocked',
    libBlock + '\n; return extractLibarchiveEntries;')(openArchiveUnlocked);

const buildDispatcher = (getFileExtension, extractLibarchiveEntries, extractRarEntries, console) =>
  new Function('getFileExtension', 'extractLibarchiveEntries', 'extractRarEntries', 'console',
    dispatchBlock + '\n; return extractArchiveEntries;')(
    getFileExtension, extractLibarchiveEntries, extractRarEntries, console);

// The real one, copied in behaviour from uiHelper.js:218 - lowercased, so
// ".RAR" and ".rar" must route identically.
const getFileExtension = filename => {
  const match = String(filename || '').toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : '';
};

const quietConsole = { warn: () => {} };
const file = name => ({ name, size: 1024 });

// A spy that records calls and returns/throws whatever it was configured with.
function engine(behaviour) {
  const calls = [];
  const fn = async (f, selectNames, options) => {
    calls.push({ name: f.name, selectNames, options });
    return behaviour(f, selectNames);
  };
  fn.calls = calls;
  return fn;
}

const RESULT = [{ name: 'TheMatrix.vpx', blob: 'BYTES' }];
const ok = () => engine(() => RESULT);
const refuses = message => engine(() => { throw new Error(message); });
const SOLID_RAR4 = 'RAR solid archive support unavailable';

// -- the dispatcher: which engine, and when --------------------------------
{
  const lib = ok();
  const rar = ok();
  const run = buildDispatcher(getFileExtension, lib, rar, quietConsole);
  const result = await run(file('pack.zip'), () => ['x']);
  check('a non-RAR archive goes to libarchive', lib.calls.length === 1);
  check('a non-RAR archive never touches unrar', rar.calls.length === 0,
    'unrar was called ' + rar.calls.length + ' time(s)');
  check('the libarchive result is returned unchanged', result === RESULT);
}

{
  const lib = ok();
  const rar = ok();
  const run = buildDispatcher(getFileExtension, lib, rar, quietConsole);
  await run(file('pack.rar'), () => ['x']);
  check('a RAR goes to libarchive FIRST - this is the whole point of the change',
    lib.calls.length === 1, 'libarchive was not called');
  check('a RAR libarchive can read never falls back to unrar', rar.calls.length === 0,
    'unrar was called ' + rar.calls.length + ' time(s) - the 2 GB path is still live');
}

{
  // The extension test must go through getFileExtension, which lowercases.
  // Asserting this against a libarchive that SUCCEEDS proves nothing: unrar
  // stays uncalled whether ".RAR" was recognised as a RAR or skipped as a
  // non-RAR, so the assertion passes for the wrong reason. Only a refusal
  // separates the two - a mutation to a case-sensitive check survived this
  // test until it was written this way.
  const lib = refuses(SOLID_RAR4);
  const rar = ok();
  const run = buildDispatcher(getFileExtension, lib, rar, quietConsole);
  let result = null;
  let threw = null;
  try { result = await run(file('PACK.RAR'), () => ['x']); } catch (e) { threw = e; }
  check('an uppercase .RAR is recognised as a RAR and still gets the fallback',
    rar.calls.length === 1,
    'treated as a non-RAR - a solid RAR4 named .RAR would fail outright');
  check('the uppercase .RAR fallback returns the unrar result', result === RESULT,
    threw ? 'threw instead: ' + threw.message : 'got ' + JSON.stringify(result));
}

// -- the fallback: solid RAR4 ----------------------------------------------
{
  const lib = refuses(SOLID_RAR4);
  const rar = ok();
  const run = buildDispatcher(getFileExtension, lib, rar, quietConsole);
  const result = await run(file('solid.rar'), () => ['x']);
  check('a RAR libarchive refuses falls back to unrar', rar.calls.length === 1,
    'unrar was not called - solid RAR4 would now fail outright');
  check('the fallback result is returned unchanged', result === RESULT);
  check('the fallback sees the same selector the caller passed',
    typeof rar.calls[0].selectNames === 'function');
}

{
  // Options must survive BOTH hops. If the fallback drops them, a solid RAR4
  // would lose its passwords at exactly the moment it needs them.
  const lib = refuses(SOLID_RAR4);
  const rar = ok();
  const run = buildDispatcher(getFileExtension, lib, rar, quietConsole);
  const opts = { passwords: ['pw'], requireExactlyOne: true };
  await run(file('solid.rar'), () => ['x'], opts);
  check('options reach libarchive on the first attempt', lib.calls[0]?.options === opts,
    'got ' + JSON.stringify(lib.calls[0]?.options));
  check('options survive the fallback to unrar', rar.calls[0]?.options === opts,
    'the fallback would lose the passwords: ' + JSON.stringify(rar.calls[0]?.options));
}

// -- a selector error is not a read failure --------------------------------
{
  const notFound = new Error('No .vpx file found inside "pack.rar".');
  notFound.archiveWasRead = true;
  const lib = engine(() => { throw notFound; });
  const rar = ok();
  const run = buildDispatcher(getFileExtension, lib, rar, quietConsole);
  let threw = null;
  try { await run(file('pack.rar'), () => { throw notFound; }); } catch (e) { threw = e; }
  check('a selector error does NOT fall back to unrar', rar.calls.length === 0,
    'unrar was called - a multi-GB archive would be re-read to reach the same message');
  check('the selector error is rethrown unchanged', threw === notFound,
    'got ' + threw?.message);
}

// -- both engines fail -----------------------------------------------------
{
  const libError = new Error(SOLID_RAR4);
  const rarError = new Error('Corrupt header in "broken.rar".');
  const lib = engine(() => { throw libError; });
  const rar = engine(() => { throw rarError; });
  const run = buildDispatcher(getFileExtension, lib, rar, quietConsole);
  let threw = null;
  try { await run(file('broken.rar'), () => ['x']); } catch (e) { threw = e; }
  check('when both engines fail the user sees the unrar error', threw === rarError,
    'got ' + threw?.message);
  check('the libarchive error is preserved as the cause', threw?.cause === libError,
    'got ' + threw?.cause);
}

{
  const libError = new Error('Could not scan "pack.zip": archive is too large.');
  const lib = engine(() => { throw libError; });
  const rar = ok();
  const run = buildDispatcher(getFileExtension, lib, rar, quietConsole);
  let threw = null;
  try { await run(file('pack.zip'), () => ['x']); } catch (e) { threw = e; }
  check('a non-RAR failure never falls back to unrar', rar.calls.length === 0,
    'unrar was handed a zip');
  check('a non-RAR failure surfaces the libarchive error', threw === libError,
    'got ' + threw?.message);
}

// -- the tag itself, in extractLibarchiveEntries ---------------------------
// openArchiveUnlocked is stubbed here; it has its own coverage in
// archive-password.test.mjs. What matters in this file is what
// extractLibarchiveEntries does with the entries it is handed, and how it
// labels a selector throw so the dispatcher above can tell it apart.
const unlockerOver = (names, onClose) => {
  const calls = [];
  const fn = async (f, passwords, verb, remedy) => {
    calls.push({ name: f.name, passwords, verb, remedy });
    return {
      archive: { close: async () => { if (onClose) onClose(); } },
      entries: names.map(n => ({
        path: n.includes('/') ? n.slice(0, n.lastIndexOf('/') + 1) : '',
        file: { name: n.split('/').pop(), size: n.length, extract: async () => 'BYTES:' + n }
      })),
      usedPassword: null
    };
  };
  fn.calls = calls;
  return fn;
};

{
  const selectorError = new Error('No .vpx file found inside "pack.rar".');
  let closed = false;
  const run = buildLibarchive(unlockerOver(['a/readme.txt'], () => { closed = true; }));
  let threw = null;
  try { await run(file('pack.rar'), () => { throw selectorError; }); } catch (e) { threw = e; }
  check('a selector throw is tagged archiveWasRead', threw?.archiveWasRead === true,
    'untagged - the dispatcher would fall back and re-read the whole archive');
  check('the selector error keeps its own message', threw === selectorError, 'got ' + threw?.message);
  check('the archive is still closed when the selector throws', closed === true,
    'the worker was leaked');
}

{
  const run = buildLibarchive(unlockerOver(['Top/TheMatrix.vpx', 'readme.txt']));
  const out = await run(file('pack.rar'), names => names.filter(n => n.endsWith('.vpx')));
  check('a successful read returns the selected entry',
    out.length === 1 && out[0].name === 'Top/TheMatrix.vpx',
    JSON.stringify(out.map(e => e.name)));
  check('the selector is shown full paths, not bare filenames',
    out[0].blob === 'BYTES:Top/TheMatrix.vpx', 'got ' + out[0].blob);
}

{
  // The passwords have to reach the unlocker or an encrypted archive fails no
  // matter what the user saved. This is the whole wiring of the feature.
  const unlock = unlockerOver(['Top/TheMatrix.vpx']);
  const run = buildLibarchive(unlock);
  await run(file('pack.rar'), names => names, { passwords: ['one', 'two'] });
  check('options.passwords is forwarded to the unlocker',
    JSON.stringify(unlock.calls[0]?.passwords) === JSON.stringify(['one', 'two']),
    'got ' + JSON.stringify(unlock.calls[0]?.passwords));
  check('the unlocker is told this is a scan, so its errors read correctly',
    unlock.calls[0]?.verb === 'scan', 'got ' + unlock.calls[0]?.verb);
}

report('RAR engine routing');
