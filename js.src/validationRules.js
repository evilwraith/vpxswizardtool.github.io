(() => {
  'use strict';

  // Every validation rule in the app, in one place.
  //
  // Four validators grew up separately and never read each other (vault note
  // "VPXS Layered Validation"): validateBuild in main.js, getFieldErrors in
  // uiEnhancements.js, the feature validator in featureValidationController.js
  // and the v090 rules in v090Enhancements.js. Phase 1 of their merge (finished
  // 2026-10-06) copied each one here exactly, quirks and all, moved every
  // screen onto this file, and deleted the originals. The four sections below
  // are those copies, and each issue still carries the `system` it came from,
  // because the screens present each system the way its validator used to.
  // Phase 2 resolves the duplicates and wording differences between systems,
  // one decision at a time; the pinned scenarios in tests/yaml-*.test.mjs
  // show exactly what every rule produces.
  //
  // One rule, one wording (Phase 2 decision 5, Jason, 2026-10-15): every
  // error names the field it belongs to and draws that field's dot itself,
  // in the dialog's own words. The dots used to come from a fifth section,
  // getFieldErrors' copy, whose twin rules said the same things differently;
  // it is gone.
  //
  // An issue is { system, type, stepId, fieldName, title, message }, plus
  // generic: true on Override's every-field rule, and gate: true on the two
  // rules that report a disabled tab's missing choice. Every system now gives
  // a dialog line, a tab count, a dot and blocking; they differ in how the
  // screens present them:
  //   build    - main.js's own dialog lines, listed first
  //   feature  - Alt Sound, the tutorial, Additional ROMs
  //   v090     - URL/version pairs, Backglass overrides, VPU Patch checksum
  // An error with no fieldName (the long YAML line) is drawn on its tab's
  // first read-only field.
  //
  // ctx is { record, selections, values, yaml, isStepEnabled }, read from
  // main.js's state.

  const hasValue = value => typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null;

  function buildIssues(ctx, utils, fields) {
    const { CATEGORY_CONFIG, WIZARD_STEPS } = fields;
    const { isItemBroken, getCategoryItems, normalizeArray, isMd5Hash, normalizeChecksumValue } = utils;
    const { record, selections, values, yaml, isStepEnabled } = ctx;
    const output = [];
    // fieldName is where the error's dot is drawn (decision 5).
    const push = (type, stepId, title, message, fieldName = '') => output.push({ system: 'build', type, stepId, fieldName, title, message });
    const addError = (stepId, title, message, fieldName) => push('error', stepId, title, message, fieldName);
    const addWarning = (stepId, title, message) => push('warning', stepId, title, message);
    // The missing choice that keeps a tab closed: reported even while that
    // tab is disabled (see collectAllErrors).
    const addGate = (stepId, title, message, fieldName) => { addError(stepId, title, message, fieldName); output[output.length - 1].gate = true; };
    const hasText = hasValue;

    // With no table, the missing ID is the same fact (Phase 2 decision 2).
    if (!record) addError('main', 'No table selected', 'Search for and load a VPS table first.', 'tableVPSId');
    else if (!values.tableVPSId) addError('main', 'Missing table VPS ID', 'The selected table does not have a usable VPS ID.', 'tableVPSId');
    if (!selections.tableFiles || !values.vpxVPSId) {
      addGate('vpx', 'VPX file required', 'Select a VPX file before copying or downloading the configuration.', 'vpxVPSId');
    }

    const fpsRaw = values.fps;
    if (fpsRaw === '' || fpsRaw === undefined || fpsRaw === null) {
      addError('main', 'FPS required', 'Enter the table frame rate as an integer.', 'fps');
    } else if (!/^\d+$/.test(String(fpsRaw)) || !Number.isInteger(Number(fpsRaw))) {
      addError('main', 'FPS must be an integer', 'Use numbers only for FPS.', 'fps');
    }

    if (!normalizeArray(values.testers).length) {
      addError('main', 'Testers required', 'Enter at least one tester; separate multiple names with commas.', 'testers');
    }

    Object.entries(CATEGORY_CONFIG).forEach(([category, config]) => {
      const selectedId = selections[category];
      const items = getCategoryItems(record, category, config, { selections });
      const item = items.find(candidate => String(candidate.id || '') === String(selectedId || ''));

      if (config.bundleField && selectedId && values[config.bundleField] === true) {
        addWarning(config.stepId, `${config.label} selected and bundled`, 'Choose either a separate VPS entry or bundled status unless both are intentionally required.');
      }
      if (item && isItemBroken(item)) {
        addError(config.stepId, `${config.label} entry broken`, 'Choose another database entry before copying or downloading.', config.idField);
      }
    });

    // options.hashFields names the field each hash came from, for a value
    // assembled from two fields (PAL/VNI); otherwise every error is on key.
    const validateChecksum = (key, stepId, label, options = {}) => {
      const rawValue = options.value !== undefined ? options.value : values[key];
      const hashes = normalizeChecksumValue(rawValue);
      if (options.required && !hashes.length) {
        addError(stepId, `${label} required`, `Add a valid MD5 value for ${label}.`, key);
        return;
      }
      if (!hashes.length) return;
      if (Array.isArray(rawValue) && hashes.length < 2) {
        addError(stepId, `${label} list invalid`, 'Use a plain string for one checksum or a list containing at least two checksums.', key);
      }
      hashes.forEach((hash, index) => {
        if (!isMd5Hash(hash)) {
          addError(stepId, `${label} MD5 invalid`, 'Each checksum must contain exactly 32 hexadecimal characters.',
            options.hashFields?.[index] || key);
        }
      });
    };

    validateChecksum('vpxChecksum', 'vpx', 'VPX Checksum', { required: true });

    // Override counts as offered: its tab is open and the checksum dot used to
    // ask for it there with no dialog line or count (decision 5).
    const backglassOffered = Boolean(
      selections.b2sFiles || hasText(values.backglassUrlOverride) || values.backglassBundled === true
      || values.backglassOverride === true
    );
    validateChecksum('backglassChecksum', 'b2s', 'Backglass Checksum', { required: backglassOffered });
    if (hasText(values.backglassUrlOverride) && !hasText(values.backglassNotes)) {
      addError('b2s', 'Backglass Notes required', 'Add Backglass Notes when using Backglass URL Override.', 'backglassNotes');
    }
    if (values.backglassBundled === true && !hasText(values.backglassNotes)) {
      addError('b2s', 'Bundled Backglass needs notes', 'Describe the bundled Backglass and where it is located.', 'backglassNotes');
    }

    const romOffered = Boolean(
      selections.romFiles || hasText(values.romUrlOverride) || values.romBundled === true
      || values.romOverride === true
    );
    validateChecksum('romChecksum', 'rom', 'ROM Checksum', { required: romOffered });
    // One problem, one dot: on the URL Override, the field you would clear.
    if (hasText(values.romUrlOverride) && values.romVPSId) {
      addError('rom', 'ROM ID conflicts with URL override', 'Use either ROM ID or ROM URL Override, not both.', 'romUrlOverride');
    }
    // A ROM URL without a version is v090's ROM pair rule alone (decision 2).
    if (hasText(values.romUrlOverride) && !hasText(values.romNotes)) {
      addError('rom', 'ROM Notes required', 'Add ROM Notes when using ROM URL Override.', 'romNotes');
    }
    if (values.romBundled === true && !hasText(values.romNotes)) {
      addError('rom', 'Bundled ROM needs notes', 'Describe the bundled ROM and where it is located.', 'romNotes');
    }

    const colorOffered = Boolean(
      selections.altColorFiles || hasText(values.coloredROMUrlOverride) || values.coloredROMBundled === true
      || values.coloredROMOverride === true
    );
    const colorRawValue = values.coloredROMChecksum;
    const colorPrimary = String(Array.isArray(colorRawValue) ? (colorRawValue[0] ?? '') : (colorRawValue ?? '')).trim();
    const colorSecondary = String(values.coloredROMChecksumSecondary || '').trim();
    // A PAL/VNI pair with one half missing is the PAL/VNI rule's problem
    // alone, so the half that is there is checked as a plain value: as a list
    // of one it also failed "<label> list invalid" (decision 2).
    const pin2dmd = values.coloredROMPin2DMD === true;
    const colorValue = pin2dmd
      ? (colorPrimary && colorSecondary ? [colorPrimary, colorSecondary] : (colorPrimary || colorSecondary))
      : colorRawValue;
    const colorHashFields = pin2dmd
      ? [colorPrimary && 'coloredROMChecksum', colorSecondary && 'coloredROMChecksumSecondary'].filter(Boolean)
      : undefined;
    validateChecksum('coloredROMChecksum', 'coloredRom', 'Color ROM Checksum', {
      required: colorOffered,
      value: colorValue,
      hashFields: colorHashFields
    });
    // On the half that is missing; with both missing the primary already
    // carries "required", so this one marks the .vni slot.
    if (pin2dmd && (!colorPrimary || !colorSecondary)) {
      addError('coloredRom', 'PAL/VNI requires two checksums', 'Add the .pal checksum and the .vni checksum.',
        colorSecondary ? 'coloredROMChecksum' : 'coloredROMChecksumSecondary');
    }
    if (hasText(values.coloredROMUrlOverride) && !hasText(values.coloredROMNotes)) {
      addError('coloredRom', 'Color ROM Notes required', 'Add Color ROM Notes when using Color ROM URL Override.', 'coloredROMNotes');
    }
    if (values.coloredROMBundled === true && !hasText(values.coloredROMNotes)) {
      addError('coloredRom', 'Bundled Color ROM needs notes', 'Describe the bundled Color ROM and where it is located.', 'coloredROMNotes');
    }

    const pupOffered = Boolean(
      selections.pupPackFiles || hasText(values.pupFileUrl) || values.pupBundled === true || values.pupOverride === true
    );
    validateChecksum('pupChecksum', 'pup', 'PUP Pack Checksum', { required: pupOffered });
    if (values.pupBundled === true && !hasText(values.pupNotes)) {
      addError('pup', 'Bundled PUP Pack needs notes', 'Describe the bundled PUP Pack and where it is located.', 'pupNotes');
    }
    if (isStepEnabled(WIZARD_STEPS.find(step => step.id === 'pup'))) {
      [
        ['pupVersion', 'PUP Pack Version'],
        ['pupArchiveRoot', 'PUP Pack Archive Root'],
        ['pupArchiveFormat', 'PUP Pack Archive Format']
      ].forEach(([key, label]) => {
        if (!hasText(values[key])) {
          addError('pup', `${label} required`, `Add ${label} before copying or downloading.`, key);
        }
      });
    }

    const dmdBundled = values.specialDMDBundled === true;
    const dmdOverride = values.specialDMDOverride === true;
    if (dmdBundled || dmdOverride) {
      if (!hasText(values.specialDMDType)) {
        addGate('dmd', 'DMD Type required', 'Add DMD Type before copying or downloading.', 'specialDMDType');
      }
      [
        ['specialDMDArchiveRoot', 'DMD Archive Root'],
        ['specialDMDArchiveFormat', 'DMD Archive Format']
      ].forEach(([key, label]) => {
        if (!hasText(values[key])) {
          addError('dmd', `${label} required`, `Add ${label} before copying or downloading.`, key);
        }
      });
      if (dmdBundled && normalizeChecksumValue(values.vpxChecksum).length < 2) {
        addError('vpx', 'Bundled DMD needs both checksums',
          'Drop the bundled archive on VPX Checksum: the list must carry the archive MD5 alongside the .vpx MD5.', 'vpxChecksum');
      }
      if (!dmdBundled) {
        validateChecksum('specialDMDChecksum', 'dmd', 'DMD Checksum', { required: true });
        [
          ['specialDMDUrlOverride', 'DMD URL Override'],
          ['specialDMDVersion', 'DMD Version']
        ].forEach(([key, label]) => {
          if (!hasText(values[key])) {
            addError('dmd', `${label} required`, `Add ${label} before copying or downloading.`, key);
          }
        });
      }
    }

    validateChecksum('diffChecksum', 'vpuPatch', 'VPU Patch Checksum');
    if (hasText(values.diffUrlOverride) && !hasText(values.diffNotes)) {
      addError('vpuPatch', 'Patch Notes required', 'Add Patch Notes when using Patch URL Override.', 'diffNotes');
    }
    if (values.diffBundled === true && !hasText(values.diffNotes)) {
      addError('vpuPatch', 'Bundled VPU Patch needs notes', 'Describe the bundled VPU Patch and where it is located.', 'diffNotes');
    }

    WIZARD_STEPS.forEach(step => {
      if (!step.overrideField || values[step.overrideField] !== true) return;
      (step.overrideRequiredFields || []).forEach(key => {
        if (hasText(values[key])) return;
        const label = step.fields.find(field => field.yml_field === key)?.name || key;
        addError(step.id, `${label} required`, `Add ${label}. Override has no VPS entry to fill it in.`);
        Object.assign(output[output.length - 1], { fieldName: key, generic: true });
      });
    });

    const yamlLines = String(yaml || '').split('\n');
    const longLine = yamlLines.find((line, index) => {
      if (line.length <= 120) return false;
      const previous = yamlLines[index - 1] || '';
      return previous.trim() !== '# yamllint disable-line rule:line-length';
    });
    if (longLine) {
      addError('main', 'YAML line exceeds 120 characters', 'Shorten the value or use a supported URL field so the generated file passes yamllint.');
    }

    return output;
  }

  function featureIssues(ctx, utils) {
    const { isMd5Hash, normalizeArray } = utils;
    const { record, selections, values } = ctx;
    const output = [];
    const add = (stepId, fieldName, title, message) => output.push({ system: 'feature', type: 'error', stepId, fieldName, title, message });

    const altSoundSelected = Boolean(selections?.altSoundFiles || values?.altSoundVPSId);
    const altSoundBundled = values?.altSoundBundled === true;
    const altSoundOverride = values?.altSoundOverride === true;
    const altSoundUrl = String(values?.altSoundUrlOverride || '').trim();
    const altSoundVersion = String(values?.altSoundVersionOverride || '').trim();
    const altSoundActive = altSoundSelected || altSoundBundled || Boolean(altSoundUrl || altSoundVersion);
    const altSoundEnabled = altSoundActive || altSoundOverride;

    if (altSoundEnabled) {
      const checksums = normalizeArray(values?.altSoundChecksum);
      if (!checksums.length) {
        add('altSound', 'altSoundChecksum', 'Alt Sound Checksum required', 'Add a valid MD5 value for Alt Sound Checksum.');
      } else if (checksums.some(checksum => !isMd5Hash(checksum))) {
        add('altSound', 'altSoundChecksum', 'Alt Sound Checksum MD5 invalid', 'Each checksum must contain exactly 32 hexadecimal characters.');
      }
      if (!String(values?.altSoundArchiveFormat || '').trim()) {
        add('altSound', 'altSoundArchiveFormat', 'Alt Sound Archive Format required', 'Choose ZIP, RAR, or 7Z.');
      }
    }

    if (altSoundSelected && altSoundUrl) {
      add('altSound', 'altSoundUrlOverride', 'Choose one Alt Sound source', 'Use either Alt Sound VPS ID or Alt Sound URL Override, not both.');
    }
    if (altSoundUrl && !altSoundVersion) {
      add('altSound', 'altSoundVersionOverride', 'Alt Sound Version Override required', 'Add Alt Sound Version Override whenever Alt Sound URL Override is used.');
    }
    if (altSoundVersion && !altSoundUrl) {
      add('altSound', 'altSoundUrlOverride', 'Alt Sound URL Override required', 'Add Alt Sound URL Override whenever Alt Sound Version Override is used.');
    }
    // One missing field, one issue: bundled and a URL together still ask for
    // the notes once (Phase 2 decision 3, 2026-10-11).
    if (altSoundBundled && !String(values?.altSoundNotes || '').trim()) {
      add('altSound', 'altSoundNotes', 'Alt Sound Notes required', 'Add Alt Sound Notes when the Alt Sound ships inside the table download.');
    } else if (altSoundUrl && !String(values?.altSoundNotes || '').trim()) {
      add('altSound', 'altSoundNotes', 'Alt Sound Notes required', 'Add Alt Sound Notes when using Alt Sound URL Override.');
    }
    if (altSoundBundled && !String(values?.altSoundArchiveRoot || '').trim()) {
      add('altSound', 'altSoundArchiveRoot', 'Alt Sound Archive Root required', 'Choose the Alt Sound root folder from the uploaded Alt Sound archive.');
    }

    const tutorialId = String(values?.tutorialVPSId || '').trim();
    if (tutorialId && !record?.tutorialFiles?.some(item => String(item?.id || '') === tutorialId)) {
      add('main', 'tutorialVPSId', 'Tutorial VPS ID unavailable', 'Choose an available tutorial for this table.');
    }

    window.VPS_ADDITIONAL_ROMS?.entries?.().forEach((entry, index) => {
      window.VPS_ADDITIONAL_ROMS.validateEntry(entry, index).forEach(message => {
        add('rom', 'additionalRoms', `Additional ROM ${index + 1} needs attention`, message);
      });
    });
    return output;
  }

  function v090Issues(ctx) {
    const { values, isStepEnabled } = ctx;
    const { WIZARD_STEPS } = window.VPS_YML_FIELDS;
    const output = [];
    const add = (stepId, fieldName, title, message) => output.push({ system: 'v090', type: 'error', stepId, fieldName, title, message });
    const readValue = fieldName => (Object.prototype.hasOwnProperty.call(values, fieldName) ? values[fieldName] : '');
    const hasText = value => Array.isArray(value)
      ? value.some(item => String(item || '').trim())
      : String(value ?? '').trim().length > 0;
    const stepEnabled = stepId => {
      const step = WIZARD_STEPS.find(candidate => candidate.id === stepId);
      return Boolean(step && isStepEnabled(step));
    };
    const pair = (stepId, urlField, versionField, label, { urlOptional = false } = {}) => {
      if (!stepEnabled(stepId)) return;
      const hasUrl = hasText(readValue(urlField));
      const hasVersion = hasText(readValue(versionField));
      if (hasUrl && !hasVersion) add(stepId, versionField, `${label} version override required`, `Add ${label} Version Override when using ${label} URL Override.`);
      if (hasVersion && !hasUrl && !urlOptional) add(stepId, urlField, `${label} URL override required`, `Add ${label} URL Override when using ${label} Version Override.`);
    };

    // A bundled ROM ships inside the table's own download, so there is no URL
    // to give, but it can still need a Version Override naming the ROM the
    // table loads (Jason's call, 2026-10-02). A URL still needs a version.
    pair('rom', 'romUrlOverride', 'romVersionOverride', 'ROM', { urlOptional: readValue('romBundled') === true });
    pair('coloredRom', 'coloredROMUrlOverride', 'coloredROMVersionOverride', 'Color ROM');
    pair('vpuPatch', 'diffUrlOverride', 'diffVersionOverride', 'Patch');

    if (stepEnabled('b2s') && hasText(readValue('backglassUrlOverride'))) {
      if (!hasText(readValue('backglassAuthorsOverride'))) {
        add('b2s', 'backglassAuthorsOverride', 'Backglass authors override required', 'Add at least one Backglass Authors Override when using Backglass URL Override.');
      }
      if (!hasText(readValue('backglassImageOverride'))) {
        add('b2s', 'backglassImageOverride', 'Backglass image override required', 'Add Backglass Image Override when using Backglass URL Override.');
      }
    }

    if (stepEnabled('vpuPatch') && !hasText(readValue('diffChecksum'))) {
      add('vpuPatch', 'diffChecksum', 'VPU Patch Checksum required', 'Add a valid MD5 value for VPU Patch Checksum.');
    }
    return output;
  }

  // A tab the user cannot open raises nothing of its own; only its gate, the
  // missing choice that would open it, is reported (Phase 2 decision 1, Jason,
  // 2026-10-06). Its other rules were consequences of that one choice, sat on
  // a tab nobody could click, and made the dialog disagree with the tab
  // counts. A disabled tab's values are pruned on load, and the gate is an
  // error, so nothing that is filtered here can reach a download.
  function collectAllErrors(ctx) {
    const utils = window.VPS_UTILS;
    const fields = window.VPS_YML_FIELDS;
    const full = { record: null, selections: {}, values: {}, yaml: '', isStepEnabled: () => false, ...ctx };
    const open = stepId => {
      const step = fields.WIZARD_STEPS.find(candidate => candidate.id === stepId);
      return !step || Boolean(full.isStepEnabled(step));
    };
    const issues = [
      ...buildIssues(full, utils, fields),
      ...featureIssues(full, utils),
      ...v090Issues(full)
    ].filter(issue => issue.gate || open(issue.stepId));
    // One problem, one issue (Phase 2 decision 2, Jason, 2026-10-10). Override's
    // "every Advanced Config field is required" is dropped from a field that a
    // more specific rule already reports: the specific one says why. Every
    // issue carries its dialog line, count, dot and blocking together
    // (decision 5), so dropping the generic one loses none of them.
    const covered = new Set(issues
      .filter(issue => issue.fieldName && !issue.generic)
      .map(issue => `${issue.stepId}:${issue.fieldName}`));
    return issues.filter(issue => !issue.generic || !covered.has(`${issue.stepId}:${issue.fieldName}`));
  }

  window.VPS_VALIDATION = Object.freeze({ collectAllErrors });
})();
