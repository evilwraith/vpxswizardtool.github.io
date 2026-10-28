// Opening a password-protected archive: detection, the retry loop, and the
// message the user actually sees.
//
// Drives the REAL openArchiveUnlocked and its helpers, sliced out of the
// shipped js.src/uiHelper.js at run time so they cannot drift from a copy.
//
// The three facts this code is built on were measured in a browser on
// 2026-08-27 against WinRAR `-p`/`-hp` archives in both RAR versions and
// 7-Zip AES-256 / ZipCrypto ZIPs. They are recorded in
// vendor/libarchive/VERSION.md, and each has an assertion here because each
// was wrong in an earlier design:
//
//   1. A successful LISTING does not mean the archive is unlocked. ZIP and
//      RAR `-p` list happily under any password at all and only fail when an
//      entry is read. Only header-encrypted RAR answers at listing.
//   2. Validity is settled against the SMALLEST entry, so the cost does not
//      scale with archive size. Probing the entry we actually want would make
//      a wrong password on a 3 GB archive cost a full decrypt.
//   3. ONE open archive takes repeated usePassword() calls. Re-opening per
//      attempt is node-unrar-js's constraint, not libarchive's, and assuming
//      otherwise is what made a password list look too expensive to offer.
//
// What this does NOT cover: real decryption, which is WASM in a browser
// worker. The archive is stubbed here. Real decryption of every encrypted
// fixture in fixtures/generated/ is covered by archive-wasm.test.mjs, in
// headless Chrome. PW below is this file's stub value; it happens to equal the
// real fixtures' password, which is set in archive-wasm.test.mjs.

import { readFileSync } from 'node:fs';
import { check, report, repoPath } from './harness.mjs';

// -- slice the real source --------------------------------------------------
const source = readFileSync(repoPath('js.src', 'uiHelper.js'), 'utf8');
const START = '  // ---- Encrypted archives ---';
const END = '  async function extractLibarchiveEntries(file, selectNames, options = {}) {';
const start = source.indexOf(START);
const end = source.indexOf(END);

check('the encrypted-archive block was located in uiHelper.js',
  start !== -1 && end > start, 'markers moved - update the slice in this test');

const block = source.slice(start, end);

check('the slice contains the retry loop under test',
  block.includes('async function openArchiveUnlocked')
  && block.includes('usePassword')
  && block.includes('archiveLockedError'),
  'the slice does not contain the behaviour under test');

const build = (loadArchiveModule, archiveReadError, getFileExtension) =>
  new Function('loadArchiveModule', 'archiveReadError', 'getFileExtension',
    block + '\n; return { openArchiveUnlocked, isPassphraseError, isUnsupportedEncryptionError, smallestExtractableEntry, probeCandidates, probeArchive, archiveLockedError };')(
    loadArchiveModule, archiveReadError, getFileExtension);

const getFileExtension = filename => {
  const match = String(filename || '').toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : '';
};

const readError = (verb, remedy, f, error) => {
  const wrapped = new Error('Could not ' + verb + ' "' + f.name + '": ' + error.message);
  wrapped.cause = error;
  return wrapped;
};

const file = name => ({ name, size: 4096 });
const PW = 'right-one';

// A stub archive. `unlocksWith` is the password its entries decrypt under;
// null means nothing inside is encrypted.
function stubArchive({ names, unlocksWith, encrypted, failListUnless, onClose }) {
  const state = { password: null, opens: 0, usePasswordCalls: [], probes: 0, closed: 0 };
  const archive = {
    async usePassword(pw) { state.password = pw; state.usePasswordCalls.push(pw); },
    async hasEncryptedData() { return encrypted === true; },
    async getFilesArray() {
      // Header-encrypted archives refuse to list at all without the password.
      if (failListUnless && state.password !== failListUnless) {
        throw new Error(state.password === null
          ? 'Passphrase required for this archive'
          : 'Incorrect passphrase');
      }
      return names.map(n => ({
        path: n.includes('/') ? n.slice(0, n.lastIndexOf('/') + 1) : '',
        file: {
          name: n.split('/').pop(),
          size: n.length,
          async extract() {
            state.probes += 1;
            if (unlocksWith !== null && unlocksWith !== undefined && state.password !== unlocksWith) {
              // Data-encrypted archives fail HERE, with garbage, not at listing.
              throw new Error('Unsupported block header size (was 7, max is 2)');
            }
            return 'BYTES:' + n;
          }
        }
      }));
    },
    async close() { state.closed += 1; if (onClose) onClose(); }
  };
  const loader = async () => ({ open: async () => { state.opens += 1; return archive; } });
  return { loader, state };
}

