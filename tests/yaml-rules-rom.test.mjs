// One scenario per validation rule: the ROM and Color ROM tabs, and the
// Additional ROM list.
//
// Piece B of the YAML run-through; see yaml-rules-main.test.mjs for how these
// files are built and yaml-scenarios.mjs for the runner.
//   SNAPSHOT=print node tests/yaml-rules-rom.test.mjs

import { check, report } from './harness.mjs';
import { startScenarios } from './yaml-scenarios.mjs';

const { app, scenario, play, PRINT } = await startScenarios();

const MD5_VPX = 'E6DF3800F7C9286FA195E84034DA683A';
const MD5_ROM = 'E4C898AFCDCF6FD2A884C77C7FD6C3A9';
const MD5_PAL = '32EFAB94D0B710EE89C401B8DD3D6850';
const MD5_VNI = '9CC6161300C1E0AC76D73EC6B847EE7C';
const MD5_ADD = '1E0F48976BD4AC0B3ED151D74FB96DC5';
const ROM_URL = 'https://example.com/rom.zip';
const MAIN = [['fill', 'fps', '60'], ['fill', 'testers', 'Tester']];

// Pink Floyd, the smallest clean build, plus its one VPS ROM.
const PINK_FLOYD = [['search', 'Lgi1JLk0Vf'], ['asset', 'tableFiles', 'qV3Z3oQ8md'], ...MAIN, ['fill', 'vpxChecksum', MD5_VPX]];
const ROM = [...PINK_FLOYD, ['asset', 'romFiles', 'jgo91P3SSp'], ['fill', 'romChecksum', MD5_ROM]];

// Lord of the Rings, for its VPS Color ROM.
const LOTR = [['search', '5RybGX4Q'], ['asset', 'tableFiles', 'ulolpyXq'], ...MAIN, ['fill', 'vpxChecksum', MD5_VPX]];
const COLOR = [...LOTR, ['asset', 'altColorFiles', 'afptXEiuqn'], ['fill', 'coloredROMChecksum', MD5_PAL]];

