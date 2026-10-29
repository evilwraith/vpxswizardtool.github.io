'use strict';
// The BUNDLED DMD shape: one archive holding both the VPX and its DMD pack.
//
// Drives the real bundledPairing config out of js.src/fields.js and the real
// bundled-shape block out of prepareData in js.src/yamlFeatureSupport.js.
//
// What it pins:
//   - vpxChecksum knows where to send the archive's format, folder list and
//     hash when a DMD is bundled into the same file
//   - bundled, vpxArchiveFormat is DERIVED from specialDMDArchiveFormat at
//     write time; the VPX tab's own Archive Format is locked and shows it
//   - outside the bundled shape vpxArchiveFormat is the VPX tab's own value
//     (table-archive mode, table.yml.example), written only when set
//   - the importer recognises the key, so a bundled YML does not come back
//     reporting it as outdated, and restores the DMD format from it
//   - both the build and the field rules demand the checksum PAIR
//
// NOT covered here: the drop handler itself. Hashing an archive twice and
// cross-writing to another tab needs a real browser and a real archive; this
// file pins the wiring and the output shape, and the source-level guards below
// are a drift net, not a substitute for the live check.

const fs = require('fs');
const { check, report, repoPath } = require('./harness');

const FIELDS = repoPath('js.src', 'fields.js');
const YAML = repoPath('js.src', 'yamlFeatureSupport.js');
const UI_HELPER = repoPath('js.src', 'uiHelper.js');
const MAIN = repoPath('js.src', 'main.js');
const RULES = repoPath('js.src', 'validationRules.js');
// The rulebook's build section, sliced on its own. Until 2026-10-15 a field
// section (getFieldErrors' copy) drew the dots and was guarded here for drift
// against it; each build rule now names its field and draws its own dot.
function ruleSection(name, next) {
  const source = fs.readFileSync(RULES, 'utf8');
  const start = source.indexOf('  function ' + name + '(');
  const end = source.indexOf('  function ' + next + '(', start);
  if (start < 0 || end < 0) throw new Error('could not slice ' + name + ' out of validationRules.js');
  return source.slice(start, end);
}
const IMPORT = repoPath('js.src', 'ymlImport.js');

const windowStub = {};
new Function('window', fs.readFileSync(FIELDS, 'utf8'))(windowStub);
const { WIZARD_STEPS, OMIT_FROM_YAML } = windowStub.VPS_YML_FIELDS;

const vpx = WIZARD_STEPS.find(step => step.id === 'vpx');
const dmd = WIZARD_STEPS.find(step => step.id === 'dmd');
const vpxChecksum = vpx.fields.find(field => field.yml_field === 'vpxChecksum');
const pairing = vpxChecksum.bundledPairing;

// 1 ── the pairing config, and that every target it names is real
{
  check('vpxChecksum declares a bundled pairing', Boolean(pairing));
  check('it triggers on specialDMDBundled', pairing.when === 'specialDMDBundled');
  check('it fills the DMD checksum', pairing.checksumField === 'specialDMDChecksum');
  check('it fills the DMD archive format', pairing.formatField === 'specialDMDArchiveFormat');
  check('it fills the DMD archive root picker', pairing.rootField === 'specialDMDArchiveRoot');
  check('it fills the DMD directory list', pairing.directoriesKey === '__dmdArchiveDirectories');

  const dmdKeys = dmd.fields.map(field => field.yml_field);
  [pairing.checksumField, pairing.formatField, pairing.rootField].forEach(key => {
    check(`${key} is a real field on the DMD tab`, dmdKeys.includes(key), JSON.stringify(dmdKeys));
  });
  check('the directory key is the one the DMD picker reads',
    pairing.directoriesKey === '__dmdArchiveDirectories'
    && OMIT_FROM_YAML.has('__dmdArchiveDirectories'));

  check('the VPX checksum still extracts the .vpx from an archive',
    vpxChecksum.archiveScanExtension === '.vpx',
    'the primary hash must stay the inner .vpx, bundled or not');
  check('the VPX checksum is NOT itself an archive browser',
    vpxChecksum.archiveBrowser === undefined,
    'browsing is switched on only by the pairing, so a normal drop is unchanged');
}

