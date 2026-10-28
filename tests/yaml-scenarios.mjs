// The builder, driven end to end the way a user drives it - the shared runner
// behind yaml-runthrough.test.mjs and the yaml-rules-*.test.mjs files.
//
// Why this exists: the app had four validators that did not talk to each other
// (vault note "VPXS Layered Validation"). They were merged into one rulebook,
// js.src/validationRules.js, on 2026-10-05 and 10-06, and the merge was only
// safe with proof that every rule still fired the same way afterwards. The
// scenarios are that proof, and they stay it while Phase 2 changes wording and
// duplicates on purpose: each one searches for a table, picks assets, fills
// fields and then records exactly what the user would see.
//
// Nothing is stubbed. The real index.html runs in headless Chrome
// (tests/browser.mjs) with every one of its scripts. The only thing swapped is
// the VPS database, which comes from fixtures/vpsdb-five.json instead of the
// network: five real records copied unchanged from vpsdb.json on 2026-10-02,
// the five tables Jason picked (TMNT remix, Lord of the Rings, Pink Floyd,
// Tales from the Crypt, AC/DC Pro Vault).
//
// What a scenario records, all through the DOM:
//   yaml    - the preview drawer's text, or the Downloaded file when clean
//   keys    - every word the preview colours as a YAML key
//   dialog  - every line of the Validate dialog, in order
//   tabs    - each tab's status: disabled, ready, or its error/warning label
//   dots    - each field showing an error dot, with the dot's message
// Error dots only render on the active tab, so the runner visits every
// enabled tab to collect them.
//
// Expected values are pinned as plain text. A merge that changes what the
// user sees, including dropping a duplicate message, has to change them on
// purpose. A scenario may also name the `rule` it exists for: the dialog title
// that must appear. That is checked on its own, so a scenario that stops
// reaching its rule fails even while someone is re-pinning the output.
//
// To print the actual values while writing a scenario:
//   SNAPSHOT=print node tests/<file>.test.mjs

import { readFileSync } from 'node:fs';
import { check, repoPath } from './harness.mjs';
import { openApp } from './browser.mjs';

const PRINT = process.env.SNAPSHOT === 'print';
const DB = JSON.parse(readFileSync(repoPath('fixtures', 'vpsdb-five.json'), 'utf8'));

