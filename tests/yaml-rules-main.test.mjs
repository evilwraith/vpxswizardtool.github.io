// One scenario per validation rule: the Main, VPX and Backglass tabs.
//
// Piece B of the YAML run-through. Each scenario starts from the smallest
// clean build and changes one thing, so the rule it names is the reason it
// fails. What it pins is everything the user sees, duplicates included: the
// three validators (vault note "VPXS Layered Validation") are to be merged,
// and the merge has to change these expectations on purpose.
// The runner is yaml-scenarios.mjs.
//   SNAPSHOT=print node tests/yaml-rules-main.test.mjs

import { check, report } from './harness.mjs';
import { startScenarios } from './yaml-scenarios.mjs';

const { app, scenario, play, PRINT } = await startScenarios();

const MD5_VPX = 'E6DF3800F7C9286FA195E84034DA683A';
const MD5_B2S = 'B3500DC847FF54988DB01C2FFDD0AAA0';

// Pink Floyd with a VPX, its checksum, FPS and a tester: the smallest build
// the app accepts. Every scenario below is this plus or minus one thing.
const TABLE = [['search', 'Lgi1JLk0Vf'], ['asset', 'tableFiles', 'qV3Z3oQ8md']];
const MAIN = [['fill', 'fps', '60'], ['fill', 'testers', 'Tester']];
const BASE = [...TABLE, ...MAIN, ['fill', 'vpxChecksum', MD5_VPX]];
// The same with a VPS backglass, checksum included.
const B2S = [...BASE, ['asset', 'b2sFiles', 'WlwK5P4-tj'], ['fill', 'backglassChecksum', MD5_B2S]];

