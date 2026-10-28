// One scenario per validation rule: the Alt Sound and VPU Patch tabs.
//
// Piece B of the YAML run-through; see yaml-rules-main.test.mjs for how these
// files are built and yaml-scenarios.mjs for the runner.
//   SNAPSHOT=print node tests/yaml-rules-sound-patch.test.mjs

import { check, report } from './harness.mjs';
import { startScenarios } from './yaml-scenarios.mjs';

const { app, scenario, PRINT } = await startScenarios();

const MD5_VPX = 'E6DF3800F7C9286FA195E84034DA683A';
const MD5_SOUND = '9CC6161300C1E0AC76D73EC6B847EE7C';
const MD5_PATCH = '32EFAB94D0B710EE89C401B8DD3D6850';
const URL = 'https://example.com/download.zip';
const MAIN = [['fill', 'fps', '60'], ['fill', 'testers', 'Tester']];

// Lord of the Rings, for its VPS Alt Sound.
const LOTR = [['search', '5RybGX4Q'], ['asset', 'tableFiles', 'ulolpyXq'], ...MAIN, ['fill', 'vpxChecksum', MD5_VPX]];
const SOUND = [...LOTR, ['asset', 'altSoundFiles', '6vSAjw2Gmk'], ['fill', 'altSoundChecksum', MD5_SOUND], ['fill', 'altSoundArchiveFormat', 'rar']];
// An Alt Sound with no VPS entry: Override and every field it asks for.
const SOUND_OVERRIDE = {
  altSoundChecksum: MD5_SOUND,
  altSoundArchiveFormat: 'rar',
  altSoundNotes: 'Download - lotr.rar',
  altSoundArchiveRoot: 'lotr',
  altSoundAuthorsOverride: 'Somebody',
  altSoundUrlOverride: URL,
  altSoundVersionOverride: '1.0'
};
const soundOverrideWithout = (...left) => [...LOTR, ['override', 'altSoundFiles', true], ...Object.entries(SOUND_OVERRIDE)
  .filter(([key]) => !left.includes(key))
  .map(([key, value]) => ['fill', key, value])];

// Tales from the Crypt with VPX uVgZUZdK: a patch is only offered once its
// parent VPX is picked, and the table's one patch, TJMo9ycfSP, is this one's.
const TFTC = [['search', 'fXaQ33KC'], ['asset', 'tableFiles', 'uVgZUZdK'], ...MAIN, ['fill', 'vpxChecksum', MD5_VPX]];
const PATCH = [...TFTC, ['asset', 'vpuPatchFiles', 'TJMo9ycfSP'], ['fill', 'diffChecksum', MD5_PATCH]];

