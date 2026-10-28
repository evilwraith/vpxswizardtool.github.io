// One scenario per validation rule: the PUP Pack and DMD tabs.
//
// Piece B of the YAML run-through; see yaml-rules-main.test.mjs for how these
// files are built and yaml-scenarios.mjs for the runner.
//   SNAPSHOT=print node tests/yaml-rules-pup-dmd.test.mjs

import { report } from './harness.mjs';
import { startScenarios } from './yaml-scenarios.mjs';

const { app, scenario } = await startScenarios();

const MD5_VPX = 'E6DF3800F7C9286FA195E84034DA683A';
const MD5_ARCHIVE = 'B3500DC847FF54988DB01C2FFDD0AAA0';
const MD5_PUP = '9CC6161300C1E0AC76D73EC6B847EE7C';
const MAIN = [['fill', 'fps', '60'], ['fill', 'testers', 'Tester']];

// Lord of the Rings, for its VPS PUP Pack.
const LOTR = [['search', '5RybGX4Q'], ['asset', 'tableFiles', 'ulolpyXq'], ...MAIN, ['fill', 'vpxChecksum', MD5_VPX]];
const PUP_FIELDS = [['fill', 'pupVersion', '1.0.1'], ['fill', 'pupArchiveRoot', 'PUPVideos/lotr'], ['fill', 'pupArchiveFormat', 'zip']];
const PUP = [...LOTR, ['asset', 'pupPackFiles', 'nM-kQQy3SN'], ['fill', 'pupChecksum', MD5_PUP], ...PUP_FIELDS];

// Pink Floyd, the smallest clean build, for the DMD (which has no VPS entry).
const PINK_FLOYD = [['search', 'Lgi1JLk0Vf'], ['asset', 'tableFiles', 'qV3Z3oQ8md'], ...MAIN, ['fill', 'vpxChecksum', MD5_VPX]];
// A standalone DMD: Override, a type, and its own download.
const DMD = [...PINK_FLOYD, ['override', 'specialDMD', true], ['dmdType', 'FlexDMD']];
const DMD_FIELDS = {
  specialDMDChecksum: MD5_ARCHIVE,
  specialDMDUrlOverride: 'https://example.com/flexdmd.zip',
  specialDMDVersion: '1.0',
  specialDMDArchiveRoot: 'FlexDMD',
  specialDMDArchiveFormat: 'zip'
};
const dmdWithout = (...left) => [...DMD, ...Object.entries(DMD_FIELDS)
  .filter(([key]) => !left.includes(key))
  .map(([key, value]) => ['fill', key, value])];