await scenario('clean base build', BASE, {
  keys: ['fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'success: Everything looks good. | The build is ready to copy or download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [],
  download: 'Lgi1JLk0Vf_table-config.yml',
  downloadMatchesPreview: true
});
await scenario('clean base build with a backglass', B2S, {
  keys: ['backglassChecksum', 'backglassVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'success: Everything looks good. | The build is ready to copy or download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: ready', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [],
  download: 'Lgi1JLk0Vf_table-config.yml',
  downloadMatchesPreview: true
});

// --- Main ------------------------------------------------------------------

await scenario('nothing loaded', [], {
  rule: 'No table selected',
  keys: [],
  dialog: [
    'error: No table selected | Search for and load a VPS table first.',
    'error: VPX file required | Select a VPX file before copying or downloading the configuration.',
    'error: FPS required | Enter the table frame rate as an integer.',
    'error: Testers required | Enter at least one tester; separate multiple names with commas.'
  ],
  tabs: ['main: 3 errors', 'vpx: disabled', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'main field-tableVPSId: No table selected. Search for and load a VPS table first.',
    'main field-fps: FPS required. Enter the table frame rate as an integer.',
    'main field-testers: Testers required. Enter at least one tester; separate multiple names with commas.'
  ],
  download: 'blocked'
});
// The configuration tabs only render once a VPX is picked, so this is the
// state straight after the search.
await scenario('no VPX selected', [['search', 'Lgi1JLk0Vf']], {
  rule: 'VPX file required',
  keys: ['tableVPSId'],
  dialog: [
    'error: VPX file required | Select a VPX file before copying or downloading the configuration.',
    'error: FPS required | Enter the table frame rate as an integer.',
    'error: Testers required | Enter at least one tester; separate multiple names with commas.'
  ],
  tabs: ['main: 2 errors', 'vpx: disabled', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'main field-fps: FPS required. Enter the table frame rate as an integer.',
    'main field-testers: Testers required. Enter at least one tester; separate multiple names with commas.'
  ],
  download: 'blocked'
});
await scenario('FPS empty', [...BASE, ['fill', 'fps', '']], {
  rule: 'FPS required',
  keys: ['tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: FPS required | Enter the table frame rate as an integer.'
  ],
  tabs: ['main: 1 error', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'main field-fps: FPS required. Enter the table frame rate as an integer.'
  ],
  download: 'blocked'
});
// Defensive: the FPS box strips anything but digits as it is typed in.
await scenario('FPS not a number (from a draft)', [...BASE, ['draft', 'values.fps', '6x']], {
  rule: 'FPS must be an integer',
  keys: ['fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: FPS must be an integer | Use numbers only for FPS.'
  ],
  tabs: ['main: 1 error', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'main field-fps: FPS must be an integer. Use numbers only for FPS.'
  ],
  download: 'blocked'
});
await scenario('testers empty', [...BASE, ['fill', 'testers', '']], {
  rule: 'Testers required',
  keys: ['fps', 'tableVPSId', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Testers required | Enter at least one tester; separate multiple names with commas.'
  ],
  tabs: ['main: 1 error', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'main field-testers: Testers required. Enter at least one tester; separate multiple names with commas.'
  ],
  download: 'blocked'
});
// Lists are never folded, so a long enough tester name is the one value that
// can still write a line past yamllint's 120.
await scenario('YAML line over 120', [...BASE, ['fill', 'testers', 'T'.repeat(120)]], {
  rule: 'YAML line exceeds 120 characters',
  keys: ['fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: YAML line exceeds 120 characters | Shorten the value or use a supported URL field so the generated file passes yamllint.'
  ],
  tabs: ['main: 1 error', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'main field-tableVPSId: YAML line exceeds 120 characters. Shorten the value or use a supported URL field so the generated file passes yamllint.'
  ],
  download: 'blocked'
});
// Defensive: the tutorial dropdown only offers the table's own tutorials.
await scenario('tutorial not on this table (from a draft)', [...BASE, ['draft', 'values.tutorialVPSId', 'notATutorial']], {
  rule: 'Tutorial VPS ID unavailable',
  keys: ['fps', 'tableVPSId', 'testers', 'tutorialVPSId', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Tutorial VPS ID unavailable | Choose an available tutorial for this table.'
  ],
  tabs: ['main: 1 error', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'main field-tutorialVPSId: Tutorial VPS ID unavailable. Choose an available tutorial for this table.'
  ],
  download: 'blocked'
});

// --- VPX -------------------------------------------------------------------

await scenario('VPX checksum empty', [...TABLE, ...MAIN], {
  rule: 'VPX Checksum required',
  keys: ['fps', 'tableVPSId', 'testers', 'vpxVPSId'],
  dialog: [
    'error: VPX Checksum required | Add a valid MD5 value for VPX Checksum.'
  ],
  tabs: ['main: ready', 'vpx: 1 error', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'vpx field-vpxChecksum: VPX Checksum required. Add a valid MD5 value for VPX Checksum.'
  ],
  download: 'blocked'
});
await scenario('VPX checksum not an MD5', [...TABLE, ...MAIN, ['fill', 'vpxChecksum', 'NOT-A-HASH']], {
  rule: 'VPX Checksum MD5 invalid',
  keys: ['fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: VPX Checksum MD5 invalid | Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  tabs: ['main: ready', 'vpx: 1 error', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'vpx field-vpxChecksum: VPX Checksum MD5 invalid. Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  download: 'blocked'
});
// A list of one is never written by the app or kept by the importer, and a
// draft that holds one has it turned into a plain string as it loads
// (migrateBuildValues in main.js, Phase 2 decision 4, 2026-10-12). Until then
// it raised "VPX Checksum list invalid"; the next scenario is the one case
// the load leaves for that rule.
await scenario('VPX checksum list of one (from a draft)', [...BASE, ['draft', 'values.vpxChecksum', [MD5_VPX]]], {
  yaml: [
    '---',
    'fps: 60',
    'tableVPSId: "Lgi1JLk0Vf"',
    'testers:',
    '  - "Tester"',
    'vpxChecksum: "E6DF3800F7C9286FA195E84034DA683A"',
    'vpxVPSId: "qV3Z3oQ8md"',
    ''
  ],
  keys: ['fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'success: Everything looks good. | The build is ready to copy or download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [],
  download: 'Lgi1JLk0Vf_table-config.yml',
  downloadMatchesPreview: true
});
// A lone entry behind a blank first one is a secondary, not the primary, so
// the load keeps the list and the missing primary is still reported (the
// pr-checker follow-up to decision 4, 2026-10-12).
await scenario('VPX checksum list with a blank first entry (from a draft)', [...BASE, ['draft', 'values.vpxChecksum', ['', MD5_VPX]]], {
  rule: 'VPX Checksum list invalid',
  keys: ['fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: VPX Checksum list invalid | Use a plain string for one checksum or a list containing at least two checksums.'
  ],
  tabs: ['main: ready', 'vpx: 1 error', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'vpx field-vpxChecksum: VPX Checksum list invalid. Use a plain string for one checksum or a list containing at least two checksums.'
  ],
  download: 'blocked'
});

// Saving the Additional Checksums dialog leaves a blank primary blank. It used
// to promote the archive MD5 into the VPX slot and clear the error (Jason,
// 2026-10-13).
await scenario('VPX checksum list with a blank first entry, saved unchanged in Additional Checksums', [...BASE, ['draft', 'values.vpxChecksum', ['', MD5_VPX]], ['additional', 'vpxChecksum', [MD5_VPX]]], {
  rule: 'VPX Checksum list invalid',
  keys: ['fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: VPX Checksum list invalid | Use a plain string for one checksum or a list containing at least two checksums.'
  ],
  tabs: ['main: ready', 'vpx: 1 error', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'vpx field-vpxChecksum: VPX Checksum list invalid. Use a plain string for one checksum or a list containing at least two checksums.'
  ],
  download: 'blocked'
});
// What the VPX tab shows on the page that scenario left open: an empty box,
// since there is no primary, and the one extra counted on the dialog button.
// The box used to show the archive MD5 while its dot said "required".
if (!PRINT) {
  const shown = await app.run(async () => {
    document.getElementById('validationDialog').close();
    document.getElementById('config-tab-vpx').click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))));
    const input = document.getElementById('field-vpxChecksum');
    const button = input?.closest('.field')?.querySelector('.checksum-additional-btn');
    return JSON.stringify({ box: input?.value ?? null, extras: button?.dataset.count ?? null });
  });
  check('VPX tab: blank primary shows an empty box and one extra', shown === JSON.stringify({ box: '', extras: '1' }), shown);
}
await scenario('VPX checksum list with a blank first entry, extra removed in Additional Checksums', [...BASE, ['draft', 'values.vpxChecksum', ['', MD5_VPX]], ['additional', 'vpxChecksum', []]], {
  rule: 'VPX Checksum required',
  keys: ['fps', 'tableVPSId', 'testers', 'vpxVPSId'],
  dialog: [
    'error: VPX Checksum required | Add a valid MD5 value for VPX Checksum.'
  ],
  tabs: ['main: ready', 'vpx: 1 error', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'vpx field-vpxChecksum: VPX Checksum required. Add a valid MD5 value for VPX Checksum.'
  ],
  download: 'blocked'
});

