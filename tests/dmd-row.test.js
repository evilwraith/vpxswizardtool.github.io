'use strict';
// Drives the REAL appendDmdAssetRow (sliced out of js.src/uiHelper.js) and the
// REAL specialDMD branch of getCategoryItems (sliced out of js.src/utilities.js)
// at run time, so neither can drift from the shipped source.
//
// What it pins, all of it decided deliberately:
//   - the dropdown ALWAYS offers every configured DMD type, whatever the table
//     declares, because VPS feature tags are not reliably labelled
//   - the tags therefore drive the status light ONLY
//   - the select stays locked until Bundled or Override is ticked
//   - three distinct placeholder texts, one per state
//   - no info button and no detail panel, because a DMD has no VPS entry
//   - with NO VPX selected nothing is declared (the regression caught on
//     2026-08-25: it used to scan every table file and light up on a fresh
//     search, before any VPX had been picked)

const fs = require('fs');
const { check, report, repoPath } = require('./harness');

const UI_HELPER = repoPath('js.src', 'uiHelper.js');
const UTILITIES = repoPath('js.src', 'utilities.js');

// ── DOM stub ───────────────────────────────────────────────────────────────
class TextNode {
  constructor(text) { this.text = String(text); }
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this._classes = new Set();
    this.textContent = '';
  }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const set = this._classes;
    return {
      add: (...c) => c.forEach(x => set.add(x)),
      remove: (...c) => c.forEach(x => set.delete(x)),
      contains: c => set.has(c)
    };
  }
  setAttribute(n, v) { this.attributes[n] = String(v); }
  getAttribute(n) { return this.attributes[n] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  fire(type) { (this.listeners[type] || []).forEach(fn => fn()); }
  appendChild(node) { this.children.push(node); return node; }
  append(...nodes) { nodes.forEach(n => this.children.push(n)); }
  // Depth-first search by class name, used only by the assertions below.
  find(cls) {
    for (const child of this.children) {
      if (!(child instanceof El)) continue;
      if (child._classes.has(cls)) return child;
      const deeper = child.find(cls);
      if (deeper) return deeper;
    }
    return null;
  }
  findTag(tag) {
    const want = String(tag).toUpperCase();
    for (const child of this.children) {
      if (!(child instanceof El)) continue;
      if (child.tagName === want) return child;
      const deeper = child.findTag(tag);
      if (deeper) return deeper;
    }
    return null;
  }
  get text() {
    return this.children
      .map(c => (c instanceof TextNode ? c.text : c instanceof El ? c.text : ''))
      .join('') || this.textContent;
  }
}

const documentStub = {
  createElement: tag => new El(tag),
  createTextNode: text => new TextNode(text)
};

// ── slice the real functions ───────────────────────────────────────────────
function slice(source, marker, label) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(label + ' not found');
  const end = source.indexOf('\n  }', start) + 4;
  if (end < 4) throw new Error(label + ' end not found');
  return source.slice(start, end);
}

const uiSource = fs.readFileSync(UI_HELPER, 'utf8');
const elementBlock = slice(uiSource, '  function element(tag, className', 'element');
const rowBlock = slice(uiSource, '  function appendDmdAssetRow(', 'appendDmdAssetRow');

const appendDmdAssetRow = new Function('document',
  elementBlock + '\n' + rowBlock + '\n  return appendDmdAssetRow;')(documentStub);

const utilSource = fs.readFileSync(UTILITIES, 'utf8');
const normalizeBlock = slice(utilSource, '  function normalizeList(value) {', 'normalizeList');
const itemsBlock = slice(utilSource, '  function getCategoryItems(record, category', 'getCategoryItems');

const getCategoryItems = new Function(
  normalizeBlock + '\n' + itemsBlock + '\n  return getCategoryItems;')();

// ── fixtures ───────────────────────────────────────────────────────────────
const CONFIG = {
  label: 'DMD',
  singular: 'DMD pack',
  stepId: 'dmd',
  bundleField: 'specialDMDBundled',
  nsfwField: 'specialDMDNSFW',
  overrideField: 'specialDMDOverride',
  customAssetRow: 'dmd',
  dmdTypes: ['FlexDMD', 'UltraDMD']
};

const AVAILABLE = { key: 'yellow', label: 'Available', items: [{ id: 'FlexDMD' }] };
const UNAVAILABLE = { key: 'neutral', label: 'Unavailable', items: [] };
const BUNDLED = { key: 'green', label: 'Bundled', items: [{ id: 'FlexDMD' }] };

function build(assetState, values, callbacks = {}) {
  const container = new El('div');
  appendDmdAssetRow(container, CONFIG, assetState, values, callbacks);
  return container.children[0];
}

const optionsOf = row => row.findTag('select').children.map(o => o.textContent);
const placeholderOf = row => row.findTag('select').children[0].textContent;

