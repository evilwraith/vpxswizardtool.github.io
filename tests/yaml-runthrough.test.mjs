// Jason's real builds driven through the app, plus the preview's WRAP toggle.
//
// The two scenarios here are Piece A of the YAML run-through: whole real
// builds, checked line for line against the YAML Jason actually ships. The
// one-rule-per-scenario set (Piece B) is in the yaml-rules-*.test.mjs files.
// The runner, and what a scenario records, is in yaml-scenarios.mjs.
//   SNAPSHOT=print node tests/yaml-runthrough.test.mjs

import { check, report } from './harness.mjs';
import { startScenarios } from './yaml-scenarios.mjs';

const { app, scenario, PRINT } = await startScenarios();

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

// Jason's real Pink Floyd build: VPX, a VPS backglass, a bundled ROM with a
// Version Override and no URL. Clean, and it downloads.
//
// Both of its earlier refusals were fixed 2026-10-02 because of this file:
// the 118-character tagline used to come out as a 129-character quoted line
// (the fold check measured the value, not the line), and a bundled ROM's
// Version Override used to demand a URL (system 3's pair rule).
await scenario('Pink Floyd clean build', [
  ['search', 'Lgi1JLk0Vf'],
  ['asset', 'tableFiles', 'qV3Z3oQ8md'],
  ['asset', 'b2sFiles', 'WlwK5P4-tj'],
  ['bundle', 'romFiles', true],
  ['fill', 'fps', '60'],
  ['fill', 'testers', 'TechZombie, Sscorpio, Coffee Joe, Boris'],
  ['fill', 'tagline', "'If ya don't eat yer meat, you can't have any pudding! How can ya have any pudding if ya don't eat ya meat?' - Teacher"],
  ['fill', 'mainNotes', "Note: There is a known bug on this table, sometimes the ball gets stuck on the right ramp. There isn't really anything that can be done about it. But it doesn't happen too often."],
  ['fill', 'vpxChecksum', 'E6DF3800F7C9286FA195E84034DA683A'],
  ['fill', 'tableNotes', "Download 'Pink Floyd NO PUPPack.zip'"],
  ['fill', 'backglassChecksum', 'B3500DC847FF54988DB01C2FFDD0AAA0'],
  ['fill', 'backglassNotes', 'Download version 1.0'],
  ['fill', 'backglassAuthorsOverride', 'CoffeeAtJoes'],
  ['fill', 'romChecksum', 'E4C898AFCDCF6FD2A884C77C7FD6C3A9'],
  ['fill', 'romNotes', "'esha_l4c.zip' in the VPX download zip"],
  ['fill', 'romVersionOverride', 'esha_l4c']
], {
  yaml: [
    '---',
    'backglassAuthorsOverride:',
    '  - "CoffeeAtJoes"',
    'backglassChecksum: "B3500DC847FF54988DB01C2FFDD0AAA0"',
    'backglassNotes: "Download version 1.0"',
    'backglassVPSId: "WlwK5P4-tj"',
    'fps: 60',
    'mainNotes: >-',
    "  Note: There is a known bug on this table, sometimes the ball gets stuck on the right ramp. There isn't really anything",
    "  that can be done about it. But it doesn't happen too often.",
    'romBundled: true',
    'romChecksum: "E4C898AFCDCF6FD2A884C77C7FD6C3A9"',
    `romNotes: "'esha_l4c.zip' in the VPX download zip"`,
    'romVersionOverride: "esha_l4c"',
    `tableNotes: "Download 'Pink Floyd NO PUPPack.zip'"`,
    'tableVPSId: "Lgi1JLk0Vf"',
    'tagline: >-',
    "  'If ya don't eat yer meat, you can't have any pudding! How can ya have any pudding if ya don't eat ya meat?' - Teacher",
    'testers:',
    '  - "TechZombie"',
    '  - "Sscorpio"',
    '  - "Coffee Joe"',
    '  - "Boris"',
    'vpxChecksum: "E6DF3800F7C9286FA195E84034DA683A"',
    'vpxVPSId: "qV3Z3oQ8md"',
    ''
  ],
  // The words the preview colours as keys. The folded mainNotes opens with
  // "Note:", which was coloured as a key until 2026-10-04; it must stay plain.
  keys: [
    'backglassAuthorsOverride', 'backglassChecksum', 'backglassNotes', 'backglassVPSId',
    'fps', 'mainNotes', 'romBundled', 'romChecksum', 'romNotes', 'romVersionOverride',
    'tableNotes', 'tableVPSId', 'tagline', 'testers', 'vpxChecksum', 'vpxVPSId'
  ],
  dialog: [
    'success: Everything looks good. | The build is ready to copy or download.'
  ],
  tabs: [
    'main: ready',
    'vpx: ready',
    'b2s: ready',
    'rom: ready',
    'coloredRom: disabled',
    'pup: disabled',
    'altSound: disabled',
    'vpuPatch: disabled',
    'dmd: disabled'
  ],
  dots: [],
  download: 'Lgi1JLk0Vf_table-config.yml',
  downloadMatchesPreview: true
});