await scenario('clean PUP Pack', PUP, {
  keys: ['fps', 'pupArchiveFormat', 'pupArchiveRoot', 'pupChecksum', 'pupVersion', 'pupVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'success: Everything looks good. | The build is ready to copy or download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: ready', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [],
  download: '5RybGX4Q_table-config.yml',
  downloadMatchesPreview: true
});

// --- PUP Pack --------------------------------------------------------------

await scenario('PUP checksum empty', [...LOTR, ['asset', 'pupPackFiles', 'nM-kQQy3SN'], ...PUP_FIELDS], {
  rule: 'PUP Pack Checksum required',
  keys: ['fps', 'pupArchiveFormat', 'pupArchiveRoot', 'pupVersion', 'pupVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: PUP Pack Checksum required | Add a valid MD5 value for PUP Pack Checksum.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: 1 error', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'pup field-pupChecksum: PUP Pack Checksum required. Add a valid MD5 value for PUP Pack Checksum.'
  ],
  download: 'blocked'
});
await scenario('PUP checksum not an MD5', [...PUP, ['fill', 'pupChecksum', 'NOT-A-HASH']], {
  rule: 'PUP Pack Checksum MD5 invalid',
  keys: ['fps', 'pupArchiveFormat', 'pupArchiveRoot', 'pupChecksum', 'pupVersion', 'pupVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: PUP Pack Checksum MD5 invalid | Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: 1 error', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'pup field-pupChecksum: PUP Pack Checksum MD5 invalid. Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  download: 'blocked'
});
await scenario('PUP version empty', [...PUP, ['fill', 'pupVersion', '']], {
  rule: 'PUP Pack Version required',
  keys: ['fps', 'pupArchiveFormat', 'pupArchiveRoot', 'pupChecksum', 'pupVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: PUP Pack Version required | Add PUP Pack Version before copying or downloading.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: 1 error', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'pup field-pupVersion: PUP Pack Version required. Add PUP Pack Version before copying or downloading.'
  ],
  download: 'blocked'
});
await scenario('PUP archive root empty', [...PUP, ['fill', 'pupArchiveRoot', '']], {
  rule: 'PUP Pack Archive Root required',
  keys: ['fps', 'pupArchiveFormat', 'pupChecksum', 'pupVersion', 'pupVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: PUP Pack Archive Root required | Add PUP Pack Archive Root before copying or downloading.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: 1 error', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'pup field-pupArchiveRoot: PUP Pack Archive Root required. Add PUP Pack Archive Root before copying or downloading.'
  ],
  download: 'blocked'
});
await scenario('PUP archive format empty', [...PUP, ['fill', 'pupArchiveFormat', '']], {
  rule: 'PUP Pack Archive Format required',
  keys: ['fps', 'pupArchiveRoot', 'pupChecksum', 'pupVersion', 'pupVPSId', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: PUP Pack Archive Format required | Add PUP Pack Archive Format before copying or downloading.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: 1 error', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'pup field-pupArchiveFormat: PUP Pack Archive Format required. Add PUP Pack Archive Format before copying or downloading.'
  ],
  download: 'blocked'
});
await scenario('PUP bundled without notes', [...LOTR, ['bundle', 'pupPackFiles', true], ['fill', 'pupChecksum', MD5_PUP], ...PUP_FIELDS], {
  rule: 'Bundled PUP Pack needs notes',
  keys: ['fps', 'pupArchiveFormat', 'pupArchiveRoot', 'pupBundled', 'pupChecksum', 'pupVersion', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Bundled PUP Pack needs notes | Describe the bundled PUP Pack and where it is located.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: 1 error', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'pup field-pupNotes: Bundled PUP Pack needs notes. Describe the bundled PUP Pack and where it is located.'
  ],
  download: 'blocked'
});
await scenario('PUP override with nothing filled', [...LOTR, ['override', 'pupPackFiles', true], ['fill', 'pupChecksum', MD5_PUP], ...PUP_FIELDS], {
  rule: 'PUP Pack Notes required',
  keys: ['fps', 'pupArchiveFormat', 'pupArchiveRoot', 'pupChecksum', 'pupVersion', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: PUP Pack Notes required | Add PUP Pack Notes. Override has no VPS entry to fill it in.',
    'error: PUP Pack URL required | Add PUP Pack URL. Override has no VPS entry to fill it in.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: 2 errors', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'pup field-pupNotes: PUP Pack Notes required. Add PUP Pack Notes. Override has no VPS entry to fill it in.',
    'pup field-pupFileUrl: PUP Pack URL required. Add PUP Pack URL. Override has no VPS entry to fill it in.'
  ],
  download: 'blocked'
});

// --- DMD -------------------------------------------------------------------

await scenario('clean standalone DMD', dmdWithout(), {
  keys: ['fps', 'specialDMDArchiveFormat', 'specialDMDArchiveRoot', 'specialDMDChecksum', 'specialDMDType', 'specialDMDUrlOverride', 'specialDMDVersion', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'success: Everything looks good. | The build is ready to copy or download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: ready'],
  dots: [],
  download: 'Lgi1JLk0Vf_table-config.yml',
  downloadMatchesPreview: true
});
// A bundled DMD ships inside the VPX's own archive, so vpxChecksum must carry
// the archive's MD5 next to the .vpx's. Typing gives the field one value;
// a list of two arrives by dropping the archive, or by Import as here.
await scenario('clean bundled DMD', [['import', [
  '---',
  'fps: 60',
  'specialDMDArchiveFormat: "zip"',
  'specialDMDArchiveRoot: "FlexDMD"',
  'specialDMDBundled: true',
  'specialDMDType: "FlexDMD"',
  'tableVPSId: "Lgi1JLk0Vf"',
  'testers:',
  '  - "Tester"',
  'vpxChecksum:',
  '  - "' + MD5_VPX + '"',
  '  - "' + MD5_ARCHIVE + '"',
  'vpxVPSId: "qV3Z3oQ8md"',
  ''
].join('\n')]], {
  keys: ['fps', 'specialDMDArchiveRoot', 'specialDMDBundled', 'specialDMDType', 'tableVPSId', 'testers', 'vpxArchiveFormat', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'success: Everything looks good. | The build is ready to copy or download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: ready'],
  dots: [],
  download: 'Lgi1JLk0Vf_table-config.yml',
  downloadMatchesPreview: true
});

// The tab stays shut until a type is picked, so a missing type is reported
// from the asset row alone (see buildIssues in validationRules.js).
await scenario('DMD ticked without a type', [...PINK_FLOYD, ['override', 'specialDMD', true]], {
  rule: 'DMD Type required',
  keys: ['fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: DMD Type required | Add DMD Type before copying or downloading.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [],
  download: 'blocked'
});
await scenario('DMD archive root empty', dmdWithout('specialDMDArchiveRoot'), {
  rule: 'DMD Archive Root required',
  keys: ['fps', 'specialDMDArchiveFormat', 'specialDMDChecksum', 'specialDMDType', 'specialDMDUrlOverride', 'specialDMDVersion', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: DMD Archive Root required | Add DMD Archive Root before copying or downloading.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: 1 error'],
  dots: [
    'dmd field-specialDMDArchiveRoot: DMD Archive Root required. Add DMD Archive Root before copying or downloading.'
  ],
  download: 'blocked'
});
await scenario('DMD archive format empty', dmdWithout('specialDMDArchiveFormat'), {
  rule: 'DMD Archive Format required',
  keys: ['fps', 'specialDMDArchiveRoot', 'specialDMDChecksum', 'specialDMDType', 'specialDMDUrlOverride', 'specialDMDVersion', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: DMD Archive Format required | Add DMD Archive Format before copying or downloading.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: 1 error'],
  dots: [
    'dmd field-specialDMDArchiveFormat: DMD Archive Format required. Add DMD Archive Format before copying or downloading.'
  ],
  download: 'blocked'
});
await scenario('DMD checksum empty', dmdWithout('specialDMDChecksum'), {
  rule: 'DMD Checksum required',
  keys: ['fps', 'specialDMDArchiveFormat', 'specialDMDArchiveRoot', 'specialDMDType', 'specialDMDUrlOverride', 'specialDMDVersion', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: DMD Checksum required | Add a valid MD5 value for DMD Checksum.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: 1 error'],
  dots: [
    'dmd field-specialDMDChecksum: DMD Checksum required. Add a valid MD5 value for DMD Checksum.'
  ],
  download: 'blocked'
});
await scenario('DMD checksum not an MD5', [...dmdWithout('specialDMDChecksum'), ['fill', 'specialDMDChecksum', 'NOT-A-HASH']], {
  rule: 'DMD Checksum MD5 invalid',
  keys: ['fps', 'specialDMDArchiveFormat', 'specialDMDArchiveRoot', 'specialDMDChecksum', 'specialDMDType', 'specialDMDUrlOverride', 'specialDMDVersion', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: DMD Checksum MD5 invalid | Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: 1 error'],
  dots: [
    'dmd field-specialDMDChecksum: DMD Checksum MD5 invalid. Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  download: 'blocked'
});
await scenario('DMD URL empty', dmdWithout('specialDMDUrlOverride'), {
  rule: 'DMD URL Override required',
  keys: ['fps', 'specialDMDArchiveFormat', 'specialDMDArchiveRoot', 'specialDMDChecksum', 'specialDMDType', 'specialDMDVersion', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: DMD URL Override required | Add DMD URL Override before copying or downloading.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: 1 error'],
  dots: [
    'dmd field-specialDMDUrlOverride: DMD URL Override required. Add DMD URL Override before copying or downloading.'
  ],
  download: 'blocked'
});
await scenario('DMD version empty', dmdWithout('specialDMDVersion'), {
  rule: 'DMD Version required',
  keys: ['fps', 'specialDMDArchiveFormat', 'specialDMDArchiveRoot', 'specialDMDChecksum', 'specialDMDType', 'specialDMDUrlOverride', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: DMD Version required | Add DMD Version before copying or downloading.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: 1 error'],
  dots: [
    'dmd field-specialDMDVersion: DMD Version required. Add DMD Version before copying or downloading.'
  ],
  download: 'blocked'
});
await scenario('DMD bundled with one VPX checksum', [...PINK_FLOYD,
  ['bundle', 'specialDMD', true], ['dmdType', 'FlexDMD'],
  ['fill', 'specialDMDArchiveRoot', 'FlexDMD'], ['fill', 'specialDMDArchiveFormat', 'zip']
], {
  rule: 'Bundled DMD needs both checksums',
  keys: ['fps', 'specialDMDArchiveRoot', 'specialDMDBundled', 'specialDMDType', 'tableVPSId', 'testers', 'vpxArchiveFormat', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Bundled DMD needs both checksums | Drop the bundled archive on VPX Checksum: the list must carry the archive MD5 alongside the .vpx MD5.'
  ],
  tabs: ['main: ready', 'vpx: 1 error', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: ready'],
  dots: [
    'vpx field-vpxChecksum: Bundled DMD needs both checksums. Drop the bundled archive on VPX Checksum: the list must carry the archive MD5 alongside the .vpx MD5.'
  ],
  download: 'blocked'
});
// Leaving the bundled shape releases the archive MD5 from vpxChecksum's
// second slot even when the .vpx MD5 in the first is still blank. The release
// used to count past the blank and leave the stale archive MD5 behind.
await scenario('DMD switched from bundled to Override with a blank VPX checksum', [...PINK_FLOYD,
  ['bundle', 'specialDMD', true], ['dmdType', 'FlexDMD'],
  ['fill', 'specialDMDArchiveRoot', 'FlexDMD'], ['fill', 'specialDMDArchiveFormat', 'zip'],
  ['draft', 'values.vpxChecksum', ['', MD5_ARCHIVE]],
  ['override', 'specialDMD', true]
], {
  rule: 'VPX Checksum required',
  keys: ['fps', 'specialDMDType', 'tableVPSId', 'testers', 'vpxVPSId'],
  dialog: [
    'error: VPX Checksum required | Add a valid MD5 value for VPX Checksum.',
    'error: DMD Archive Root required | Add DMD Archive Root before copying or downloading.',
    'error: DMD Archive Format required | Add DMD Archive Format before copying or downloading.',
    'error: DMD Checksum required | Add a valid MD5 value for DMD Checksum.',
    'error: DMD URL Override required | Add DMD URL Override before copying or downloading.',
    'error: DMD Version required | Add DMD Version before copying or downloading.'
  ],
  tabs: ['main: ready', 'vpx: 1 error', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: 5 errors'],
  dots: [
    'vpx field-vpxChecksum: VPX Checksum required. Add a valid MD5 value for VPX Checksum.',
    'dmd field-specialDMDChecksum: DMD Checksum required. Add a valid MD5 value for DMD Checksum.',
    'dmd field-specialDMDVersion: DMD Version required. Add DMD Version before copying or downloading.',
    'dmd field-specialDMDUrlOverride: DMD URL Override required. Add DMD URL Override before copying or downloading.',
    'dmd field-specialDMDArchiveRoot: DMD Archive Root required. Add DMD Archive Root before copying or downloading.',
    'dmd field-specialDMDArchiveFormat: DMD Archive Format required. Add DMD Archive Format before copying or downloading.'
  ],
  download: 'blocked'
});

await app.close();
report('yaml-rules-pup-dmd');