// ── shape of the row ───────────────────────────────────────────────────────
{
  const row = build(AVAILABLE, {});
  check('row carries the specialDMD category', row.dataset.category === 'specialDMD', row.dataset.category);
  check('row is an asset-row', row._classes.has('asset-row'));
  check('row is tagged asset-row-dmd', row._classes.has('asset-row-dmd'));
  check('row has exactly 5 grid children', row.children.length === 5, 'got ' + row.children.length);
  check('name is a plain DIV, never a link', row.children[0].tagName === 'DIV', row.children[0].tagName);
  check('name reads DMD', row.children[0].textContent === 'DMD', row.children[0].textContent);
  check('NO info button', row.find('asset-info-button') === null);
  check('NO detail panel', row.find('asset-detail') === null);
  check('fifth child is an empty placeholder span', row.children[4].tagName === 'SPAN' && row.children[4].children.length === 0);
}

// ── the dropdown always offers every type ──────────────────────────────────
{
  const cases = [
    ['table declares FlexDMD only', { key: 'yellow', label: 'Available', items: [{ id: 'FlexDMD' }] }],
    ['table declares UltraDMD only', { key: 'yellow', label: 'Available', items: [{ id: 'UltraDMD' }] }],
    ['table declares both', { key: 'yellow', label: 'Available', items: [{ id: 'FlexDMD' }, { id: 'UltraDMD' }] }],
    ['table declares neither', UNAVAILABLE]
  ];
  cases.forEach(([label, assetState]) => {
    const opts = optionsOf(build(assetState, { specialDMDBundled: true }));
    check('offers both types when ' + label,
      opts.includes('FlexDMD') && opts.includes('UltraDMD'), opts.join(','));
  });
}

// ── the select is locked until a shape is declared ─────────────────────────
{
  check('select LOCKED when declared but nothing ticked',
    build(AVAILABLE, {}).findTag('select').disabled === true);
  check('select LOCKED when nothing declared and nothing ticked',
    build(UNAVAILABLE, {}).findTag('select').disabled === true);
  check('select UNLOCKED by Bundled',
    build(BUNDLED, { specialDMDBundled: true }).findTag('select').disabled === false);
  check('select UNLOCKED by Override',
    build(BUNDLED, { specialDMDOverride: true }).findTag('select').disabled === false);
}

// ── three placeholder texts, one per state ─────────────────────────────────
{
  check('placeholder: nothing declared -> "No DMD Available"',
    placeholderOf(build(UNAVAILABLE, {})) === 'No DMD Available',
    placeholderOf(build(UNAVAILABLE, {})));
  check('placeholder: declared, nothing ticked -> "Bundled w/ VPX or Override"',
    placeholderOf(build(AVAILABLE, {})) === 'Bundled w/ VPX or Override',
    placeholderOf(build(AVAILABLE, {})));
  check('placeholder: Bundled ticked -> "Select DMD Type"',
    placeholderOf(build(BUNDLED, { specialDMDBundled: true })) === 'Select DMD Type');
  check('placeholder: Override ticked -> "Select DMD Type"',
    placeholderOf(build(BUNDLED, { specialDMDOverride: true })) === 'Select DMD Type');
  check('placeholder: Override ticked on an UNDECLARED table still says Select DMD Type',
    placeholderOf(build(UNAVAILABLE, { specialDMDOverride: true })) === 'Select DMD Type');
}

// ── the chosen type round-trips ────────────────────────────────────────────
{
  const row = build(BUNDLED, { specialDMDBundled: true, specialDMDType: 'UltraDMD' });
  const opts = row.findTag('select').children;
  check('the stored type is the selected option',
    opts.find(o => o.value === 'UltraDMD').selected === true);
  check('the other type is NOT selected',
    opts.find(o => o.value === 'FlexDMD').selected === false);
  check('the placeholder is not selected once a type is stored',
    opts[0].selected !== true);

  const cleared = build(BUNDLED, { specialDMDBundled: true });
  check('no type stored means no option selected',
    cleared.findTag('select').children.every(o => o.selected !== true));
}

// ── status light mirrors getAssetState ─────────────────────────────────────
{
  check('status carries state-yellow when Available',
    build(AVAILABLE, {}).find('asset-status')._classes.has('state-yellow'));
  check('status carries state-neutral when Unavailable',
    build(UNAVAILABLE, {}).find('asset-status')._classes.has('state-neutral'));
  check('status carries state-green when Bundled',
    build(BUNDLED, { specialDMDBundled: true }).find('asset-status')._classes.has('state-green'));
  check('status prints the label it was given',
    build(AVAILABLE, {}).find('asset-status').text === 'Available');
  check('status has a dot', build(AVAILABLE, {}).find('status-dot') !== null);
}

