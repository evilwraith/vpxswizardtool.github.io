'use strict';
// Drives the REAL createDirectoryPicker, sliced out of the shipped
// js.src/uiHelper.js at run time, so this can never drift from a copy.

const fs = require('fs');
const path = require('path');

const { check, report, repoPath } = require('./harness');
const UI_PATH = repoPath('js.src', 'uiHelper.js');

// ── minimal DOM ────────────────────────────────────────────────────────────
let ROOT = null;

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this._text = '';
    this._classes = new Set();
    this.hidden = false;
    this.disabled = false;
    this.id = '';
    this.rect = { left: 10, top: 100, bottom: 132, width: 300, height: 32 };
  }
  get className() { return [...this._classes].join(' '); }
  set className(value) { this._classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get classList() {
    const set = this._classes;
    return {
      add: (...c) => c.forEach(x => set.add(x)),
      remove: (...c) => c.forEach(x => set.delete(x)),
      contains: c => set.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !set.has(c) : !!force;
        if (on) set.add(c); else set.delete(c);
        return on;
      }
    };
  }
  get textContent() {
    if (this.children.length) return this.children.map(c => c.textContent).join('');
    return this._text;
  }
  set textContent(value) { this.children = []; this._text = String(value); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  append(...nodes) { nodes.forEach(n => this.appendChild(n)); }
  replaceChildren(...nodes) {
    this.children.forEach(c => { c.parentNode = null; });
    this.children = [];
    nodes.forEach(n => this.appendChild(n));
  }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn);
  }
  dispatch(type, event = {}) {
    const ev = Object.assign({ type, target: this, preventDefault() {}, defaultPrevented: false }, event);
    (this.listeners[type] || []).slice().forEach(fn => fn(ev));
    return ev;
  }
  contains(node) {
    let cursor = node;
    while (cursor) { if (cursor === this) return true; cursor = cursor.parentNode; }
    return false;
  }
  get isConnected() {
    let cursor = this;
    while (cursor) { if (cursor === ROOT) return true; cursor = cursor.parentNode; }
    return false;
  }
  getBoundingClientRect() { return this.rect; }
  scrollIntoView() {}
  focus() { global.__focused = this; }
  querySelector() { return null; }
}

const documentStub = {
  listeners: {},
  createElement: tag => new El(tag),
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); },
  fire(type, event) { (this.listeners[type] || []).slice().forEach(fn => fn(event)); },
  getElementById: () => null
};

const windowStub = {
  innerHeight: 900,
  listeners: {},
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); },
  count(type) { return (this.listeners[type] || []).length; }
};

function element(tag, className = '', text = '') {
  const node = documentStub.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null && text !== '') node.textContent = text;
  return node;
}

// ── slice the real source ──────────────────────────────────────────────────
const source = fs.readFileSync(UI_PATH, 'utf8');
const start = source.indexOf('  // ── Shared archive directory picker');
if (start < 0) throw new Error('picker block marker not found in uiHelper.js');
const endMarker = '  function getDirectoryPicker(id) {';
const endAt = source.indexOf(endMarker);
if (endAt < 0) throw new Error('getDirectoryPicker not found in uiHelper.js');
const blockEnd = source.indexOf('\n  }', endAt) + '\n  }'.length;
const block = source.slice(start, blockEnd);

const factory = new Function('element', 'document', 'window',
  block + '\n return { createDirectoryPicker, getDirectoryPicker, directoryDepth, sameDirectoryList };');
const api = factory(element, documentStub, windowStub);

// ── harness ────────────────────────────────────────────────────────────────

let nextId = 0;
const openPickers = [];
function build(directories, options = {}) {
  ROOT = new El('div');
  const selected = { value: options.value || '' };
  const chosen = [];
  const picker = api.createDirectoryPicker({
    id: 'picker-' + (nextId += 1),
    ariaLabel: 'Choose archive root',
    emptyText: 'Drop an archive to browse directories',
    getValue: () => selected.value,
    onSelect: directory => { selected.value = directory; chosen.push(directory); }
  });
  ROOT.appendChild(picker.element);
  picker.setDirectories(directories);
  const trigger = picker.element.children[0];
  const panel = picker.element.children[1];
  return { picker, trigger, panel, chosen, selected };
}

const rows = panel => panel.children.filter(c => c.classList.contains('archive-directory-option'));
const moreRow = panel => panel.children.find(c => c.classList.contains('archive-directory-more')) || null;
const label = trigger => trigger.children[0].textContent;