// Jason's real Lord of the Rings build with one thing missing: the Alt Sound
// checksum. Exactly one error, on the Alt Sound tab, and Download refuses.
await scenario('Lord of the Rings, Alt Sound checksum missing', [
  ['search', '5RybGX4Q'],
  ['asset', 'tableFiles', 'ulolpyXq'],
  ['asset', 'b2sFiles', 'oKIJBxNPPj'],
  ['asset', 'altColorFiles', 'afptXEiuqn'],
  ['asset', 'altSoundFiles', '6vSAjw2Gmk'],
  ['override', 'romFiles', true],
  ['fill', 'fps', '60'],
  ['fill', 'testers', 'Missile Toad, Wraith, Filth'],
  ['fill', 'tagline', 'Fly, you fools!'],
  ['fill', 'tutorialVPSId', '5qwHwININZ'],
  ['fill', 'vpxChecksum', '1E0F48976BD4AC0B3ED151D74FB96DC5'],
  ['fill', 'tableNotes', 'Download - Lord of the Rings (Stern 2003) VPW 1.6.vpx'],
  ['fill', 'backglassChecksum', '5A15BE05433596F7056E18FE6456B4B6'],
  ['fill', 'backglassNotes', 'Download - Lord Of The Rings (Stern 2003), The.directb2s'],
  ['fill', 'romChecksum', '9CC6161300C1E0AC76D73EC6B847EE7C'],
  ['fill', 'romNotes', 'Download - lotr.zip'],
  ['fill', 'romUrlOverride', 'https://www.vpforums.org/index.php?app=downloads&showfile=7316'],
  ['fill', 'romVersionOverride', 'lotr'],
  ['fill', 'coloredROMChecksum', '32EFAB94D0B710EE89C401B8DD3D6850'],
  ['fill', 'coloredROMNotes', 'Download - pin2dmd.pac'],
  ['fill', 'altSoundNotes', 'Download - lotr.rar'],
  ['fill', 'altSoundArchiveRoot', 'lotr'],
  ['fill', 'altSoundArchiveFormat', 'rar']
], {
  // Line for line his real table-lordoftheringsvalinor.yml, minus the
  // altSoundChecksum this scenario leaves out (diffed 2026-10-02).
  yaml: [
    '---',
    'altSoundArchiveFormat: "rar"',
    'altSoundArchiveRoot: "lotr"',
    'altSoundNotes: "Download - lotr.rar"',
    'altSoundVPSId: "6vSAjw2Gmk"',
    'backglassChecksum: "5A15BE05433596F7056E18FE6456B4B6"',
    'backglassNotes: "Download - Lord Of The Rings (Stern 2003), The.directb2s"',
    'backglassVPSId: "oKIJBxNPPj"',
    'coloredROMChecksum: "32EFAB94D0B710EE89C401B8DD3D6850"',
    'coloredROMNotes: "Download - pin2dmd.pac"',
    'coloredROMVPSId: "afptXEiuqn"',
    'fps: 60',
    'romChecksum: "9CC6161300C1E0AC76D73EC6B847EE7C"',
    'romNotes: "Download - lotr.zip"',
    'romUrlOverride: "https://www.vpforums.org/index.php?app=downloads&showfile=7316"',
    'romVersionOverride: "lotr"',
    'tableNotes: "Download - Lord of the Rings (Stern 2003) VPW 1.6.vpx"',
    'tableVPSId: "5RybGX4Q"',
    'tagline: "Fly, you fools!"',
    'testers:',
    '  - "Missile Toad"',
    '  - "Wraith"',
    '  - "Filth"',
    'tutorialVPSId: "5qwHwININZ"',
    'vpxChecksum: "1E0F48976BD4AC0B3ED151D74FB96DC5"',
    'vpxVPSId: "ulolpyXq"',
    ''
  ],
  dialog: [
    'error: Alt Sound Checksum required | Add a valid MD5 value for Alt Sound Checksum.'
  ],
  tabs: [
    'main: ready',
    'vpx: ready',
    'b2s: ready',
    'rom: ready',
    'coloredRom: ready',
    'pup: disabled',
    'altSound: 1 error',
    'vpuPatch: disabled',
    'dmd: disabled'
  ],
  dots: [
    'altSound field-altSoundChecksum: Alt Sound Checksum required. Add a valid MD5 value for Alt Sound Checksum.'
  ],
  download: 'blocked'
});

