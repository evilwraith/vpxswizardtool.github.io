'use strict';
// Drives the REAL dot presenter and its sweep (presentErrorDot, presentField,
// collectFieldEntries, presentFields), sliced out of the shipped
// js.src/uiEnhancements.js at run time. They moved there from
// featureValidationController.js on 2026-10-06, when one pass began drawing
// every error dot; since decision 5 piece 3 (2026-10-18) every dot is one
// .field-error-dot per field, whichever system found the problem.

const fs = require('fs');
const { check, report, repoPath } = require('./harness');
const DOTS = repoPath('js.src', 'uiEnhancements.js');
const CSS_DIR = repoPath('css.src') + '/';

const all = [];

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = {};
    this._classes = new Set();
    this.mutations = 0;      // childList changes only
    all.push(this);
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
  matches(selector) {
    return selector.split(',').map(s => s.trim().replace('.', '')).some(c => this._classes.has(c));
  }
  setAttribute(n, v) { this.attributes[n] = String(v); }
  getAttribute(n) { return this.attributes[n] ?? null; }
  removeAttribute(n) { delete this.attributes[n]; }
  querySelectorAll(selector) {
    const attr = selector.match(/^\[([\w-]+)="([^"]*)"\]$/);
    const found = [];
    const walk = node => node.children.forEach(child => {
      if (attr ? child.attributes[attr[1]] === attr[2] : child.matches(selector)) found.push(child);
      walk(child);
    });
    walk(this);
    return found;
  }
  appendChild(node) { node.parentElement = this; this.children.push(node); this.mutations += 1; return node; }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(c => c !== this);
    this.parentElement.mutations += 1;
    this.parentElement = null;
  }
  // Direct children only, by class (".x") or tag ("input"), comma lists allowed.
  querySelector(selector) {
    const wants = selector.replace(/:scope > /g, '').split(',').map(s => s.trim());
    return this.children.find(c => wants.some(w => (w.startsWith('.') ? c._classes.has(w.slice(1)) : c.tagName === w.toUpperCase()))) || null;
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }
}

const documentStub = {
  createElement: tag => new El(tag),
  querySelectorAll: selector => {
    const want = selector.replace('.', '');
    return all.filter(node => node._classes.has(want) && node.parentElement);
  }
};

// ── slice the real functions ───────────────────────────────────────────────
const source = fs.readFileSync(DOTS, 'utf8');
// dotText, entryText and setDotTip, which every dot's tooltip is built with.
const helperStart = source.indexOf('  const dotText = ');
const helperEnd = source.indexOf('  function findFieldWrapper(container, fieldName) {');
if (helperStart < 0 || helperEnd < 0) throw new Error('dot tooltip helpers not found');
const helpers = source.slice(helperStart, helperEnd);
// restoreControlLabel through presentFields: the presenter, its screen-reader
// half and the sweep. The end marker is guarded too, so a moved one cannot
// silently take the rest of the file.
const blockStart = source.indexOf('  function restoreControlLabel(control) {');
const blockEnd = source.indexOf('  function decorateCurrentFields() {');
if (blockStart < 0 || blockEnd < 0 || blockEnd < blockStart) throw new Error('dot presenter block not found');
const api = new Function('document', helpers + source.slice(blockStart, blockEnd)
  + '\n return { presentErrorDot, presentField, collectFieldEntries, presentFields, clearFeaturePresentation };')(documentStub);

// One pass of decorateCurrentFields, minus the rulebook: issues are
// [wrapper, issue] pairs, added in the order the real pass adds them.
function pass(container, pairs) {
  api.clearFeaturePresentation();
  const { fields, add } = api.collectFieldEntries();
  pairs.forEach(([wrapper, issue]) => add(wrapper, issue));
  api.presentFields(container, fields);
}

const field = (...classes) => { const n = new El('div'); n.className = ['field', ...classes].join(' '); return n; };
const inside = (container, node) => container.appendChild(node);
const findDot = w => w.children.find(c => c.className.split(' ').includes('field-error-dot')) || null;
const dotsIn = w => w.children.filter(c => c.className.split(' ').includes('field-error-dot'));
const tipOf = dot => dot?.children.find(c => c.className === 'error-dot-tip') || null;
const issue = (system, title, message) => ({ system, title, message });

