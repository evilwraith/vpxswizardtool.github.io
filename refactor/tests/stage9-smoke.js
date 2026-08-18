(() => {
  'use strict';

  const frame = document.getElementById('appFrame');
  const results = document.getElementById('results');

  function append(name, passed, detail = '') {
    const item = document.createElement('li');
    item.className = passed ? 'pass' : 'fail';
    item.textContent = `${passed ? 'PASS' : 'FAIL'} — ${name}${detail ? `: ${detail}` : ''}`;
    results.appendChild(item);
  }

  function updateSummary() {
    const items = [...results.querySelectorAll('li')];
    const summary = items.find(item => /smoke tests? failed|All \d+ smoke tests passed/.test(item.textContent));
    if (!summary) return;
    const checks = items.filter(item => item !== summary && !item.classList.contains('pending'));
    const failed = checks.filter(item => item.classList.contains('fail')).length;
    summary.className = failed ? 'fail' : 'pass';
    summary.textContent = failed
      ? `${failed} smoke test${failed === 1 ? '' : 's'} failed.`
      : `All ${checks.length} smoke tests passed.`;
  }

  async function sha256(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  async function run() {
    const appWindow = frame.contentWindow;
    const appDocument = frame.contentDocument;
    if (!appWindow || !appDocument) {
      append('Stage 9 iframe access', false, 'Unable to access the refactor frame.');
      updateSummary();
      return;
    }

    const requiredGlobals = [
      'VPS_README_TEMPLATE_RESOLVER',
      'VPS_YML_PARSER',
      'VPS_YML_IMPORT_MODEL',
      'VPS_YML_IMPORT_CONTROLLER'
    ];
    const missingGlobals = requiredGlobals.filter(name => !appWindow[name]);
    append('Stage 9 module globals', missingGlobals.length === 0, missingGlobals.join(', '));

    const scriptPaths = new Set([...appDocument.scripts].map(script => {
      try { return new URL(script.src, appWindow.location.href).pathname; } catch (_) { return ''; }
    }));
    const expectedPaths = [
      '/refactor/src/services/readmeTemplateResolver.js',
      '/refactor/src/services/ymlParser.js',
      '/refactor/src/services/ymlImportModel.js',
      '/refactor/src/controllers/ymlImportController.js'
    ];
    const missingPaths = expectedPaths.filter(path => !scriptPaths.has(path));
    const inheritedImporterLoaded = scriptPaths.has('/js.src/ymlImport.js');
    append(
      'Stage 9 script ownership',
      missingPaths.length === 0 && !inheritedImporterLoaded,
      [missingPaths.length ? `missing ${missingPaths.join(', ')}` : '', inheritedImporterLoaded ? 'legacy ymlImport.js loaded' : '']
        .filter(Boolean).join('; ')
    );

    try {
      const expectedTemplates = [
        {
          mode: 'manual',
          path: '/refactor/templates/readme/man_README.md',
          hash: 'e87931aa10930a5d2e04eeaa5b75d2fb89691b33b36eae1057d0accc96f7c36e'
        },
        {
          mode: 'wizard',
          path: '/refactor/templates/readme/wiz_README.md',
          hash: '167582d643cc0f9033b3d6272cc52dc80c9f6d5133580d402ab53572f4e88bb3'
        }
      ];
      const templateResults = await Promise.all(expectedTemplates.map(async template => {
        const response = await fetch(template.path, { cache: 'no-store' });
        if (!response.ok) return `${template.mode}: HTTP ${response.status}`;
        const content = await response.text();
        const actualHash = await sha256(content);
        return actualHash === template.hash ? '' : `${template.mode}: ${actualHash}`;
      }));
      const failures = templateResults.filter(Boolean);
      append('Vendored README template integrity', failures.length === 0, failures.join('; '));

      const resolver = appWindow.VPS_README_TEMPLATE_RESOLVER;
      const manualRoute = resolver.resolve('https://raw.githubusercontent.com/TheOminousOsie/VPXS_4KP_Readme_Gen/main/Content/man_README.md');
      const wizardRoute = resolver.resolve('https://raw.githubusercontent.com/TheOminousOsie/VPXS_4KP_Readme_Gen/main/Content/wiz_README.md');
      append(
        'README template local routing',
        manualRoute === expectedTemplates[0].path && wizardRoute === expectedTemplates[1].path,
        `${manualRoute}, ${wizardRoute}`
      );
    } catch (error) {
      append('Vendored README template integrity', false, error?.message || 'Template verification failed.');
      append('README template local routing', false, 'Template verification failed.');
    }

    try {
      const parser = appWindow.VPS_YML_PARSER;
      const parsed = parser.parseFlatYaml([
        '---',
        'tableVPSId: "table-one"',
        'enabled: true',
        'fps: 60',
        'testers:',
        '  - "Alpha"',
        '  - "Beta"',
        'notes: >-',
        '  First line',
        '  second line',
        'coloredROMChecksum: [aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb]'
      ].join('\n'));
      const parserValid = parsed.tableVPSId === 'table-one'
        && parsed.enabled === true
        && parsed.fps === 60
        && Array.isArray(parsed.testers)
        && parsed.testers.join(',') === 'Alpha,Beta'
        && parsed.notes === 'First line second line'
        && parsed.coloredROMChecksum.length === 2;
      append('Flat YML parser contract', parserValid);

      let duplicateRejected = false;
      try { parser.parseFlatYaml('tableVPSId: "one"\ntableVPSId: "two"'); }
      catch (error) { duplicateRejected = /Duplicate YML field/.test(error.message); }
      append('Flat YML duplicate rejection', duplicateRejected);
    } catch (error) {
      append('Flat YML parser contract', false, error?.message || 'Parser verification failed.');
      append('Flat YML duplicate rejection', false, 'Parser verification failed.');
    }

    try {
      const model = appWindow.VPS_YML_IMPORT_MODEL;
      const normalized = model.normalizeImportedData({
        tableVPSId: 'table-one',
        vpxVPSId: 'vpx-one',
        enabled: true,
        testers: ['Alpha', 'Beta'],
        coloredROMChecksum: ['a'.repeat(32), 'b'.repeat(32)],
        unsupportedField: 'ignored'
      });
      const normalizedValid = normalized.values.enabled === undefined
        && normalized.values.testers === 'Alpha, Beta'
        && normalized.values.coloredROMChecksum === 'a'.repeat(32)
        && normalized.values.coloredROMChecksumSecondary === 'b'.repeat(32)
        && normalized.values.coloredROMPin2DMD === true
        && normalized.ignored.includes('unsupportedField');
      append('YML import normalization contract', normalizedValid, `${normalized.ignored.length} ignored field`);

      const controller = appWindow.VPS_YML_IMPORT_CONTROLLER;
      const controllerValid = typeof controller?.importFile === 'function'
        && typeof controller?.isYmlFile === 'function'
        && typeof controller?.hasCurrentBuild === 'function'
        && controller.isYmlFile(new appWindow.File(['---'], 'sample.yml'))
        && !controller.isYmlFile(new appWindow.File(['---'], 'sample.yaml'));
      append('YML import controller API', controllerValid);
    } catch (error) {
      append('YML import normalization contract', false, error?.message || 'Import model verification failed.');
      append('YML import controller API', false, 'Import model verification failed.');
    }

    updateSummary();
  }

  frame.addEventListener('load', () => {
    window.setTimeout(run, 1800);
  }, { once: true });
})();