const NAMES = ['readme.txt', 'Top/TheMatrix.vpx'];

// -- isPassphraseError ------------------------------------------------------
{
  const { isPassphraseError } = build(async () => ({}), readError, getFileExtension);
  check('recognises the libarchive "required" phrasing',
    isPassphraseError(new Error('Passphrase required for this entry')));
  check('recognises the libarchive "incorrect" phrasing',
    isPassphraseError(new Error('Incorrect passphrase')));
  check('recognises the RAR4 header phrasing',
    isPassphraseError(new Error('Incorrect passphrase or corrupt encrypted RAR4 header')));
  const unrarError = new Error('extraction failed');
  unrarError.reason = 'ERAR_BAD_PASSWORD';
  check('recognises unrar reporting on .reason rather than .message',
    isPassphraseError(unrarError),
    'unrar failures would never retry, so a solid RAR4 could not be unlocked');
  check('does NOT claim a solid-RAR4 refusal is a password problem',
    !isPassphraseError(new Error('RAR solid archive support unavailable')),
    'this would send a solid RAR4 down the password path instead of to unrar');
  check('does NOT claim decompression garbage is a password problem',
    !isPassphraseError(new Error('Unsupported block header size (was 7, max is 2)')));
}

// -- smallestExtractableEntry ----------------------------------------------
{
  const { smallestExtractableEntry } = build(async () => ({}), readError, getFileExtension);
  const entry = (name, size) => ({ file: { name, size, extract: async () => 'x' } });
  const picked = smallestExtractableEntry([entry('big.vpx', 262144), entry('readme.txt', 32), entry('mid', 4096)]);
  check('picks the smallest entry, which is what keeps validation size-independent',
    picked?.file?.name === 'readme.txt', 'got ' + picked?.file?.name);
  check('returns null when nothing is extractable', smallestExtractableEntry([]) === null);
  check('ignores entries with no extract()',
    smallestExtractableEntry([{ file: { name: 'x', size: 1 } }]) === null);
}

// -- zero-byte entries must never be probed --------------------------------
// A REAL BUG, found by Jason on 2026-08-27 with a real table pack. An empty
// file has no bytes to decrypt, so it proves nothing - and libarchive fails one
// outright on RAR4 with "Zero window size is invalid" EVEN WITH THE CORRECT
// PASSWORD. The pack held a zero-byte placeholder, it sorted first, the probe
// picked it, and the app told him his correct password was wrong while every
// other entry in the archive decrypted fine.
//
// This is the worst failure shape this feature has: a false negative that the
// user cannot argue with, because the field visibly holds the right password.
const ZERO_WINDOW = 'Zero window size is invalid';

{
  const { probeCandidates, smallestExtractableEntry } = build(async () => ({}), readError, getFileExtension);
  const entry = (name, size) => ({ file: { name, size, extract: async () => 'x' } });
  const pack = [entry('.gitkeep', 0), entry('placeholder.dat', 0), entry('readme.txt', 180), entry('table.vpx', 3145728)];
  check('a zero-byte entry is never chosen as the probe',
    smallestExtractableEntry(pack)?.file?.name === 'readme.txt',
    'chose ' + smallestExtractableEntry(pack)?.file?.name + ' - RAR4 fails empty entries with a correct password');
  check('zero-byte entries are excluded from the candidate list entirely',
    probeCandidates(pack).every(c => c.file.size > 0),
    JSON.stringify(probeCandidates(pack).map(c => c.file.name)));
  check('candidates come back smallest-first',
    JSON.stringify(probeCandidates(pack).map(c => c.file.name)) === JSON.stringify(['readme.txt', 'table.vpx']));
  check('an archive of nothing but empty files yields no candidates',
    probeCandidates([entry('a', 0), entry('b', 0)]).length === 0);
}

