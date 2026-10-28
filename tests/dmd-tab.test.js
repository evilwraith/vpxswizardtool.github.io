'use strict';
// Drives the REAL DMD tab definition out of js.src/fields.js, the REAL
// fieldIsDisabled out of js.src/uiHelper.js, and the REAL bundled-shape key
// drop out of js.src/yamlFeatureSupport.js.
//
// What it pins:
//   - the DMD tab is the PUP Pack tab minus its Required checkbox
//   - the two shapes: Type / Archive Root / Archive Format belong to BOTH,
//     while Checksum / Notes / Version / URL Override are standalone-only and
//     are locked out when Bundled is ticked
//   - a value typed before the shape was switched is dropped from the YML
//     rather than leaking, so disabling in the UI is not the only guard
//   - the rulebook's build section names every DMD key and files each
//     error against its own field, which is where its dot is drawn.

const fs = require('fs');
const { check, report, repoPath } = require('./harness');

const FIELDS = repoPath('js.src', 'fields.js');
const UI_HELPER = repoPath('js.src', 'uiHelper.js');
const YAML = repoPath('js.src', 'yamlFeatureSupport.js');
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

// ── the real field definitions ─────────────────────────────────────────────
// fields.js is pure data with no DOM use, so a bare window stub runs it.
const windowStub = {};
new Function('window', fs.readFileSync(FIELDS, 'utf8'))(windowStub);
const { WIZARD_STEPS, CATEGORY_CONFIG, OMIT_FROM_YAML } = windowStub.VPS_YML_FIELDS;

const dmd = WIZARD_STEPS.find(step => step.id === 'dmd');
const pup = WIZARD_STEPS.find(step => step.id === 'pup');
const byKey = key => (dmd.fields || []).find(field => field.yml_field === key);
const keys = (dmd.fields || []).map(field => field.yml_field);

const BOTH_SHAPES = ['specialDMDType', 'specialDMDArchiveRoot', 'specialDMDArchiveFormat'];
const STANDALONE_ONLY = ['specialDMDChecksum', 'specialDMDNotes', 'specialDMDVersion', 'specialDMDUrlOverride'];

// 1 ── the step exists and is wired to the asset row
{
  check('a dmd step exists', Boolean(dmd));
  check('it is unlocked by Bundled', dmd.bundleField === 'specialDMDBundled');
  check('it is unlocked by Override', dmd.overrideField === 'specialDMDOverride');
  check('it also demands a Type before opening', dmd.requiresValue === 'specialDMDType');
  check('it has NO category - a DMD has no VPS entry to select', !dmd.category);
  check('Type is readonly: the asset row owns the value', byKey('specialDMDType').readonly === true);
}

// 2 ── the tab carries every key the spec lists, and nothing else
{
  const expected = [...BOTH_SHAPES, ...STANDALONE_ONLY].sort();
  check('the tab holds exactly the seven spec keys',
    JSON.stringify(keys.slice().sort()) === JSON.stringify(expected),
    JSON.stringify(keys));
  check('field order mirrors the PUP tab (ID first, format last)',
    keys[0] === 'specialDMDType' && keys[keys.length - 1] === 'specialDMDArchiveFormat',
    JSON.stringify(keys));
}

// 3 ── "minus the required checkbox"
{
  check('the PUP tab really does have a Required checkbox (control)',
    pup.fields.some(field => field.yml_field === 'pupRequired'));
  check('the DMD tab has NO Required field',
    !keys.some(key => /required/i.test(key)));
  check('the DMD tab has no boolean field at all',
    !dmd.fields.some(field => field.type === 'bool'));
}

// 4 ── which fields each shape carries
{
  STANDALONE_ONLY.forEach(key => {
    check(`${key} is locked when Bundled`, byKey(key).disabledWhen === 'specialDMDBundled',
      String(byKey(key).disabledWhen));
  });
  BOTH_SHAPES.forEach(key => {
    check(`${key} stays live in BOTH shapes`, byKey(key).disabledWhen === undefined,
      String(byKey(key).disabledWhen));
  });
  check('only the checksum explains itself when locked',
    dmd.fields.filter(field => field.disabledHint).length === 1);
  check('that explanation points at the VPX tab',
    /VPX tab/i.test(byKey('specialDMDChecksum').disabledHint),
    byKey('specialDMDChecksum').disabledHint);
}

