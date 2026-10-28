'use strict';
// The asset info panel and the two places a table's identity is shown: the
// card title link and the version dropdown label.
//
// Drives the REAL getVpsListingUrl and getItemLabel out of js.src/utilities.js,
// and the REAL appendAssetDetail sliced out of js.src/uiHelper.js, so none of
// them can drift from a copy. The column order and the height budget are
// asserted against the shipped source and stylesheet for the same reason.
//
// What it pins, all of it decided deliberately on 2026-08-27:
//   - the dropdown shows the UPDATED date, not the created one, because when
//     choosing between versions what matters is when the file last changed
//   - the info panel is exactly five columns in one fixed order
//   - with no Format, ONLY Authors widens - it is the column that runs long
//   - the row stops at 65px BY CONSTRUCTION, not by clipping, because the
//     overflow tooltip is a ::after inside the cell and an overflow:hidden
//     above it would clip the tooltip along with the text it exists to reveal
//   - the clamp comes off below the mobile breakpoint: a touch device has no
//     hover, so clamped text there would be unreachable

const fs = require('fs');
const { check, report, repoPath } = require('./harness');

// ── real utilities ─────────────────────────────────────────────────────────
global.window = {};
global.document = { createElement: () => ({ style: {} }) };
require(repoPath('js.src', 'utilities.js'));
const u = global.window.VPS_UTILS;

// ── 1. the VPS listing URL ────────────────────────────────────────────────
check('a listing URL is built from the table id',
  u.getVpsListingUrl('OUvOEgWRhf') === 'https://virtualpinballspreadsheet.github.io/games?game=OUvOEgWRhf',
  'got ' + u.getVpsListingUrl('OUvOEgWRhf'));
check('no id yields no URL, so the title stays plain text',
  u.getVpsListingUrl('') === '' && u.getVpsListingUrl(null) === '' && u.getVpsListingUrl(undefined) === '');
check('an id with URL-significant characters is encoded',
  u.getVpsListingUrl('a b&c=d') === 'https://virtualpinballspreadsheet.github.io/games?game=a%20b%26c%3Dd',
  'got ' + u.getVpsListingUrl('a b&c=d'));
check('surrounding whitespace is trimmed rather than encoded into the link',
  u.getVpsListingUrl('  Xy1  ') === 'https://virtualpinballspreadsheet.github.io/games?game=Xy1',
  'got ' + u.getVpsListingUrl('  Xy1  '));

// ── 2. the dropdown label uses the UPDATED date ───────────────────────────
// Real timestamps from The Matrix's 1.0.14 table file.
const CREATED = 1709164800000;   // 29.02.2024
const UPDATED = 1709998917834;   // 09.03.2024

{
  const label = u.getItemLabel({ id: 'r5a2h31Gz8', version: '1.0.14', createdAt: CREATED, updatedAt: UPDATED });
  check('the label carries the UPDATED date', label.includes('09.03.2024'), 'got ' + label);
  check('the label does NOT carry the created date', !label.includes('29.02.2024'),
    'got ' + label + ' - this is the change, so seeing the created date means it did not land');
  check('id and version are still present and the v prefix is stripped',
    label.startsWith('r5a2h31Gz8') && label.includes('1.0.14'), 'got ' + label);
}
{
  const stripped = u.getItemLabel({ id: 'x', version: 'v2.1', createdAt: CREATED, updatedAt: UPDATED });
  check('a leading v is stripped from the version', stripped.includes('2.1') && !stripped.includes('v2.1'),
    'got ' + stripped);
}
{
  // A record with no update stamp must not fall back to an em-dash.
  const onlyCreated = u.getItemLabel({ id: 'x', version: '1.0', createdAt: CREATED });
  check('with no update stamp it falls back to the created date, not a dash',
    onlyCreated.includes('29.02.2024'), 'got ' + onlyCreated);
}
{
  const alt = u.getItemLabel({ id: 'x', version: '1.0', createdAt: CREATED, lastUpdated: UPDATED });
  check('an alternative update key is honoured (VPS records are inconsistent)',
    alt.includes('09.03.2024'), 'got ' + alt);
}

// ── 3. appendAssetDetail, sliced from the real source ─────────────────────
const SOURCE = fs.readFileSync(repoPath('js.src', 'uiHelper.js'), 'utf8');
const START = '  // Returns whether anything was rendered';
const END = '  function getAssetImageUrl(item) {';
const start = SOURCE.indexOf(START);
const end = SOURCE.indexOf(END);
check('appendAssetDetail was located in uiHelper.js', start !== -1 && end > start,
  'markers moved - update the slice in this test');
const block = SOURCE.slice(start, end);

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.dataset = {};
    this._classes = new Set();
    this.textContent = '';
  }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const set = this._classes;
    return { add: (...c) => c.forEach(x => set.add(x)), contains: c => set.has(c) };
  }
  appendChild(n) { this.children.push(n); return n; }
  append(...n) { n.forEach(x => this.children.push(x)); }
  find(cls) {
    for (const child of this.children) {
      if (child instanceof El) {
        if (child._classes.has(cls)) return child;
        const hit = child.find(cls);
        if (hit) return hit;
      }
    }
    return null;
  }
}
const element = (tag, className = '', text = '') => {
  const el = new El(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null && text !== '') el.textContent = text;
  return el;
};
const appendAssetDetail = new Function('element', block + '\n; return appendAssetDetail;')(element);