{
  // One awkward entry must not condemn the whole archive.
  const { probeArchive } = build(async () => ({}), readError, getFileExtension);
  const good = { file: { name: 'ok.txt', size: 200, extract: async () => 'bytes' } };
  const bad = { file: { name: 'weird.bin', size: 10, extract: async () => { throw new Error(ZERO_WINDOW); } } };
  const verdict = await probeArchive([bad, good]);
  check('a failing smallest entry falls through to the next candidate',
    verdict === 'ok', 'got ' + verdict + ' - one odd entry would reject a correct password');
  const allBad = await probeArchive([
    { file: { name: 'a', size: 10, extract: async () => { throw new Error('Incorrect passphrase'); } } },
    { file: { name: 'b', size: 20, extract: async () => { throw new Error('Incorrect passphrase'); } } }
  ]);
  check('detection is NOT weakened: every candidate failing is still locked',
    allBad === 'locked', 'got ' + allBad);
  const onlyEmpty = await probeArchive([{ file: { name: 'e', size: 0, extract: async () => { throw new Error(ZERO_WINDOW); } } }]);
  check('an unprobeable archive is not declared locked on no evidence',
    onlyEmpty === 'ok', 'got ' + onlyEmpty + ' - inventing a password problem from an untested archive');
}

{
  // End to end, the exact shape of Jason's pack: an encrypted archive whose
  // smallest member is a zero-byte file that always throws.
  let closed = 0;
  const mkEntry = (name, size, ok) => ({ path: '', file: { name, size,
    async extract() { if (!ok) throw new Error(ZERO_WINDOW); return 'BYTES'; } } });
  const archive = {
    async usePassword() {},
    async hasEncryptedData() { return true; },
    async getFilesArray() {
      return [mkEntry('.gitkeep', 0, false), mkEntry('readme.txt', 180, true), mkEntry('tlk35.vpx', 3145728, true)];
    },
    async close() { closed += 1; }
  };
  const { openArchiveUnlocked } = build(async () => ({ open: async () => archive }), readError, getFileExtension);
  let threw = null;
  let result = null;
  try { result = await openArchiveUnlocked(file('tlk35.rar'), ['the-right-one'], 'scan', 'r'); }
  catch (e) { threw = e; }
  check('a pack whose smallest member is empty still unlocks',
    result !== null && threw === null,
    threw ? 'refused with: ' + threw.message : 'no result');
  check('and it is left open for the caller', closed === 0, 'closed ' + closed);
}

// -- an archive with nothing encrypted --------------------------------------
{
  const { loader, state } = stubArchive({ names: NAMES, unlocksWith: null, encrypted: false });
  const { openArchiveUnlocked } = build(loader, readError, getFileExtension);
  const result = await openArchiveUnlocked(file('plain.zip'), ['unused'], 'scan', 'remedy');
  check('an unencrypted archive opens on the first try', result.usedPassword === null);
  check('it returns the entries', result.entries.length === 2);
  check('usePassword is never called on it', state.usePasswordCalls.length === 0,
    'got ' + JSON.stringify(state.usePasswordCalls));
  check('it is NOT probed - nothing encrypted means nothing to validate', state.probes === 0,
    'a probe here costs a decrypt on every ordinary drop, and misreports read errors as password errors');
  check('the caller owns closing it, so it is left open', state.closed === 0);
}

// -- data-encrypted: lists fine under any password, fails at the probe ------
{
  const { loader, state } = stubArchive({ names: NAMES, unlocksWith: PW, encrypted: true });
  const { openArchiveUnlocked } = build(loader, readError, getFileExtension);
  const result = await openArchiveUnlocked(file('locked.zip'), ['wrong', PW], 'scan', 'remedy');
  check('a data-encrypted archive is unlocked by the password that works',
    result.usedPassword === PW, 'got ' + result.usedPassword);
  check('a successful listing alone is not trusted as unlocked', state.probes >= 2,
    'only ' + state.probes + ' probe(s) - a wrong password would have been accepted');
  check('the archive is opened exactly ONCE across every attempt', state.opens === 1,
    'opened ' + state.opens + ' times - re-opening is unrar\'s constraint, not libarchive\'s');
  check('every candidate password was tried in order',
    JSON.stringify(state.usePasswordCalls) === JSON.stringify(['wrong', PW]),
    'got ' + JSON.stringify(state.usePasswordCalls));
}