// 2 ── bundled, vpxArchiveFormat is derived, not edited
// The VPX tab has its own Archive Format for table-archive mode (no DMD). While
// a DMD is bundled the DMD tab answers the format, so the VPX control is locked
// and only shows that answer - it never asks the same question twice.
{
  const format = vpx.fields.find(field => field.yml_field === 'vpxArchiveFormat');
  check('the VPX tab declares Archive Format', Boolean(format));
  check('it is locked while a DMD is bundled', format?.disabledWhen === 'specialDMDBundled');
  check('it shows the DMD format then', format?.mirrorFrom?.when === 'specialDMDBundled'
    && format?.mirrorFrom?.field === 'specialDMDArchiveFormat' && format?.mirrorFrom?.index === undefined);
  check('no DMD field writes vpxArchiveFormat', !dmd.fields.some(field => field.yml_field === 'vpxArchiveFormat'));
}

// ── the real bundled-shape block out of prepareData ────────────────────────
// Normalised to LF before slicing: js.src is CRLF in the working tree, and
// a multi-line marker built from a JS string literal is LF, so it would
// match nothing.
const yamlSource = fs.readFileSync(YAML, 'utf8').split('\r\n').join('\n');
const start = yamlSource.indexOf('    if (data.specialDMDBundled === true) {');
if (start < 0) throw new Error('bundled-shape block not found');
const endMarker = "    if (!String(data.vpxArchiveFormat || '').trim()) delete data.vpxArchiveFormat;";
const end = yamlSource.indexOf(endMarker, start);
if (end < 0) throw new Error('bundled-shape block end not found');
const block = yamlSource.slice(start, end + endMarker.length);
const applyBundledShape = new Function('data', block + '\n return data;');

// 3 ── the format mirrors across, and only in the bundled shape
{
  const bundled = applyBundledShape({
    specialDMDBundled: true,
    specialDMDArchiveFormat: '7z',
    specialDMDType: 'FlexDMD'
  });
  check('a bundled build writes vpxArchiveFormat', bundled.vpxArchiveFormat === '7z',
    String(bundled.vpxArchiveFormat));
  // The DMD Archive Format field is a STORE in this shape, not an output key:
  // one archive, so the format is written once, as vpxArchiveFormat. (Note this
  // departs from new-YML-updates.txt, which lists specialDMDArchiveFormat as
  // required when bundled - Jason overruled the spec text on 2026-08-26.)
  check('the DMD format key itself is NOT written when bundled',
    !('specialDMDArchiveFormat' in bundled), String(bundled.specialDMDArchiveFormat));

  const standalone = applyBundledShape({
    specialDMDBundled: false,
    specialDMDArchiveFormat: 'zip'
  });
  check('a standalone DMD writes NO vpxArchiveFormat of its own',
    !('vpxArchiveFormat' in standalone), String(standalone.vpxArchiveFormat));

  // Table-archive mode: the VPX tab's Archive Format, no DMD bundled.
  const tableArchive = applyBundledShape({ specialDMDBundled: false, vpxArchiveFormat: 'rar' });
  check('the VPX tab\'s own Archive Format is written outside the bundled shape',
    tableArchive.vpxArchiveFormat === 'rar', String(tableArchive.vpxArchiveFormat));
  const blank = applyBundledShape({ vpxArchiveFormat: '' });
  check('a blank VPX Archive Format writes nothing', !('vpxArchiveFormat' in blank));

  const noFormat = applyBundledShape({ specialDMDBundled: true });
  check('no DMD format means no mirrored key at all',
    !('vpxArchiveFormat' in noFormat),
    'an empty string would serialize as a present-but-blank key');

  const rar = applyBundledShape({ specialDMDBundled: true, specialDMDArchiveFormat: 'rar' });
  check('the mirror carries whatever the DMD format says', rar.vpxArchiveFormat === 'rar');
}

// 4 ── the bundled build still drops the DMD's own checksum
{
  const out = applyBundledShape({
    specialDMDBundled: true,
    specialDMDArchiveFormat: 'zip',
    specialDMDChecksum: 'D'.repeat(32)
  });
  check('specialDMDChecksum is displayed but never written',
    !('specialDMDChecksum' in out),
    'the archive hash goes into the vpxChecksum list instead');
}