{
  const box = new El('div');
  const rendered = appendAssetDetail(box, 'Authors', ['Enthusiast', 'JPSalas']);
  check('it reports that it rendered', rendered === true);
  const cell = box.children[0];
  check('the cell is tagged with its label so CSS can target it by name',
    cell.dataset.detail === 'Authors', 'got ' + cell.dataset.detail);
  check('the cell carries the class the layout keys off',
    cell.classList.contains('asset-detail-cell'));
  const value = cell.find('asset-detail-value');
  check('the value lives in its own element so it can be clamped and measured',
    value !== null, 'a bare text node cannot carry the line clamp or the tooltip');
  check('an array value is joined for display', value?.textContent === 'Enthusiast, JPSalas',
    value ? 'got ' + value.textContent : 'no value element at all - it is a bare text node again');
}
{
  const box = new El('div');
  check('an empty value renders nothing and says so',
    appendAssetDetail(box, 'Format', '') === false && box.children.length === 0);
  check('an empty array renders nothing and says so',
    appendAssetDetail(box, 'Format', []) === false && box.children.length === 0);
  check('null renders nothing and says so',
    appendAssetDetail(box, 'Format', null) === false && box.children.length === 0);
}

// ── 4. the five columns, in order, from the shipped source ────────────────
{
  const panel = SOURCE.slice(SOURCE.indexOf("const detail = element('div', 'asset-detail');"),
    SOURCE.indexOf("row.appendChild(detail);"));
  const order = [...panel.matchAll(/appendAssetDetail\(detail, '([^']+)'/g)].map(m => m[1]);
  check('exactly five columns, in the requested order',
    JSON.stringify(order) === JSON.stringify(['VPS ID', 'Version', 'Created', 'Authors', 'Format']),
    'got ' + JSON.stringify(order));
  check('the dropped columns really are gone',
    !order.includes('File') && !order.includes('Updated'), 'got ' + JSON.stringify(order));
  check('Created reads the created date, not the updated one',
    /appendAssetDetail\(detail, 'Created', formatDate\(selectedItem\.createdAt\)\)/.test(panel),
    'the detail panel shows Created; only the DROPDOWN moved to the updated date');
  check('a missing Format flags the row so Authors can widen',
    /if \(!hasFormat\) detail\.classList\.add\('asset-detail-no-format'\)/.test(panel));
  // Removed 2026-08-27. It was the one thing exempt from the height budget, so
  // with it gone the row is hard-capped and nothing can grow it.
  check('the asset comment is gone, so nothing escapes the height budget',
    !panel.includes('asset-comment') && !panel.includes('selectedItem.comment'),
    'the comment is back - the row can grow past 65px again');
}

// ── 5. the stylesheet holds the layout and the height budget ─────────────
{
  const css = fs.readFileSync(repoPath('css.src', 'category.css'), 'utf8');
  check('the four short columns are pinned at 110px and Authors takes the rest',
    /\.asset-detail \{[^}]*grid-template-columns: 110px 110px 110px minmax\(0, 1fr\) 110px;/s.test(css),
    'equal tracks starved Authors while VPS ID and Version sat half empty');
  check('the auto-fit min width is gone, since that is what stopped five fitting',
    !/\.asset-detail \{[^}]*grid-template-columns: repeat\(auto-fit[^}]*\}/s.test(css));
  check('the stylesheet no longer styles an asset comment',
    !css.includes('.asset-comment'),
    'a dead rule for an element that is no longer rendered');
  check('the value is clamped to two lines',
    /\.asset-detail-value \{[^}]*-webkit-line-clamp: 2/s.test(css));
  check('the line-height is pinned, because the 65px budget depends on it',
    /\.asset-detail-value \{[^}]*line-height: 1\.35/s.test(css));
  check('labels never wrap, for the same reason',
    /\.asset-detail strong \{[^}]*white-space: nowrap/s.test(css));
  check('with no Format the template drops its last track, not its widths',
    /\.asset-detail-no-format \{ grid-template-columns: 110px 110px 110px minmax\(0, 1fr\); \}/.test(css),
    'the short columns must stay 110px; only Authors absorbs the freed space');
  check('the old span rule is gone, or it would leave an empty 110px track',
    !/\.asset-detail-no-format \[data-detail="Authors"\]/.test(css));
  check('no overflow:hidden sits on the cell, or it would clip its own tooltip',
    !/\.asset-detail-cell \{[^}]*overflow: hidden/s.test(css));
  check('the overflow tooltip renders from data-tooltip',
    /\.asset-detail-cell\[data-tooltip\]::after \{[^}]*content: attr\(data-tooltip\)/s.test(css));
  check('mobile keeps the reflow rather than forcing fixed 110px columns',
    /@media \(max-width: 760px\)[\s\S]*?\.asset-detail,\s*\n\s*\.asset-detail-no-format \{ grid-template-columns: repeat\(auto-fit/.test(css),
    'both variants must reflow: the no-format template would otherwise survive onto a phone');
  check('mobile drops the clamp, because a touch device cannot hover a tooltip',
    /@media \(max-width: 760px\)[\s\S]*?\.asset-detail-value \{ display: block; -webkit-line-clamp: none/.test(css));
}

// ── 6. the tooltip is set only when the text is actually clipped ─────────
{
  const enh = fs.readFileSync(repoPath('js.src', 'uiEnhancements.js'), 'utf8');
  check('the clip test is made on hover, not at render',
    /mouseover[\s\S]{0,400}asset-detail-value/.test(enh),
    'measuring at render reads zero: .asset-detail is display:none until opened');
  check('both dimensions are tested',
    /scrollHeight > \S+\.clientHeight \+ 1[\s\S]{0,80}scrollWidth > \S+\.clientWidth \+ 1/.test(enh));
  check('a value that fits has its tooltip removed rather than left behind',
    /else delete cell\.dataset\.tooltip/.test(enh));
}

// ── 7. the Info button ────────────────────────────────────────────────────
// Both states read "Info"; the open state is signalled by a red outline alone.
// Nothing in the content changes, so the button cannot change width. The state
// therefore has to reach assistive tech some way other than the label.
{
  const btn = SOURCE.slice(SOURCE.indexOf("const infoButton = element('button'"),
    SOURCE.indexOf('row.appendChild(infoButton);'));
  check('the label is the literal "Info" in both states',
    /element\('button', `asset-info-button\$\{detailOpen \? ' is-open' : ''\}`, 'Info'\)/.test(btn),
    'any state-dependent label changes the width as it toggles');
  check('the old "Hide info" label is gone', !btn.includes("'Hide info'"));
  check('nothing state-dependent is added to the button content',
    !/infoButton\.append\(/.test(btn),
    'appended content is how the button last started resizing between states');
  check('the open state is carried by a class, not by the content',
    /asset-info-button\$\{detailOpen \? ' is-open' : ''\}/.test(btn));
  check('aria-expanded reports the state the label no longer does',
    /aria-expanded', detailOpen \? 'true' : 'false'/.test(btn),
    'both states read "Info", so a screen reader has no other signal');
  check('the accessible name still says show or hide',
    /aria-label[^;]*\$\{detailOpen \? 'Hide' : 'Show'\}/.test(btn));
}
{
  const css = fs.readFileSync(repoPath('css.src', 'category.css'), 'utf8');
  check('no leftover styling for the removed X',
    !css.includes('.asset-info-close'), 'a dead rule for an element no longer rendered');
  check('the button box is unchanged between states: no flex layout or gap',
    !/\.asset-info-button \{[^}]*(display: inline-flex|gap:)/s.test(css),
    'the X needed those; without it they only risk shifting the box');
  check('no min-width is needed, because the label never changes',
    !/\.asset-info-button \{[^}]*min-width/s.test(css));
  // A real bug Jason spotted: every control in the row jumped up half a pixel
  // as the panel opened. The first track stretches to fill min-height while it
  // is the only track (35px) and content-sizes once the panel adds a second
  // (34px), and align-items: center then re-centres everything in a shorter
  // track. Measured before and after: dy -0.5 on every element, dx 0.
  check('the first row track is pinned so opening the panel cannot resize it',
    /\.asset-row \{[^}]*grid-template-rows: minmax\(35px, auto\);/s.test(css),
    'without this the row re-centres and every control shifts half a pixel');
  check('the arithmetic the 35px comes from is still true',
    /\.asset-row \{[^}]*min-height: 52px;/s.test(css)
    && /\.asset-row \{[^}]*padding: 8px 10px;/s.test(css)
    && /\.asset-row \{[^}]*border-bottom: 1px/s.test(css),
    '35px = min-height 52 - 16px padding - 1px border; if any changed, the pin is now wrong');
  check('the row still centres its controls, which is why the pin matters',
    /\.asset-row \{[^}]*align-items: center;/s.test(css));
  check('the open outline is red',
    /\.asset-info-button\.is-open \{ border-color: var\(--danger\); \}/.test(css));
  check('an open button stays red on hover rather than flipping to accent',
    /\.asset-info-button\.is-open:not\(:disabled\):hover \{ border-color: var\(--danger\); \}/.test(css));
  check('the hover rule for the open state comes after the generic one, or it loses',
    css.indexOf('.asset-info-button.is-open:not(:disabled):hover')
      > css.indexOf('.asset-info-button:not(:disabled):hover'));
}
{
  const card = fs.readFileSync(repoPath('css.src', 'card.css'), 'utf8');
  const hover = card.slice(card.indexOf('.table-title-link:hover'));
  check('the card title link has no underline on hover',
    !/text-decoration: underline/.test(hover.slice(0, 160)), 'got ' + hover.slice(0, 120));
  check('it still changes colour, so the link is still discoverable',
    /\.table-title-link:hover,\s*\n\.table-title-link:focus-visible \{ color: var\(--accent\); \}/.test(card));
}

report('asset detail panel and title link');
