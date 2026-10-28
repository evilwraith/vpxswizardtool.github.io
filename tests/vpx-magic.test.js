'use strict';
// Drives the REAL vpxMagic codec and the REAL serializeScalar, both sliced out
// of shipped source at run time so they cannot drift from the app.
//
// vpxMagic is the "Password" field on the VPX tab: plain text in the builder,
// base64 in the generated YML.

const fs = require('fs');
const { check, report, repoPath } = require('./harness');

const UTILS_PATH = repoPath('js.src', 'utilities.js');
const YAML_PATH = repoPath('js.src', 'yamlFeatureSupport.js');

// ── slice: the codec out of utilities.js ───────────────────────────────────
function sliceFunction(source, declaration) {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`not found in source: ${declaration}`);
  const end = source.indexOf('\n  }', start) + 4;
  return source.slice(start, end);
}

const utilsSource = fs.readFileSync(UTILS_PATH, 'utf8');
const codec = new Function(
  sliceFunction(utilsSource, '  function encodeVpxMagic(value) {')
  + '\n'
  + sliceFunction(utilsSource, '  function decodeVpxMagic(value) {')
  + '\n return { encodeVpxMagic, decodeVpxMagic };'
)();

// ── slice: serializeScalar (plus the real UNFOLDABLE_KEYS) ─────────────────
const yamlSource = fs.readFileSync(YAML_PATH, 'utf8');
const unfoldableDecl = yamlSource.match(/ {2}const UNFOLDABLE_KEYS = new Set\(\[[^\]]*\]\);/);
if (!unfoldableDecl) throw new Error('UNFOLDABLE_KEYS not found in yamlFeatureSupport.js');

const serialize = new Function('wrapText', 'URL_FIELD_NAMES',
  unfoldableDecl[0] + '\n'
  + sliceFunction(yamlSource, '  function cleanYamlString(value) {') + '\n'
  + sliceFunction(yamlSource, '  function isUrlField(name) {') + '\n'
  + sliceFunction(yamlSource, '  function serializeScalar(name, value, indent = \'\') {') + '\n'
  + ' return { serializeScalar, UNFOLDABLE_KEYS };'
)(sliceRealWrapText(), new Set());

function sliceRealWrapText() {
  return new Function(sliceFunction(utilsSource, '  function wrapText(text, maxLength = 120) {')
    + '\n return wrapText;')();
}

const { encodeVpxMagic, decodeVpxMagic } = codec;
const { serializeScalar, UNFOLDABLE_KEYS } = serialize;

// 1 ── plain ASCII encodes to base64
{
  check('ascii encodes', encodeVpxMagic('hunter2') === Buffer.from('hunter2', 'utf8').toString('base64'),
    encodeVpxMagic('hunter2'));
  check('encoded value is not the plain text', encodeVpxMagic('hunter2') !== 'hunter2');
}

// 2 ── non-Latin1 does not throw (btoa alone would)
{
  const samples = ['pässwörd', 'пароль', '密码', 'pass🔑word'];
  samples.forEach(sample => {
    let threw = false;
    let encoded = '';
    try { encoded = encodeVpxMagic(sample); } catch (_) { threw = true; }
    check(`"${sample}" encodes without throwing`, threw === false,
      'btoa throws above U+00FF — the TextEncoder step is what prevents this');
    check(`"${sample}" round-trips`, decodeVpxMagic(encoded) === sample, `got ${decodeVpxMagic(encoded)}`);
  });
}

// 3 ── empty and whitespace-only produce nothing to write
{
  check('empty encodes to empty', encodeVpxMagic('') === '');
  check('whitespace encodes to empty', encodeVpxMagic('   ') === '');
  check('undefined encodes to empty', encodeVpxMagic(undefined) === '');
  check('null encodes to empty', encodeVpxMagic(null) === '');
  check('empty decodes to empty', decodeVpxMagic('') === '');
}

// 4 ── the value is trimmed before encoding
{
  check('surrounding whitespace is trimmed', encodeVpxMagic('  hunter2  ') === encodeVpxMagic('hunter2'));
}

// 5 ── THE ROUND-TRIP BUG: importing an encoded YML must not re-encode it
{
  const original = 'MyT@ble!2026';
  const encoded = encodeVpxMagic(original);
  check('decode undoes encode', decodeVpxMagic(encoded) === original, decodeVpxMagic(encoded));
  check('re-encoding the decoded value is stable', encodeVpxMagic(decodeVpxMagic(encoded)) === encoded,
    'import then download would otherwise double-encode');
}

// 6 ── plain text that atob will happily mangle is left alone
{
  // "password" is 8 chars of valid base64 alphabet, so atob decodes it to
  // garbage rather than throwing. The re-encode check is what catches it.
  check('atob does decode "password" to garbage', Buffer.from('password', 'base64').length > 0);
  check('but decodeVpxMagic leaves it as typed', decodeVpxMagic('password') === 'password',
    'a hand-written plain-text YML value must survive import unchanged');
  check('a non-base64 value is left alone', decodeVpxMagic('my table pass!') === 'my table pass!');

  // "password" is actually rejected by the fatal UTF-8 decoder, not by the
  // re-encode check. This pair is what pins the re-encode check itself:
  // unpadded base64 decodes cleanly to valid UTF-8, but does not re-encode to
  // itself, so it must be treated as plain text rather than silently "fixed".
  check('non-canonical (unpadded) base64 is left as typed',
    decodeVpxMagic('aGVsbG8') === 'aGVsbG8',
    'the re-encode check is the only thing that distinguishes this case');
  check('canonical base64 of the same value does decode',
    decodeVpxMagic('aGVsbG8=') === 'hello', decodeVpxMagic('aGVsbG8='));
}