// 1 ── a dot is created, carrying the message
{
  const w = field('checksum-drop-field');
  api.presentErrorDot(w, ['Add a valid MD5 value for Alt Sound Checksum.']);
  const dot = findDot(w);
  check('a dot element is created', !!dot);
  check('dot carries the message', dot?.dataset.tooltip === 'Add a valid MD5 value for Alt Sound Checksum.');
  check('dot is labelled for screen readers',
    dot?.getAttribute('aria-label') === 'Add a valid MD5 value for Alt Sound Checksum.');
  check('dot is announced as an image', dot?.getAttribute('role') === 'img');
  // Flipped on purpose in piece 3: until then this dot was deliberately NOT
  // .field-error-dot, because the build dots were deleted wholesale by class.
  check('dot is class field-error-dot and nothing else', dot?.className === 'field-error-dot', dot?.className);
  check('dot can be reached with the keyboard', dot?.tabIndex === 0);
}

// 2 ── repeat passes must not churn the DOM (the loop hazard)
{
  const w = field('checksum-drop-field');
  api.presentErrorDot(w, ['same message']);
  const first = findDot(w);
  const afterCreate = w.mutations;
  api.presentErrorDot(w, ['same message']);
  api.presentErrorDot(w, ['same message']);
  api.presentErrorDot(w, ['same message']);
  check('no second dot is created', dotsIn(w).length === 1, 'duplicate dots');
  check('same node reused', findDot(w) === first);
  check('no further DOM mutations across three passes', w.mutations === afterCreate,
    'mutations=' + w.mutations + ' after=' + afterCreate);
}

// 3 ── a changed message updates in place
{
  const w = field('checksum-drop-field');
  api.presentErrorDot(w, ['first']);
  const dot = findDot(w);
  const afterCreate = w.mutations;
  api.presentErrorDot(w, ['second']);
  check('message updated', findDot(w)?.dataset.tooltip === 'second');
  check('updated on the same node', findDot(w) === dot);
  check('updating did not touch childList', w.mutations === afterCreate);
}

// 4 ── two messages: one per line in data-tooltip, one sentence for the reader
{
  const w = field();
  api.presentErrorDot(w, ['one.', 'two.']);
  check('messages one per line', findDot(w)?.dataset.tooltip === 'one.\ntwo.', JSON.stringify(findDot(w)?.dataset.tooltip));
  check('label reads them as one sentence', findDot(w)?.getAttribute('aria-label') === 'one. two.');
}

// 5 ── the Additional ROM dot sits on the indicator, not on the header row
//      (until 2026-10-11 it was a pseudo-element on the whole row)
{
  const container = new El('div');
  const row = inside(container, new El('summary'));
  row.className = 'additional-rom-controls';
  const indicator = row.appendChild(new El('button'));
  indicator.className = 'additional-rom-indicator';
  const add = row.appendChild(new El('button'));
  add.className = 'additional-rom-add';
  api.presentErrorDot(row, ['one.', 'two.']);
  check('the header row gets no dot of its own', findDot(row) === null);
  check('the indicator gets the dot', findDot(indicator)?.dataset.tooltip === 'one.\ntwo.');
  check('the + button gets no dot while the indicator is there', findDot(add) === null);
  check('a dot inside a button is not a focus stop of its own', findDot(indicator)?.tabIndex === undefined);

  const bare = new El('summary');
  bare.className = 'additional-rom-controls';
  const onlyAdd = bare.appendChild(new El('button'));
  onlyAdd.className = 'additional-rom-add';
  api.presentErrorDot(bare, ['nope']);
  check('with no indicator the + button gets it', findDot(onlyAdd)?.dataset.tooltip === 'nope');

  pass(container, [[row, issue('feature', 'Additional ROM 1 needs attention', 'Select a ROM VPS ID.')]]);
  const kept = findDot(indicator);
  check('the sweep keeps it while the row is in error', kept !== null);
  pass(container, []);
  check('the sweep removes it once the row clears', findDot(indicator) === null);
  check('the row is no longer marked', !row.classList.contains('has-field-error'));
}