// ---------------------------------------------------------------------------
// The preview's WRAP toggle (added 2026-10-03)
// ---------------------------------------------------------------------------

// Runs on the build the last scenario left loaded. Checked (the default), the
// YAML wraps and nothing scrolls sideways. Unchecked, lines run on and the
// preview scrolls sideways instead, while the drawer, the preview and the
// toggle itself stay exactly where they were.
const wrap = await app.run(async () => {
  const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const box = document.getElementById('previewWrapToggle');
  const pre = document.getElementById('previewYaml');
  const drawer = document.getElementById('previewDrawer');
  const label = box?.closest('label');
  const frame = pre.parentElement;
  const measure = () => ({
    whiteSpace: getComputedStyle(pre).whiteSpace,
    scrolls: pre.scrollWidth > pre.clientWidth + 1,
    drawerWidth: drawer.getBoundingClientRect().width,
    preWidth: pre.getBoundingClientRect().width,
    labelRight: Math.round(frame.getBoundingClientRect().right - label.getBoundingClientRect().right),
    labelTop: Math.round(label.getBoundingClientRect().top - frame.getBoundingClientRect().top)
  });
  if (!box) return { missing: true };
  const result = { viewport: innerWidth, checkedAtLoad: box.checked, text: label.textContent.trim() };
  result.wrapped = measure();
  box.click();
  await settle();
  result.unwrapped = measure();
  pre.scrollLeft = 200;
  await settle();
  result.scrolledLeft = pre.scrollLeft;
  result.afterScroll = measure();
  box.click();
  await settle();
  result.rewrapped = measure();
  return result;
});

if (PRINT) {
  console.log('\n=== WRAP toggle');
  console.log(JSON.stringify(wrap, null, 2));
} else {
  check('wrap: toggle exists', !wrap.missing);
  // The page scrollbar takes its share of the 1400, so test the layout itself:
  // the drawer is the fixed 340px side column, not the phone layout's full width.
  check('wrap: desktop layout, drawer is the 340px side column', wrap.wrapped?.drawerWidth === 340, JSON.stringify(wrap.wrapped) + ' viewport ' + wrap.viewport);
  check('wrap: labelled WRAP and checked at load', wrap.text === 'WRAP' && wrap.checkedAtLoad === true, JSON.stringify(wrap));
  check('wrap: checked wraps, no sideways scroll', wrap.wrapped?.whiteSpace === 'pre-wrap' && !wrap.wrapped.scrolls, JSON.stringify(wrap.wrapped));
  check('wrap: unchecked stops wrapping and scrolls sideways', wrap.unwrapped?.whiteSpace === 'pre' && wrap.unwrapped.scrolls && wrap.scrolledLeft > 0, JSON.stringify(wrap.unwrapped) + ' scrollLeft ' + wrap.scrolledLeft);
  check('wrap: drawer and preview keep their width',
    wrap.unwrapped?.drawerWidth === wrap.wrapped?.drawerWidth && wrap.unwrapped.preWidth === wrap.wrapped.preWidth,
    JSON.stringify([wrap.wrapped, wrap.unwrapped]));
  check('wrap: toggle stays pinned top-right while the YAML scrolls',
    JSON.stringify([wrap.afterScroll?.labelRight, wrap.afterScroll?.labelTop]) === JSON.stringify([wrap.wrapped?.labelRight, wrap.wrapped?.labelTop]) && wrap.wrapped.labelRight < 20 && wrap.wrapped.labelTop < 20,
    JSON.stringify([wrap.wrapped, wrap.afterScroll]));
  check('wrap: re-checking wraps again', wrap.rewrapped?.whiteSpace === 'pre-wrap' && !wrap.rewrapped.scrolls, JSON.stringify(wrap.rewrapped));
}

await app.close();
report('yaml-runthrough');