// -- header-encrypted: refuses to list at all without the password ----------
{
  const { loader, state } = stubArchive({
    names: NAMES, unlocksWith: PW, encrypted: true, failListUnless: PW
  });
  const { openArchiveUnlocked } = build(loader, readError, getFileExtension);
  const result = await openArchiveUnlocked(file('locked.rar'), ['nope', PW], 'scan', 'remedy');
  check('a header-encrypted archive is unlocked despite listing failures',
    result.usedPassword === PW, 'got ' + result.usedPassword);
  check('a failed listing does not abort the remaining passwords', state.opens === 1);
}

// -- nothing opens it -------------------------------------------------------
{
  const { loader, state } = stubArchive({ names: NAMES, unlocksWith: PW, encrypted: true });
  const { openArchiveUnlocked } = build(loader, readError, getFileExtension);
  let threw = null;
  try { await openArchiveUnlocked(file('locked.zip'), ['a', 'b'], 'scan', 'remedy'); }
  catch (e) { threw = e; }
  check('it throws when no password works', threw !== null);
  check('the error is flagged archiveLocked', threw?.archiveLocked === true);
  check('the archive is closed rather than leaked', state.closed === 1,
    'closed ' + state.closed + ' times');
  check('the message says how many passwords were tried',
    /none of your 2 saved passwords/.test(threw?.message || ''), 'got ' + threw?.message);
  check('the message never leaks the engine\'s decompression garbage',
    !/block header|Huffman|checksum error/i.test(threw?.message || ''),
    'got ' + threw?.message);
  check('a locked archive is tagged archiveWasRead so RAR never falls back to unrar',
    threw?.archiveWasRead === true,
    'the dispatcher would re-read a multi-GB archive through unrar to fail again');
}

// -- the message the user sees ---------------------------------------------
{
  const { archiveLockedError } = build(async () => ({}), readError, getFileExtension);
  const none = archiveLockedError(file('locked.rar'), []);
  check('with no passwords saved it tells the user where to add one',
    /add the password under VPX Password/.test(none.message), 'got ' + none.message);
  const one = archiveLockedError(file('locked.rar'), ['x']);
  check('one saved password is singular, not "1 passwords"',
    /your 1 saved password\b/.test(one.message) && !/passwords/.test(one.message),
    'got ' + one.message);
  const sevenZip = archiveLockedError(file('locked.7z'), ['x']);
  check('an encrypted 7z says so plainly instead of blaming the password',
    /7z archives cannot be opened/.test(sevenZip.message), 'got ' + sevenZip.message);
  check('the 7z message tells the user what to do instead',
    /extract it and drop the file from inside/.test(sevenZip.message), 'got ' + sevenZip.message);
  const upper = archiveLockedError(file('LOCKED.7Z'), []);
  check('the 7z check is case-insensitive',
    /7z archives cannot be opened/.test(upper.message), 'got ' + upper.message);
}

// -- a genuine read failure is not a password problem ----------------------
{
  const solid = new Error('RAR solid archive support unavailable');
  const archive = {
    async usePassword() {},
    async hasEncryptedData() { return false; },
    async getFilesArray() { throw solid; },
    async close() { closed += 1; }
  };
  let closed = 0;
  const loader = async () => ({ open: async () => archive });
  const { openArchiveUnlocked } = build(loader, readError, getFileExtension);
  let threw = null;
  try { await openArchiveUnlocked(file('solid.rar'), [PW], 'scan', 'drop the file inside'); }
  catch (e) { threw = e; }
  check('a solid-RAR4 refusal is NOT reported as locked', threw?.archiveLocked !== true,
    'it would tell the user to add a password for an archive that needs none');
  check('it is NOT tagged archiveWasRead, so the unrar fallback still runs',
    threw?.archiveWasRead !== true,
    'tagging it would break the solid-RAR4 fallback entirely');
  check('it is wrapped for the user', /Could not scan "solid\.rar"/.test(threw?.message || ''),
    'got ' + threw?.message);
  check('the archive is closed on a genuine failure too', closed === 1, 'closed ' + closed);
}