const SHALLOW_AND_DEEP = [
  'PUPVideos',
  'PUPVideos/Matrix',
  'PUPVideos/Matrix/Backglass',
  'PUPVideos/Matrix/DMD',
  'PUPVideos/Matrix/DMD/Nested',
  'Sounds',
  'Sounds/Effects/Deep'
];

// 1 ── collapsed view shows only depth <= 2, with a LOAD MORE row
{
  const { trigger, panel, picker } = build(SHALLOW_AND_DEEP);
  trigger.dispatch('click');
  const visible = rows(panel).map(r => r.dataset.value);
  check('collapsed shows only depth <= 2',
    visible.every(v => v.split('/').filter(Boolean).length <= 2),
    'got ' + JSON.stringify(visible));
  check('collapsed hides the deeper folders', visible.length === 3, 'visible=' + visible.length);
  check('LOAD MORE row is present', !!moreRow(panel));
  check('LOAD MORE names the hidden count',
    moreRow(panel).textContent.includes('(4 deeper)'),
    moreRow(panel).textContent);
  check('trigger reports the truncation',
    label(trigger) === 'Showing 3 of 7 archive directories…', label(trigger));
  picker.close();
}

// 2 ── THE POINT OF THE CHANGE: LOAD MORE expands with the panel still open
{
  const { trigger, panel, picker } = build(SHALLOW_AND_DEEP);
  trigger.dispatch('click');
  check('panel is open before expanding', panel.hidden === false);
  moreRow(panel).dispatch('mousedown', { preventDefault() {} });
  check('panel is STILL open after LOAD MORE', panel.hidden === false,
    'panel closed — this is the whole bug the change exists to fix');
  check('every folder is now listed', rows(panel).length === 7, 'rows=' + rows(panel).length);
  check('LOAD MORE row is gone', moreRow(panel) === null);
  check('aria-expanded stays true', trigger.getAttribute('aria-expanded') === 'true');
  check('trigger label drops the truncation note',
    label(trigger) === 'Choose from 7 archive directories…', label(trigger));
  openPickers.push(picker);
  const active2 = rows(panel).find(r => r.classList.contains('is-active'));
  check('highlight lands on the first newly revealed folder',
    active2 && active2.dataset.value === 'PUPVideos/Matrix/Backglass',
    'active=' + (active2 && active2.dataset.value));
}

// 3 ── an unchanged repopulate must not touch the DOM (Alt Sound rAF loop)
{
  const { trigger, panel, picker } = build(SHALLOW_AND_DEEP);
  trigger.dispatch('click');
  moreRow(panel).dispatch('mousedown', { preventDefault() {} });
  const before = rows(panel)[2];
  picker.setDirectories(SHALLOW_AND_DEEP.slice());   // equal by value, new array
  check('identical repopulate leaves the panel open', panel.hidden === false);
  check('identical repopulate does not rebuild rows', rows(panel)[2] === before,
    'rows were re-created, which would close the panel under the user');
  check('identical repopulate keeps the expansion', rows(panel).length === 7);
  picker.setDirectories([...SHALLOW_AND_DEEP]);
  check('repeat repopulate still stable', rows(panel)[2] === before);
  picker.close();
}

// 4 ── a new archive collapses and closes
{
  const { trigger, panel, picker } = build(SHALLOW_AND_DEEP);
  trigger.dispatch('click');
  moreRow(panel).dispatch('mousedown', { preventDefault() {} });
  picker.setDirectories(['NewPack', 'NewPack/Deep/Deeper'], { collapse: true });
  check('new archive closes the panel', panel.hidden === true);
  trigger.dispatch('click');
  check('new archive starts collapsed again',
    rows(panel).length === 1 && !!moreRow(panel),
    'rows=' + rows(panel).length + ' more=' + !!moreRow(panel));
  picker.close();
}

// 5 ── a deep-only archive must not hide everything behind LOAD MORE
{
  const { trigger, panel, picker } = build(['a/b/c', 'd/e/f', 'g/h/i']);
  trigger.dispatch('click');
  check('deep-only archive lists everything', rows(panel).length === 3, 'rows=' + rows(panel).length);
  check('deep-only archive shows no LOAD MORE', moreRow(panel) === null);
  picker.close();
}