// 5 ── the importer knows the key
// It is a VPX field now, so allSupportedKeys picks it up like any other; the
// DMD's own format is never written when bundled, so it is read back from it.
{
  const importSource = fs.readFileSync(IMPORT, 'utf8');
  check('vpxArchiveFormat is a declared field, so import supports it',
    vpx.fields.some(field => field.yml_field === 'vpxArchiveFormat'),
    'otherwise a bundled YML imports with it flagged outdated and stripped');
  check('a bundled import restores the DMD format from vpxArchiveFormat',
    importSource.includes('values.specialDMDArchiveFormat = values.vpxArchiveFormat;'),
    'without it a re-imported bundled DMD reports DMD Archive Format required');
}

// 6 ── both rule sections demand the pair
{
  const buildRules = ruleSection('buildIssues', 'featureIssues');
  check('the build rules check vpxChecksum length when bundled',
    buildRules.includes('normalizeChecksumValue(values.vpxChecksum).length < 2'),
    'the blocking rules must refuse a single checksum in the bundled shape');
  check('the build rules file that error against the vpx tab',
    /addError\('vpx', 'Bundled DMD needs both checksums'/.test(buildRules));
  check('the build rule draws its dot on vpxChecksum',
    buildRules.includes("alongside the .vpx MD5.', 'vpxChecksum')"));
}

// 7 ── the drop handler is wired, as a drift net only
{
  const ui = fs.readFileSync(UI_HELPER, 'utf8');
  check('the handler reads the pairing off the field', ui.includes('field.bundledPairing'));
  check('a second whole-archive hash is calculated', ui.includes('pairedHashTask'));
  check('the pair is written as a two-item list',
    ui.includes('[checksumResult.value.checksum, pairedHash]'));
  // The DMD checksum is a VIEW of vpxChecksum[1], never a stored copy - that is
  // what makes a hand edit of the VPX additional checksum show up on the DMD
  // tab instead of the two quietly disagreeing.
  check('the archive hash is NOT stored a second time',
    !ui.includes('onChange(pairing.checksumField'),
    'storing a copy is how the two values drift apart');
  const dmdChecksumField = dmd.fields.find(f => f.yml_field === 'specialDMDChecksum');
  check('the DMD checksum mirrors another field', Boolean(dmdChecksumField.mirrorFrom));
  check('it mirrors vpxChecksum', dmdChecksumField.mirrorFrom.field === 'vpxChecksum');
  check('it mirrors the SECOND entry - the archive hash',
    dmdChecksumField.mirrorFrom.index === 1);
  check('it only mirrors in the bundled shape',
    dmdChecksumField.mirrorFrom.when === 'specialDMDBundled');
  // Matched exactly, not as a loose substring: `field.mirrorFrom` on its own
  // still appears in a version of this line that has been disabled, so a
  // vaguer check passes against code that no longer works.
  check('the renderer honours mirrorFrom',
    ui.includes('const mirror = field.mirrorFrom && values[field.mirrorFrom.when] === true'),
    'the mirror must actually be consulted, not merely mentioned');

  // An archive with no folders in it is a .vpx in a zip, not a bundle.
  check('no folders means no second hash', ui.includes('pairedDirectories.length'));
  // The format cross-write has to sit BEHIND that gate too. It used to run up
  // front, off the file extension alone, so a folderless archive still pushed a
  // format onto the DMD tab.
  check('the format is written after the folder check, not before',
    ui.indexOf('onChange(pairing.formatField') > ui.indexOf('const pairedDirectories'),
    'a folderless archive must set nothing at all');
  check('the format write is inside the paired branch',
    ui.indexOf('onChange(pairing.formatField')
      > ui.indexOf('onChange(field.yml_field, [checksumResult.value.checksum, pairedHash]'),
    'it belongs with the pair, not with the drop');
  check('folders are browsed for a bundled drop too',
    ui.includes('field.archiveBrowser || pairing'));
  check('the folder list crosses to the DMD key',
    ui.includes('pairing ? pairing.directoriesKey'));
  check('the DMD picker is the one repainted',
    ui.includes('pairing ? pairing.rootField'));
  check('an ordinary drop still takes the old path',
    ui.includes('replacePrimaryChecksum(values[field.yml_field], checksumResult.value.checksum)'),
    'the non-bundled branch must survive - it is what is live today');
}

// 8 ── import: the two values no control can carry back
// Both were losing data on a bundled round-trip. setField returns early on a
// readonly field, so specialDMDType never arrived - and with no type the DMD
// tab stays disabled, so loadImportedFields skipped every field on it. A
// control also holds one string, so vpxChecksum's second entry was flattened
// away the moment its input event fired.
{
  const imp = fs.readFileSync(IMPORT, 'utf8');

  check('the DMD type is set through its asset row',
    imp.includes('data-category="specialDMD"'),
    'setField skips readonly fields, so the tab field cannot carry it');
  check('...and BEFORE loadImportedFields, or the tab is still disabled',
    imp.indexOf('data-category="specialDMD"') < imp.indexOf('await loadImportedFields(values)'),
    'a disabled tab has all of its fields skipped');

  check('list values are restored straight to state', imp.includes('restoreListValues(values);'));
  check('...AFTER loadImportedFields, once the controls have had their turn',
    imp.indexOf('restoreListValues(values);') > imp.indexOf('await loadImportedFields(values)'));
  // The exact guard, not a loose substring: fieldValueForControl contains
  // `field.type === 'array'` too, so a vaguer check stays green even after the
  // exemption is deleted.
  check('array-typed fields are exempt from that restore',
    imp.includes("if (!field || field.type === 'array') return;"),
    'testers and author overrides round-trip correctly as comma strings');
  check('single values are left alone', imp.includes('value.length < 2'),
    'only a genuine list needs rescuing');
  check('the additional-checksum UI is repainted afterwards',
    imp.includes('VPS_CHECKSUM_ADDITIONAL'),
    'otherwise the restored second checksum is in state but invisible');
}

// 9 ── leaving the bundled shape releases the entry it borrowed on the VPX tab
// Drives the REAL liveMirrors and clearShapeDisabledFields, sliced out of the
// shipped js.src/main.js at run time. Nothing here is a copy of the logic.
//
// The bug this pins: bundled, the DMD checksum is a VIEW of vpxChecksum's
// second entry, so the archive MD5 physically lives on the VPX tab. Switching
// to Override cleared the whole DMD side and left that hash behind as an
// "additional checksum" for an archive the build no longer bundles into.
//
// The subtle half is WHEN the mirror list is read. Read after the switch, the
// code cannot tell "just left the bundled shape" from "was never in it", and
// the second case would eat a hand-entered additional checksum.
{
  const mainSource = fs.readFileSync(MAIN, 'utf8');
  const START = "  // Which of a step's mirrored fields are live right now.";
  const start = mainSource.indexOf(START);
  const anchor = mainSource.indexOf('if (field.archiveFormatField) delete', start);
  const blockEnd = mainSource.indexOf('\n  }', anchor) + '\n  }'.length;
  const block = mainSource.slice(start, blockEnd);

  check('the shape-switch block was located in main.js',
    start !== -1 && anchor !== -1
    && block.includes('function liveMirrors')
    && block.includes('function clearShapeDisabledFields'),
    'markers moved — update the slice in this test');

  const build = state => new Function('state',
    block + '\n; return { liveMirrors, clearShapeDisabledFields };')(state);

  // The two real handlers in main.js do exactly this, in exactly this order.
  // Reproduced here rather than sliced because they also renderWorkspace().
  function toggle(values, step, fieldName, checked) {
    const state = { values };
    const { liveMirrors, clearShapeDisabledFields } = build(state);
    const mirrorsBefore = liveMirrors(step);
    state.values[fieldName] = checked;
    const partner = fieldName === step.bundleField ? step.overrideField : step.bundleField;
    if (checked && partner) state.values[partner] = false;
    clearShapeDisabledFields(step, mirrorsBefore);
    return state.values;
  }

  const bundledState = () => ({
    specialDMDBundled: true,
    specialDMDType: 'FlexDMD',
    specialDMDArchiveRoot: 'DMD/',
    specialDMDArchiveFormat: 'zip',
    __dmdArchiveDirectories: ['DMD/'],
    vpxChecksum: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']
  });

  // ── Bundled → Override: the reported bug
  {
    const values = toggle(bundledState(), dmd, 'specialDMDOverride', true);
    check('Bundled → Override drops the borrowed archive MD5',
      values.vpxChecksum === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'got ' + JSON.stringify(values.vpxChecksum));
    check('...collapsing a one-entry list back to a plain string',
      typeof values.vpxChecksum === 'string',
      'an array of one would still render an empty additional-checksum row');
    check('...and the DMD side still clears with it',
      values.specialDMDArchiveRoot === undefined
      && values.specialDMDArchiveFormat === undefined
      && values.__dmdArchiveDirectories === undefined);
  }

  // ── Bundled → neither: unticking Bundled is the same departure
  {
    const values = toggle(bundledState(), dmd, 'specialDMDBundled', false);
    check('unticking Bundled drops it too',
      values.vpxChecksum === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'got ' + JSON.stringify(values.vpxChecksum));
  }

  // ── entering the shape must not touch the VPX tab
  {
    const values = toggle({
      specialDMDOverride: true,
      specialDMDChecksum: 'cccccccccccccccccccccccccccccccc',
      vpxChecksum: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    }, dmd, 'specialDMDBundled', true);
    check('Override → Bundled leaves vpxChecksum alone',
      values.vpxChecksum === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    check('...and still clears the DMD checksum the new shape cannot carry',
      values.specialDMDChecksum === undefined);
  }

  // ── the precision guard: a shape the user was never in
  // This is what the before-the-switch capture buys. Without it, unticking
  // Override on a table that never bundled anything would eat a hand-entered
  // additional VPX checksum.
  {
    const values = toggle({
      specialDMDOverride: true,
      vpxChecksum: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'dddddddddddddddddddddddddddddddd']
    }, dmd, 'specialDMDOverride', false);
    check('a hand-entered additional checksum survives a shape the user never bundled in',
      Array.isArray(values.vpxChecksum) && values.vpxChecksum.length === 2
      && values.vpxChecksum[1] === 'dddddddddddddddddddddddddddddddd',
      'got ' + JSON.stringify(values.vpxChecksum));
  }

  // ── only the borrowed slot goes
  {
    const values = toggle({
      specialDMDBundled: true,
      vpxChecksum: [
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
      ]
    }, dmd, 'specialDMDOverride', true);
    check('a third checksum is not collateral damage',
      Array.isArray(values.vpxChecksum) && values.vpxChecksum.length === 2
      && values.vpxChecksum[0] === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      && values.vpxChecksum[1] === 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      'got ' + JSON.stringify(values.vpxChecksum));
  }

  // ── the pair was never completed
  {
    const values = toggle({
      specialDMDBundled: true,
      vpxChecksum: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    }, dmd, 'specialDMDOverride', true);
    check('a lone primary is left exactly as it was',
      values.vpxChecksum === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  }

  // ── a step with no mirror keeps its hands off
  {
    const pup = WIZARD_STEPS.find(step => step.id === 'pup');
    const values = toggle({
      pupBundled: true,
      vpxChecksum: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']
    }, pup, 'pupBundled', false);
    check('a PUP toggle never reaches the VPX checksum',
      Array.isArray(values.vpxChecksum) && values.vpxChecksum.length === 2,
      'got ' + JSON.stringify(values.vpxChecksum));
  }

  // ── the ordering, in the shipped handlers
  // The behaviour above is only correct because both handlers read the mirror
  // list before they move the shape. A future edit that hoists the assignment
  // back above it would pass every check above and still be wrong.
  ['handleBundleChange', 'handleOverrideChange'].forEach(name => {
    const from = mainSource.indexOf('function ' + name + '(');
    const body = mainSource.slice(from, mainSource.indexOf('renderWorkspace();', from));
    check(name + ' reads liveMirrors before it moves the shape',
      from !== -1
      && body.indexOf('liveMirrors(step)') !== -1
      && body.indexOf('liveMirrors(step)') < body.indexOf('state.values[fieldName] = checked'),
      'capturing after the switch cannot tell "just left" from "never entered"');
    check(name + ' passes the captured list on',
      body.includes('clearShapeDisabledFields(step, mirrorsBefore)'));
  });
}

report('bundled DMD');