// 7 ── vpxMagic is declared unfoldable
{
  check('vpxMagic is in UNFOLDABLE_KEYS', UNFOLDABLE_KEYS.has('vpxMagic') === true);
}

// 8 ── a long base64 payload is never folded across lines
{
  const long = encodeVpxMagic('x'.repeat(200));
  check('the payload really is over the fold threshold', long.length > 120, `${long.length} chars`);

  const line = serializeScalar('vpxMagic', long);
  check('long vpxMagic is not folded', line.includes('>-') === false,
    'a folded scalar rejoins with spaces, which would corrupt the base64');
  check('long vpxMagic stays on one quoted line',
    line.includes(`vpxMagic: "${long}"`) === true, line);
  check('long vpxMagic carries the yamllint suppression',
    line.startsWith('# yamllint disable-line rule:line-length\n'), line.split('\n')[0]);
  // Null-safe on purpose: if the value ever does fold, this must report a
  // clean assertion failure rather than throwing and erroring the whole file.
  const captured = line.match(/vpxMagic: "([^"]*)"/);
  check('the value survives serialization intact',
    Boolean(captured) && captured[1] === long, captured ? captured[1] : '(folded — no single-line match)');
}

// 9 ── a short one is a plain quoted line with no suppression comment
{
  const short = encodeVpxMagic('hunter2');
  const line = serializeScalar('vpxMagic', short);
  check('short vpxMagic is a plain line', line === `vpxMagic: "${short}"\n`, JSON.stringify(line));
  check('short vpxMagic has no yamllint comment', line.includes('yamllint') === false);
}

// 10 ── CONTROL: an ordinary long string still folds, so the change is targeted
{
  const prose = 'word '.repeat(40).trim();
  const line = serializeScalar('tableNotes', prose);
  check('ordinary long text still folds', line.includes('tableNotes: >-') === true,
    'the unfoldable rule must not leak onto every other field');
}

// ── slice: the multi-password slot mapping ─────────────────────────────────
// The builder holds up to four slots; the YML carries one key. These three
// functions are the whole mapping, so they are sliced and driven directly.
const inlineKeysDecl = utilsSource.match(/ {2}const VPX_MAGIC_INLINE_KEYS = \[[^\]]*\];/);
if (!inlineKeysDecl) throw new Error('VPX_MAGIC_INLINE_KEYS not found in utilities.js');

const slots = new Function(
  inlineKeysDecl[0] + '\n'
  + sliceFunction(utilsSource, '  function encodeVpxMagic(value) {') + '\n'
  + sliceFunction(utilsSource, '  function collectVpxMagic(values) {') + '\n'
  + sliceFunction(utilsSource, '  function distributeVpxMagic(list, values) {') + '\n'
  + sliceFunction(utilsSource, '  function buildVpxMagicOutput(values) {') + '\n'
  + ' return { collectVpxMagic, distributeVpxMagic, buildVpxMagicOutput };'
)();
const { collectVpxMagic, distributeVpxMagic, buildVpxMagicOutput } = slots;

// 11 ── collect walks the slots in order and drops blanks
{
  check('collect returns nothing for empty state', collectVpxMagic({}).length === 0);
  check('collect returns nothing for null', collectVpxMagic(null).length === 0);
  check('one slot -> one password',
    JSON.stringify(collectVpxMagic({ vpxMagic: 'a' })) === '["a"]');
  check('slots come back in order',
    JSON.stringify(collectVpxMagic({ vpxMagic: 'a', vpxMagic2: 'b', vpxMagic3: 'c' })) === '["a","b","c"]');
  check('the overflow list comes last',
    JSON.stringify(collectVpxMagic({
      vpxMagic: 'a', vpxMagic2: 'b', vpxMagic3: 'c', vpxMagicAdditional: ['d', 'e']
    })) === '["a","b","c","d","e"]');
  check('a blank middle slot is dropped, not stranded',
    JSON.stringify(collectVpxMagic({ vpxMagic: 'a', vpxMagic2: '   ', vpxMagic3: 'c' })) === '["a","c"]',
    JSON.stringify(collectVpxMagic({ vpxMagic: 'a', vpxMagic2: '   ', vpxMagic3: 'c' })));
  check('passwords are trimmed', JSON.stringify(collectVpxMagic({ vpxMagic: '  a  ' })) === '["a"]');
  check('a non-array overflow value is ignored',
    JSON.stringify(collectVpxMagic({ vpxMagic: 'a', vpxMagicAdditional: 'oops' })) === '["a"]');
}