// 5b ── a screen reader hears the Additional ROM error from the indicator
//       (the dot is inside a button, whose children are not announced)
{
  const container = new El('details');
  const row = inside(container, new El('summary'));   // the sweep only sees attached nodes
  row.className = 'additional-rom-controls';
  const indicator = row.appendChild(new El('button'));
  indicator.className = 'additional-rom-indicator';
  indicator.setAttribute('aria-label', 'Additional ROM: x. Activate to edit.');
  pass(container, [[row, issue('feature', '', 'Select a ROM VPS ID.')]]);
  const dot = findDot(indicator);
  check('the indicator is described by its dot',
    !!dot?.id && indicator.getAttribute('aria-describedby') === dot.id);
  check('the indicator is marked invalid', indicator.getAttribute('aria-invalid') === 'true');
  check('the indicator keeps its own label', indicator.getAttribute('aria-label') === 'Additional ROM: x. Activate to edit.');
  api.clearFeaturePresentation();
  check('clearing drops the description', indicator.getAttribute('aria-describedby') === null);
  check('clearing drops the invalid mark', indicator.getAttribute('aria-invalid') === null);
  check('the row carries no dead error attributes',
    row.dataset.featureErrorMessage === undefined && row.dataset.featureErrorCount === undefined);
}

// 6 ── the sweep clears dots whose error is gone, and only those
{
  const container = new El('div');
  const stillBad = inside(container, field());
  const nowFixed = inside(container, field());
  pass(container, [[stillBad, issue('build', '', 'still wrong')], [nowFixed, issue('build', '', 'was wrong')]]);
  const standing = findDot(stillBad);
  pass(container, [[stillBad, issue('build', '', 'still wrong')]]);
  check('dot removed once the error clears', findDot(nowFixed) === null);
  check('its field is no longer marked', !nowFixed.classList.contains('has-field-error'));
  check('dot kept while the error stands', findDot(stillBad) === standing && standing !== null);
  check('its field stays marked', stillBad.classList.contains('has-field-error'));
}

// 6b ── a standing build error causes no DOM mutation between passes. Until
//       piece 3 build dots were deleted and redrawn on every pass.
{
  const container = new El('div');
  const w = inside(container, field());
  const bad = [[w, issue('build', 'FPS required', 'Add the FPS.')]];
  pass(container, bad);
  const dot = findDot(w);
  const settled = w.mutations + dot.mutations;
  pass(container, bad);
  pass(container, bad);
  check('a standing build dot is the same node', findDot(w) === dot);
  check('a standing build dot causes no mutation', w.mutations + dot.mutations === settled,
    'mutations=' + (w.mutations + dot.mutations) + ' settled=' + settled);
}

// 6c ── the sweep stays inside the builder: a dialog draws its own dots
{
  const container = new El('div');
  const dialogField = new El('div').appendChild(field());   // outside the container, as the dialogs are
  const dialogDot = dialogField.appendChild(new El('span'));
  dialogDot.className = 'field-error-dot';
  dialogField.classList.add('has-field-error');
  const stray = inside(container, field('has-field-error'));
  const strayDot = stray.appendChild(new El('span'));
  strayDot.className = 'field-error-dot';
  pass(container, []);
  check('a dialog dot is left alone', dialogDot.parentElement === dialogField);
  check('a dialog field stays marked', dialogField.classList.contains('has-field-error'));
  check('a builder dot no pass drew is removed', strayDot.parentElement === null);
  check('a builder field no pass marked is unmarked', !stray.classList.contains('has-field-error'));
}

// 7 ── one dot per field, whatever found the problem (piece 3). Until then a
//      field with build and feature problems stacked two dots in one corner,
//      and two v090 problems on one field stacked two v090 dots.
{
  const container = new El('div');
  const w = inside(container, field());
  const control = w.appendChild(new El('input'));
  control.setAttribute('aria-label', 'Alt Sound Checksum');
  pass(container, [
    [w, issue('build', 'Build problem', 'Fix the build problem.')],
    [w, issue('v090', 'First pair problem', 'Fix the first.')],
    [w, issue('v090', 'Second pair problem', 'Fix the second.')],
    [w, issue('feature', 'Feature problem', 'Fix the feature problem.')],
    [w, issue('feature', 'Build problem', 'Fix the build problem.')]
  ]);
  check('one dot on the field', dotsIn(w).length === 1, 'dots=' + dotsIn(w).length);
  const dot = findDot(w);
  check('every problem, in rulebook order, each once', dot?.dataset.tooltip === [
    'Build problem. Fix the build problem.',
    'First pair problem. Fix the first.',
    'Second pair problem. Fix the second.',
    'Feature problem. Fix the feature problem.'
  ].join('\n'), JSON.stringify(dot?.dataset.tooltip));
  check('one tooltip line per problem', tipOf(dot)?.children.length === 4);
  check('the control label carries only the feature problems',
    control.getAttribute('aria-label') === 'Alt Sound Checksum. Feature problem. Fix the feature problem. Build problem. Fix the build problem.',
    control.getAttribute('aria-label'));
  check('the control is marked invalid', control.getAttribute('aria-invalid') === 'true');

  pass(container, [[w, issue('build', 'Build problem', 'Fix the build problem.')]]);
  check('once the feature problems clear, the label is restored', control.getAttribute('aria-label') === 'Alt Sound Checksum');
  check('and the invalid mark goes', control.getAttribute('aria-invalid') === null);
  check('the dot stays, updated in place', findDot(w) === dot && dot.dataset.tooltip === 'Build problem. Fix the build problem.');

  const other = inside(container, field());
  const otherControl = other.appendChild(new El('input'));
  pass(container, [[other, issue('build', 'Only build', 'Fix it.')]]);
  check('a build problem leaves the control label alone',
    otherControl.getAttribute('aria-label') === null && otherControl.getAttribute('aria-invalid') === null);
}

