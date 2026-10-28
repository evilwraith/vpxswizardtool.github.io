(() => {
  'use strict';

  // Manufacturer-specific checksum rules. A matching rule REPLACES the field's
  // default accepted extensions and turns on scan-inside-the-archive for the
  // one extension named. Stern ROMs ship as a bare .bin, so the loose file is
  // accepted directly and a dropped archive is scanned for the .bin inside.
  // Matched against the Manufacturer Override first, then the VPS record's own
  // manufacturer (VPS spells it exactly "Stern" — no Pinball/Electronics variants).
  const STERN_ROM_RULE = {
    Stern: { checksumExtensions: ['.bin', '.zip', '.rar', '.7z'], archiveScanExtension: '.bin' }
  };

  const CATEGORY_CONFIG = {
    tableFiles: {
      label: 'VPX', singular: 'VPX file', stepId: 'vpx', idField: 'vpxVPSId', nsfwField: 'vpxNSFW', required: true, supportsImage: true
    },
    b2sFiles: {
      label: 'B2S', singular: 'B2S file', stepId: 'b2s', idField: 'backglassVPSId', bundleField: 'backglassBundled', nsfwField: 'backglassNSFW', overrideField: 'backglassOverride', supportsImage: true
    },
    romFiles: {
      label: 'ROM', singular: 'ROM file', stepId: 'rom', idField: 'romVPSId', bundleField: 'romBundled', nsfwField: 'romNSFW', overrideField: 'romOverride'
    },
    altColorFiles: {
      label: 'Color ROM', singular: 'Color ROM file', stepId: 'coloredRom', idField: 'coloredROMVPSId', bundleField: 'coloredROMBundled', nsfwField: 'coloredROMNSFW', overrideField: 'coloredROMOverride'
    },
    pupPackFiles: {
      label: 'PUP Pack', singular: 'PUP Pack', stepId: 'pup', idField: 'pupVPSId', bundleField: 'pupBundled', nsfwField: 'pupNSFW', overrideField: 'pupOverride'
    },
    altSoundFiles: {
      label: 'Alt Sound', singular: 'Alt Sound file', stepId: 'altSound', idField: 'altSoundVPSId', bundleField: 'altSoundBundled', nsfwField: 'altSoundNSFW', overrideField: 'altSoundOverride',
      sourceFields: ['altSoundFiles'], optionFormat: 'id-version-author'
    },
    vpuPatchFiles: {
      label: 'VPU Patch', singular: 'VPU Patch file', stepId: 'vpuPatch', idField: 'diffVPSId', bundleField: 'diffBundled', nsfwField: 'diffNSFW', overrideField: 'diffOverride',
      sourceFields: ['vpuPatchFiles', 'vpuPatches', 'patchFiles']
    },
    specialDMD: {
      // A DMD is not a traditional asset. VPS holds no per-DMD entry, so there
      // is no VPS ID — hence no idField, and no name link or info button on the
      // row. The type is declared as a feature on the VPX file itself.
      //
      // dmdTypes is the fixed list the row's dropdown always offers. It is
      // deliberately NOT filtered by what the table declares: VPS feature tags
      // are not reliably labelled, so the tags drive the status light only and
      // the user picks the real type. It lives on the config so getCategoryItems
      // and renderAssetMatrix read one list instead of each keeping a copy.
      label: 'DMD', singular: 'DMD pack', stepId: 'dmd', bundleField: 'specialDMDBundled',
      nsfwField: 'specialDMDNSFW', overrideField: 'specialDMDOverride',
      customAssetRow: 'dmd', dmdTypes: ['FlexDMD', 'UltraDMD']
    }
  };

  const BUNDLE_FIELDS = [
    { name: 'B2S', yml_field: 'backglassBundled' },
    { name: 'ROM', yml_field: 'romBundled' },
    { name: 'Color ROM', yml_field: 'coloredROMBundled' },
    { name: 'PUP Pack', yml_field: 'pupBundled' },
    { name: 'Alt Sound', yml_field: 'altSoundBundled' },
    { name: 'VPU Patch', yml_field: 'diffBundled' }
  ];

  const WIZARD_STEPS = [
    {
      id: 'main', label: 'Main', legend: 'Main Configuration', always: true,
      fields: [
        { name: 'Game VPS ID', yml_field: 'tableVPSId', type: 'str', readonly: true },
        { name: 'FPS', yml_field: 'fps', type: 'int', min: 1, max: 99, maxlength: 2 },
        {
          name: 'Wizard Disabled', yml_field: 'enabled', type: 'bool', invertBoolean: true,
          tooltip: 'Checked keeps this table disabled for Wizard. Uncheck to explicitly enable it.'
        },
        { name: 'Tagline', yml_field: 'tagline', type: 'str', wide: true, responsiveTextarea: true },
        { name: 'Main Notes', yml_field: 'mainNotes', type: 'str', multiline: true, wide: true },
        { name: 'Testers', yml_field: 'testers', type: 'array', multiline: true, wide: true, placeholder: 'name, name, name' },
        { name: 'Table Name Override', yml_field: 'tableNameOverride', type: 'str', wide: true, advanced: true },
        { name: 'Table Manufacturer Override', yml_field: 'tableManufacturerOverride', type: 'str', advanced: true },
        { name: 'Year Override', yml_field: 'tableYearOverride', type: 'int', maxlength: 4, advanced: true },
        {
          name: 'Tutorial VPS ID', yml_field: 'tutorialVPSId', type: 'select',
          dynamicOptionsSource: 'tutorialFiles', optionFormat: 'id-author',
          options: [{ label: 'Select a tutorial', value: '' }]
        }
      ]
    },
    {
      id: 'vpx', label: 'VPX', legend: 'VPX File', category: 'tableFiles',
      fields: [
        { name: 'VPX ID', yml_field: 'vpxVPSId', type: 'str', readonly: true, wide: true },
        {
          name: 'VPX Checksum', yml_field: 'vpxChecksum', type: 'str', wide: true, maxlength: 32,
          checksumExtensions: ['.vpx', '.zip', '.rar', '.7z'], archiveScanExtension: '.vpx',
          // When a DMD is bundled into this same archive, ONE drop has to do
          // the work of two tabs: the .vpx inside stays the primary checksum,
          // the archive's own MD5 joins it as a second entry, and the archive's
          // format, folder list and hash all cross over to the DMD tab.
          //
          // Only in that shape. An ordinary table's drop is untouched, which
          // matters because that behaviour is already live on the site.
          bundledPairing: {
            when: 'specialDMDBundled',
            checksumField: 'specialDMDChecksum',
            formatField: 'specialDMDArchiveFormat',
            rootField: 'specialDMDArchiveRoot',
            directoriesKey: '__dmdArchiveDirectories'
          }
        },
        { name: 'VPX Notes', yml_field: 'tableNotes', type: 'str', multiline: true, wide: true },
        // Standard text in the UI and in state; written to the YML
        // base64-encoded by VPS_UTILS.encodeVpxMagic. `advanced: true` is what
        // creates the Advanced Config section on this tab, which had none.
        { name: 'Password', yml_field: 'vpxMagic', type: 'str', wide: true, advanced: true },
        // Slots 2 and 3 are revealed on demand by vpxMagicController's "+"
        // control and stay hidden until added. All four slots collapse into the
        // single vpxMagic key at serialize time, so none of these three may
        // ever reach the YML - see OMIT_FROM_YAML below, and the explicit
        // deletes in prepareData, which matter because vpxMagicAdditional
        // holds PLAIN TEXT passwords.
        { name: 'Password 2', yml_field: 'vpxMagic2', type: 'str', wide: true, advanced: true },
        { name: 'Password 3', yml_field: 'vpxMagic3', type: 'str', wide: true, advanced: true },
        {
          // customRenderer: rendered by vpxMagicController, not uiHelper
          // (productionUiExtensions strips these before the generic renderer).
          name: 'Additional Passwords', yml_field: 'vpxMagicAdditional',
          type: 'additional-passwords', advanced: true, customRenderer: true
        }
      ]
    },
    {
      id: 'b2s', label: 'Backglass', legend: 'Backglass (B2S)', category: 'b2sFiles', bundleField: 'backglassBundled',
      overrideField: 'backglassOverride',
      // Only Override (no VPS entry at all) requires these — Bundled ships
      // inside the table's own download and only needs Notes (main.js).
      overrideRequiredFields: ['backglassNotes', 'backglassAuthorsOverride', 'backglassImageOverride', 'backglassUrlOverride'],
      fields: [
        { name: 'Backglass ID', yml_field: 'backglassVPSId', type: 'str', readonly: true, wide: true },
        {
          name: 'Backglass Checksum', yml_field: 'backglassChecksum', type: 'str', wide: true, maxlength: 32,
          checksumExtensions: ['.directb2s', '.zip', '.rar', '.7z'], archiveScanExtension: '.directb2s'
        },
        { name: 'Backglass Notes', yml_field: 'backglassNotes', type: 'str', multiline: true, wide: true },
        { name: 'Backglass Authors Override', yml_field: 'backglassAuthorsOverride', type: 'array', wide: true, placeholder: 'name, name, name', advanced: true },
        { name: 'Backglass Image Override', yml_field: 'backglassImageOverride', type: 'url', wide: true, advanced: true },
        { name: 'Backglass URL Override', yml_field: 'backglassUrlOverride', type: 'url', wide: true, advanced: true }
      ]
    },
    {
      id: 'rom', label: 'ROM', legend: 'ROM File', category: 'romFiles', bundleField: 'romBundled',
      overrideField: 'romOverride',
      overrideRequiredFields: ['romNotes', 'romUrlOverride', 'romVersionOverride'],
      fields: [
        { name: 'ROM ID', yml_field: 'romVPSId', type: 'str', readonly: true, wide: true },
        {
          name: 'ROM Checksum', yml_field: 'romChecksum', type: 'str', wide: true, maxlength: 32,
          checksumExtensions: ['.zip', '.rar', '.7z'], manufacturerRules: STERN_ROM_RULE
        },
        { name: 'ROM Notes', yml_field: 'romNotes', type: 'str', multiline: true, wide: true },
        { name: 'ROM URL Override', yml_field: 'romUrlOverride', type: 'url', wide: true, advanced: true },
        { name: 'ROM Version Override', yml_field: 'romVersionOverride', type: 'str', wide: true, advanced: true },
        {
          // customRenderer: rendered by additionalRomsController, not uiHelper
          // (productionUiExtensions strips these before the generic renderer).
          // The checksum settings below are read by that controller's own drop handler.
          name: 'Additional ROMs', yml_field: 'additionalRoms', type: 'additional-roms', advanced: true, customRenderer: true,
          checksumExtensions: ['.zip', '.rar', '.7z'], manufacturerRules: STERN_ROM_RULE
        }
      ]
    },
    {
      id: 'coloredRom', label: 'Color ROM', legend: 'Color ROM', category: 'altColorFiles', bundleField: 'coloredROMBundled',
      overrideField: 'coloredROMOverride',
      overrideRequiredFields: ['coloredROMNotes', 'coloredROMUrlOverride', 'coloredROMVersionOverride'],
      fields: [
        { name: 'Color ROM ID', yml_field: 'coloredROMVPSId', type: 'str', readonly: true, wide: true },
        {
          name: 'Color ROM Checksum', yml_field: 'coloredROMChecksum', type: 'str', wide: true, maxlength: 32,
          colorRomArchiveScan: true,
          checksumExtensionsByFlag: {
            field: 'coloredROMPin2DMD',
            false: ['.crz', '.pal', '.pac', '.cromc'],
            true: ['.pal', '.vni']
          }
        },
        { name: 'PAL/VNI', yml_field: 'coloredROMPin2DMD', type: 'bool' },
        {
          name: 'Color ROM Checksum #2', yml_field: 'coloredROMChecksumSecondary', type: 'str', wide: true, maxlength: 32,
          checksumExtensions: ['.pal', '.vni'], disabledUnless: 'coloredROMPin2DMD', omitFromYaml: true, inlineHint: 'ROM name'
        },
        { name: 'Color ROM Notes', yml_field: 'coloredROMNotes', type: 'str', multiline: true, wide: true },
        { name: 'Color ROM URL Override', yml_field: 'coloredROMUrlOverride', type: 'url', wide: true, advanced: true },
        { name: 'Color ROM Version Override', yml_field: 'coloredROMVersionOverride', type: 'str', wide: true, advanced: true }
      ]
    },
    {
      id: 'pup', label: 'PUP Pack', legend: 'PUP Pack', category: 'pupPackFiles', bundleField: 'pupBundled',
      overrideField: 'pupOverride',
      // Version/Archive Root/Archive Format are unconditionally required
      // whenever this tab is enabled (see validationRules.js). URL is
      // only required when Override is checked — a selected or bundled
      // PUP Pack doesn't need a manual download URL — same as Notes.
      overrideRequiredFields: ['pupNotes', 'pupFileUrl'],
      fields: [
        { name: 'PUP Pack ID', yml_field: 'pupVPSId', type: 'str', readonly: true, wide: true },
        {
          name: 'PUP Pack Checksum', yml_field: 'pupChecksum', type: 'str', wide: true, maxlength: 32,
          checksumExtensions: ['.zip', '.rar', '.7z'], archiveBrowser: true,
          archiveFormatField: 'pupArchiveFormat', archiveRootField: 'pupArchiveRoot'
        },
        { name: 'PUP Pack Notes', yml_field: 'pupNotes', type: 'str', multiline: true, wide: true },
        { name: 'PUP Pack Version', yml_field: 'pupVersion', type: 'str' },
        { name: 'PUP Pack URL', yml_field: 'pupFileUrl', type: 'url' },
        { name: 'PUP Pack Archive Root', yml_field: 'pupArchiveRoot', type: 'str', directoryPicker: true },
        {
          name: 'PUP Pack Archive Format', yml_field: 'pupArchiveFormat', type: 'select', hideLabel: true,
          options: [
            { label: 'PUP Pack Archive Format', value: '' },
            { label: 'ZIP', value: 'zip' },
            { label: 'RAR', value: 'rar' },
            { label: '7Z', value: '7z' }
          ]
        },
        { name: 'PUP Pack Required', yml_field: 'pupRequired', type: 'bool' }
      ]
    },
    {
      id: 'altSound', label: 'Alt Sound', legend: 'Alt Sound', category: 'altSoundFiles', bundleField: 'altSoundBundled',
      overrideField: 'altSoundOverride',
      overrideRequiredFields: ['altSoundNotes', 'altSoundArchiveRoot', 'altSoundAuthorsOverride', 'altSoundUrlOverride', 'altSoundVersionOverride'],
      fields: [
        { name: 'Alt Sound ID', yml_field: 'altSoundVPSId', type: 'str', readonly: true, wide: true },
        { name: 'Alt Sound Checksum', yml_field: 'altSoundChecksum', type: 'str', wide: true, maxlength: 32 },
        { name: 'Alt Sound Notes', yml_field: 'altSoundNotes', type: 'str', multiline: true, wide: true },
        { name: 'Alt Sound Archive Root', yml_field: 'altSoundArchiveRoot', type: 'str' },
        {
          name: 'Alt Sound Archive Format', yml_field: 'altSoundArchiveFormat', type: 'select', hideLabel: true,
          options: [
            { label: 'Alt Sound Archive Format', value: '' },
            { label: 'ZIP', value: 'zip' },
            { label: 'RAR', value: 'rar' },
            { label: '7Z', value: '7z' }
          ]
        },
        {
          name: 'Alt Sound Authors Override', yml_field: 'altSoundAuthorsOverride', type: 'array', wide: true,
          placeholder: 'name, name, name', advanced: true
        },
        { name: 'Alt Sound URL Override', yml_field: 'altSoundUrlOverride', type: 'url', wide: true, advanced: true },
        { name: 'Alt Sound Version Override', yml_field: 'altSoundVersionOverride', type: 'str', wide: true, advanced: true },
        { name: 'Alt Sound Archive Directories', yml_field: '__altSoundArchiveDirectories', type: 'str', customRenderer: true }
      ]
    },
    {
      id: 'vpuPatch', label: 'VPU Patch', legend: 'VPU Patch', category: 'vpuPatchFiles', bundleField: 'diffBundled',
      overrideField: 'diffOverride',
      overrideRequiredFields: ['diffNotes', 'diffAuthorsOverride', 'diffUrlOverride', 'diffVersionOverride'],
      fields: [
        { name: 'VPU Patch ID', yml_field: 'diffVPSId', type: 'str', readonly: true, wide: true },
        {
          name: 'VPU Patch Checksum', yml_field: 'diffChecksum', type: 'str', wide: true, maxlength: 32,
          checksumExtensions: ['.dif', '.zip', '.rar', '.7z'], archiveScanExtension: '.dif'
        },
        { name: 'Patch Notes', yml_field: 'diffNotes', type: 'str', multiline: true, wide: true },
        { name: 'Patch Authors Override', yml_field: 'diffAuthorsOverride', type: 'array', wide: true, placeholder: 'name, name, name', advanced: true },
        { name: 'Patch URL Override', yml_field: 'diffUrlOverride', type: 'url', wide: true, advanced: true },
        { name: 'Patch Version Override', yml_field: 'diffVersionOverride', type: 'str', wide: true, advanced: true }
      ]
    },
    {
      // The DMD tab's own fields are piece D of new-YML-updates.txt and are not
      // built yet. The step is registered now regardless, because
      // handleBundleChange and handleOverrideChange in main.js resolve their
      // step out of WIZARD_STEPS: with no entry here, ticking Bundled would not
      // untick Override, and unticking neither would clear the DMD values.
      //
      // No category — a DMD has no VPS entry to select, so this tab unlocks on
      // Bundled or Override only (see isStepEnabled).
      //
      // requiresValue gates the tab on a DMD type having been picked: ticking a
      // box alone is not enough to make the tab interactable.
      //
      // specialDMDType is registered here rather than left to piece D because
      // clearStepData walks step.fields — with an empty list, unticking both
      // boxes left the type behind in the YAML. It is readonly for the same
      // reason pupVPSId is: the asset row's dropdown owns the value, the tab
      // only displays it.
      id: 'dmd', label: 'DMD', legend: 'DMD', bundleField: 'specialDMDBundled',
      overrideField: 'specialDMDOverride', requiresValue: 'specialDMDType',
      // Laid out like the PUP Pack tab, minus its Required checkbox.
      //
      // The four disabledWhen fields are exactly the keys the BUNDLED shape
      // does not carry (see new-YML-updates.txt): a DMD shipping inside the
      // VPX's own archive has no download of its own, so it has no checksum,
      // notes, version or URL. Standalone (Override) needs all of them.
      overrideRequiredFields: ['specialDMDUrlOverride', 'specialDMDVersion'],
      fields: [
        { name: 'DMD Type', yml_field: 'specialDMDType', type: 'str', readonly: true, wide: true },
        {
          name: 'DMD Checksum', yml_field: 'specialDMDChecksum', type: 'str', wide: true, maxlength: 32,
          checksumExtensions: ['.zip', '.rar', '.7z'], archiveBrowser: true,
          archiveFormatField: 'specialDMDArchiveFormat', archiveRootField: 'specialDMDArchiveRoot',
          disabledWhen: 'specialDMDBundled',
          // Bundled, this is a VIEW of vpxChecksum's second entry rather than a
          // value of its own - same archive, one hash. Deriving it instead of
          // storing a copy is what stops the two drifting apart when the user
          // edits the VPX additional checksum by hand.
          mirrorFrom: { when: 'specialDMDBundled', field: 'vpxChecksum', index: 1 },
          disabledHint: 'Bundled with the VPX — enter this on the VPX tab instead.'
        },
        { name: 'DMD Notes', yml_field: 'specialDMDNotes', type: 'str', multiline: true, wide: true, disabledWhen: 'specialDMDBundled' },
        { name: 'DMD Version', yml_field: 'specialDMDVersion', type: 'str', disabledWhen: 'specialDMDBundled' },
        { name: 'DMD URL Override', yml_field: 'specialDMDUrlOverride', type: 'url', disabledWhen: 'specialDMDBundled' },
        { name: 'DMD Archive Root', yml_field: 'specialDMDArchiveRoot', type: 'str', directoryPicker: true },
        {
          name: 'DMD Archive Format', yml_field: 'specialDMDArchiveFormat', type: 'select', hideLabel: true,
          options: [
            { label: 'DMD Archive Format', value: '' },
            { label: 'ZIP', value: 'zip' },
            { label: 'RAR', value: 'rar' },
            { label: '7Z', value: '7z' }
          ]
        }
      ]
    }
  ];

  const OMIT_FROM_YAML = new Set([
    'coloredROMChecksumSecondary',
    '__pupArchiveDirectories',
    '__altSoundArchiveDirectories',
    '__dmdArchiveDirectories',
    '__checksumSources',
    '__tableManufacturer',
    // Override checkboxes are a builder-only convenience that unlocks a tab
    // without a VPS entry — the flag itself never appears in the output,
    // only the Advanced Config field values it forces the user to fill in.
    'backglassOverride',
    'romOverride',
    'coloredROMOverride',
    'pupOverride',
    'altSoundOverride',
    'diffOverride',
    'specialDMDOverride',
    // Password slots 2+ are builder-only state. They are collapsed into the
    // single vpxMagic key by prepareData; the raw keys must never be written.
    'vpxMagic2',
    'vpxMagic3',
    'vpxMagicAdditional',
    '__vpxMagicSlots'
  ]);
  const PRESET_FIELDS = new Set(['enabled', 'fps', 'testers', 'pupArchiveFormat', 'altSoundArchiveFormat']);

  window.VPS_YML_FIELDS = {
    CATEGORY_CONFIG,
    BUNDLE_FIELDS,
    WIZARD_STEPS,
    OMIT_FROM_YAML,
    PRESET_FIELDS
  };
})();