// ── checkboxes ─────────────────────────────────────────────────────────────
{
  const row = build(AVAILABLE, {});
  const boxes = row.find('asset-toggle-stack').children;
  check('three toggles: Bundled, NSFW, Override', boxes.length === 3, 'got ' + boxes.length);
  check('NSFW is locked while neither box is ticked',
    row.find('nsfw-toggle').findTag('input').disabled === true);

  const unlocked = build(BUNDLED, { specialDMDBundled: true });
  check('NSFW unlocks once Bundled is ticked',
    unlocked.find('nsfw-toggle').findTag('input').disabled === false);
  check('Bundled reads back as checked',
    unlocked.find('bundle-toggle').findTag('input').checked === true);

  const tableNsfw = build(BUNDLED, { specialDMDBundled: true, nsfw: true });
  check('the table-level NSFW flag re-locks the per-asset one',
    tableNsfw.find('nsfw-toggle').findTag('input').disabled === true);
}

// ── the callbacks fire with the right field names ──────────────────────────
{
  const seen = [];
  const row = build(BUNDLED, { specialDMDBundled: true }, {
    onChange: (k, v) => seen.push(['change', k, v]),
    onBundle: (k, v) => seen.push(['bundle', k, v]),
    onOverride: (k, v) => seen.push(['override', k, v]),
    onNsfw: (k, v) => seen.push(['nsfw', k, v])
  });

  const select = row.findTag('select');
  select.value = 'FlexDMD';
  select.fire('change');
  check('picking a type calls onChange with specialDMDType',
    seen.some(e => e[0] === 'change' && e[1] === 'specialDMDType' && e[2] === 'FlexDMD'), JSON.stringify(seen));

  row.find('bundle-toggle').findTag('input').fire('change');
  check('Bundled calls onBundle with specialDMDBundled',
    seen.some(e => e[0] === 'bundle' && e[1] === 'specialDMDBundled'));

  row.find('override-toggle').findTag('input').fire('change');
  check('Override calls onOverride with specialDMDOverride',
    seen.some(e => e[0] === 'override' && e[1] === 'specialDMDOverride'));

  row.find('nsfw-toggle').findTag('input').fire('change');
  check('NSFW calls onNsfw with specialDMDNSFW',
    seen.some(e => e[0] === 'nsfw' && e[1] === 'specialDMDNSFW'));
}

// ── which tags count: getCategoryItems ─────────────────────────────────────
{
  const record = {
    tableFiles: [
      { id: 'vpx-1', features: ['FlexDMD'] },
      { id: 'vpx-2', features: ['UltraDMD', 'VPU Patch'] },
      { id: 'vpx-3', features: ['Music'] },
      { id: 'vpx-4', features: ['UltraDMD', 'FlexDMD'] },
      { id: 'vpx-5', features: ['flexdmd'] },
      { id: 'vpx-6', Features: ['UltraDMD'] },
      { id: 'vpx-7', features: 'FlexDMD' }
    ]
  };
  const items = id => getCategoryItems(record, 'specialDMD', CONFIG,
    id ? { selections: { tableFiles: id } } : {}).map(i => i.id);

  check('NO VPX selected declares nothing (the 2026-08-25 regression)',
    items(null).length === 0, JSON.stringify(items(null)));
  check('selected VPX declaring FlexDMD -> FlexDMD', JSON.stringify(items('vpx-1')) === '["FlexDMD"]', JSON.stringify(items('vpx-1')));
  check('selected VPX declaring UltraDMD -> UltraDMD', JSON.stringify(items('vpx-2')) === '["UltraDMD"]', JSON.stringify(items('vpx-2')));
  check('a non-DMD feature declares nothing', items('vpx-3').length === 0, JSON.stringify(items('vpx-3')));
  check('both tags come back in dmdTypes order',
    JSON.stringify(items('vpx-4')) === '["FlexDMD","UltraDMD"]', JSON.stringify(items('vpx-4')));
  check('tag matching is case-insensitive', JSON.stringify(items('vpx-5')) === '["FlexDMD"]', JSON.stringify(items('vpx-5')));
  check('the capitalised Features key is read too', JSON.stringify(items('vpx-6')) === '["UltraDMD"]', JSON.stringify(items('vpx-6')));
  check('a bare string feature is read like a one-item list',
    JSON.stringify(items('vpx-7')) === '["FlexDMD"]', JSON.stringify(items('vpx-7')));
  check('an unknown VPX id declares nothing', items('nope').length === 0);
  check('OTHER table files never leak in - only the selected VPX counts',
    items('vpx-3').length === 0 && items('vpx-1').length === 1);
  check('no dmdTypes configured means nothing is ever declared',
    getCategoryItems(record, 'specialDMD', {}, { selections: { tableFiles: 'vpx-1' } }).length === 0);
}

report('dmd-row');