// 8 ── the tooltip is a real element, one line per problem, headline in bold
//      (decision 5, piece 2); data-tooltip keeps the plain text
{
  const lineText = line => line.children.map(c => c.textContent).join('');
  const w = field();
  api.presentErrorDot(w, [
    { title: 'Alt Sound Checksum required', message: 'Add a valid MD5 value for Alt Sound Checksum.' },
    { title: 'Alt Sound Notes required', message: 'Add Alt Sound Notes when using Alt Sound URL Override.' }
  ]);
  const dot = findDot(w);
  const tip = tipOf(dot);
  check('the dot carries a tooltip element', !!tip);
  check('the tooltip element is hidden from screen readers', tip?.getAttribute('aria-hidden') === 'true');
  check('one line per problem', tip?.children.length === 2 && tip.children.every(c => c.className === 'error-dot-tip-line'));
  const [first, second] = tip?.children || [];
  check('each headline is bold',
    first?.children[0]?.tagName === 'STRONG' && first.children[0].textContent === 'Alt Sound Checksum required.'
      && second?.children[0]?.tagName === 'STRONG' && second.children[0].textContent === 'Alt Sound Notes required.');
  check('each line reads headline then instruction',
    lineText(first) === 'Alt Sound Checksum required. Add a valid MD5 value for Alt Sound Checksum.'
      && lineText(second) === 'Alt Sound Notes required. Add Alt Sound Notes when using Alt Sound URL Override.');
  check('data-tooltip keeps the plain text', dot?.dataset.tooltip
    === 'Alt Sound Checksum required. Add a valid MD5 value for Alt Sound Checksum.\nAlt Sound Notes required. Add Alt Sound Notes when using Alt Sound URL Override.');

  const same = [{ title: 'Alt Sound Checksum required', message: 'Add a valid MD5 value for Alt Sound Checksum.' }];
  api.presentErrorDot(w, same);
  const rebuilt = tipOf(dot);
  check('a changed message rebuilds the tooltip', rebuilt !== tip && rebuilt?.children.length === 1);
  const settled = dot.mutations;
  api.presentErrorDot(w, same);
  api.presentErrorDot(w, same);
  check('an unchanged message leaves the tooltip alone', tipOf(dot) === rebuilt && dot.mutations === settled,
    'mutations=' + dot.mutations + ' settled=' + settled);

  const plain = field();
  api.presentErrorDot(plain, ['No headline here.']);
  const plainLine = tipOf(findDot(plain))?.children[0];
  check('a plain message has no bold part',
    plainLine?.children.length === 1 && plainLine.children[0].tagName === 'SPAN' && plainLine.children[0].textContent === 'No headline here.');
}