// 12 ── distribute fills the inline slots first, then overflows
{
  const one = distributeVpxMagic(['a'], {});
  check('one password fills only slot 1', one.vpxMagic === 'a' && !('vpxMagic2' in one));
  check('one password leaves no overflow list', !('vpxMagicAdditional' in one));

  const three = distributeVpxMagic(['a', 'b', 'c'], {});
  check('three passwords fill the three inline slots',
    three.vpxMagic === 'a' && three.vpxMagic2 === 'b' && three.vpxMagic3 === 'c');
  check('three passwords leave no overflow list', !('vpxMagicAdditional' in three));

  const five = distributeVpxMagic(['a', 'b', 'c', 'd', 'e'], {});
  check('the fourth onward overflow into the list',
    JSON.stringify(five.vpxMagicAdditional) === '["d","e"]', JSON.stringify(five.vpxMagicAdditional));
  check('the inline slots are still filled alongside the overflow',
    five.vpxMagic === 'a' && five.vpxMagic2 === 'b' && five.vpxMagic3 === 'c');

  // Importing a smaller set over a larger one must not leave the old tail.
  const stale = { vpxMagic: 'a', vpxMagic2: 'b', vpxMagic3: 'c', vpxMagicAdditional: ['d'] };
  distributeVpxMagic(['z'], stale);
  check('a shorter import clears the slots it does not fill',
    stale.vpxMagic === 'z' && !('vpxMagic2' in stale) && !('vpxMagic3' in stale)
    && !('vpxMagicAdditional' in stale), JSON.stringify(stale));

  check('a bare string is treated as one password',
    distributeVpxMagic('solo', {}).vpxMagic === 'solo');
  const empty = distributeVpxMagic([], { vpxMagic: 'old' });
  check('an empty import clears slot 1 too', !('vpxMagic' in empty));
}

// 13 ── the YML shape: nothing / scalar / list
{
  check('no passwords writes no key', buildVpxMagicOutput({}) === undefined);
  check('a blank password writes no key', buildVpxMagicOutput({ vpxMagic: '  ' }) === undefined);

  const single = buildVpxMagicOutput({ vpxMagic: 'hunter2' });
  check('ONE password stays a plain string', typeof single === 'string', typeof single);
  check('ONE password is byte-identical to the pre-multi-password output',
    single === encodeVpxMagic('hunter2'),
    'nothing already published may change shape');

  const many = buildVpxMagicOutput({ vpxMagic: 'a', vpxMagic2: 'b' });
  check('TWO passwords become a list', Array.isArray(many) === true);
  check('the list holds both, in order',
    many.length === 2 && many[0] === encodeVpxMagic('a') && many[1] === encodeVpxMagic('b'));
  check('every list entry is encoded, not plain',
    many.every(entry => entry !== 'a' && entry !== 'b'));

  const six = buildVpxMagicOutput({
    vpxMagic: 'a', vpxMagic2: 'b', vpxMagic3: 'c', vpxMagicAdditional: ['d', 'e', 'f']
  });
  check('six passwords all reach the list', six.length === 6, String(six.length));
}

// 14 ── THE ROUND TRIP: type -> write -> import -> compare, every slot count
// A password is the one field where losing a character is unrecoverable:
// nothing downstream can tell a wrong password from a right one.
{
  const pool = ['hunter2', 'pässwörd', 'пароль', '密码', 'pass🔑word', 'a b!c#d$e'];

  for (let count = 1; count <= pool.length; count += 1) {
    const typed = pool.slice(0, count);
    const state = distributeVpxMagic(typed, {});
    const written = buildVpxMagicOutput(state);

    // What the YML would carry, back through the importer's path.
    const raw = Array.isArray(written) ? written : [written];
    const decoded = raw.map(decodeVpxMagic);
    const reimported = distributeVpxMagic(decoded, {});
    const readBack = collectVpxMagic(reimported);

    check(count + ' password(s) survive the full round trip',
      JSON.stringify(readBack) === JSON.stringify(typed),
      'typed ' + JSON.stringify(typed) + ' got ' + JSON.stringify(readBack));

    check(count + ' password(s) re-encode identically (no double-encoding)',
      JSON.stringify(buildVpxMagicOutput(reimported)) === JSON.stringify(written),
      'import then download must not encode a second time');

    check(count + ' password(s): the written value never contains the plain text',
      typed.every(word => !raw.some(entry => String(entry) === word)),
      JSON.stringify(raw));
  }
}

// 15 ── every encoded entry is single-line, so the list writer is safe
{
  // buildYaml's array branch writes `  - "value"` per item with no folding.
  // That is only safe because base64 never contains a newline or a quote.
  const long = buildVpxMagicOutput({ vpxMagic: 'x'.repeat(300), vpxMagic2: 'y'.repeat(300) });
  check('a long multi-password payload is still a list', Array.isArray(long));
  check('no encoded entry contains a newline',
    long.every(entry => !String(entry).includes('\n')));
  check('no encoded entry contains a double quote',
    long.every(entry => !String(entry).includes('"')),
    'the array writer wraps each item in double quotes without escaping');
}

report('vpxMagic codec and serialization');
