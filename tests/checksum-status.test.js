'use strict';
// Drives the REAL checksum status registry, sliced out of the shipped
// js.src/uiHelper.js at run time.

const fs = require('fs');
const { check, report, repoPath } = require('./harness');
const UI_PATH = repoPath('js.src', 'uiHelper.js');

// ── minimal DOM, with ids and closest() ────────────────────────────────────
const byId = new Map();

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this._classes = new Set();
    this._text = '';
    this._id = '';
  }
  get id() { return this._id; }
  set id(value) { this._id = value; byId.set(value, this); }
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
  get textContent() { return this._text; }
  set textContent(value) { this._text = String(value); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  append(...nodes) { nodes.forEach(n => this.appendChild(n)); }
  closest(selector) {
    const want = selector.replace('.', '');
    let cursor = this;
    while (cursor) { if (cursor._classes.has(want)) return cursor; cursor = cursor.parentNode; }
    return null;
  }
  querySelector(selector) {
    const want = selector.replace('.', '');
    const walk = node => {
      for (const child of node.children) {
        if (child._classes.has(want)) return child;
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    return walk(this);
  }
}

const documentStub = { createElement: tag => new El(tag), getElementById: id => byId.get(id) || null };

function element(tag, className = '', text = '') {
  const node = documentStub.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null && text !== '') node.textContent = text;
  return node;
}

// ── slice the real source ──────────────────────────────────────────────────
const source = fs.readFileSync(UI_PATH, 'utf8');
const start = source.indexOf('  const checksumStatuses = new Map();');
if (start < 0) throw new Error('checksumStatuses not found in uiHelper.js');
const endMarker = '  function setChecksumStatus(fieldId, status) {';
const endAt = source.indexOf(endMarker);
if (endAt < 0) throw new Error('setChecksumStatus not found in uiHelper.js');
const block = source.slice(start, source.indexOf('\n  }', endAt) + 4);

const api = new Function('element', 'document',
  block + '\n return { checksumStatuses, checksumGenerations, paintChecksumStatus, applyChecksumStatus,'
        + ' setChecksumStatus, getChecksumGeneration, beginChecksumJob, isChecksumGenerationCurrent,'
        + ' resetChecksumStatuses };')(element, documentStub);


const FIELD = 'field-pupChecksum';

// Builds the field the way createFieldControl does, replacing any previous one
// for the same id — exactly what renderAccordions() does on a tab switch.
function renderField() {
  const wrapper = element('div', 'field checksum-drop-field');
  const input = element('input');
  input.id = FIELD;
  const status = element('span', 'checksum-drop-status');
  const hint = element('span', 'checksum-drop-hint', 'Drop .zip file to calculate MD5');
  hint.dataset.defaultHint = hint.textContent;   // what createFieldControl stashes
  status.append(hint);
  wrapper.append(input, status);
  // the restore call createFieldControl makes at build time
  api.paintChecksumStatus(wrapper, hint, api.checksumStatuses.get(FIELD));
  return { wrapper, hint };
}

const loading = w => w._classes.has('checksum-is-loading');

// 1 ── a drop paints the spinner and the message
{
  api.setChecksumStatus(FIELD, null);
  const first = renderField();
  api.setChecksumStatus(FIELD, { loading: true, message: 'Processing TheMatrixPup.zip…' });
  check('spinner class is set', loading(first.wrapper) === true);
  check('aria-busy is set', first.wrapper.getAttribute('aria-busy') === 'true');
  check('progress message is shown', first.hint.textContent === 'Processing TheMatrixPup.zip…');
}

// 2 ── THE BUG: a tab switch rebuilds the field mid-drop
{
  api.setChecksumStatus(FIELD, null);
  const before = renderField();
  api.setChecksumStatus(FIELD, { loading: true, message: 'Processing TheMatrixPup.zip…' });

  const after = renderField();          // tab away and back
  check('rebuilt field still shows the spinner', loading(after.wrapper) === true,
    'the animation vanished on tab change — this is the reported bug');
  check('rebuilt field still shows the message',
    after.hint.textContent === 'Processing TheMatrixPup.zip…', after.hint.textContent);
  check('the old detached field is irrelevant now', before.wrapper !== after.wrapper);
}

// 3 ── the job finishing reaches the NEW field, not the detached one
{
  api.setChecksumStatus(FIELD, null);
  const before = renderField();
  api.setChecksumStatus(FIELD, { loading: true, message: 'Processing TheMatrixPup.zip…' });
  const after = renderField();

  api.setChecksumStatus(FIELD, { message: 'MD5 calculated · 812 directories loaded from TheMatrixPup.zip' });
  check('spinner stops on the visible field', loading(after.wrapper) === false);
  check('result lands on the visible field',
    after.hint.textContent.startsWith('MD5 calculated'), after.hint.textContent);
  check('result did NOT go to the detached field',
    before.hint.textContent === 'Processing TheMatrixPup.zip…',
    'the completion handler wrote into the old node');
  check('aria-busy cleared', after.wrapper.getAttribute('aria-busy') === 'false');
}

// 4 ── errors carry the error class across a rebuild
{
  api.setChecksumStatus(FIELD, null);
  renderField();
  api.setChecksumStatus(FIELD, { message: 'MD5 failed', error: true });
  const after = renderField();
  check('error message survives the rebuild', after.hint.textContent === 'MD5 failed');
  check('error class survives the rebuild', after.hint._classes.has('error') === true);
  check('not spinning on an error', loading(after.wrapper) === false);
}

// 5 ── clearing the status stops a later rebuild repainting a stale message
{
  api.setChecksumStatus(FIELD, null);
  renderField();
  api.setChecksumStatus(FIELD, { loading: true, message: 'Processing lone.vni…' });
  api.setChecksumStatus(FIELD, null);                     // the lone .vni branch
  const after = renderField();
  check('cleared status leaves the default hint',
    after.hint.textContent === 'Drop .zip file to calculate MD5', after.hint.textContent);
  check('cleared status is not spinning', loading(after.wrapper) === false);
}

// 6 ── a field that is not on screen must not throw
{
  api.setChecksumStatus(FIELD, null);
  let threw = false;
  try { api.setChecksumStatus('field-thatDoesNotExist', { loading: true, message: 'x' }); }
  catch (_) { threw = true; }
  check('missing field does not throw', threw === false);
}

// 7 ── two fields keep separate status
{
  api.setChecksumStatus(FIELD, null);
  const pup = renderField();
  const secondary = (() => {
    const wrapper = element('div', 'field checksum-drop-field');
    const input = element('input');
    input.id = 'field-coloredROMChecksumSecondary';
    const status = element('span', 'checksum-drop-status');
    const hint = element('span', 'checksum-drop-hint', 'Drop .vni');
    status.append(hint);
    wrapper.append(input, status);
    return { wrapper, hint };
  })();

  api.setChecksumStatus(FIELD, { loading: true, message: 'Processing pup.zip…' });
  api.setChecksumStatus('field-coloredROMChecksumSecondary', { message: 'MD5 calculated (rom.vni)' });
  check('pup field still spinning', loading(pup.wrapper) === true);
  check('secondary field not spinning', loading(secondary.wrapper) === false);
  check('secondary message is its own', secondary.hint.textContent === 'MD5 calculated (rom.vni)');
  check('pup message is its own', pup.hint.textContent === 'Processing pup.zip…');
}

// 8 -- THE CLEAR BUG: clearing a status must restore the instruction text on
//      the node that is ALREADY on screen, without waiting for a rebuild.
{
  api.resetChecksumStatuses();
  const field = renderField();
  api.setChecksumStatus(FIELD, { message: 'MD5 calculated from TheMatrixPup.zip' });
  check('message is showing before the clear',
    field.hint.textContent === 'MD5 calculated from TheMatrixPup.zip');

  api.setChecksumStatus(FIELD, null);
  check('cleared status restores the hint IN PLACE',
    field.hint.textContent === 'Drop .zip file to calculate MD5', field.hint.textContent);
  check('cleared status is not spinning', loading(field.wrapper) === false);
}

// 9 -- resetChecksumStatuses(ids) clears the named fields
{
  api.resetChecksumStatuses();
  const field = renderField();
  api.setChecksumStatus(FIELD, { message: 'MD5 calculated from old.zip', error: true });
  check('error class is set before the reset', field.hint._classes.has('error') === true);

  api.resetChecksumStatuses([FIELD]);
  check('reset restores the default hint',
    field.hint.textContent === 'Drop .zip file to calculate MD5', field.hint.textContent);
  check('reset drops the error class', field.hint._classes.has('error') === false);
  check('reset removes the stored status', api.checksumStatuses.has(FIELD) === false);
}

// 10 -- resetChecksumStatuses() with no argument clears every field
{
  api.resetChecksumStatuses();
  const pup = renderField();
  const other = (() => {
    const wrapper = element('div', 'field checksum-drop-field');
    const input = element('input');
    input.id = 'field-altSoundChecksum';
    const status = element('span', 'checksum-drop-status');
    const hint = element('span', 'checksum-drop-hint', 'Drop .zip / .rar / .7z file');
    hint.dataset.defaultHint = hint.textContent;
    status.append(hint);
    wrapper.append(input, status);
    return { wrapper, hint };
  })();

  api.setChecksumStatus(FIELD, { loading: true, message: 'Processing pup.zip...' });
  api.setChecksumStatus('field-altSoundChecksum', { message: 'MD5 calculated' });

  api.resetChecksumStatuses();
  check('whole reset clears the pup hint',
    pup.hint.textContent === 'Drop .zip file to calculate MD5', pup.hint.textContent);
  check('whole reset clears the alt sound hint',
    other.hint.textContent === 'Drop .zip / .rar / .7z file', other.hint.textContent);
  check('whole reset stops the spinner', loading(pup.wrapper) === false);
  check('whole reset empties the registry', api.checksumStatuses.size === 0);
}

// 11 -- a Clear invalidates a job that is still running
{
  api.resetChecksumStatuses();
  renderField();
  const token = api.beginChecksumJob(FIELD);          // drop starts
  check('a fresh job is current', api.isChecksumGenerationCurrent(FIELD, token) === true);

  api.resetChecksumStatuses();                        // user hits Clear
  check('the in-flight job is no longer current',
    api.isChecksumGenerationCurrent(FIELD, token) === false,
    'a hash finishing after Clear would write into the cleared build');
}

// 12 -- a second drop on the same field supersedes the first
{
  api.resetChecksumStatuses();
  renderField();
  const first = api.beginChecksumJob(FIELD);
  const second = api.beginChecksumJob(FIELD);
  check('the superseded drop is stale', api.isChecksumGenerationCurrent(FIELD, first) === false);
  check('the newest drop is current', api.isChecksumGenerationCurrent(FIELD, second) === true);
}

// 13 -- clearing ONE tab must not kill a job running on a different field
{
  api.resetChecksumStatuses();
  const pupToken = api.beginChecksumJob(FIELD);
  const altToken = api.beginChecksumJob('field-altSoundChecksum');

  api.resetChecksumStatuses([FIELD]);                 // Clear section on the PUP tab
  check('the cleared tab loses its job',
    api.isChecksumGenerationCurrent(FIELD, pupToken) === false);
  check('an unrelated tab keeps its job',
    api.isChecksumGenerationCurrent('field-altSoundChecksum', altToken) === true,
    'clearing one tab must not cancel a hash running on another');
}

// 14 -- a hint with no stashed default is left alone rather than blanked
{
  api.resetChecksumStatuses();
  const wrapper = element('div', 'field checksum-drop-field');
  const input = element('input');
  input.id = 'field-legacyNoDefault';
  const status = element('span', 'checksum-drop-status');
  const hint = element('span', 'checksum-drop-hint', 'some text');
  status.append(hint);
  wrapper.append(input, status);

  api.setChecksumStatus('field-legacyNoDefault', null);
  check('no stashed default leaves the text untouched', hint.textContent === 'some text');
}

report('checksum status registry');