await scenario('clean build with a ROM', ROM, {
  keys: ['fps', 'romChecksum', 'romVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'success: Everything looks good. | The build is ready to copy or download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: ready', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [],
  download: 'Lgi1JLk0Vf_table-config.yml',
  downloadMatchesPreview: true
});
await scenario('clean build with a Color ROM', COLOR, {
  keys: ['coloredROMChecksum', 'coloredROMVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'success: Everything looks good. | The build is ready to copy or download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: ready', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [],
  download: '5RybGX4Q_table-config.yml',
  downloadMatchesPreview: true
});

// --- ROM -------------------------------------------------------------------

await scenario('ROM checksum empty', [...PINK_FLOYD, ['asset', 'romFiles', 'jgo91P3SSp']], {
  rule: 'ROM Checksum required',
  keys: ['fps', 'romVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: ROM Checksum required | Add a valid MD5 value for ROM Checksum.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 1 error', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'rom field-romChecksum: ROM Checksum required. Add a valid MD5 value for ROM Checksum.'
  ],
  download: 'blocked'
});
await scenario('ROM checksum not an MD5', [...PINK_FLOYD, ['asset', 'romFiles', 'jgo91P3SSp'], ['fill', 'romChecksum', 'NOT-A-HASH']], {
  rule: 'ROM Checksum MD5 invalid',
  keys: ['fps', 'romChecksum', 'romVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: ROM Checksum MD5 invalid | Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 1 error', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'rom field-romChecksum: ROM Checksum MD5 invalid. Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  download: 'blocked'
});
await scenario('ROM picked from VPS and given a URL too', [...ROM,
  ['fill', 'romUrlOverride', ROM_URL], ['fill', 'romVersionOverride', 'esha_la3'], ['fill', 'romNotes', 'From the URL']
], {
  rule: 'ROM ID conflicts with URL override',
  keys: ['fps', 'romChecksum', 'romNotes', 'romUrlOverride', 'romVersionOverride', 'romVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: ROM ID conflicts with URL override | Use either ROM ID or ROM URL Override, not both.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 1 error', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'rom field-romUrlOverride: ROM ID conflicts with URL override. Use either ROM ID or ROM URL Override, not both.'
  ],
  download: 'blocked'
});
// Where the dot sits, measured on the page this scenario left open. Every dot
// is on its visible box's top-right corner, 4px out each way. ID fields are
// padded to line up with the checksum drop zones, and until 2026-10-06 their
// dot sat 5px further out than the rest (Jason spotted it on the ROM ID).
// Since decision 5 the conflict has one dot, on the URL Override, so an ID
// field's corner is measured by the VPU Patch ID check in
// yaml-rules-sound-patch.test.mjs instead.
if (!PRINT) {
  const corners = await app.run(async () => {
    document.getElementById('validationDialog').close();
    document.getElementById('config-tab-rom').click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))));
    return [...document.querySelectorAll('#config-panel-rom .field-error-dot')].map(dot => {
      const box = dot.closest('.field').querySelector('input, textarea, select, .readonly-id').getBoundingClientRect();
      const spot = dot.getBoundingClientRect();
      return dot.closest('.field').querySelector('[id^="field-"]').id + ' ' + Math.round(spot.right - box.right) + ',' + Math.round(box.top - spot.top);
    });
  });
  check('dots: the one ROM conflict dot measured', corners.length === 1, corners.join('\n'));
  corners.forEach(corner => check('dots: ' + corner.split(' ')[0] + ' sits 4px out from its box corner', corner.endsWith(' 4,4'), corner));
}
await scenario('ROM URL without a version', [...PINK_FLOYD,
  ['bundle', 'romFiles', true], ['fill', 'romChecksum', MD5_ROM], ['fill', 'romNotes', 'In the table download'], ['fill', 'romUrlOverride', ROM_URL]
], {
  rule: 'ROM version override required',
  keys: ['fps', 'romBundled', 'romChecksum', 'romNotes', 'romUrlOverride', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: ROM version override required | Add ROM Version Override when using ROM URL Override.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 1 error', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'rom field-romVersionOverride: ROM version override required. Add ROM Version Override when using ROM URL Override.'
  ],
  download: 'blocked'
});
await scenario('ROM URL without notes', [...PINK_FLOYD,
  ['override', 'romFiles', true], ['fill', 'romChecksum', MD5_ROM], ['fill', 'romUrlOverride', ROM_URL], ['fill', 'romVersionOverride', 'esha_la3']
], {
  rule: 'ROM Notes required',
  keys: ['fps', 'romChecksum', 'romUrlOverride', 'romVersionOverride', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: ROM Notes required | Add ROM Notes when using ROM URL Override.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 1 error', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'rom field-romNotes: ROM Notes required. Add ROM Notes when using ROM URL Override.'
  ],
  download: 'blocked'
});
await scenario('ROM version without a URL', [...ROM, ['fill', 'romVersionOverride', 'esha_la3']], {
  rule: 'ROM URL override required',
  keys: ['fps', 'romChecksum', 'romVersionOverride', 'romVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: ROM URL override required | Add ROM URL Override when using ROM Version Override.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 1 error', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'rom field-romUrlOverride: ROM URL override required. Add ROM URL Override when using ROM Version Override.'
  ],
  download: 'blocked'
});
await scenario('ROM bundled without notes', [...PINK_FLOYD, ['bundle', 'romFiles', true], ['fill', 'romChecksum', MD5_ROM]], {
  rule: 'Bundled ROM needs notes',
  keys: ['fps', 'romBundled', 'romChecksum', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Bundled ROM needs notes | Describe the bundled ROM and where it is located.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 1 error', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'rom field-romNotes: Bundled ROM needs notes. Describe the bundled ROM and where it is located.'
  ],
  download: 'blocked'
});
await scenario('ROM override with nothing filled', [...PINK_FLOYD, ['override', 'romFiles', true], ['fill', 'romChecksum', MD5_ROM]], {
  rule: 'ROM Notes required',
  keys: ['fps', 'romChecksum', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: ROM Notes required | Add ROM Notes. Override has no VPS entry to fill it in.',
    'error: ROM URL Override required | Add ROM URL Override. Override has no VPS entry to fill it in.',
    'error: ROM Version Override required | Add ROM Version Override. Override has no VPS entry to fill it in.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 3 errors', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'rom field-romNotes: ROM Notes required. Add ROM Notes. Override has no VPS entry to fill it in.',
    'rom field-romUrlOverride: ROM URL Override required. Add ROM URL Override. Override has no VPS entry to fill it in.',
    'rom field-romVersionOverride: ROM Version Override required. Add ROM Version Override. Override has no VPS entry to fill it in.'
  ],
  download: 'blocked'
});
// See 'backglass override with the checksum empty too' (decision 5).
await scenario('ROM override with the checksum empty too', [...PINK_FLOYD, ['override', 'romFiles', true]], {
  rule: 'ROM Checksum required',
  keys: ['fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: ROM Checksum required | Add a valid MD5 value for ROM Checksum.',
    'error: ROM Notes required | Add ROM Notes. Override has no VPS entry to fill it in.',
    'error: ROM URL Override required | Add ROM URL Override. Override has no VPS entry to fill it in.',
    'error: ROM Version Override required | Add ROM Version Override. Override has no VPS entry to fill it in.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 4 errors', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'rom field-romChecksum: ROM Checksum required. Add a valid MD5 value for ROM Checksum.',
    'rom field-romNotes: ROM Notes required. Add ROM Notes. Override has no VPS entry to fill it in.',
    'rom field-romUrlOverride: ROM URL Override required. Add ROM URL Override. Override has no VPS entry to fill it in.',
    'rom field-romVersionOverride: ROM Version Override required. Add ROM Version Override. Override has no VPS entry to fill it in.'
  ],
  download: 'blocked'
});