// -- blank and untrimmed passwords -----------------------------------------
{
  const { loader, state } = stubArchive({ names: NAMES, unlocksWith: PW, encrypted: true });
  const { openArchiveUnlocked } = build(loader, readError, getFileExtension);
  let result = null;
  let threw = null;
  try { result = await openArchiveUnlocked(file('locked.zip'), ['', '   ', '  ' + PW + '  '], 'scan', 'r'); }
  catch (e) { threw = e; }
  check('blank password slots are skipped rather than tried',
    JSON.stringify(state.usePasswordCalls) === JSON.stringify([PW]),
    'got ' + JSON.stringify(state.usePasswordCalls));
  check('a password pasted with stray whitespace still works', result?.usedPassword === PW,
    threw ? 'threw instead: ' + threw.message : 'got ' + JSON.stringify(result?.usedPassword));
}

{
  const { loader } = stubArchive({ names: NAMES, unlocksWith: null, encrypted: false });
  const { openArchiveUnlocked } = build(loader, readError, getFileExtension);
  const result = await openArchiveUnlocked(file('plain.zip'), undefined, 'scan', 'r');
  check('a missing password list is treated as none, not a crash',
    result.usedPassword === null);
}

// -- the open itself failing ------------------------------------------------
{
  const boom = new Error('not an archive');
  const loader = async () => ({ open: async () => { throw boom; } });
  const { openArchiveUnlocked } = build(loader, readError, getFileExtension);
  let threw = null;
  try { await openArchiveUnlocked(file('junk.zip'), [PW], 'browse', 'enter it manually'); }
  catch (e) { threw = e; }
  check('a failure to open at all is wrapped with the caller\'s verb',
    /Could not browse "junk\.zip"/.test(threw?.message || ''), 'got ' + threw?.message);
  check('it is not misreported as locked', threw?.archiveLocked !== true);
}

// -- encryption libarchive has no cipher for (7z) --------------------------
// 7z is the one format that can never be decrypted here. It must be refused in
// our own words, not the engine's, and it must not send the user off to check
// a password that was never the problem. Both of its modes were driven in a
// browser on 2026-08-27 and they fail at DIFFERENT stages, so both are covered.
const NO_CIPHER_LISTING = 'The archive header is encrypted, but currently not supported';
const NO_CIPHER_ENTRY = 'The file content is encrypted, but currently not supported';

{
  const { isUnsupportedEncryptionError } = build(async () => ({}), readError, getFileExtension);
  check('recognises the header-encrypted 7z refusal',
    isUnsupportedEncryptionError(new Error(NO_CIPHER_LISTING)));
  check('recognises the content-encrypted 7z refusal',
    isUnsupportedEncryptionError(new Error(NO_CIPHER_ENTRY)));
  check('does NOT treat a wrong password as unsupported',
    !isUnsupportedEncryptionError(new Error('Incorrect passphrase')),
    'a wrong password would stop the retry loop dead');
}

{
  // Plain-AES 7z: lists fine, and hasEncryptedData() LIES by returning false,
  // so the probe is the only thing standing between the user and the engine's
  // own error text. Measured: this is exactly what enc-7z.7z does.
  let probes = 0;
  let closed = 0;
  const archive = {
    async usePassword() {},
    async hasEncryptedData() { return false; },
    async getFilesArray() {
      return [{ path: '', file: { name: 'readme.txt', size: 32,
        async extract() { probes += 1; throw new Error(NO_CIPHER_ENTRY); } } }];
    },
    async close() { closed += 1; }
  };
  const { openArchiveUnlocked } = build(async () => ({ open: async () => archive }), readError, getFileExtension);
  let threw = null;
  try { await openArchiveUnlocked(file('locked.7z'), ['a', 'b', 'c'], 'scan', 'r'); }
  catch (e) { threw = e; }
  check('a .7z is probed even though hasEncryptedData() says false',
    probes >= 1, 'not probed - the engine error would reach the user verbatim');
  check('an undecryptable 7z is reported in our words, not the engine\'s',
    /7z archives cannot be opened/.test(threw?.message || ''), 'got ' + threw?.message);
  check('it never leaks "currently not supported" to the user',
    !/currently not supported/.test(threw?.message || ''), 'got ' + threw?.message);
  check('it stops at the first password instead of grinding the whole list',
    probes === 1, 'probed ' + probes + ' times for an archive no password can open');
  check('the archive is closed', closed === 1, 'closed ' + closed);
}