// 5 ── the checksum field is the PUP one: archive drop plus folder browsing
{
  const checksum = byKey('specialDMDChecksum');
  const pupChecksum = pup.fields.find(field => field.yml_field === 'pupChecksum');
  check('DMD checksum browses archives, like PUP', checksum.archiveBrowser === true);
  check('it drives its own format field', checksum.archiveFormatField === 'specialDMDArchiveFormat');
  check('it takes the same archive extensions as PUP',
    JSON.stringify(checksum.checksumExtensions) === JSON.stringify(pupChecksum.checksumExtensions),
    JSON.stringify(checksum.checksumExtensions));
  check('it is capped at one MD5 width', checksum.maxlength === 32);
  check('Archive Root offers a directory picker', byKey('specialDMDArchiveRoot').directoryPicker === true);

  const formats = byKey('specialDMDArchiveFormat').options.map(option => option.value).filter(Boolean);
  check('Archive Format offers zip/rar/7z', JSON.stringify(formats) === '["zip","rar","7z"]',
    JSON.stringify(formats));
}

// 6 ── Override requires the download story; Bundled does not
{
  check('overrideRequiredFields names URL Override and Version',
    JSON.stringify((dmd.overrideRequiredFields || []).slice().sort())
    === JSON.stringify(['specialDMDUrlOverride', 'specialDMDVersion']),
    JSON.stringify(dmd.overrideRequiredFields));
}

// 7 ── the asset row config, carried over from piece C
{
  const config = CATEGORY_CONFIG.specialDMD;
  check('the asset row still points at the dmd tab', config.stepId === 'dmd');
  check('it still has no idField', config.idField === undefined);
  check('specialDMDOverride is builder-only and never written',
    OMIT_FROM_YAML.has('specialDMDOverride'));
}

// ── the real fieldIsDisabled ───────────────────────────────────────────────
function sliceFunction(source, declaration) {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`not found: ${declaration}`);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}

const uiSource = fs.readFileSync(UI_HELPER, 'utf8');
const fieldIsDisabled = new Function(
  sliceFunction(uiSource, '  function fieldIsDisabled(field, values) {') + '\n return fieldIsDisabled;'
)();

// 8 ── the three ways a field locks
{
  check('an ordinary field is live', fieldIsDisabled({ yml_field: 'a' }, {}) === false);
  check('field.disabled locks outright', fieldIsDisabled({ disabled: true }, {}) === true);
  check('disabledUnless locks while the flag is absent',
    fieldIsDisabled({ disabledUnless: 'flag' }, {}) === true);
  check('disabledUnless unlocks when the flag is true',
    fieldIsDisabled({ disabledUnless: 'flag' }, { flag: true }) === false);
  check('disabledWhen is live while the flag is absent',
    fieldIsDisabled({ disabledWhen: 'flag' }, {}) === false);
  check('disabledWhen LOCKS when the flag is true',
    fieldIsDisabled({ disabledWhen: 'flag' }, { flag: true }) === true);
  check('disabledWhen ignores a merely truthy flag',
    fieldIsDisabled({ disabledWhen: 'flag' }, { flag: 'yes' }) === false,
    'the shape flags are real booleans; a stray string must not lock a field');

  // The real DMD fields through the real function.
  STANDALONE_ONLY.forEach(key => {
    check(`${key} is live in the standalone shape`,
      fieldIsDisabled(byKey(key), { specialDMDOverride: true }) === false);
    check(`${key} is locked in the bundled shape`,
      fieldIsDisabled(byKey(key), { specialDMDBundled: true }) === true);
  });
  BOTH_SHAPES.forEach(key => {
    check(`${key} is live in the bundled shape too`,
      fieldIsDisabled(byKey(key), { specialDMDBundled: true }) === false);
  });
}

// ── the bundled-shape key drop, out of prepareData ─────────────────────────
const yamlSource = fs.readFileSync(YAML, 'utf8');
const dropStart = yamlSource.indexOf('    if (data.specialDMDBundled === true) {');
if (dropStart < 0) throw new Error('bundled-shape drop not found in yamlFeatureSupport.js');
const dropBlock = yamlSource.slice(dropStart, yamlSource.indexOf('\n    }', dropStart) + 6);
const applyBundledShape = new Function('data', dropBlock + '\n return data;');