await scenario('clean Alt Sound', SOUND, {
  keys: ['altSoundArchiveFormat', 'altSoundChecksum', 'altSoundVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'success: Everything looks good. | The build is ready to copy or download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: ready', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [],
  download: '5RybGX4Q_table-config.yml',
  downloadMatchesPreview: true
});
await scenario('clean Alt Sound by Override', soundOverrideWithout(), {
  keys: ['altSoundArchiveFormat', 'altSoundArchiveRoot', 'altSoundAuthorsOverride', 'altSoundChecksum', 'altSoundNotes', 'altSoundUrlOverride', 'altSoundVersionOverride', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'success: Everything looks good. | The build is ready to copy or download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: ready', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [],
  download: '5RybGX4Q_table-config.yml',
  downloadMatchesPreview: true
});
await scenario('clean VPU Patch', PATCH, {
  keys: ['diffChecksum', 'diffVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'success: Everything looks good. | The build is ready to copy or download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: ready', 'dmd: disabled'],
  dots: [],
  download: 'fXaQ33KC_table-config.yml',
  downloadMatchesPreview: true
});

// --- Alt Sound -------------------------------------------------------------

await scenario('Alt Sound checksum not an MD5', [...SOUND, ['fill', 'altSoundChecksum', 'NOT-A-HASH']], {
  rule: 'Alt Sound Checksum MD5 invalid',
  keys: ['altSoundArchiveFormat', 'altSoundChecksum', 'altSoundVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Alt Sound Checksum MD5 invalid | Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: 1 error', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'altSound field-altSoundChecksum: Alt Sound Checksum MD5 invalid. Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  download: 'blocked'
});
await scenario('Alt Sound archive format empty', [...SOUND, ['fill', 'altSoundArchiveFormat', '']], {
  rule: 'Alt Sound Archive Format required',
  keys: ['altSoundChecksum', 'altSoundVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Alt Sound Archive Format required | Choose ZIP, RAR, or 7Z.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: 1 error', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'altSound field-altSoundArchiveFormat: Alt Sound Archive Format required. Choose ZIP, RAR, or 7Z.'
  ],
  download: 'blocked'
});
await scenario('Alt Sound picked from VPS and given a URL too', [...SOUND,
  ['fill', 'altSoundUrlOverride', URL], ['fill', 'altSoundVersionOverride', '1.0'], ['fill', 'altSoundNotes', 'From the URL']
], {
  rule: 'Choose one Alt Sound source',
  keys: ['altSoundArchiveFormat', 'altSoundChecksum', 'altSoundNotes', 'altSoundUrlOverride', 'altSoundVersionOverride', 'altSoundVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Choose one Alt Sound source | Use either Alt Sound VPS ID or Alt Sound URL Override, not both.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: 1 error', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'altSound field-altSoundUrlOverride: Choose one Alt Sound source. Use either Alt Sound VPS ID or Alt Sound URL Override, not both.'
  ],
  download: 'blocked'
});
await scenario('Alt Sound URL without a version', soundOverrideWithout('altSoundVersionOverride'), {
  rule: 'Alt Sound Version Override required',
  keys: ['altSoundArchiveFormat', 'altSoundArchiveRoot', 'altSoundAuthorsOverride', 'altSoundChecksum', 'altSoundNotes', 'altSoundUrlOverride', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Alt Sound Version Override required | Add Alt Sound Version Override whenever Alt Sound URL Override is used.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: 1 error', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'altSound field-altSoundVersionOverride: Alt Sound Version Override required. Add Alt Sound Version Override whenever Alt Sound URL Override is used.'
  ],
  download: 'blocked'
});
await scenario('Alt Sound version without a URL', [...SOUND, ['fill', 'altSoundVersionOverride', '1.0']], {
  rule: 'Alt Sound URL Override required',
  keys: ['altSoundArchiveFormat', 'altSoundChecksum', 'altSoundVersionOverride', 'altSoundVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Alt Sound URL Override required | Add Alt Sound URL Override whenever Alt Sound Version Override is used.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: 1 error', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'altSound field-altSoundUrlOverride: Alt Sound URL Override required. Add Alt Sound URL Override whenever Alt Sound Version Override is used.'
  ],
  download: 'blocked'
});
await scenario('Alt Sound URL without notes', soundOverrideWithout('altSoundNotes'), {
  rule: 'Alt Sound Notes required',
  keys: ['altSoundArchiveFormat', 'altSoundArchiveRoot', 'altSoundAuthorsOverride', 'altSoundChecksum', 'altSoundUrlOverride', 'altSoundVersionOverride', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Alt Sound Notes required | Add Alt Sound Notes when using Alt Sound URL Override.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: 1 error', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'altSound field-altSoundNotes: Alt Sound Notes required. Add Alt Sound Notes when using Alt Sound URL Override.'
  ],
  download: 'blocked'
});
await scenario('Alt Sound bundled without notes', [...LOTR,
  ['bundle', 'altSoundFiles', true], ['fill', 'altSoundChecksum', MD5_SOUND], ['fill', 'altSoundArchiveFormat', 'rar'], ['fill', 'altSoundArchiveRoot', 'lotr']
], {
  rule: 'Alt Sound Notes required',
  keys: ['altSoundArchiveFormat', 'altSoundArchiveRoot', 'altSoundBundled', 'altSoundChecksum', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Alt Sound Notes required | Add Alt Sound Notes when the Alt Sound ships inside the table download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: 1 error', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'altSound field-altSoundNotes: Alt Sound Notes required. Add Alt Sound Notes when the Alt Sound ships inside the table download.'
  ],
  download: 'blocked'
});
// Bundled with a URL left over in the draft: both notes rules apply, and the
// missing notes are reported once, in the bundled wording (Phase 2 decision 3,
// 2026-10-11; it showed two lines and counted 2).
await scenario('Alt Sound bundled with a URL, without notes', [...LOTR,
  ['bundle', 'altSoundFiles', true], ['fill', 'altSoundChecksum', MD5_SOUND], ['fill', 'altSoundArchiveFormat', 'rar'], ['fill', 'altSoundArchiveRoot', 'lotr'],
  ['draft', 'values.altSoundUrlOverride', URL], ['draft', 'values.altSoundVersionOverride', '1.0']
], {
  rule: 'Alt Sound Notes required',
  keys: ['altSoundArchiveFormat', 'altSoundArchiveRoot', 'altSoundBundled', 'altSoundChecksum', 'altSoundUrlOverride', 'altSoundVersionOverride', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Alt Sound Notes required | Add Alt Sound Notes when the Alt Sound ships inside the table download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: 1 error', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'altSound field-altSoundNotes: Alt Sound Notes required. Add Alt Sound Notes when the Alt Sound ships inside the table download.'
  ],
  download: 'blocked'
});
await scenario('Alt Sound bundled without an archive root', [...LOTR,
  ['bundle', 'altSoundFiles', true], ['fill', 'altSoundChecksum', MD5_SOUND], ['fill', 'altSoundArchiveFormat', 'rar'], ['fill', 'altSoundNotes', 'In the table download']
], {
  rule: 'Alt Sound Archive Root required',
  keys: ['altSoundArchiveFormat', 'altSoundBundled', 'altSoundChecksum', 'altSoundNotes', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Alt Sound Archive Root required | Choose the Alt Sound root folder from the uploaded Alt Sound archive.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: 1 error', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'altSound field-altSoundArchiveRoot: Alt Sound Archive Root required. Choose the Alt Sound root folder from the uploaded Alt Sound archive.'
  ],
  download: 'blocked'
});
await scenario('Alt Sound override with nothing filled', [...LOTR, ['override', 'altSoundFiles', true]], {
  rule: 'Alt Sound Checksum required',
  keys: ['fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Alt Sound Notes required | Add Alt Sound Notes. Override has no VPS entry to fill it in.',
    'error: Alt Sound Archive Root required | Add Alt Sound Archive Root. Override has no VPS entry to fill it in.',
    'error: Alt Sound Authors Override required | Add Alt Sound Authors Override. Override has no VPS entry to fill it in.',
    'error: Alt Sound URL Override required | Add Alt Sound URL Override. Override has no VPS entry to fill it in.',
    'error: Alt Sound Version Override required | Add Alt Sound Version Override. Override has no VPS entry to fill it in.',
    'error: Alt Sound Checksum required | Add a valid MD5 value for Alt Sound Checksum.',
    'error: Alt Sound Archive Format required | Choose ZIP, RAR, or 7Z.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: 7 errors', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'altSound field-altSoundChecksum: Alt Sound Checksum required. Add a valid MD5 value for Alt Sound Checksum.',
    'altSound field-altSoundNotes: Alt Sound Notes required. Add Alt Sound Notes. Override has no VPS entry to fill it in.',
    'altSound field-altSoundArchiveRoot: Alt Sound Archive Root required. Add Alt Sound Archive Root. Override has no VPS entry to fill it in.',
    'altSound field-altSoundArchiveFormat: Alt Sound Archive Format required. Choose ZIP, RAR, or 7Z.',
    'altSound field-altSoundAuthorsOverride: Alt Sound Authors Override required. Add Alt Sound Authors Override. Override has no VPS entry to fill it in.',
    'altSound field-altSoundUrlOverride: Alt Sound URL Override required. Add Alt Sound URL Override. Override has no VPS entry to fill it in.',
    'altSound field-altSoundVersionOverride: Alt Sound Version Override required. Add Alt Sound Version Override. Override has no VPS entry to fill it in.'
  ],
  download: 'blocked'
});

// --- VPU Patch -------------------------------------------------------------

await scenario('VPU Patch checksum empty', [...TFTC, ['asset', 'vpuPatchFiles', 'TJMo9ycfSP']], {
  rule: 'VPU Patch Checksum required',
  keys: ['diffVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: VPU Patch Checksum required | Add a valid MD5 value for VPU Patch Checksum.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: 1 error', 'dmd: disabled'],
  dots: [
    'vpuPatch field-diffChecksum: VPU Patch Checksum required. Add a valid MD5 value for VPU Patch Checksum.'
  ],
  download: 'blocked'
});
await scenario('VPU Patch checksum not an MD5', [...PATCH, ['fill', 'diffChecksum', 'NOT-A-HASH']], {
  rule: 'VPU Patch Checksum MD5 invalid',
  keys: ['diffChecksum', 'diffVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: VPU Patch Checksum MD5 invalid | Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: 1 error', 'dmd: disabled'],
  dots: [
    'vpuPatch field-diffChecksum: VPU Patch Checksum MD5 invalid. Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  download: 'blocked'
});
// A list of one is never written by the app or kept by the importer, and a
// draft that holds one has it turned into a plain string as it loads
// (migrateBuildValues in main.js, Phase 2 decision 4, 2026-10-12). Until then
// the tab said "1 error" with no dot: the fallback dot landed on the VPU Patch
// ID, where it is removed (NO_DOT_FIELDS in uiEnhancements.js).
await scenario('VPU Patch checksum list of one (from a draft)', [...PATCH, ['draft', 'values.diffChecksum', [MD5_PATCH]]], {
  yaml: [
    '---',
    'diffChecksum: "32EFAB94D0B710EE89C401B8DD3D6850"',
    'diffVPSId: "TJMo9ycfSP"',
    'fps: 60',
    'tableVPSId: "fXaQ33KC"',
    'testers:',
    '  - "Tester"',
    'vpxChecksum: "E6DF3800F7C9286FA195E84034DA683A"',
    'vpxVPSId: "uVgZUZdK"',
    ''
  ],
  keys: ['diffChecksum', 'diffVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'success: Everything looks good. | The build is ready to copy or download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: ready', 'dmd: disabled'],
  dots: [],
  download: 'fXaQ33KC_table-config.yml',
  downloadMatchesPreview: true
});
await scenario('Patch URL without notes', [...PATCH, ['fill', 'diffUrlOverride', URL], ['fill', 'diffVersionOverride', '1.0']], {
  rule: 'Patch Notes required',
  keys: ['diffChecksum', 'diffUrlOverride', 'diffVersionOverride', 'diffVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Patch Notes required | Add Patch Notes when using Patch URL Override.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: 1 error', 'dmd: disabled'],
  dots: [
    'vpuPatch field-diffNotes: Patch Notes required. Add Patch Notes when using Patch URL Override.'
  ],
  download: 'blocked'
});
await scenario('Patch URL without a version', [...PATCH, ['fill', 'diffUrlOverride', URL], ['fill', 'diffNotes', 'From the URL']], {
  rule: 'Patch version override required',
  keys: ['diffChecksum', 'diffNotes', 'diffUrlOverride', 'diffVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Patch version override required | Add Patch Version Override when using Patch URL Override.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: 1 error', 'dmd: disabled'],
  dots: [
    'vpuPatch field-diffVersionOverride: Patch version override required. Add Patch Version Override when using Patch URL Override.'
  ],
  download: 'blocked'
});
await scenario('Patch version without a URL', [...PATCH, ['fill', 'diffVersionOverride', '1.0']], {
  rule: 'Patch URL override required',
  keys: ['diffChecksum', 'diffVersionOverride', 'diffVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Patch URL override required | Add Patch URL Override when using Patch Version Override.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: 1 error', 'dmd: disabled'],
  dots: [
    'vpuPatch field-diffUrlOverride: Patch URL override required. Add Patch URL Override when using Patch Version Override.'
  ],
  download: 'blocked'
});
await scenario('VPU Patch bundled without notes', [...TFTC, ['bundle', 'vpuPatchFiles', true], ['fill', 'diffChecksum', MD5_PATCH]], {
  rule: 'Bundled VPU Patch needs notes',
  keys: ['diffBundled', 'diffChecksum', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Bundled VPU Patch needs notes | Describe the bundled VPU Patch and where it is located.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: 1 error', 'dmd: disabled'],
  dots: [
    'vpuPatch field-diffNotes: Bundled VPU Patch needs notes. Describe the bundled VPU Patch and where it is located.'
  ],
  download: 'blocked'
});
await scenario('VPU Patch override with nothing filled', [...TFTC, ['override', 'vpuPatchFiles', true], ['fill', 'diffChecksum', MD5_PATCH]], {
  rule: 'Patch Notes required',
  keys: ['diffChecksum', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Patch Notes required | Add Patch Notes. Override has no VPS entry to fill it in.',
    'error: Patch Authors Override required | Add Patch Authors Override. Override has no VPS entry to fill it in.',
    'error: Patch URL Override required | Add Patch URL Override. Override has no VPS entry to fill it in.',
    'error: Patch Version Override required | Add Patch Version Override. Override has no VPS entry to fill it in.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: 4 errors', 'dmd: disabled'],
  dots: [
    'vpuPatch field-diffNotes: Patch Notes required. Add Patch Notes. Override has no VPS entry to fill it in.',
    'vpuPatch field-diffAuthorsOverride: Patch Authors Override required. Add Patch Authors Override. Override has no VPS entry to fill it in.',
    'vpuPatch field-diffUrlOverride: Patch URL Override required. Add Patch URL Override. Override has no VPS entry to fill it in.',
    'vpuPatch field-diffVersionOverride: Patch Version Override required. Add Patch Version Override. Override has no VPS entry to fill it in.'
  ],
  download: 'blocked'
});

// Defensive, like the backglass one in yaml-rules-main: only a saved draft can
// carry a broken entry. Until 2026-10-14 the VPU Patch ID was barred from
// carrying a dot (NO_DOT_FIELDS in uiEnhancements.js, and a rule in
// css.src/v091.css), so this tab said "1 error" with no dot anywhere.
await scenario('VPU Patch entry broken (from a draft)', [...PATCH, ['draft', 'record.tableFiles.0.broken', true]], {
  rule: 'VPU Patch entry broken',
  keys: ['diffChecksum', 'diffVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: VPU Patch entry broken | Choose another database entry before copying or downloading.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: 1 error', 'dmd: disabled'],
  dots: [
    'vpuPatch field-diffVPSId: VPU Patch entry broken. Choose another database entry before copying or downloading.'
  ],
  download: 'blocked'
});
// The dot sits on the ID box's top-right corner, 4px out each way, like the
// ROM ID's (yaml-rules-rom).
if (!PRINT) {
  const corner = await app.run(async () => {
    document.getElementById('validationDialog').close();
    document.getElementById('config-tab-vpuPatch').click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))));
    const dot = document.querySelector('#config-panel-vpuPatch .field-error-dot');
    if (!dot) return 'no dot';
    const box = dot.closest('.field').querySelector('input, textarea, select, .readonly-id').getBoundingClientRect();
    const spot = dot.getBoundingClientRect();
    return Math.round(spot.right - box.right) + ',' + Math.round(box.top - spot.top);
  });
  check('dots: VPU Patch ID dot sits 4px out from its box corner', corner === '4,4', corner);
}

// Jason's live check: with another dot on the tab, the broken entry used to
// lose its dot (the generic fallback only fires on a tab with no dot), so the
// tab said "2 errors" with one dot, on the checksum.
await scenario('VPU Patch entry broken, with a bad checksum (from a draft)', [...PATCH, ['fill', 'diffChecksum', 'not-an-md5'], ['draft', 'record.tableFiles.0.broken', true]], {
  rule: 'VPU Patch entry broken',
  keys: ['diffChecksum', 'diffVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: VPU Patch entry broken | Choose another database entry before copying or downloading.',
    'error: VPU Patch Checksum MD5 invalid | Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: 2 errors', 'dmd: disabled'],
  dots: [
    'vpuPatch field-diffVPSId: VPU Patch entry broken. Choose another database entry before copying or downloading.',
    'vpuPatch field-diffChecksum: VPU Patch Checksum MD5 invalid. Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  download: 'blocked'
});

await app.close();
report('yaml-rules-sound-patch');