{
  // Header-encrypted 7z (-mhe=on) refuses at LISTING, a different stage.
  let closed = 0;
  const archive = {
    async usePassword() {},
    async hasEncryptedData() { return true; },
    async getFilesArray() { throw new Error(NO_CIPHER_LISTING); },
    async close() { closed += 1; }
  };
  const { openArchiveUnlocked } = build(async () => ({ open: async () => archive }), readError, getFileExtension);
  let threw = null;
  try { await openArchiveUnlocked(file('locked.7z'), ['a'], 'scan', 'r'); }
  catch (e) { threw = e; }
  check('a header-encrypted 7z is caught at the listing stage too',
    /7z archives cannot be opened/.test(threw?.message || ''), 'got ' + threw?.message);
  check('it is flagged archiveLocked like any other unopenable archive',
    threw?.archiveLocked === true);
  check('the archive is closed on the listing-stage refusal', closed === 1, 'closed ' + closed);
}

// -- PLAIN passwords reach the engine, never the base64 --------------------
// vpxMagic has two jobs and they must not be confused. The YML carries the
// password BASE64-ENCODED (that is output). The archive engine needs the
// ORIGINAL text the user typed. collectVpxMagic returns the plain values and
// encoding happens only in the serializer, so the drop handlers must call
// collectVpxMagic - never buildVpxMagicOutput or encodeVpxMagic.
//
// Verified in a browser 2026-08-27: the plain value decrypts a real encrypted
// RAR and the base64 of it does not, so getting this wrong is silent and total
// - every protected archive would refuse with a password the user can see is
// correct in the field. Nothing pinned it until this block.
{
  const callSites = source.match(/passwords:\s*collectVpxMagic\(values\)/g) || [];
  check('the checksum-drop call sites pass the PLAIN passwords',
    callSites.length === 2,
    'found ' + callSites.length + ' - expected the checksum scan drop and the Color ROM drop');
  check('the archive browse passes the plain passwords too',
    source.includes('readArchiveDirectories(file, collectVpxMagic(values))'),
    'the directory picker would fail on an encrypted archive');
  check('nothing hands the ENCODED form to an archive reader',
    !/passwords:\s*(buildVpxMagicOutput|.*encodeVpxMagic)/.test(source),
    'an encoded password decrypts nothing - every protected archive would refuse');
  check('uiHelper imports collectVpxMagic, not the encoder',
    /collectVpxMagic\s*\n?\s*\}\s*=\s*window\.VPS_UTILS/.test(source)
    || /collectVpxMagic,?\s*\n/.test(source.slice(0, 2000)),
    'the destructure at the top of uiHelper.js no longer pulls in collectVpxMagic');
}

// -- unrar's half of it -----------------------------------------------------
// The solid-RAR4 fallback is the ONLY path libarchive cannot serve, so if it
// ignores the saved passwords then an encrypted solid RAR4 is unopenable no
// matter what the user types. unrar differs from libarchive in one way that
// matters: it fixes the password at construction, so each attempt needs a new
// extractor. That must NOT turn into a second read of the file.
const RAR_START = '  async function extractRarEntries(file, selectNames, options = {}) {';
const rarStart = source.indexOf(RAR_START);
check('extractRarEntries was located in uiHelper.js', rarStart !== -1 && rarStart < start,
  'marker moved - update the slice in this test');
const rarBlock = source.slice(rarStart, start);

const buildRar = (loadUnrarModule, isPassphraseError, archiveLockedError) =>
  new Function('loadUnrarModule', 'isPassphraseError', 'archiveLockedError',
    rarBlock + '\n; return extractRarEntries;')(
    loadUnrarModule, isPassphraseError, archiveLockedError);