// 6 ── choosing a folder reports it and closes
{
  const { trigger, panel, chosen } = build(SHALLOW_AND_DEEP);
  trigger.dispatch('click');
  rows(panel)[1].dispatch('mousedown', { preventDefault() {} });
  check('onSelect got the folder', chosen[0] === 'PUPVideos/Matrix', 'chosen=' + chosen[0]);
  check('panel closed after choosing', panel.hidden === true);
  check('aria-expanded back to false', trigger.getAttribute('aria-expanded') === 'false');
}

// 7 ── keyboard: arrow + Enter chooses, Enter on LOAD MORE expands
{
  const { trigger, panel, chosen } = build(SHALLOW_AND_DEEP);
  trigger.dispatch('keydown', { key: 'ArrowDown', preventDefault() {} });
  check('ArrowDown opens the panel', panel.hidden === false);
  trigger.dispatch('keydown', { key: 'ArrowDown', preventDefault() {} });
  trigger.dispatch('keydown', { key: 'Enter', preventDefault() {} });
  check('Enter chose the highlighted folder', chosen[0] === 'PUPVideos/Matrix', 'chosen=' + chosen[0]);

  const second = build(SHALLOW_AND_DEEP);
  second.trigger.dispatch('click');
  second.trigger.dispatch('keydown', { key: 'End', preventDefault() {} });
  second.trigger.dispatch('keydown', { key: 'Enter', preventDefault() {} });
  check('Enter on LOAD MORE expands instead of choosing', rows(second.panel).length === 7);
  check('Enter on LOAD MORE keeps the panel open', second.panel.hidden === false);
  check('Enter on LOAD MORE selected nothing', second.chosen.length === 0);
  second.picker.close();
}

// 8 ── Escape closes, type-ahead jumps
{
  const { trigger, panel, picker } = build(SHALLOW_AND_DEEP);
  trigger.dispatch('click');
  trigger.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  check('Escape closes the panel', panel.hidden === true);

  trigger.dispatch('click');
  trigger.dispatch('keydown', { key: 'S', preventDefault() {} });
  const active = rows(panel).find(r => r.classList.contains('is-active'));
  check('type-ahead jumped to the S folder', active && active.dataset.value === 'Sounds',
    'active=' + (active && active.dataset.value));
  picker.close();
}

// 9 ── the current value is marked selected when the panel opens
{
  const { trigger, panel, picker } = build(SHALLOW_AND_DEEP, { value: 'PUPVideos/Matrix' });
  trigger.dispatch('click');
  const marked = rows(panel).filter(r => r.getAttribute('aria-selected') === 'true');
  check('exactly one row is marked selected', marked.length === 1, 'marked=' + marked.length);
  check('the marked row is the current value', marked[0] && marked[0].dataset.value === 'PUPVideos/Matrix');
  check('the selected row starts highlighted', marked[0] && marked[0].classList.contains('is-active'));
  picker.close();
}

// 10 ── empty archive disables the control
{
  const { trigger, panel, picker } = build([]);
  check('empty list disables the trigger', trigger.disabled === true);
  check('empty list shows the drop hint',
    label(trigger) === 'Drop an archive to browse directories', label(trigger));
  trigger.dispatch('click');
  check('disabled trigger will not open', panel.hidden === true);
  picker.setDirectories(SHALLOW_AND_DEEP);
  check('control enables once an archive loads', trigger.disabled === false);
}

// 11 ── clicking outside closes, and listeners are released
{
  openPickers.forEach(p => p.close());   // tests above deliberately left one open

  const { trigger, panel, picker } = build(SHALLOW_AND_DEEP);
  const before = windowStub.count('resize');
  trigger.dispatch('click');
  check('open registers a resize listener', windowStub.count('resize') === before + 1);
  documentStub.fire('pointerdown', { target: new El('div') });
  check('outside click closes the panel', panel.hidden === true);
  check('close releases the resize listener', windowStub.count('resize') === before,
    'listener leaked: ' + windowStub.count('resize'));
  picker.close();
}

// 12 ── a detached control closes itself rather than positioning a ghost
{
  const { trigger, panel, picker } = build(SHALLOW_AND_DEEP);
  trigger.dispatch('click');
  ROOT.replaceChildren();                     // simulate renderAccordions()
  windowStub.listeners.scroll.slice().forEach(fn => fn());
  check('detached control closes on the next reposition', panel.hidden === true);
  picker.close();
}

report('directory picker');
