(() => {
  'use strict';
  const runtime = window.VPS_FEATURE_RUNTIME;
  const fields = window.VPS_YML_FIELDS;
  const utils = window.VPS_UTILS;
  if (!runtime || !fields || !utils) return;

  const { WIZARD_STEPS } = fields;

  // The three slots that live directly in Advanced Config. Slot 1 is always
  // shown; 2 and 3 are revealed by the "+" control. Anything past these
  // overflows into the dialog below.
  const SLOT_KEYS = utils.VPX_MAGIC_INLINE_KEYS || ['vpxMagic', 'vpxMagic2', 'vpxMagic3'];
  const INLINE_SLOTS = SLOT_KEYS.length;

  function definition() {
    return WIZARD_STEPS.find(step => step.id === 'vpx')?.fields
      .find(field => field.yml_field === 'vpxMagicAdditional') || { yml_field: 'vpxMagicAdditional' };
  }

  function values() {
    return runtime.state.values || {};
  }

  function entries() {
    const list = values().vpxMagicAdditional;
    return Array.isArray(list) ? list.map(entry => String(entry ?? '')) : [];
  }

  function commit(key, value) {
    runtime.state.callbacks?.onChange?.(key, value, definition());
  }

  // Every password in order, inline slots first, blanks preserved so an index
  // means the same thing here as it does on screen.
  //
  // Only the VISIBLE slots are included. A hidden third slot is not a row the
  // user can see, so counting it would make removing one of two rows leave two
  // behind - the same off-by-one that made an empty slot 2 take slot 3 with it.
  function currentList() {
    const source = values();
    return [
      ...SLOT_KEYS.slice(0, slots()).map(key => String(source[key] ?? '')),
      ...entries()
    ];
  }

  // Push state back into the inline inputs. Called ONLY from applyList, never
  // from render(): render() also runs from the capture-phase input listeners
  // in productionUiExtensions, which fire before the field's own handler has
  // committed, so syncing there would clobber the character just typed.
  function syncSlotInputs() {
    const source = values();
    SLOT_KEYS.forEach(key => {
      const input = document.getElementById(`field-${key}`);
      if (input && input !== document.activeElement) input.value = String(source[key] ?? '');
    });
  }

  // Write a whole ordered list back across the slots, closing every gap. This
  // is what makes removing Password 2 shift Password 3 up into its place.
  function applyList(list) {
    // Blanks are preserved here on purpose. They are dropped at serialize time
    // by collectVpxMagic, so an empty slot costs the YML nothing - but the row
    // COUNT has to come from how many rows remain, not how many hold a value.
    // Counting filled entries cannot tell two empty rows from one, which made
    // removing an empty slot 2 collapse an empty slot 3 along with it.
    const next = list.map(entry => String(entry ?? ''));
    SLOT_KEYS.forEach((key, index) => commit(key, next[index] ?? ''));
    const overflow = next.slice(INLINE_SLOTS).map(entry => entry.trim()).filter(Boolean);
    commit('vpxMagicAdditional', overflow.length ? overflow : undefined);
    commit('__vpxMagicSlots', Math.max(1, Math.min(INLINE_SLOTS, next.length)));
    syncSlotInputs();
    render();
    runtime.schedule();
  }

  // How many inline slots are showing. Held in state so it survives the
  // re-render a tab switch causes, and floored by what is actually filled so
  // an import carrying three passwords reveals three fields.
  function slots() {
    const source = values();
    let filled = 1;
    SLOT_KEYS.forEach((key, index) => {
      if (String(source[key] ?? '').trim()) filled = index + 1;
    });
    const stored = Number(source.__vpxMagicSlots) || 0;
    return Math.min(INLINE_SLOTS, Math.max(1, filled, stored));
  }

  // The overflow list is a customRenderer field, so it has no DOM control for
  // ymlImport's setField to drive - exactly the reason additionalRoms needs its
  // own import bridge. Without this, passwords past slot 3 are silently dropped
  // on load. Called from ymlImport once loadImportedFields has finished.
  function applyImported(list) {
    const clean = (Array.isArray(list) ? list : [])
      .map(entry => String(entry ?? '').trim())
      .filter(Boolean);
    commit('vpxMagicAdditional', clean.length ? clean : undefined);
    render();
    runtime.schedule();
  }

  // ── the overflow dialog ──────────────────────────────────────────────────
  // The dialog edits a working copy and commits only on Save, so a half-typed
  // password never reaches state, and Cancel genuinely discards.
  let draft = [];

  function dialog() {
    let node = document.getElementById('vpxMagicDialog');
    if (node) return node;
    node = document.createElement('dialog');
    node.id = 'vpxMagicDialog';
    node.className = 'app-dialog vpx-magic-dialog';
    node.setAttribute('aria-labelledby', 'vpxMagicTitle');
    node.innerHTML = `
      <div class="dialog-header">
        <div><p class="eyebrow">VPX Configuration</p><h2 id="vpxMagicTitle">Additional Passwords</h2></div>
        <button class="dialog-close" data-vpx-magic-close type="button" aria-label="Close additional passwords">&times;</button>
      </div>
      <div class="dialog-body vpx-magic-body">
        <p class="vpx-magic-note">Passwords ${INLINE_SLOTS + 1} and up. The first ${INLINE_SLOTS} stay on the VPX tab.</p>
        <div class="field-grid vpx-magic-list" id="vpxMagicList"></div>
        <button class="text-btn vpx-magic-add-row" id="vpxMagicAddRow" type="button">+ Add another password</button>
        <div class="vpx-magic-dialog-actions">
          <button class="text-btn danger-btn" id="vpxMagicClear" type="button" hidden>Clear</button>
          <button class="text-btn" data-vpx-magic-close type="button">Cancel</button>
          <button class="text-btn preview-primary" id="vpxMagicSave" type="button">Save</button>
        </div>
      </div>`;
    document.body.appendChild(node);
    // Every close path discards: only Save writes.
    node.querySelectorAll('[data-vpx-magic-close]').forEach(button => {
      button.addEventListener('click', () => cancel());
    });
    node.addEventListener('click', event => { if (event.target === node) cancel(); });
    node.querySelector('#vpxMagicSave').addEventListener('click', save);
    node.querySelector('#vpxMagicClear').addEventListener('click', clearAll);
    node.querySelector('#vpxMagicAddRow').addEventListener('click', () => {
      draft.push('');
      paint();
      node.querySelector('#vpxMagicList .vpx-magic-row:last-child input')?.focus();
    });
    return node;
  }

  function paint() {
    const list = dialog().querySelector('#vpxMagicList');
    list.replaceChildren();
    draft.forEach((value, index) => {
      const controlId = `vpxMagicExtra${index}`;
      const name = `Password ${INLINE_SLOTS + index + 1}`;
      const wrapper = document.createElement('div');
      wrapper.className = 'field field-wide vpx-magic-row';

      // No stacked <label>: the name lives inside the field as placeholder
      // text. Every row here is the same one-line control, so a column of
      // labels above them is pure vertical noise. aria-label carries the name
      // for anything that cannot see a placeholder.
      const row = document.createElement('div');
      row.className = 'vpx-magic-row-controls';

      const input = document.createElement('input');
      input.type = 'text';
      input.id = controlId;
      input.autocomplete = 'off';
      input.placeholder = name;
      input.setAttribute('aria-label', name);
      input.value = value;
      input.addEventListener('input', () => { draft[index] = input.value; });
      row.appendChild(input);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'vpx-magic-remove';
      remove.textContent = '−';
      remove.dataset.tooltip = 'REMOVE PASSWORD';
      remove.setAttribute('aria-label', `Remove password ${INLINE_SLOTS + index + 1}`);
      remove.addEventListener('click', () => {
        draft.splice(index, 1);
        if (!draft.length) draft.push('');
        paint();
      });
      row.appendChild(remove);

      wrapper.appendChild(row);
      list.appendChild(wrapper);
    });
  }

  function open() {
    draft = entries();
    if (!draft.length) draft.push('');
    paint();
    const node = dialog();
    // Clear only makes sense once something has actually been saved.
    node.querySelector('#vpxMagicClear').hidden = entries().length === 0;
    if (typeof node.showModal === 'function') node.showModal();
    else node.setAttribute('open', 'open');
    node.querySelector('#vpxMagicList input')?.focus();
  }

  function cancel() {
    draft = [];
    dialog().close?.();
  }

  function save() {
    const kept = draft.map(entry => String(entry ?? '').trim()).filter(Boolean);
    draft = [];
    dialog().close?.();
    commit('vpxMagicAdditional', kept.length ? kept : undefined);
    render();
    runtime.schedule();
  }

  function clearAll() {
    draft = [];
    dialog().close?.();
    commit('vpxMagicAdditional', undefined);
    render();
    runtime.schedule();
  }

  // ── the inline controls on the VPX tab ───────────────────────────────────
  function wrapperFor(key) {
    return document.getElementById(`field-${key}`)?.closest('.field') || null;
  }

  function keyIndicatorSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="12" r="3.2"/><path d="M11 12h10M18 12v3.5M21 12v2.5"/></svg>';
  }

  // Slots 2 and 3 get their own remove control, matching the dialog's rows.
  // Slot 1 does not: it is the original Password field and always shows.
  function decorateSlot(key, index) {
    const wrapper = wrapperFor(key);
    if (!wrapper || index === 0) return;
    if (wrapper.querySelector('.vpx-magic-slot-remove')) return;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'vpx-magic-slot-remove';
    remove.textContent = '−';
    remove.dataset.tooltip = 'REMOVE PASSWORD';
    remove.setAttribute('aria-label', `Remove password ${index + 1}`);
    remove.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const next = currentList();
      next.splice(index, 1);
      applyList(next);
    });
    wrapper.classList.add('vpx-magic-slot');
    wrapper.appendChild(remove);
  }

  function render() {
    const panel = document.getElementById('config-panel-vpx');
    const advanced = panel?.querySelector('.compact-advanced');
    const summary = advanced?.querySelector(':scope > summary');
    if (!advanced || !summary || !runtime.state.callbacks) return;

    // Reuses the Additional ROMs control classes deliberately: same affordance
    // in the same place on a different tab, and a second set of near-identical
    // rules is how those two would drift apart visually.
    summary.classList.add('additional-rom-controls');

    const showing = slots();
    SLOT_KEYS.forEach((key, index) => {
      const wrapper = wrapperFor(key);
      if (wrapper) wrapper.hidden = index >= showing;
      if (index < showing) decorateSlot(key, index);
    });

    let add = summary.querySelector('.vpx-magic-add');
    if (!add) {
      add = document.createElement('button');
      add.type = 'button';
      add.className = 'additional-rom-add vpx-magic-add';
      add.textContent = '+';
      add.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const current = slots();
        // The first two clicks reveal a field in place; past that the overflow
        // dialog owns every further password.
        if (current < INLINE_SLOTS) {
          commit('__vpxMagicSlots', current + 1);
          render();
          runtime.schedule();
          return;
        }
        open();
      });
      summary.appendChild(add);
    }
    const nextIsDialog = showing >= INLINE_SLOTS;
    add.dataset.tooltip = nextIsDialog ? 'ADDITIONAL PASSWORDS' : 'ADD PASSWORD';
    add.setAttribute('aria-label', nextIsDialog ? 'Open additional passwords' : 'Add another password');

    const extra = entries().filter(Boolean);
    let indicator = summary.querySelector('.vpx-magic-indicator');
    if (!extra.length) {
      indicator?.remove();
      return;
    }
    if (!indicator) {
      indicator = document.createElement('button');
      indicator.type = 'button';
      indicator.className = 'additional-rom-indicator vpx-magic-indicator';
      indicator.innerHTML = keyIndicatorSvg();
      indicator.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        open();
      });
      summary.insertBefore(indicator, add);
    }
    // Never the password itself, only how many: this tooltip renders into the
    // page and would otherwise put a secret on screen next to a closed field.
    const count = `${extra.length} additional password${extra.length === 1 ? '' : 's'}`;
    indicator.dataset.tooltip = count.toUpperCase();
    indicator.setAttribute('aria-label', `${count}. Activate to edit.`);
  }

  const api = Object.freeze({ entries, open, render, slots, applyImported, applyList });
  window.VPS_MAGIC_PASSWORDS = api;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', dialog, { once: true });
  else dialog();
})();