const helpers = build(async () => ({}), readError, getFileExtension);

// A file whose whole-file read is counted, because that read is the size
// ceiling this engine carries and it must happen at most once.
function countedFile(name) {
  const handle = { name, size: 4096, reads: 0 };
  handle.arrayBuffer = async () => { handle.reads += 1; return new ArrayBuffer(8); };
  return handle;
}

function unrarStub(requiredPassword) {
  const constructions = [];
  const module = {
    async createExtractorFromData({ password }) {
      constructions.push(password === undefined ? null : password);
      return {
        getFileList: () => ({ fileHeaders: [{ name: 'Top/TheMatrix.vpx' }, { name: 'readme.txt' }] }),
        extract: ({ files }) => {
          if (requiredPassword && password !== requiredPassword) {
            const error = new Error('extraction failed');
            error.reason = 'ERAR_BAD_PASSWORD';
            throw error;
          }
          return { files: files.map(n => ({ fileHeader: { name: n }, extraction: new Uint8Array([1, 2, 3]) })) };
        }
      };
    }
  };
  return { loader: async () => ({ module, wasmBinary: null }), constructions };
}

const pickVpx = names => names.filter(n => n.endsWith('.vpx'));

{
  const { loader, constructions } = unrarStub(null);
  const run = buildRar(loader, helpers.isPassphraseError, helpers.archiveLockedError);
  const handle = countedFile('plain.rar');
  const out = await run(handle, pickVpx, {});
  check('an unencrypted RAR extracts on the first attempt', out.length === 1);
  check('no password is passed when none is saved',
    JSON.stringify(constructions) === JSON.stringify([null]),
    'got ' + JSON.stringify(constructions));
  check('the file is read exactly once', handle.reads === 1, 'read ' + handle.reads + ' times');
}

{
  const { loader, constructions } = unrarStub(PW);
  const run = buildRar(loader, helpers.isPassphraseError, helpers.archiveLockedError);
  const handle = countedFile('solid-locked.rar');
  let out = null;
  let threw = null;
  try { out = await run(handle, pickVpx, { passwords: ['wrong', PW] }); }
  catch (e) { threw = e; }
  check('an encrypted solid RAR4 is unlocked by a saved password', out?.length === 1,
    threw ? 'threw instead: ' + threw.message
      + ' - unrar is dropping the passwords, so this archive is unopenable'
      : 'got ' + JSON.stringify(out));
  check('each attempt builds a fresh extractor, as unrar requires',
    JSON.stringify(constructions) === JSON.stringify([null, 'wrong', PW]),
    'got ' + JSON.stringify(constructions));
  check('trying three passwords still reads the file only ONCE', handle.reads === 1,
    'read ' + handle.reads + ' times - the retry loop re-read the archive');
}

{
  const { loader } = unrarStub(PW);
  const run = buildRar(loader, helpers.isPassphraseError, helpers.archiveLockedError);
  let threw = null;
  try { await run(countedFile('locked.rar'), pickVpx, { passwords: ['a', 'b'] }); }
  catch (e) { threw = e; }
  check('a RAR no saved password opens reports as locked', threw?.archiveLocked === true,
    'got ' + threw?.message);
  check('its message counts the passwords tried',
    /none of your 2 saved passwords/.test(threw?.message || ''), 'got ' + threw?.message);
}

{
  // A selector throw is a real answer, not a reason to try the next password.
  const { loader, constructions } = unrarStub(null);
  const run = buildRar(loader, helpers.isPassphraseError, helpers.archiveLockedError);
  const missing = new Error('No .vpx file found inside "pack.rar".');
  let threw = null;
  try {
    await run(countedFile('pack.rar'), () => { throw missing; }, { passwords: ['a', 'b', 'c'] });
  } catch (e) { threw = e; }
  check('a selector error is thrown at once, not retried per password',
    constructions.length === 1, 'built ' + constructions.length + ' extractors');
  check('the selector error reaches the caller unchanged', threw === missing,
    'got ' + threw?.message);
}

report('encrypted archive unlocking');