// 9 ── disabling in the UI is not the only guard
{
  const filled = {
    specialDMDBundled: true,
    specialDMDType: 'FlexDMD',
    specialDMDArchiveRoot: 'dmd/',
    specialDMDArchiveFormat: 'zip',
    specialDMDChecksum: 'A'.repeat(32),
    specialDMDNotes: 'typed before switching shape',
    specialDMDVersion: '1.0',
    specialDMDUrlOverride: 'https://example.com/dmd.zip'
  };
  const out = applyBundledShape({ ...filled });
  STANDALONE_ONLY.forEach(key => {
    check(`${key} is dropped from a bundled build`, !(key in out), JSON.stringify(out[key]));
  });
  ['specialDMDType', 'specialDMDArchiveRoot'].forEach(key => {
    check(`${key} survives a bundled build`, out[key] === filled[key]);
  });
  // The format is CONSUMED rather than merely kept: bundled, one archive means
  // one format key, written as vpxArchiveFormat. The DMD field still exists and
  // is still required - it stores the value, it is just not output.
  check('specialDMDArchiveFormat is consumed, not written, when bundled',
    !('specialDMDArchiveFormat' in out), String(out.specialDMDArchiveFormat));
  check('...and it reappears as vpxArchiveFormat', out.vpxArchiveFormat === 'zip',
    String(out.vpxArchiveFormat));

  const standalone = applyBundledShape({ ...filled, specialDMDBundled: false });
  check('a standalone build keeps its checksum',
    standalone.specialDMDChecksum === filled.specialDMDChecksum);
  check('a standalone build keeps its version and URL',
    standalone.specialDMDVersion === '1.0' && Boolean(standalone.specialDMDUrlOverride));
}

// 10 ── the checksum key is registered for uppercasing
{
  const declared = yamlSource.match(/const CHECKSUM_KEYS = \[[\s\S]*?\];/);
  check('CHECKSUM_KEYS names specialDMDChecksum',
    Boolean(declared) && declared[0].includes('specialDMDChecksum'));
}

// ── the rulebook's DMD rules ───────────────────────────────────────────────
// 11 ── every DMD key is checked, and each error names its own field, or its
//       dot lands on the tab's first field instead of the one to fix.
{
  const buildRules = ruleSection('buildIssues', 'featureIssues');

  [...BOTH_SHAPES, 'specialDMDChecksum', 'specialDMDUrlOverride', 'specialDMDVersion'].forEach(key => {
    check(`the build rules know ${key}`, buildRules.includes(key));
  });

  check('the standalone rules are gated on specialDMDBundled',
    buildRules.includes('specialDMDBundled'));
  check('the DMD Type gate files against specialDMDType',
    buildRules.includes("'Add DMD Type before copying or downloading.', 'specialDMDType')"));
  check('the DMD required-field loops file each error against its key',
    (buildRules.match(/addError\('dmd', `\$\{label\} required`, `Add \$\{label\} before copying or downloading\.`, key\)/g) || []).length === 2);
}

// ── one directory list per tab ─────────────────────────────────────────────
const archiveDirectoriesKey = new Function(
  sliceFunction(uiSource, '  function archiveDirectoriesKey(stepId) {') + '\n return archiveDirectoriesKey;'
)();

// 12 ── the derived key must reproduce the two that already existed, or the
//       generalisation silently orphans PUP's and Alt Sound's loaded lists.
{
  check('pup derives the key it already used',
    archiveDirectoriesKey('pup') === '__pupArchiveDirectories', archiveDirectoriesKey('pup'));
  check('altSound derives the key it already used',
    archiveDirectoriesKey('altSound') === '__altSoundArchiveDirectories', archiveDirectoriesKey('altSound'));
  check('dmd gets its own key', archiveDirectoriesKey('dmd') === '__dmdArchiveDirectories');
  check('the three keys are all different',
    new Set(['pup', 'altSound', 'dmd'].map(archiveDirectoriesKey)).size === 3);

  ['__pupArchiveDirectories', '__altSoundArchiveDirectories', '__dmdArchiveDirectories'].forEach(key => {
    check(`${key} is never written to the YML`, OMIT_FROM_YAML.has(key));
  });

  check('uiHelper no longer hardcodes the PUP directory key',
    !/values\.__pupArchiveDirectories/.test(uiSource),
    'a shared key made a DMD drop overwrite the PUP list');
  check('uiHelper no longer hardcodes the PUP picker id',
    !/getDirectoryPicker\('field-pupArchiveRoot-directory-select'\)/.test(uiSource),
    'a hardcoded id made a DMD drop repaint the PUP picker');
}