// --- Color ROM -------------------------------------------------------------

await scenario('Color ROM checksum empty', [...LOTR, ['asset', 'altColorFiles', 'afptXEiuqn']], {
  rule: 'Color ROM Checksum required',
  keys: ['coloredROMVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Color ROM Checksum required | Add a valid MD5 value for Color ROM Checksum.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: 1 error', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'coloredRom field-coloredROMChecksum: Color ROM Checksum required. Add a valid MD5 value for Color ROM Checksum.'
  ],
  download: 'blocked'
});
await scenario('Color ROM checksum not an MD5', [...LOTR, ['asset', 'altColorFiles', 'afptXEiuqn'], ['fill', 'coloredROMChecksum', 'NOT-A-HASH']], {
  rule: 'Color ROM Checksum MD5 invalid',
  keys: ['coloredROMChecksum', 'coloredROMVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Color ROM Checksum MD5 invalid | Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: 1 error', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'coloredRom field-coloredROMChecksum: Color ROM Checksum MD5 invalid. Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  download: 'blocked'
});
await scenario('PAL/VNI with one checksum', [...COLOR, ['fill', 'coloredROMPin2DMD', true], ['fill', 'coloredROMChecksum', MD5_PAL]], {
  rule: 'PAL/VNI requires two checksums',
  keys: ['coloredROMChecksum', 'coloredROMPin2DMD', 'coloredROMVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: PAL/VNI requires two checksums | Add the .pal checksum and the .vni checksum.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: 1 error', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'coloredRom field-coloredROMChecksumSecondary: PAL/VNI requires two checksums. Add the .pal checksum and the .vni checksum.'
  ],
  download: 'blocked'
});
await scenario('PAL/VNI with only the VNI checksum', [...COLOR, ['fill', 'coloredROMPin2DMD', true], ['fill', 'coloredROMChecksumSecondary', MD5_VNI]], {
  rule: 'PAL/VNI requires two checksums',
  keys: ['coloredROMChecksum', 'coloredROMPin2DMD', 'coloredROMVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: PAL/VNI requires two checksums | Add the .pal checksum and the .vni checksum.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: 1 error', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'coloredRom field-coloredROMChecksum: PAL/VNI requires two checksums. Add the .pal checksum and the .vni checksum.'
  ],
  download: 'blocked'
});
// The pair is checked as one list, but a bad hash is marked on the slot it
// came from (decision 5: each error draws its own dot).
await scenario('PAL/VNI with a bad VNI checksum', [...COLOR, ['fill', 'coloredROMPin2DMD', true], ['fill', 'coloredROMChecksum', MD5_PAL], ['fill', 'coloredROMChecksumSecondary', 'not-an-md5']], {
  rule: 'Color ROM Checksum MD5 invalid',
  keys: ['coloredROMChecksum', 'coloredROMPin2DMD', 'coloredROMVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Color ROM Checksum MD5 invalid | Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: 1 error', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'coloredRom field-coloredROMChecksumSecondary: Color ROM Checksum MD5 invalid. Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  download: 'blocked'
});
await scenario('clean PAL/VNI pair', [...COLOR, ['fill', 'coloredROMPin2DMD', true], ['fill', 'coloredROMChecksum', MD5_PAL], ['fill', 'coloredROMChecksumSecondary', MD5_VNI]], {
  keys: ['coloredROMChecksum', 'coloredROMPin2DMD', 'coloredROMVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'success: Everything looks good. | The build is ready to copy or download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: ready', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [],
  download: '5RybGX4Q_table-config.yml',
  downloadMatchesPreview: true
});
await scenario('Color ROM URL without notes', [...COLOR,
  ['fill', 'coloredROMUrlOverride', ROM_URL], ['fill', 'coloredROMVersionOverride', '2.6']
], {
  rule: 'Color ROM Notes required',
  keys: ['coloredROMChecksum', 'coloredROMUrlOverride', 'coloredROMVersionOverride', 'coloredROMVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Color ROM Notes required | Add Color ROM Notes when using Color ROM URL Override.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: 1 error', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'coloredRom field-coloredROMNotes: Color ROM Notes required. Add Color ROM Notes when using Color ROM URL Override.'
  ],
  download: 'blocked'
});
await scenario('Color ROM URL without a version', [...COLOR,
  ['fill', 'coloredROMUrlOverride', ROM_URL], ['fill', 'coloredROMNotes', 'From the URL']
], {
  rule: 'Color ROM version override required',
  keys: ['coloredROMChecksum', 'coloredROMNotes', 'coloredROMUrlOverride', 'coloredROMVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Color ROM version override required | Add Color ROM Version Override when using Color ROM URL Override.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: 1 error', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'coloredRom field-coloredROMVersionOverride: Color ROM version override required. Add Color ROM Version Override when using Color ROM URL Override.'
  ],
  download: 'blocked'
});
await scenario('Color ROM version without a URL', [...COLOR, ['fill', 'coloredROMVersionOverride', '2.6']], {
  rule: 'Color ROM URL override required',
  keys: ['coloredROMChecksum', 'coloredROMVersionOverride', 'coloredROMVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Color ROM URL override required | Add Color ROM URL Override when using Color ROM Version Override.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: 1 error', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'coloredRom field-coloredROMUrlOverride: Color ROM URL override required. Add Color ROM URL Override when using Color ROM Version Override.'
  ],
  download: 'blocked'
});
await scenario('Color ROM bundled without notes', [...LOTR, ['bundle', 'altColorFiles', true], ['fill', 'coloredROMChecksum', MD5_PAL]], {
  rule: 'Bundled Color ROM needs notes',
  keys: ['coloredROMBundled', 'coloredROMChecksum', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Bundled Color ROM needs notes | Describe the bundled Color ROM and where it is located.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: 1 error', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'coloredRom field-coloredROMNotes: Bundled Color ROM needs notes. Describe the bundled Color ROM and where it is located.'
  ],
  download: 'blocked'
});
await scenario('Color ROM override with nothing filled', [...LOTR, ['override', 'altColorFiles', true], ['fill', 'coloredROMChecksum', MD5_PAL]], {
  rule: 'Color ROM Notes required',
  keys: ['coloredROMChecksum', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Color ROM Notes required | Add Color ROM Notes. Override has no VPS entry to fill it in.',
    'error: Color ROM URL Override required | Add Color ROM URL Override. Override has no VPS entry to fill it in.',
    'error: Color ROM Version Override required | Add Color ROM Version Override. Override has no VPS entry to fill it in.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: 3 errors', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'coloredRom field-coloredROMNotes: Color ROM Notes required. Add Color ROM Notes. Override has no VPS entry to fill it in.',
    'coloredRom field-coloredROMUrlOverride: Color ROM URL Override required. Add Color ROM URL Override. Override has no VPS entry to fill it in.',
    'coloredRom field-coloredROMVersionOverride: Color ROM Version Override required. Add Color ROM Version Override. Override has no VPS entry to fill it in.'
  ],
  download: 'blocked'
});
// See 'backglass override with the checksum empty too' (decision 5).
await scenario('Color ROM override with the checksum empty too', [...LOTR, ['override', 'altColorFiles', true]], {
  rule: 'Color ROM Checksum required',
  keys: ['fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Color ROM Checksum required | Add a valid MD5 value for Color ROM Checksum.',
    'error: Color ROM Notes required | Add Color ROM Notes. Override has no VPS entry to fill it in.',
    'error: Color ROM URL Override required | Add Color ROM URL Override. Override has no VPS entry to fill it in.',
    'error: Color ROM Version Override required | Add Color ROM Version Override. Override has no VPS entry to fill it in.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: 4 errors', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'coloredRom field-coloredROMChecksum: Color ROM Checksum required. Add a valid MD5 value for Color ROM Checksum.',
    'coloredRom field-coloredROMNotes: Color ROM Notes required. Add Color ROM Notes. Override has no VPS entry to fill it in.',
    'coloredRom field-coloredROMUrlOverride: Color ROM URL Override required. Add Color ROM URL Override. Override has no VPS entry to fill it in.',
    'coloredRom field-coloredROMVersionOverride: Color ROM Version Override required. Add Color ROM Version Override. Override has no VPS entry to fill it in.'
  ],
  download: 'blocked'
});

// --- Additional ROMs -------------------------------------------------------
//
// Tales from the Crypt, the one table with several ROMs. The Additional ROM
// dialog checks an entry before it will add it, so a bad entry can only
// arrive the way a user's older file brings one in: through Import, whose
// Additional ROM block is applied without that check.
//
// The error dot shows on the ROM tab only. Until 2026-10-04 it also showed on
// the VPX tab's Advanced Config header: the feature validator took the first
// .additional-rom-controls on the page, and the VPX tab's Additional Passwords
// control shares that class. A "vpx additionalRoms" dot here means it is back.
//
// The dialog shows one line per problem: an entry with two problems lists both
// under the same title. Until 2026-10-11 the dialog skipped a title it had
// already added, so it listed only the first while the tab counted two.

function talesFromTheCrypt(entries) {
  const block = entries.map(entry => Object.entries(entry)
    .map(([key, value], index) => (index ? '    ' : '  - ') + key + ': "' + value + '"')
    .join('\n')).join('\n');
  return [
    '---',
    'fps: 60',
    'romChecksum: "' + MD5_ROM + '"',
    'romVPSId: "s-4c6GqaOn"',
    'tableVPSId: "fXaQ33KC"',
    'testers:',
    '  - "Tester"',
    'vpxChecksum: "' + MD5_VPX + '"',
    'vpxVPSId: "xkDq6Aub"',
    'additionalRoms:',
    block,
    ''
  ].join('\n');
}
const imported = entries => [['import', talesFromTheCrypt(entries)]];

await scenario('clean Additional ROM', imported([{ vpsId: 'WshhKlRf', checksum: MD5_ADD }]), {
  keys: ['additionalRoms', 'vpsId', 'checksum', 'fps', 'romChecksum', 'romVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'success: Everything looks good. | The build is ready to copy or download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: ready', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [],
  download: 'fXaQ33KC_table-config.yml',
  downloadMatchesPreview: true
});
await scenario('Additional ROM without a VPS ID', imported([{ checksum: MD5_ADD }]), {
  rule: 'Additional ROM 1 needs attention',
  keys: ['additionalRoms', 'checksum', 'fps', 'romChecksum', 'romVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Additional ROM 1 needs attention | Select a ROM VPS ID.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 1 error', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'rom additionalRoms: Additional ROM 1 needs attention. Select a ROM VPS ID.'
  ],
  download: 'blocked'
});
await scenario('Additional ROM without a checksum', imported([{ vpsId: 'WshhKlRf' }]), {
  rule: 'Additional ROM 1 needs attention',
  keys: ['additionalRoms', 'vpsId', 'fps', 'romChecksum', 'romVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Additional ROM 1 needs attention | Checksum is required.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 1 error', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'rom additionalRoms: Additional ROM 1 needs attention. Checksum is required.'
  ],
  download: 'blocked'
});
await scenario('Additional ROM checksum not an MD5', imported([{ vpsId: 'WshhKlRf', checksum: 'NOT-A-HASH' }]), {
  rule: 'Additional ROM 1 needs attention',
  keys: ['additionalRoms', 'vpsId', 'checksum', 'fps', 'romChecksum', 'romVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Additional ROM 1 needs attention | Checksum must contain exactly 32 hexadecimal characters.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 1 error', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'rom additionalRoms: Additional ROM 1 needs attention. Checksum must contain exactly 32 hexadecimal characters.'
  ],
  download: 'blocked'
});
// A URL entry stands in for the VPS ID (vpsId XOR urlOverride), so this one
// carries no VPS ID: the version is the only thing missing.
await scenario('Additional ROM URL without a version', imported([{ checksum: MD5_ADD, urlOverride: ROM_URL }]), {
  rule: 'Additional ROM 1 needs attention',
  keys: ['additionalRoms', 'checksum', 'urlOverride', 'fps', 'romChecksum', 'romVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Additional ROM 1 needs attention | Version Override is required when URL Override is used.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 1 error', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'rom additionalRoms: Additional ROM 1 needs attention. Version Override is required when URL Override is used.'
  ],
  download: 'blocked'
});
// table.yml.example: versionOverride is optional beside a vpsId and only
// required beside a urlOverride. Until 2026-10-27 this was an error.
await scenario('Additional ROM version beside a VPS ID', imported([{ vpsId: 'WshhKlRf', checksum: MD5_ADD, versionOverride: 'tftc_303' }]), {
  keys: ['additionalRoms', 'vpsId', 'checksum', 'versionOverride', 'fps', 'romChecksum', 'romVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'success: Everything looks good. | The build is ready to copy or download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: ready', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [],
  download: 'fXaQ33KC_table-config.yml',
  downloadMatchesPreview: true
});
await scenario('Additional ROM with a VPS ID and a URL', imported([{ vpsId: 'WshhKlRf', checksum: MD5_ADD, versionOverride: 'tftc_303', urlOverride: ROM_URL }]), {
  rule: 'Additional ROM 1 needs attention',
  keys: ['additionalRoms', 'vpsId', 'checksum', 'versionOverride', 'urlOverride', 'fps', 'romChecksum', 'romVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Additional ROM 1 needs attention | Use either a VPS ID or a URL Override, not both.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 1 error', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'rom additionalRoms: Additional ROM 1 needs attention. Use either a VPS ID or a URL Override, not both.'
  ],
  download: 'blocked'
});
await scenario('bundled Additional ROM', imported([{ checksum: MD5_ADD, bundled: 'true', notes: 'In the table zip' }]), {
  keys: ['additionalRoms', 'checksum', 'bundled', 'notes', 'fps', 'romChecksum', 'romVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'success: Everything looks good. | The build is ready to copy or download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: ready', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [],
  download: 'fXaQ33KC_table-config.yml',
  downloadMatchesPreview: true
});
await scenario('bundled Additional ROM without notes', imported([{ checksum: MD5_ADD, bundled: 'true' }]), {
  rule: 'Additional ROM 1 needs attention',
  keys: ['additionalRoms', 'checksum', 'bundled', 'fps', 'romChecksum', 'romVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Additional ROM 1 needs attention | Notes are required for a bundled ROM: say where it is in the download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 1 error', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'rom additionalRoms: Additional ROM 1 needs attention. Notes are required for a bundled ROM: say where it is in the download.'
  ],
  download: 'blocked'
});
await scenario('Additional ROM is the primary ROM', imported([{ vpsId: 's-4c6GqaOn', checksum: MD5_ADD }]), {
  rule: 'Additional ROM 1 needs attention',
  keys: ['additionalRoms', 'vpsId', 'checksum', 'fps', 'romChecksum', 'romVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Additional ROM 1 needs attention | The primary ROM cannot also be an Additional ROM.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 1 error', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'rom additionalRoms: Additional ROM 1 needs attention. The primary ROM cannot also be an Additional ROM.'
  ],
  download: 'blocked'
});
await scenario('Additional ROM not on this table', imported([{ vpsId: 'notAnEntry', checksum: MD5_ADD }]), {
  rule: 'Additional ROM 1 needs attention',
  keys: ['additionalRoms', 'vpsId', 'checksum', 'fps', 'romChecksum', 'romVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Additional ROM 1 needs attention | The selected Additional ROM is not available for this table.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 1 error', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'rom additionalRoms: Additional ROM 1 needs attention. The selected Additional ROM is not available for this table.'
  ],
  download: 'blocked'
});
await scenario('Additional ROM listed twice', imported([{ vpsId: 'WshhKlRf', checksum: MD5_ADD }, { vpsId: 'WshhKlRf', checksum: MD5_ADD }]), {
  rule: 'Additional ROM 2 needs attention',
  keys: ['additionalRoms', 'vpsId', 'checksum', 'vpsId', 'checksum', 'fps', 'romChecksum', 'romVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Additional ROM 1 needs attention | That ROM is already in Additional ROMs.',
    'error: Additional ROM 2 needs attention | That ROM is already in Additional ROMs.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 2 errors', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  // One problem per line since decision 5 piece 3 (2026-10-18): every dot
  // keeps its plain text that way; the Additional ROM dot joined with spaces.
  dots: [
    'rom additionalRoms: Additional ROM 1 needs attention. That ROM is already in Additional ROMs.\nAdditional ROM 2 needs attention. That ROM is already in Additional ROMs.'
  ],
  download: 'blocked'
});

// Pinned from the pre-merge validators on 2026-10-05 (validator merge, Phase 1
// piece 2). The first is the one-line-per-problem rule above with two problems
// on one entry (re-pinned 2026-10-11, Phase 2 decision 3: it showed one line);
// the second has a v090 and a feature issue in the dialog at once, which no
// other scenario does, so it pins their order.
await scenario('Additional ROM with two problems', imported([{ checksum: 'NOT-A-HASH' }]), {
  rule: 'Additional ROM 1 needs attention',
  keys: ['additionalRoms', 'checksum', 'fps', 'romChecksum', 'romVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Additional ROM 1 needs attention | Select a ROM VPS ID.',
    'error: Additional ROM 1 needs attention | Checksum must contain exactly 32 hexadecimal characters.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 2 errors', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  // One problem per line since decision 5 piece 3, as above.
  dots: [
    'rom additionalRoms: Additional ROM 1 needs attention. Select a ROM VPS ID.\nAdditional ROM 1 needs attention. Checksum must contain exactly 32 hexadecimal characters.'
  ],
  download: 'blocked'
});
const withRomVersion = entries => [['import', talesFromTheCrypt(entries).replace('vpxChecksum:', 'romVersionOverride: "tftc_303"\nvpxChecksum:')]];
await scenario('v090 and feature issues together', withRomVersion([{ checksum: MD5_ADD }]), {
  rule: 'ROM URL override required',
  keys: ['additionalRoms', 'checksum', 'fps', 'romChecksum', 'romVersionOverride', 'romVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: ROM URL override required | Add ROM URL Override when using ROM Version Override.',
    'error: Additional ROM 1 needs attention | Select a ROM VPS ID.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: 2 errors', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'rom additionalRoms: Additional ROM 1 needs attention. Select a ROM VPS ID.',
    'rom field-romUrlOverride: ROM URL override required. Add ROM URL Override when using ROM Version Override.'
  ],
  download: 'blocked'
});

// The Additional ROM editor draws its own dots. Since 2026-10-19 their
// tooltip is one problem per line, like the builder's. The primary ROM listed
// twice (import-only) puts two problems on the editor's ROM field.
if (!PRINT) {
  await play(imported([{ vpsId: 's-4c6GqaOn', checksum: MD5_ADD }, { vpsId: 's-4c6GqaOn', checksum: MD5_ADD }]));
  const tip = await app.run(async () => {
    const settle = () => new Promise(resolve => {
      const frames = n => n ? requestAnimationFrame(() => frames(n - 1)) : setTimeout(resolve, 0);
      frames(3);
    });
    document.getElementById('config-tab-rom').click();
    await settle();
    document.querySelector('#config-panel-rom .additional-rom-indicator').click();
    await settle();
    document.getElementById('additionalRomSave').click();
    await settle();
    const dot = document.getElementById('additionalRomVpsId')?.closest('.field')?.querySelector(':scope > .field-error-dot');
    const lines = [...(dot?.querySelectorAll('.error-dot-tip > .error-dot-tip-line') || [])].map(line => line.textContent);
    const result = {
      tooltip: dot?.dataset.tooltip || '',
      lines,
      label: dot?.getAttribute('aria-label') || '',
      pseudo: dot ? getComputedStyle(dot, '::before').content : ''
    };
    // The body scrolls, so a tip above its top edge is cut off under the header.
    dot?.focus();
    const box = dot?.querySelector(':scope > .error-dot-tip')?.getBoundingClientRect();
    const body = dot?.closest('.dialog-body')?.getBoundingClientRect();
    const spot = dot?.getBoundingClientRect();
    result.below = box && spot ? box.top >= spot.bottom : false;
    result.inside = box && body ? box.top >= body.top && box.height > 0 : false;
    document.getElementById('additionalRomVpsId').closest('dialog')?.close();
    return result;
  });
  const both = ['The primary ROM cannot also be an Additional ROM.', 'That ROM is already in Additional ROMs.'];
  check('the editor dot\'s tooltip is one problem per line', tip.tooltip === both.join('\n'), JSON.stringify(tip));
  check('the editor dot shows each problem on its own line', JSON.stringify(tip.lines) === JSON.stringify(both), JSON.stringify(tip.lines));
  check('the editor dot\'s label still reads as one sentence', tip.label === both.join(' '), tip.label);
  check('the editor dot\'s plain pseudo tooltip steps aside', tip.pseudo === 'none', tip.pseudo);
  check('the editor dot\'s tooltip opens below the dot', tip.below === true, JSON.stringify(tip));
  check('the editor dot\'s tooltip is not cut off under the header', tip.inside === true, JSON.stringify(tip));
}

// Since 2026-10-19 the editor's dots are live once a Save ROM has failed:
// quiet on open, then each edit (and a file drop) re-checks the entry, until
// the editor reopens.
if (!PRINT) {
  await play(imported([{ vpsId: 'WshhKlRf', checksum: 'NOT-A-HASH' }]));
  const live = await app.run(async (md5) => {
    const settle = () => new Promise(resolve => {
      const frames = n => n ? requestAnimationFrame(() => frames(n - 1)) : setTimeout(resolve, 0);
      frames(3);
    });
    const node = () => document.getElementById('additionalRomDialog');
    const dots = () => [...node().querySelectorAll('.field-error-dot')]
      .map(dot => dot.closest('.field').querySelector('input, select').id.replace('additionalRom', ''));
    const edit = async (id, value, type) => {
      const control = document.getElementById('additionalRom' + id);
      control.value = value;
      control.dispatchEvent(new Event(type, { bubbles: true }));
      await settle();
      return dots();
    };
    const openEditor = async () => {
      document.querySelector('#config-panel-rom .additional-rom-indicator').click();
      await settle();
    };
    const save = async () => {
      document.getElementById('additionalRomSave').click();
      await settle();
      return dots();
    };
    const result = {};
    document.getElementById('config-tab-rom').click();
    await settle();
    await openEditor();
    result.opened = dots();
    result.typedBeforeSave = await edit('Checksum', 'X', 'input');
    await edit('Checksum', 'NOT-A-HASH', 'input');
    result.saved = await save();
    result.fixed = await edit('Checksum', md5, 'input');
    result.broken = await edit('VpsId', '', 'change');
    node().close();
    await openEditor();
    result.reopened = dots();
    result.typedAfterReopen = await edit('Checksum', 'Y', 'input');
    await edit('Checksum', 'NOT-A-HASH', 'input');
    result.savedAgain = await save();
    const drop = new DataTransfer();
    drop.items.add(new File(['additional rom bytes'], 'rom.zip'));
    document.getElementById('additionalRomChecksumField')
      .dispatchEvent(new DragEvent('drop', { dataTransfer: drop, bubbles: true, cancelable: true }));
    const hint = node().querySelector('.checksum-drop-hint');
    for (let wait = 0; wait < 100 && !hint.textContent.startsWith('MD5 calculated'); wait += 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await settle();
    result.hint = hint.textContent;
    result.dropped = dots();
    node().close();
    return result;
  }, MD5_ADD);
  const shown = JSON.stringify(live);
  check('the editor opens with no dots', live.opened.length === 0, shown);
  check('typing before the first Save draws no dots', live.typedBeforeSave.length === 0, shown);
  check('a failed Save dots the checksum', JSON.stringify(live.saved) === '["Checksum"]', shown);
  check('fixing the checksum clears its dot at once', live.fixed.length === 0, shown);
  check('blanking the VPS ID dots it at once', JSON.stringify(live.broken) === '["VpsId"]', shown);
  check('reopening the editor starts quiet again', live.reopened.length === 0 && live.typedAfterReopen.length === 0, shown);
  check('the second Save dots the checksum again', JSON.stringify(live.savedAgain) === '["Checksum"]', shown);
  check('a file drop that fills the checksum clears its dot', live.hint.startsWith('MD5 calculated') && live.dropped.length === 0, shown);
}

await app.close();
report('yaml-rules-rom');