// ── the CSS half: one dot class, styled once ───────────────────────────────
{
  const read = f => fs.readFileSync(CSS_DIR + f, 'utf8');
  const uie = read('uiEnhancements.css');
  const v090 = read('v090.css');
  const fex = read('featureExtensions.css');

  check('the dot has one base appearance rule', /\n\.field-error-dot \{\s*position: absolute;/.test(uie));
  check('dot has the tooltip rule', v090.includes('.field-error-dot[data-tooltip]::before'));
  check('tooltip shows on dot hover', v090.includes('.field-error-dot[data-tooltip]:hover::before'));
  check('dot anchors to the checksum input corner', fex.includes('.checksum-drop-field > .field-error-dot'));
  check('the field-wide hover trigger is gone',
    !fex.includes('.field.feature-has-field-error:hover::before'),
    'hovering anywhere in the field still pops the tooltip');
  check('the field-wide pseudo tooltip is gone', !fex.includes('.field.feature-has-field-error::before'));
  check('the field-wide pseudo dot is gone', !fex.includes('.field.feature-has-field-error::after'));
  check('the header-row pseudo dot is gone',
    !fex.includes('.additional-rom-controls.feature-has-field-error::after'));
  check('the header-row hover trigger is gone',
    !fex.includes('.additional-rom-controls.feature-has-field-error:hover::before'),
    'hovering anywhere on the Advanced Config row still pops the tooltip');
  check('the dot is styled on the indicator',
    /\.additional-rom-indicator > \.field-error-dot,\s*\.additional-rom-add > \.field-error-dot \{/.test(fex));
  check('the indicator tooltip steps aside for the dot',
    fex.includes('.additional-rom-indicator:has(> .field-error-dot:hover)::after'));

  // Piece 3: the second and third dot classes are gone from every stylesheet
  // and script, so nothing can draw or style a dot the sweep does not know.
  fs.readdirSync(CSS_DIR).filter(f => f.endsWith('.css')).forEach(f => {
    check(`${f} names no second dot class`, !/feature-error-dot|v090-error-dot/.test(read(f)));
  });
  const JS_DIR = repoPath('js.src') + '/';
  fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js')).forEach(f => {
    const code = fs.readFileSync(JS_DIR + f, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    check(`${f} draws no second dot class`, !/feature-error-dot|v090-error-dot/.test(code));
  });
}

// ── the multi-error count pill is GONE, on purpose ─────────────────────────
// It painted a numbered red pill above any field with two or more errors. It
// spent most of its life painting an EMPTY pill (the count lived on the .field
// while attr() resolved against the dot), was fixed on 2026-08-26, and was then
// removed the same day: the dot alone says "there is a problem here", and the
// tooltip says what it is. Nothing should reintroduce data-error-count.
{
  const w = field('checksum-drop-field');
  api.presentErrorDot(w, ['one', 'two', 'three']);
  const dot = findDot(w);
  check('a multi-error field still gets its dot', !!dot);
  check('the dot carries NO error count', dot?.dataset.errorCount === undefined,
    String(dot?.dataset.errorCount));
  check('the tooltip still carries every message', dot?.dataset.tooltip === 'one\ntwo\nthree');

  const sources = [
    'js.src/uiEnhancements.js',
    'js.src/additionalRomsController.js',
    'js.src/v091Corrections.js'
  ];
  sources.forEach(rel => {
    const src = fs.readFileSync(repoPath(...rel.split('/')), 'utf8');
    check(`${rel} writes no error count`, !src.includes('dataset.errorCount'));
    check(`${rel} has no data-error-count cleanup left`, !src.includes('data-error-count'));
  });

  const uie = fs.readFileSync(CSS_DIR + 'uiEnhancements.css', 'utf8');
  check('no CSS rule reads the count', !uie.includes('attr(data-error-count)'));
  check('no CSS rule selects on the count', !uie.includes('[data-error-count]'));
  check('the dot itself is untouched by the removal', uie.includes('.field-error-dot {'));
}

// ── the red tab alert dot is GONE too ──────────────────────────────────────
// A tab in error is red and carries an inset top strip. That is the signal; a
// separate dot on top of it was noise.
{
  const category = fs.readFileSync(CSS_DIR + 'category.css', 'utf8');
  check('no .config-tab-alert rule survives', !category.includes('.config-tab-alert'));
  check('the error tab is still coloured red', category.includes('.config-tab.has-error {'));
  check('the error tab still gets its inset strip',
    category.includes('inset 0 3px 0 var(--danger)'));
  check('the warning tab still gets its own colour', category.includes('.config-tab.has-warning {'));
  check('the ready tab is untouched', category.includes('.config-tab.has-ready'));

  ['js.src/uiHelper.js', 'js.src/main.js'].forEach(rel => {
    const src = fs.readFileSync(repoPath(...rel.split('/')), 'utf8');
    check(`${rel} builds no alert marker`, !src.includes('config-tab-alert'));
    check(`${rel} still sets the has-error class`, src.includes('has-${status.className}'));
  });
}

report('error dot');