// 13 ── every archive-browsing checksum can find its own root picker
{
  const browsing = WIZARD_STEPS.flatMap(step =>
    (step.fields || []).filter(field => field.archiveBrowser).map(field => ({ step, field })));

  check('at least PUP and DMD browse archives', browsing.length >= 2, String(browsing.length));
  browsing.forEach(({ step, field }) => {
    check(`${field.yml_field} names its archive root field`,
      Boolean(field.archiveRootField), String(field.archiveRootField));
    const root = (step.fields || []).find(candidate => candidate.yml_field === field.archiveRootField);
    check(`${field.archiveRootField} is on the same tab`, Boolean(root));
    check(`${field.archiveRootField} actually offers a picker`, root && root.directoryPicker === true);
    check(`${field.yml_field} also drives a format field`, Boolean(field.archiveFormatField));
  });
}

// ── a shape switch takes its values off screen ─────────────────────────────
const mainSourceForClear = fs.readFileSync(MAIN, 'utf8');
// The mirror teardown inside it is covered in tests/dmd-bundled.test.js
// section 9.
const buildClearShapeDisabledFields = new Function('state',
  sliceFunction(mainSourceForClear, '  function clearShapeDisabledFields(step, mirrorsBefore = []) {')
  + '\n return clearShapeDisabledFields;');
const clearShapeDisabledFields = state => buildClearShapeDisabledFields(state);

// 14 ── only the fields the new shape drops are cleared
{
  const makeState = () => ({
    values: {
      specialDMDBundled: true,
      specialDMDType: 'FlexDMD',
      specialDMDArchiveRoot: 'dmd/',
      specialDMDArchiveFormat: 'zip',
      specialDMDChecksum: 'B'.repeat(32),
      specialDMDNotes: 'typed before the switch',
      specialDMDVersion: '2.1',
      specialDMDUrlOverride: 'https://example.com/dmd.zip'
    }
  });

  const bundled = makeState();
  clearShapeDisabledFields(bundled)(dmd);
  STANDALONE_ONLY.forEach(key => {
    check(`switching to Bundled clears ${key} from state`, !(key in bundled.values),
      JSON.stringify(bundled.values[key]));
  });
  check('the DMD Type survives a shape switch', bundled.values.specialDMDType === 'FlexDMD',
    'the asset row owns it, and it means the same thing in either shape');
  // Root and format described the OLD shape's archive - bundled it is the VPX's
  // archive, standalone it is the DMD's own - so they go with the switch.
  ['specialDMDArchiveRoot', 'specialDMDArchiveFormat'].forEach(key => {
    check(`switching shape clears ${key} - it described the old archive`,
      !(key in bundled.values), JSON.stringify(bundled.values[key]));
  });

  const standalone = makeState();
  standalone.values.specialDMDBundled = false;
  clearShapeDisabledFields(standalone)(dmd);
  STANDALONE_ONLY.forEach(key => {
    check(`the standalone shape keeps ${key}`, Boolean(standalone.values[key]));
  });

  // A step with no shape-gated fields must come through untouched.
  const pupState = makeState();
  const beforePup = JSON.stringify(pupState.values);
  clearShapeDisabledFields(pupState)(pup);
  check('a tab with no disabledWhen fields is left alone',
    JSON.stringify(pupState.values) === beforePup);
  check('a missing step is handled without throwing',
    clearShapeDisabledFields(makeState())(undefined) === undefined);
}

// ── the DMD tab's layout sizing ────────────────────────────────────────────
const getFieldLayoutClass = new Function(
  sliceFunction(uiSource, '  function getFieldLayoutClass(stepId, field) {')
  + '\n return getFieldLayoutClass;'
)();