// Runs one step inside the page. Each step is [verb, ...args]:
//   ['search', query]               type in the search box and submit
//   ['asset', category, vpsId]      pick an entry in an asset row's dropdown
//   ['dmdType', type]               pick the DMD row's type (it has no VPS ID)
//   ['bundle', category, on]        set an asset row's Bundled box
//   ['override', category, on]      set an asset row's Override box
//   ['fill', ymlField, value]       open the field's tab, then type / pick / tick
//   ['import', ymlText]             open a YML through the import box
//   ['additional', ymlField, list]  open the field's Additional Checksums
//                                   dialog, make its rows exactly `list`, Save
// Two more run from Node, because they reload the page:
//   ['draft', path, value]          edit the autosaved draft, then reload so
//                                   the app restores it. For defensive rules
//                                   no current user path can reach.
// A step that cannot be done as written throws, so a scenario never quietly
// skips the action it claims to test.
async function pageStep(app, step) {
  await app.run(async ([verb, a, b]) => {
    const settle = () => new Promise(resolve => {
      // Three frames plus a task covers every deferred refresh in the app
      // (the deepest is a double-rAF followed by a setTimeout 0).
      const frames = n => n ? requestAnimationFrame(() => frames(n - 1)) : setTimeout(resolve, 0);
      frames(3);
    });
    const waitUntil = async (test, what, ms = 5000) => {
      const deadline = Date.now() + ms;
      while (!test()) {
        if (Date.now() > deadline) throw new Error(what);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    };
    const { WIZARD_STEPS } = window.VPS_YML_FIELDS;
    const where = JSON.stringify([verb, a, b]);
    const row = category => {
      const found = document.querySelector('.asset-row[data-category="' + category + '"]');
      if (!found) throw new Error(where + ': no asset row for ' + category);
      return found;
    };
    const setBox = (box, on, what) => {
      if (!box) throw new Error('no ' + what + ' box');
      if (box.disabled) throw new Error(what + ' box is disabled');
      if (box.checked !== on) box.click();
    };
    const openTab = stepId => {
      const tab = document.getElementById('config-tab-' + stepId);
      if (!tab) throw new Error('no tab ' + stepId);
      if (tab.disabled) throw new Error('tab ' + stepId + ' is disabled');
      if (document.querySelector('.config-tab-panel')?.dataset.step !== stepId) tab.click();
    };
    const pick = (select, value) => {
      if (!select) throw new Error(where + ': no dropdown');
      if (select.disabled) throw new Error(where + ': dropdown is disabled');
      if (![...select.options].some(option => option.value === value && !option.disabled)) {
        throw new Error(where + ': no selectable option ' + value);
      }
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };

    if (verb === 'search') {
      document.getElementById('idInput').value = a;
      document.getElementById('searchForm').requestSubmit();
      await waitUntil(() => !document.getElementById('workspace').hidden, where + ': no table loaded');
    } else if (verb === 'asset') {
      pick(row(a).querySelector('select'), b);
    } else if (verb === 'dmdType') {
      pick(row('specialDMD').querySelector('select'), a);
    } else if (verb === 'bundle') {
      setBox(row(a).querySelector('.bundle-toggle:not(.nsfw-toggle):not(.override-toggle) input'), b, where + ' Bundled');
    } else if (verb === 'override') {
      setBox(row(a).querySelector('.override-toggle input'), b, where + ' Override');
    } else if (verb === 'fill') {
      const step = WIZARD_STEPS.find(candidate => candidate.fields.some(field => field.yml_field === a));
      if (!step) throw new Error(where + ': no tab owns ' + a);
      openTab(step.id);
      await settle();
      const control = document.getElementById('field-' + a);
      if (!control) throw new Error(where + ': field not rendered');
      if (control.disabled) throw new Error(where + ': field is disabled');
      if (control.type === 'checkbox') {
        setBox(control, b, where);
      } else {
        control.value = b;
        if (control.value !== b) throw new Error(where + ': the field would not take that value');
        const event = control.tagName === 'SELECT' ? 'change' : 'input';
        control.dispatchEvent(new Event(event, { bubbles: true }));
      }
    } else if (verb === 'additional') {
      const step = WIZARD_STEPS.find(candidate => candidate.fields.some(field => field.yml_field === a));
      if (!step) throw new Error(where + ': no tab owns ' + a);
      openTab(step.id);
      await settle();
      const button = document.getElementById('field-' + a)?.closest('.field')?.querySelector('.checksum-additional-btn');
      if (!button || button.hidden) throw new Error(where + ': no Additional Checksums button');
      button.click();
      const node = document.getElementById('checksumAdditionalDialog');
      if (!node?.open) throw new Error(where + ': the dialog did not open');
      const inputs = () => [...node.querySelectorAll('.checksum-additional-row input')];
      // Typing into the last row adds a fresh empty one, as it does for a user.
      const count = Math.max(b.length, inputs().length);
      for (let index = 0; index < count; index += 1) {
        const input = inputs()[index];
        if (!input) throw new Error(where + ': no row ' + (index + 1));
        input.value = b[index] ?? '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      document.getElementById('checksumAdditionalSave').click();
      if (node.open) throw new Error(where + ': Save was refused');
    } else if (verb === 'import') {
      const input = document.getElementById('ymlImportInput');
      const transfer = new DataTransfer();
      transfer.items.add(new File([a], 'scenario.yml', { type: 'text/yaml' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const toast = () => document.querySelector('#ymlImportToast');
      const title = () => toast()?.querySelector('.vps-db-toast-title')?.textContent || '';
      await waitUntil(() => /YML loaded|could not be loaded|Import cancelled/.test(title()), where + ': import never finished', 10000);
      if (!/YML loaded/.test(title())) {
        throw new Error(where + ': import failed: ' + title() + ' - ' + (toast()?.querySelector('.vps-db-toast-message')?.textContent || ''));
      }
      // The Additional ROM bridge applies its block after the importer finishes.
      await new Promise(resolve => setTimeout(resolve, 100));
    } else {
      throw new Error('unknown step ' + where);
    }
    await settle();
  }, step);
}

// Edits the autosaved draft at a dotted path, then reloads so restoreDraft
// brings it back exactly as a returning user would see it.
async function draftStep(app, [, path, value]) {
  const edited = await app.run(async ([path, value]) => {
    // Autosave fires 350 ms after the last change.
    await new Promise(resolve => setTimeout(resolve, 450));
    const key = Object.keys(localStorage).find(name => {
      try { return JSON.parse(localStorage.getItem(name))?.version === 2; } catch (_) { return false; }
    });
    if (!key) return 'no draft saved';
    const draft = JSON.parse(localStorage.getItem(key));
    const parts = path.split('.');
    let node = draft;
    for (const part of parts.slice(0, -1)) {
      if (node?.[part] === undefined) return 'no ' + path + ' in the draft';
      node = node[part];
    }
    node[parts[parts.length - 1]] = value;
    localStorage.setItem(key, JSON.stringify(draft));
    return '';
  }, [path, value]);
  if (edited) throw new Error(JSON.stringify(['draft', path, value]) + ': ' + edited);
  await app.reload();
  await app.run(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)))));
}

// Records what the user would see right now. Opens and closes the Validate
// dialog, and visits every enabled tab for its error dots.
async function snapshot(app) {
  return app.run(async () => {
    const settle = () => new Promise(resolve => {
      const frames = n => n ? requestAnimationFrame(() => frames(n - 1)) : setTimeout(resolve, 0);
      frames(3);
    });
    const text = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();

    const yaml = document.getElementById('previewYaml').textContent;
    const keys = [...document.querySelectorAll('#previewYaml .yml-key')].map(span => span.textContent);

    document.getElementById('validateBtn').click();
    await settle();
    const dialog = [...document.querySelectorAll('#validationBody .validation-item')].map(item => {
      const kind = ['error', 'warning', 'success'].find(name => item.classList.contains(name)) || '?';
      return kind + ': ' + text(item.querySelector('strong')) + ' | ' + text(item.querySelector('span'));
    });
    document.getElementById('validationDialog').close();
    await settle();

    const tabStatus = tab => {
      if (tab.disabled) return 'disabled';
      if (tab.classList.contains('has-error') || tab.classList.contains('has-warning')) return tab.title;
      return tab.classList.contains('has-ready') ? 'ready' : '?';
    };
    const tabs = [...document.querySelectorAll('.config-tab')].map(tab => tab.dataset.step + ': ' + tabStatus(tab));

    const dots = [];
    for (const tab of document.querySelectorAll('.config-tab:not([disabled])')) {
      tab.click();
      await settle();
      document.querySelectorAll('.config-tab-panel .field-error-dot').forEach(dot => {
        const control = dot.closest('.field')?.querySelector('[id^="field-"]');
        const message = dot.dataset.tooltip || dot.getAttribute('title') || dot.getAttribute('aria-label') || '';
        const name = dot.closest('.additional-rom-controls') ? 'additionalRoms' : (control?.id || '?');
        dots.push(tab.dataset.step + ' ' + name + ': ' + message);
      });
    }
    return { yaml, keys, dialog, tabs, dots };
  });
}

// One browser for the whole file: each openApp adds its own exit and signal
// listeners, so a browser per scenario would trip Node's listener warning.
// Desktop size, so the preview is the 340px side column Jason works in.
export async function startScenarios() {
  const app = await openApp({ db: DB, downloads: true, windowSize: [1400, 900] });

  async function scenario(name, steps, expected) {
    // A fresh page per scenario, and no draft to restore into it - proved, not
    // assumed. On CI on 2026-10-06 one scenario ran against the previous one's
    // page and failed as six confusing snapshot diffs; a reset that does not
    // take now fails as itself.
    await app.reset();
    const stale = await app.run(() => {
      const storage = Object.keys(localStorage);
      const loaded = !document.getElementById('workspace').hidden;
      return storage.length || loaded ? JSON.stringify({ storage, loaded }) : '';
    });
    if (stale) throw new Error(name + ': the reset did not give a fresh page: ' + stale);

    const errorsBefore = app.errors.length;
    let actual;
    let download;
    // Names the scenario in any failure; a bare "Runtime.evaluate timed out"
    // does not say where it happened.
    try {
      for (const step of steps) {
        if (step[0] === 'draft') await draftStep(app, step);
        else await pageStep(app, step);
      }
      actual = await snapshot(app);

      // A refused Download opens the Validate dialog instead, so only wait for a
      // file when it stayed shut; waiting on every refusal cost 2 s a scenario.
      const refused = await app.run(async () => {
        document.getElementById('downloadBtn').click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))));
        return document.getElementById('validationDialog').open;
      });
      download = refused
        ? { error: 'refused' }
        : await app.nextDownload(5000).catch(error => ({ error: error.message }));
    } catch (error) {
      error.message = 'scenario "' + name + '": ' + error.message;
      throw error;
    }
    actual.download = download.error ? 'blocked' : download.filename;
    if (!download.error) actual.downloadMatchesPreview = download.text === actual.yaml;
    const pageErrors = app.errors.slice(errorsBefore);

    if (PRINT) {
      const { yaml, ...rest } = actual;
      console.log('\n=== ' + name);
      console.log(JSON.stringify(expected.yaml ? actual : rest, null, 2));
      if (pageErrors.length) console.log('page errors:', pageErrors);
      return;
    }

    if (expected.rule) {
      const titles = actual.dialog.map(line => line.slice(line.indexOf(': ') + 2, line.indexOf(' | ')));
      check(name + ': reaches its rule "' + expected.rule + '"', titles.includes(expected.rule), actual.dialog.join('\n'));
    }
    for (const key of ['yaml', 'keys', 'dialog', 'tabs', 'dots', 'download', 'downloadMatchesPreview']) {
      if (!(key in expected)) continue;
      const want = Array.isArray(expected[key]) ? expected[key].join('\n') : expected[key];
      const got = Array.isArray(actual[key]) ? actual[key].join('\n') : actual[key];
      check(name + ': ' + key, got === want, 'expected:\n' + want + '\n        actual:\n' + got);
    }
    check(name + ': no page errors', pageErrors.length === 0, pageErrors.join('\n'));
  }

  // The steps alone, on a fresh page, for a check that inspects the page itself.
  async function play(steps) {
    await app.reset();
    for (const step of steps) {
      if (step[0] === 'draft') await draftStep(app, step);
      else await pageStep(app, step);
    }
  }

  return { app, scenario, play, PRINT };
}