// The Additional Checksums dialog over a filled primary: an extra is kept
// behind it, and removing the extra again collapses the field to a plain
// string.
await scenario('VPX checksum with an extra added in Additional Checksums', [...BASE, ['additional', 'vpxChecksum', [MD5_B2S]]], {
  yaml: [
    '---',
    'fps: 60',
    'tableVPSId: "Lgi1JLk0Vf"',
    'testers:',
    '  - "Tester"',
    'vpxChecksum:',
    '  - "E6DF3800F7C9286FA195E84034DA683A"',
    '  - "B3500DC847FF54988DB01C2FFDD0AAA0"',
    'vpxVPSId: "qV3Z3oQ8md"',
    ''
  ],
  keys: ['fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'success: Everything looks good. | The build is ready to copy or download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [],
  download: 'Lgi1JLk0Vf_table-config.yml',
  downloadMatchesPreview: true
});
await scenario('VPX checksum extra added, then removed in Additional Checksums', [...BASE, ['additional', 'vpxChecksum', [MD5_B2S]], ['additional', 'vpxChecksum', []]], {
  yaml: [
    '---',
    'fps: 60',
    'tableVPSId: "Lgi1JLk0Vf"',
    'testers:',
    '  - "Tester"',
    'vpxChecksum: "E6DF3800F7C9286FA195E84034DA683A"',
    'vpxVPSId: "qV3Z3oQ8md"',
    ''
  ],
  keys: ['fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'success: Everything looks good. | The build is ready to copy or download.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [],
  download: 'Lgi1JLk0Vf_table-config.yml',
  downloadMatchesPreview: true
});
// Typing the primary box empty leaves index 0 blank. It used to promote the
// extra into the primary slot (Jason, 2026-10-13).
await scenario('VPX checksum with an extra, primary typed empty', [...BASE, ['additional', 'vpxChecksum', [MD5_B2S]], ['fill', 'vpxChecksum', '']], {
  rule: 'VPX Checksum list invalid',
  keys: ['fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: VPX Checksum list invalid | Use a plain string for one checksum or a list containing at least two checksums.'
  ],
  tabs: ['main: ready', 'vpx: 1 error', 'b2s: disabled', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'vpx field-vpxChecksum: VPX Checksum list invalid. Use a plain string for one checksum or a list containing at least two checksums.'
  ],
  download: 'blocked'
});

// --- Backglass -------------------------------------------------------------

await scenario('backglass checksum empty', [...BASE, ['asset', 'b2sFiles', 'WlwK5P4-tj']], {
  rule: 'Backglass Checksum required',
  keys: ['backglassVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Backglass Checksum required | Add a valid MD5 value for Backglass Checksum.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: 1 error', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'b2s field-backglassChecksum: Backglass Checksum required. Add a valid MD5 value for Backglass Checksum.'
  ],
  download: 'blocked'
});
await scenario('backglass checksum not an MD5', [...BASE, ['asset', 'b2sFiles', 'WlwK5P4-tj'], ['fill', 'backglassChecksum', 'NOT-A-HASH']], {
  rule: 'Backglass Checksum MD5 invalid',
  keys: ['backglassChecksum', 'backglassVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Backglass Checksum MD5 invalid | Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: 1 error', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'b2s field-backglassChecksum: Backglass Checksum MD5 invalid. Each checksum must contain exactly 32 hexadecimal characters.'
  ],
  download: 'blocked'
});
// The same no-promotion rule on another tab: an extra added under an empty
// Backglass Checksum stays an extra.
await scenario('backglass checksum extra added with the primary empty', [...BASE, ['asset', 'b2sFiles', 'WlwK5P4-tj'], ['additional', 'backglassChecksum', [MD5_B2S]]], {
  rule: 'Backglass Checksum list invalid',
  keys: ['backglassChecksum', 'backglassVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Backglass Checksum list invalid | Use a plain string for one checksum or a list containing at least two checksums.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: 1 error', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'b2s field-backglassChecksum: Backglass Checksum list invalid. Use a plain string for one checksum or a list containing at least two checksums.'
  ],
  download: 'blocked'
});
await scenario('backglass URL override without notes', [...B2S,
  ['fill', 'backglassUrlOverride', 'https://example.com/pinkfloyd.directb2s'],
  ['fill', 'backglassAuthorsOverride', 'CoffeeAtJoes'],
  ['fill', 'backglassImageOverride', 'https://example.com/pinkfloyd.png']
], {
  rule: 'Backglass Notes required',
  keys: ['backglassAuthorsOverride', 'backglassChecksum', 'backglassImageOverride', 'backglassUrlOverride', 'backglassVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Backglass Notes required | Add Backglass Notes when using Backglass URL Override.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: 1 error', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'b2s field-backglassNotes: Backglass Notes required. Add Backglass Notes when using Backglass URL Override.'
  ],
  download: 'blocked'
});
await scenario('backglass URL override without authors', [...B2S,
  ['fill', 'backglassUrlOverride', 'https://example.com/pinkfloyd.directb2s'],
  ['fill', 'backglassNotes', 'Download version 1.0'],
  ['fill', 'backglassImageOverride', 'https://example.com/pinkfloyd.png']
], {
  rule: 'Backglass authors override required',
  keys: ['backglassChecksum', 'backglassImageOverride', 'backglassNotes', 'backglassUrlOverride', 'backglassVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Backglass authors override required | Add at least one Backglass Authors Override when using Backglass URL Override.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: 1 error', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'b2s field-backglassAuthorsOverride: Backglass authors override required. Add at least one Backglass Authors Override when using Backglass URL Override.'
  ],
  download: 'blocked'
});
await scenario('backglass URL override without image', [...B2S,
  ['fill', 'backglassUrlOverride', 'https://example.com/pinkfloyd.directb2s'],
  ['fill', 'backglassNotes', 'Download version 1.0'],
  ['fill', 'backglassAuthorsOverride', 'CoffeeAtJoes']
], {
  rule: 'Backglass image override required',
  keys: ['backglassAuthorsOverride', 'backglassChecksum', 'backglassNotes', 'backglassUrlOverride', 'backglassVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Backglass image override required | Add Backglass Image Override when using Backglass URL Override.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: 1 error', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'b2s field-backglassImageOverride: Backglass image override required. Add Backglass Image Override when using Backglass URL Override.'
  ],
  download: 'blocked'
});
await scenario('backglass bundled without notes', [...BASE, ['bundle', 'b2sFiles', true], ['fill', 'backglassChecksum', MD5_B2S]], {
  rule: 'Bundled Backglass needs notes',
  keys: ['backglassBundled', 'backglassChecksum', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Bundled Backglass needs notes | Describe the bundled Backglass and where it is located.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: 1 error', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'b2s field-backglassNotes: Bundled Backglass needs notes. Describe the bundled Backglass and where it is located.'
  ],
  download: 'blocked'
});
await scenario('backglass selected and bundled', [...B2S, ['bundle', 'b2sFiles', true], ['fill', 'backglassNotes', 'In the table download']], {
  rule: 'B2S selected and bundled',
  keys: ['backglassBundled', 'backglassChecksum', 'backglassNotes', 'backglassVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'warning: B2S selected and bundled | Choose either a separate VPS entry or bundled status unless both are intentionally required.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: 1 warning', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [],
  download: 'Lgi1JLk0Vf_table-config.yml',
  downloadMatchesPreview: true
});
await scenario('backglass override with nothing filled', [...BASE, ['override', 'b2sFiles', true], ['fill', 'backglassChecksum', MD5_B2S]], {
  rule: 'Backglass Notes required',
  keys: ['backglassChecksum', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Backglass Notes required | Add Backglass Notes. Override has no VPS entry to fill it in.',
    'error: Backglass Authors Override required | Add Backglass Authors Override. Override has no VPS entry to fill it in.',
    'error: Backglass Image Override required | Add Backglass Image Override. Override has no VPS entry to fill it in.',
    'error: Backglass URL Override required | Add Backglass URL Override. Override has no VPS entry to fill it in.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: 4 errors', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'b2s field-backglassNotes: Backglass Notes required. Add Backglass Notes. Override has no VPS entry to fill it in.',
    'b2s field-backglassAuthorsOverride: Backglass Authors Override required. Add Backglass Authors Override. Override has no VPS entry to fill it in.',
    'b2s field-backglassImageOverride: Backglass Image Override required. Add Backglass Image Override. Override has no VPS entry to fill it in.',
    'b2s field-backglassUrlOverride: Backglass URL Override required. Add Backglass URL Override. Override has no VPS entry to fill it in.'
  ],
  download: 'blocked'
});
// Override opens the tab, so the checksum is asked for there before any URL
// is typed: one rule gives the dot and the dialog line (decision 5).
await scenario('backglass override with the checksum empty too', [...BASE, ['override', 'b2sFiles', true]], {
  rule: 'Backglass Checksum required',
  keys: ['fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: Backglass Checksum required | Add a valid MD5 value for Backglass Checksum.',
    'error: Backglass Notes required | Add Backglass Notes. Override has no VPS entry to fill it in.',
    'error: Backglass Authors Override required | Add Backglass Authors Override. Override has no VPS entry to fill it in.',
    'error: Backglass Image Override required | Add Backglass Image Override. Override has no VPS entry to fill it in.',
    'error: Backglass URL Override required | Add Backglass URL Override. Override has no VPS entry to fill it in.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: 5 errors', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'b2s field-backglassChecksum: Backglass Checksum required. Add a valid MD5 value for Backglass Checksum.',
    'b2s field-backglassNotes: Backglass Notes required. Add Backglass Notes. Override has no VPS entry to fill it in.',
    'b2s field-backglassAuthorsOverride: Backglass Authors Override required. Add Backglass Authors Override. Override has no VPS entry to fill it in.',
    'b2s field-backglassImageOverride: Backglass Image Override required. Add Backglass Image Override. Override has no VPS entry to fill it in.',
    'b2s field-backglassUrlOverride: Backglass URL Override required. Add Backglass URL Override. Override has no VPS entry to fill it in.'
  ],
  download: 'blocked'
});
// Defensive: the dropdown disables a broken entry and the importer refuses
// one, so only a saved draft can carry it.
//
// There is no "<asset> ID unavailable" rule: sanitizeAssetSelections in main.js
// drops any selection the table does not offer every time a table loads, a
// restored draft included, and the importer refuses one, so it could never
// fire. Removed 2026-10-19.
await scenario('backglass entry broken (from a draft)', [...B2S, ['draft', 'record.b2sFiles.0.broken', true]], {
  rule: 'B2S entry broken',
  keys: ['backglassChecksum', 'backglassVPSId', 'fps', 'tableVPSId', 'testers', 'vpxChecksum', 'vpxVPSId'],
  dialog: [
    'error: B2S entry broken | Choose another database entry before copying or downloading.'
  ],
  tabs: ['main: ready', 'vpx: ready', 'b2s: 1 error', 'rom: disabled', 'coloredRom: disabled', 'pup: disabled', 'altSound: disabled', 'vpuPatch: disabled', 'dmd: disabled'],
  dots: [
    'b2s field-backglassVPSId: B2S entry broken. Choose another database entry before copying or downloading.'
  ],
  download: 'blocked'
});

// No rule names a field that is missing from the page today, so the check
// swaps in a rulebook that adds one. Its dot must still show, on the tab's
// first read-only field: a tab counting an error with no dot anywhere is the
// bug Jason caught live on 2026-10-14 (pr-checker on 3433dc1).
if (!PRINT) {
  await play(BASE);
  const dots = await app.run(async () => {
    const settle = () => new Promise(resolve => {
      const frames = n => n ? requestAnimationFrame(() => frames(n - 1)) : setTimeout(resolve, 0);
      frames(3);
    });
    const real = window.VPS_VALIDATION;
    window.VPS_VALIDATION = {
      collectAllErrors: ctx => [...real.collectAllErrors(ctx), {
        system: 'build', type: 'error', stepId: 'main',
        title: 'Ghost field required', message: 'This field is not on the page.', fieldName: 'notOnThePage'
      }]
    };
    try {
      document.getElementById('config-tab-vpx').click();
      await settle();
      document.getElementById('config-tab-main').click();
      await settle();
      return [...document.querySelectorAll('.config-tab-panel .field-error-dot')].map(dot =>
        (dot.closest('.field')?.querySelector('[id^="field-"]')?.id || '?') + ': ' + dot.dataset.tooltip);
    } finally {
      window.VPS_VALIDATION = real;
    }
  });
  check('an error on a field missing from the page still gets its dot, on the first read-only field',
    dots.join('\n') === 'field-tableVPSId: Ghost field required. This field is not on the page.', dots.join('\n'));
}

// The dot's tooltip in the real page (decision 5, piece 2): a real element
// with the headline in bold, the old plain pseudo tooltip gone, hidden until
// the dot is hovered or focused.
if (!PRINT) {
  await play([...TABLE, ['fill', 'testers', 'Tester'], ['fill', 'vpxChecksum', MD5_VPX]]);
  const tip = await app.run(async () => {
    const settle = () => new Promise(resolve => {
      const frames = n => n ? requestAnimationFrame(() => frames(n - 1)) : setTimeout(resolve, 0);
      frames(3);
    });
    document.getElementById('config-tab-main').click();
    await settle();
    const dot = document.getElementById('field-fps')?.closest('.field')?.querySelector(':scope > .field-error-dot');
    const box = dot?.querySelector(':scope > .error-dot-tip');
    const strong = box?.querySelector('strong');
    const result = {
      headline: strong?.textContent || '',
      weight: strong ? getComputedStyle(strong).fontWeight : '',
      text: box?.textContent || '',
      pseudo: dot ? getComputedStyle(dot, '::before').content : '',
      hidden: box ? getComputedStyle(box).display : ''
    };
    dot?.focus();
    result.focused = box ? getComputedStyle(box).display : '';
    return result;
  });
  check('the FPS dot\'s headline is bold', tip.headline === 'FPS required.' && Number(tip.weight) >= 700, JSON.stringify(tip));
  check('the FPS dot\'s tooltip reads headline then instruction',
    tip.text === 'FPS required. Enter the table frame rate as an integer.', tip.text);
  check('the plain pseudo tooltip steps aside', tip.pseudo === 'none', tip.pseudo);
  check('the tooltip is hidden until the dot is hovered or focused', tip.hidden === 'none' && tip.focused === 'block',
    JSON.stringify(tip));
}

await app.close();
report('yaml-rules-main');