// 15 ── DMD Notes matches PUP Notes rather than the three-row default
{
  const dmdNotes = getFieldLayoutClass('dmd', byKey('specialDMDNotes'));
  const pupNotes = getFieldLayoutClass('pup', pup.fields.find(f => f.yml_field === 'pupNotes'));
  check('DMD Notes is a two-row textarea', /field-textarea-two/.test(dmdNotes), dmdNotes);
  check('PUP Notes is a two-row textarea too', /field-textarea-two/.test(pupNotes), pupNotes);
  check('DMD Notes did NOT fall through to the three-row default',
    !/field-textarea-three/.test(dmdNotes), dmdNotes);
  check('DMD Notes is still full width', /field-wide/.test(dmdNotes), dmdNotes);

  // The rest of the DMD tab uses the shared grid, so it must NOT pick up
  // PUP's grid-area classes - those would place fields in a grid the DMD tab
  // does not define.
  ['specialDMDVersion', 'specialDMDUrlOverride', 'specialDMDArchiveRoot'].forEach(key => {
    check(`${key} claims no PUP grid area`,
      !/field-pup-/.test(getFieldLayoutClass('dmd', byKey(key))),
      getFieldLayoutClass('dmd', byKey(key)));
  });
  check('DMD Checksum still gets the standard checksum layout',
    /field-checksum-standard/.test(getFieldLayoutClass('dmd', byKey('specialDMDChecksum'))),
    getFieldLayoutClass('dmd', byKey('specialDMDChecksum')));
}

// 16 ── a shape switch drops the directory list it just orphaned
{
  const withDirs = () => ({
    values: {
      specialDMDBundled: true,
      specialDMDChecksum: 'C'.repeat(32),
      specialDMDNotes: 'x',
      specialDMDVersion: '1',
      specialDMDUrlOverride: 'https://example.com/a.zip',
      specialDMDArchiveRoot: 'dmd/',
      __dmdArchiveDirectories: ['dmd/', 'dmd/alt/']
    }
  });

  const bundled = withDirs();
  clearShapeDisabledFields(bundled)(dmd);
  check('the orphaned directory list goes with the browsing field',
    !('__dmdArchiveDirectories' in bundled.values),
    JSON.stringify(bundled.values.__dmdArchiveDirectories));
  check('Archive Root goes too - it pointed inside the old archive',
    !('specialDMDArchiveRoot' in bundled.values),
    JSON.stringify(bundled.values.specialDMDArchiveRoot));

  const standalone = withDirs();
  standalone.values.specialDMDBundled = false;
  clearShapeDisabledFields(standalone)(dmd);
  check('the list goes in the OTHER direction too - the shape changed either way',
    !('__dmdArchiveDirectories' in standalone.values),
    JSON.stringify(standalone.values.__dmdArchiveDirectories));

  // PUP's checksum is not shape-gated, so toggling PUP must never cost it the
  // list the user just loaded.
  const pupState = {
    values: { pupBundled: true, __pupArchiveDirectories: ['pup/', 'pup/x/'] }
  };
  clearShapeDisabledFields(pupState)(pup);
  check('a tab whose browsing field is not shape-gated keeps its list',
    Array.isArray(pupState.values.__pupArchiveDirectories)
    && pupState.values.__pupArchiveDirectories.length === 2,
    JSON.stringify(pupState.values.__pupArchiveDirectories));
}


// 17 ── being shape-gated at all is what decides, not which field was disabled
{
  // A step whose fields change with the shape is describing a different archive
  // in each one, so its whole archive description goes - whether or not the
  // field that got disabled was the browsing one.
  const gated = {
    values: {
      someFlag: true, someNote: 'x', someRoot: 'r/', someFormat: 'zip',
      __fakeArchiveDirectories: ['a/', 'b/']
    }
  };
  clearShapeDisabledFields(gated)({
    id: 'fake',
    fields: [
      { yml_field: 'someNote', disabledWhen: 'someFlag', archiveFormatField: 'someFormat' },
      { yml_field: 'someRoot', directoryPicker: true }
    ]
  });
  check('the disabled field is cleared', !('someNote' in gated.values));
  check('the archive root goes with the shape', !('someRoot' in gated.values));
  check('so does the archive format', !('someFormat' in gated.values));
  check('and so does the folder list', !('__fakeArchiveDirectories' in gated.values));

  // A step with NO shape-gated fields keeps everything. This is PUP and Alt
  // Sound: their archive means the same thing bundled or not, so a toggle must
  // never cost the user the folder list they just loaded.
  const plain = {
    values: { someFlag: true, someRoot: 'r/', __plainArchiveDirectories: ['a/'] }
  };
  clearShapeDisabledFields(plain)({
    id: 'plain',
    fields: [{ yml_field: 'someRoot', directoryPicker: true }]
  });
  check('a step with no shape-gated fields keeps its root', plain.values.someRoot === 'r/');
  check('...and keeps its folder list',
    Array.isArray(plain.values.__plainArchiveDirectories));
}

report('dmd-tab');
