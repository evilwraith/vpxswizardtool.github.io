/* Guided walkthrough: a spotlight tour over the real workspace.
 *
 * Two modes, from two buttons in Help:
 *
 *   overview - free navigation, explains the app in place, changes nothing.
 *   guided   - loads the demo table, then holds the user's hand through
 *              actually building the YML. Steps with a task will not let Next
 *              through until the task is done, and advance on their own once
 *              it is. Reopening a saved YML comes LAST here, because this mode
 *              is about building a new one.
 *
 * Why it runs with the help dialog CLOSED: an element shown via showModal()
 * paints in the browser's top layer, above all document.body content whatever
 * its z-index, so a body-level overlay could never cover it. See "VPXS UI
 * Gotchas".
 *
 * The tour never selects anything for the user. It reveals collapsed UI, and it
 * loads the demo table on request; every actual build decision stays theirs. */
(() => {
  'use strict';

  const GAP = 14;     // space between the spotlight edge and the tooltip
  const PAD = 8;      // breathing room drawn around the highlighted control
  const EDGE = 12;    // minimum distance from the viewport edge
  const POLL = 350;   // how often a locked step re-checks its task
  const SETTLE = 700; // pause after a task completes, so the user sees it land

  /* Tales from the Crypt (Data East, 1993). One of only twelve tables in the
     VPS database that can reach all seven asset types at once, and the one with
     the most options among them. Its VPU Patch (TJMo9ycfSP) declares
     parentId uVgZUZdK, so the patch row fills in only once that exact VPX is
     selected. Guided mode teaches that rather than papering over it. */
  const DEMO_TABLE = {
    id: 'fXaQ33KC',
    name: 'Tales from the Crypt',
    requiredVpx: 'uVgZUZdK',
    requiredVpxLabel: 'VPW Premium 1.22'
  };

  const OTHER_ASSETS = [
    ['b2sFiles', 'Backglass'],
    ['romFiles', 'ROM'],
    ['altColorFiles', 'Color ROM'],
    ['pupPackFiles', 'PUP Pack'],
    ['altSoundFiles', 'Alt Sound']
  ];

  // ---------------------------------------------------------------- app state

  function runtimeState() {
    return window.VPS_FEATURE_RUNTIME?.state || {};
  }

  function categoryConfig(category) {
    return (window.VPS_YML_FIELDS?.CATEGORY_CONFIG || {})[category] || {};
  }

  function selectedId(category) {
    return String(runtimeState().selections?.[category] ?? '').trim();
  }

  /* A row counts as done however the user chose to satisfy it: a version
     picked, Bundled ticked, or Override ticked. All three are legitimate. */
  function assetFilled(category) {
    const config = categoryConfig(category);
    const values = runtimeState().values || {};
    return Boolean(
      selectedId(category)
      || (config.bundleField && values[config.bundleField] === true)
      || (config.overrideField && values[config.overrideField] === true)
    );
  }

  /* Uses the app's own validator so the tour agrees with what the build check
     will say about the same value. */
  function validMd5(value) {
    const check = window.VPS_UTILS?.isMd5Hash;
    const text = String(value ?? '').trim();
    return typeof check === 'function' ? Boolean(check(text)) : /^[0-9a-f]{32}$/i.test(text);
  }

  /* Table and asset names come from the VPS database, so they are escaped
     before going anywhere near innerHTML. */
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  function tableName() {
    return String(runtimeState().record?.name || '').trim();
  }

  // How many real choices a row offers, ignoring its "nothing selected" option.
  function assetOptionCount(category) {
    const row = firstVisible(`.asset-row[data-category="${category}"]`);
    const select = row && row.querySelector ? row.querySelector('select') : null;
    if (!select || !select.options) return null;
    return [...select.options].filter(option => option.value).length;
  }

  function plural(count, one, many) {
    return count === 1 ? one : many;
  }

  function tableLoaded() {
    const workspace = document.getElementById('workspace');
    return Boolean(workspace) && !workspace.hidden;
  }

  // ---------------------------------------------------------------- the steps

  const STEP = {
    search: {
      title: 'Find your table',
      target: '.header-search-wrap',
      prefer: 'bottom',
      /* The moment the user is actually in the search box, the tooltip gets out
         of the way, over to the side the YAML preview occupies, and the light
         follows the dropdown as it opens. `#suggestions` is display:none until
         it has results, so it measures 0x0 and the target falls back to the
         search box on its own until there is something to show. */
      variant: {
        when: () => document.activeElement?.id === 'idInput' || Boolean(firstVisible('#suggestions')),
        target: '#suggestions',
        prefer: 'right'
      },
      body: `<p>Everything starts here. Type a table name, or paste a VPS ID if you already have one.</p>
             <p>Matches appear as you type. Arrow keys move through them, Enter takes the highlighted one.</p>
             <p>Press <strong>/</strong> from anywhere in the app to jump back to this box.</p>`
    },

    ymlImport: {
      // Guided puts this last, as a sign-off. The standard tour meets it second,
      // where "coming back later" would read like an ending.
      title: () => (mode === 'guided' ? 'Coming back to edit this later' : 'Or reopen a YML you already made'),
      target: '#ymlImportDrop',
      prefer: 'bottom',
      body: `<p>You never have to start from scratch again. Drag a finished <strong>.yml</strong> back onto here and it loads into the builder ready to edit.</p>
             <p>The file is read inside your browser. Nothing is uploaded.</p>
             <p>If it holds fields the builder no longer supports, you get the chance to strip them out before it loads.</p>`
    },

    strip: {
      // Guided has just loaded the demo table. The standard tour may be running
      // with nothing loaded at all, so it cannot claim otherwise.
      title: () => (mode === 'guided' ? 'Your table is loaded' : 'The table strip'),
      target: '#tableStrip',
      prefer: 'bottom',
      missing: 'No table is loaded. Search for one at the top of the page, or use the demo table button in Help, and this strip appears here.',
      body: `<p>The table strip confirms what you loaded: name, manufacturer, year, and the VPS ID with a copy button beside it.</p>
             <p>Click the artwork to preview it larger. <strong>Clear</strong> starts a completely new build.</p>`
    },

    assets: {
      title: 'How the Assets Panel works',
      target: '.asset-section',
      prefer: 'right',
      missing: 'No table is loaded. Search for one at the top of the page and the Assets Panel fills in with a row per asset.',
      body: `<p>One row per asset. Filling a row unlocks its configuration tab below, and there are three ways to fill one.</p>
             <p><strong>Pick a version</strong> from the dropdown for the normal case. <strong>Bundled</strong> means it ships inside the table download, so it only needs Notes. <strong>Override</strong> means it has no VPS entry at all, so you supply every detail by hand.</p>
             <p>Once a row has something selected, <strong>its title turns into a link</strong>. It opens the page where that file is actually hosted, in a new tab: usually VPUniverse or VPForums, sometimes a Google Drive or MEGA link. That is where you go to download it, and the quickest way to confirm you picked the right version.</p>
             <p>The colored badges along the top summarize every row at a glance, and a green one jumps to that asset's tab.</p>`
    },

    vpx: {
      title: 'Start with the VPX',
      target: '.asset-row[data-category="tableFiles"]',
      prefer: 'right',
      missing: 'No table is loaded, so there is no VPX row yet.',
      /* Guided mode is walking a known table, so it can name the exact version
         to take. The standard tour has no idea what the user loaded, so it
         describes their own table back to them instead of naming a file that
         may not exist for them. */
      body() {
        const lead = '<p>The VPX is the table itself, so it comes first. Everything else attaches to it.</p>';
        if (mode === 'guided') {
          return `${lead}
            <p>This table has several versions. Take <strong>VPW Premium 1.22</strong>, ID <strong>uVgZUZdK</strong>, because it is the one the VPU Patch in the next step is built for.</p>`;
        }
        const name = tableName();
        const count = assetOptionCount('tableFiles');
        const intro = count === null || !name
          ? '<p>Load a table and this row lists every VPX version available for it.</p>'
          : `<p><strong>${esc(name)}</strong> offers <strong>${count} VPX ${plural(count, 'version', 'versions')}</strong> here. They are not interchangeable: expect MODs, VR and full-single-screen variants, and different authors.</p>`;
        return `${lead}${intro}
          <p><strong>Which one you pick has consequences further down.</strong> A VPU Patch is built for one specific VPX, so a different choice here can leave that row empty. If a row below looks broken, come back and check this one first.</p>`;
      },
      task: {
        instruction: 'In the highlighted row, choose the VPX with ID <strong>uVgZUZdK</strong> (VPW Premium 1.22).',
        done: () => selectedId('tableFiles') === DEMO_TABLE.requiredVpx,
        status() {
          const current = selectedId('tableFiles');
          if (!current) return 'Nothing selected yet.';
          return current === DEMO_TABLE.requiredVpx
            ? 'That is the one.'
            : `That VPX (${current}) has no patch attached. Choose uVgZUZdK instead.`;
        }
      }
    },

    patch: {
      // "And now it appears" only makes sense straight after the guided VPX
      // step caused it.
      title: () => (mode === 'guided' ? 'And now the VPU Patch appears' : 'The VPU Patch row, and why it is empty'),
      target: '.asset-row[data-category="vpuPatchFiles"]',
      prefer: 'right',
      missing: 'No table is loaded, so there is no VPU Patch row yet.',
      body() {
        const lead = `<p><strong>VPS does not publish patches as their own category.</strong> They sit among the table's VPX files, tagged with a <code>VPU Patch</code> feature, and each one records which VPX it patches. The builder only offers a patch once you have selected that exact VPX.</p>`;
        if (mode === 'guided') {
          return `<p>That row was empty a moment ago, and nothing was broken.</p>${lead}
            <p>Picking uVgZUZdK is what filled it in. Remember this one: if an asset row looks broken, check the VPX selection above it first.</p>`;
        }
        const count = assetOptionCount('vpuPatchFiles');
        if (count === null) return `${lead}<p>Load a table to see this row in action.</p>`;
        const outcome = count > 0
          ? `<p>With the VPX you have selected, <strong>${count} ${plural(count, 'patch is', 'patches are')}</strong> available here.</p>`
          : '<p>Right now this row is empty. That is the normal state: either this table has no patch at all, or the one it has belongs to a different VPX than the one you selected. Only 89 of the 2,561 tables in the database carry a patch.</p>';
        return `${lead}${outcome}
          <p>Either way, the lesson holds: if an asset row looks broken, check the VPX selection above it first.</p>`;
      },
      task: {
        instruction: 'Select the patch in the highlighted row.',
        done: () => assetFilled('vpuPatchFiles'),
        status: () => (assetFilled('vpuPatchFiles') ? 'Selected.' : 'Nothing selected yet.')
      }
    },

    others: {
      title: 'Fill in the rest',
      target: '.asset-section',
      prefer: 'right',
      missing: 'No table is loaded, so there are no asset rows yet.',
      body: `<p>This table carries every asset type, which is exactly why it was chosen for the tour. Work down the remaining rows.</p>
             <p>Any of the three routes counts: pick a version, tick <strong>Bundled</strong>, or tick <strong>Override</strong>. For this run, picking a version is simplest.</p>
             <p>Watch the badges at the top change color as you go, and try clicking a row title once you have selected something.</p>`,
      task: {
        instruction: 'Fill in the Backglass, ROM, Color ROM, PUP Pack, and Alt Sound rows.',
        done: () => OTHER_ASSETS.every(([category]) => assetFilled(category)),
        status() {
          const missing = OTHER_ASSETS.filter(([category]) => !assetFilled(category));
          const done = OTHER_ASSETS.length - missing.length;
          return missing.length
            ? `${done} of ${OTHER_ASSETS.length} done. Still needed: ${missing.map(([, label]) => label).join(', ')}.`
            : 'All five done.';
        }
      }
    },

    tabs: {
      title: () => (mode === 'guided' ? 'Every row you filled opened a tab' : 'The configuration tabs'),
      target: '.config-tab-list',
      prefer: 'right',
      reveal: 'configTab',
      missing: 'Nothing has unlocked a tab yet. Pick a version on any asset row above, or tick Bundled or Override on one, and the tabs appear here.',
      body: `<p>Only the tabs you gave a reason to exist are enabled. Each holds the fields for that asset.</p>
             <p>A tab turns <strong>red only for errors</strong>. Warnings leave it green, and it stays green once its required fields are done, even after you move away.</p>`
    },

    checksum: {
      title: 'Checksums, by dropping the file',
      target: '.checksum-drop-field',
      prefer: 'right',
      reveal: 'checksum',
      missing: 'No tab is open yet. Select an asset above to unlock its tab, and its checksum field is the second thing on it.',
      body: `<p>Drag the actual file onto the field and the MD5 is worked out in your browser. Nothing is uploaded. You can also type or paste one.</p>
             <p>Some fields reach inside an archive for you: drop a zip on VPX and it hashes the <strong>.vpx</strong> within. Backglass does the same for <strong>.directb2s</strong>, VPU Patch for <strong>.dif</strong>.</p>
             <p>On a <strong>Stern</strong> table, ROM also takes a bare <strong>.bin</strong> and finds a single .bin inside an archive. The line under the field always says what got hashed.</p>`,
      task: {
        instruction: 'Drop the VPX file onto the highlighted field.<span class="tour-task-aside"><strong><em>No copy of it on hand?</em></strong> Paste any 32-character MD5 instead, so the tour can move on.</span>',
        done: () => validMd5(runtimeState().values?.vpxChecksum),
        status() {
          const value = String(runtimeState().values?.vpxChecksum ?? '').trim();
          if (!value) return 'Field is empty.';
          if (validMd5(value)) {
            const source = runtimeState().values?.__checksumSources?.vpxChecksum?.name;
            return source ? `Calculated from ${source}.` : 'Looks like a valid MD5.';
          }
          return `${value.length} of 32 characters, and it must be hexadecimal.`;
        }
      }
    },

    advanced: {
      title: 'Advanced Config, when a tab needs it',
      target: '.advanced-fields',
      prefer: 'right',
      reveal: 'advanced',
      missing: 'No tab is open yet. Select an asset above to unlock one, and Advanced Config sits at the bottom of it.',
      body: `<p>URL, Version, and Authors overrides live here. Most builds never touch them.</p>
             <p>You need them when a tab is in <strong>Override</strong> mode, since there is no database entry to read from. Two rules catch people out: a URL Override always requires its matching Notes field, and it conflicts with having a VPS ID selected for the same asset.</p>`
    },

    preview: {
      title: 'Watch the YAML build itself',
      target: '#previewDrawer',
      prefer: 'left',
      missing: 'No table is loaded. Search for one and the live YAML preview appears down the right-hand side.',
      body: `<p>This is the actual file you are about to download, updating as you work.</p>
             <p>The colored dot beside the heading summarizes the whole build. <strong>Click the dot</strong> to jump to the first outstanding error.</p>`
    },

    actions: {
      title: 'Validate, then download',
      target: '.preview-actions',
      prefer: 'left',
      missing: 'No table is loaded. Search for one and these buttons appear at the top of the preview panel.',
      body: () => `<p><strong>Validate</strong> lists everything still wrong. <strong>Download</strong> saves the finished YML.</p>
             <p>Copy and Download stay blocked while any error remains. Warnings never block you.</p>
             <p>${mode === 'guided'
               ? 'That is the build loop. One last thing before you go.'
               : 'That is the build loop start to finish.'}</p>`
    }
  };

  const ORDER = {
    overview: ['search', 'ymlImport', 'strip', 'assets', 'vpx', 'patch', 'tabs', 'checksum', 'advanced', 'preview', 'actions'],
    // Guided starts after the demo table has loaded, and reopening a saved YML
    // moves to the end: this mode is about building a new one.
    guided: ['strip', 'assets', 'vpx', 'patch', 'others', 'tabs', 'checksum', 'advanced', 'preview', 'actions', 'ymlImport']
  };

  const SIDES = ['right', 'left', 'bottom', 'top'];

  /* A step whose control is hidden behind collapsed UI opens it rather than
     telling the user to go and find it. These change what is on screen only:
     no build data is written, nothing is chosen on the user's behalf.

     Opening "a tab" is not enough on its own, because the Main tab has no
     checksum field and several tabs have no Advanced Config. These walk the
     enabled tabs until the step's own target exists. Clicking a tab re-renders
     the accordion synchronously and replaces the buttons, so each pass re-reads
     them by id rather than holding stale nodes. */
  function enabledTabIds() {
    return [...document.querySelectorAll('.config-tab')]
      .filter(button => !button.disabled && button.id)
      .map(button => button.id);
  }

  function activeTabId() {
    return document.querySelector('.config-tab.active')?.id || null;
  }

  /* Clicking a tab is never free: it re-renders the accordion, and
     `productionFieldPresentation` re-runs from a capture-phase click listener
     and a MutationObserver on top of that. A click made when nothing needed to
     change is therefore a re-render made for nothing, and if anything reacts to
     that re-render by asking for another reveal, the two feed each other and
     the tour stalls in place. Every path below is a no-op when it already has
     what it needs. */
  function activateTab(id) {
    if (!id || id === activeTabId()) return false;
    const tab = document.getElementById(id);
    if (!tab || tab.disabled) return false;
    tab.click();
    return true;
  }

  function revealTarget(selector) {
    if (firstVisible(selector)) return true;
    const startedOn = activeTabId();
    for (const id of enabledTabIds()) {
      if (!activateTab(id)) continue;
      if (firstVisible(selector)) return true;
    }
    activateTab(startedOn);
    return false;
  }

  const REVEAL = {
    configTab: () => revealTarget('.config-tab-list'),
    /* Deliberately lands on the VPX tab when it exists, so the field being lit
       is the one the step's task is watching. Falls back to whichever tab has a
       checksum field if VPX is not available. */
    checksum() {
      if (firstVisible('.checksum-drop-field')) return true;
      if (activateTab('config-tab-vpx') && firstVisible('.checksum-drop-field')) return true;
      return revealTarget('.checksum-drop-field');
    },
    /* Order matters. VPX and PUP Pack have no Advanced Config at all, and
       Main's three are table metadata rather than asset overrides, so this
       heads for an asset tab that genuinely has one: Backglass first, then
       ROM. Main is the last resort rather than the first hit it would be if
       this just walked the tabs in render order. */
    advanced() {
      const preferred = ['b2s', 'rom', 'coloredRom', 'altSound', 'vpuPatch', 'main'];
      if (!firstVisible('.advanced-fields')) {
        for (const id of preferred.map(step => `config-tab-${step}`)) {
          if (!activateTab(id)) continue;
          if (firstVisible('.advanced-fields')) break;
        }
      }
      const details = firstVisible('.advanced-fields');
      if (details && !details.open) details.open = true;
      return Boolean(details);
    }
  };

  // ------------------------------------------------------------------ runtime

  let root = null;
  let spotlight = null;
  let tip = null;
  let steps = [];
  let mode = 'overview';
  let index = 0;
  let active = false;
  let lastFocus = null;
  let currentTarget = null;
  let pollTimer = null;
  let advanceTimer = null;
  let targetTimer = null;
  let variantTimer = null;
  let renderedWithTarget = false;

  function build() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'tour-root';
    root.hidden = true;

    spotlight = document.createElement('div');
    spotlight.className = 'tour-spotlight';

    tip = document.createElement('div');
    tip.className = 'tour-tip';
    tip.setAttribute('role', 'dialog');
    tip.setAttribute('aria-modal', 'true');
    tip.setAttribute('aria-label', 'Guided tour');
    tip.tabIndex = -1;

    root.append(spotlight, tip);
    document.body.appendChild(root);
  }

  /* Presence in the DOM proves nothing here, for two separate reasons.
     A control inside a hidden workspace has no box. And more awkwardly, the
     Additional ROM dialog is BUILT EAGERLY AT PAGE LOAD and appended to
     document.body (additionalRomsController.js, bottom of file), carrying its
     own `.checksum-drop-field` and its own `.advanced-fields` the whole time it
     is closed. So `document.querySelector('.advanced-fields')` is never null,
     even on a tab that has no Advanced Config at all.

     Every "is it on screen?" question therefore has to walk the matches and
     take the first one with a real box. Anything inside a closed <dialog> is
     display:none and measures 0x0, so it is skipped. */
  function firstVisible(selector) {
    if (!selector) return null;
    for (const node of document.querySelectorAll(selector)) {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return node;
    }
    return null;
  }

  /* A step can declare a `variant` that takes over while some condition holds.
     The preferred side switches as soon as the condition is true, but the
     target only switches once the variant's element is genuinely on screen, so
     a step never loses its highlight waiting for something to appear. */
  function activeVariant(step) {
    return step && step.variant && step.variant.when() ? step.variant : null;
  }

  function stepTarget(step) {
    const variant = activeVariant(step);
    if (variant && variant.target && firstVisible(variant.target)) return variant.target;
    return step ? step.target : null;
  }

  function stepPrefer(step) {
    const variant = activeVariant(step);
    return (variant && variant.prefer) || (step ? step.prefer : undefined);
  }

  function visibleTarget(step) {
    return firstVisible(stepTarget(step));
  }

  function placeSpotlight(node) {
    if (!node) {
      spotlight.classList.add('is-centered');
      spotlight.style.top = '';
      spotlight.style.left = '';
      spotlight.style.width = '';
      spotlight.style.height = '';
      return null;
    }
    const rect = node.getBoundingClientRect();
    spotlight.classList.remove('is-centered');
    spotlight.style.top = `${rect.top - PAD}px`;
    spotlight.style.left = `${rect.left - PAD}px`;
    spotlight.style.width = `${rect.width + PAD * 2}px`;
    spotlight.style.height = `${rect.height + PAD * 2}px`;
    return rect;
  }

  /* Placement rule: the tooltip must never cover the thing it is describing,
     which matters far more once a step asks the user to act inside the lit box.
     Each side is tested for "fits on screen" AND "does not intersect the lit
     box", in the step's preferred order. Wide panels ask for 'right', parking
     the tooltip over the YAML preview instead of over the rows in play. If no
     side is completely clean, the one covering the least of the target wins, so
     there is always an answer. */
  function placeTip(rect, prefer) {
    const { width: w, height: h } = tip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    if (!rect) {
      tip.style.top = `${clamp((vh - h) / 2, EDGE, Math.max(EDGE, vh - h - EDGE))}px`;
      tip.style.left = `${clamp((vw - w) / 2, EDGE, Math.max(EDGE, vw - w - EDGE))}px`;
      return;
    }

    const box = {
      top: rect.top - PAD,
      left: rect.left - PAD,
      right: rect.right + PAD,
      bottom: rect.bottom + PAD
    };

    const alignY = clamp(rect.top + rect.height / 2 - h / 2, EDGE, Math.max(EDGE, vh - h - EDGE));
    const alignX = clamp(rect.left + rect.width / 2 - w / 2, EDGE, Math.max(EDGE, vw - w - EDGE));

    const candidates = {
      right: { left: box.right + GAP, top: alignY },
      left: { left: box.left - GAP - w, top: alignY },
      bottom: { left: alignX, top: box.bottom + GAP },
      top: { left: alignX, top: box.top - GAP - h }
    };

    const onScreen = c => c.left >= EDGE && c.top >= EDGE
      && c.left + w <= vw - EDGE && c.top + h <= vh - EDGE;

    const overlapArea = c => {
      const x = Math.max(0, Math.min(c.left + w, box.right) - Math.max(c.left, box.left));
      const y = Math.max(0, Math.min(c.top + h, box.bottom) - Math.max(c.top, box.top));
      return x * y;
    };

    const order = prefer ? [prefer, ...SIDES.filter(side => side !== prefer)] : SIDES;

    let chosen = null;
    for (const side of order) {
      const candidate = candidates[side];
      if (onScreen(candidate) && overlapArea(candidate) === 0) { chosen = candidate; break; }
    }

    if (!chosen) {
      chosen = order
        .map(side => candidates[side])
        .map(c => ({
          left: clamp(c.left, EDGE, Math.max(EDGE, vw - w - EDGE)),
          top: clamp(c.top, EDGE, Math.max(EDGE, vh - h - EDGE))
        }))
        .sort((a, b) => overlapArea(a) - overlapArea(b))[0];
    }

    tip.style.top = `${chosen.top}px`;
    tip.style.left = `${chosen.left}px`;
  }

  /* Re-queried on EVERY measure, never cached. Activating a tab re-renders the
     accordion and replaces these nodes, and `productionFieldPresentation`
     re-runs from a capture-phase click listener and a MutationObserver, so a
     node captured a moment ago can be detached by the time it is measured. A
     detached node reports a zero-size box at 0,0, which collapsed the spotlight
     and left the tooltip with nothing to anchor to between steps. */
  function reposition() {
    if (!active) return;
    const step = steps[index];
    currentTarget = visibleTarget(step);
    placeTip(placeSpotlight(currentTarget), stepPrefer(step));
  }

  /* Only ever calls reposition(), which re-queries and re-places but never
     clicks a tab, re-renders, or touches focus. That is what makes it safe to
     run on a short interval, unlike anything that reveals. */
  function watchVariant() {
    window.clearInterval(variantTimer);
    if (!steps[index]?.variant) return;
    variantTimer = window.setInterval(reposition, 200);
  }

  /* A target can also arrive a beat late, after one of those deferred passes
     finishes. This watches for the presence of the step's target to disagree
     with what the tooltip was drawn for, and redraws once when it does. */
  function watchTarget() {
    window.clearInterval(targetTimer);
    let tries = 0;
    targetTimer = window.setInterval(() => {
      if (!active) { window.clearInterval(targetTimer); return; }
      // Deliberately one-way: redraw when a target APPEARS, never when it
      // vanishes. Reacting to a disappearance would chase the flicker of a
      // deferred re-render and redraw forever.
      if (!renderedWithTarget && visibleTarget(steps[index])) {
        window.clearInterval(targetTimer);
        render({ reveal: false, focus: false });
        return;
      }
      if (++tries > 12) window.clearInterval(targetTimer);
    }, 250);
  }

  // A task only locks the tour in guided mode; overview stays free to browse.
  function taskFor(step) {
    return mode === 'guided' && step && step.task ? step.task : null;
  }

  /* Refreshes the live parts of a locked step without rebuilding the tooltip,
     so the user does not lose their place mid-click. */
  function refreshTask() {
    const task = taskFor(steps[index]);
    if (!task) return false;

    const done = Boolean(task.done());
    const status = tip.querySelector('.tour-task-status');
    if (status) {
      status.textContent = task.status ? task.status() : '';
      status.classList.toggle('is-done', done);
    }
    const next = tip.querySelector('[data-tour="next"]');
    if (next) next.disabled = !done;
    tip.querySelector('.tour-tip-task')?.classList.toggle('is-done', done);
    return done;
  }

  function stopWatching() {
    window.clearInterval(pollTimer);
    window.clearTimeout(advanceTimer);
    window.clearInterval(targetTimer);
    window.clearInterval(variantTimer);
    pollTimer = null;
    advanceTimer = null;
    targetTimer = null;
    variantTimer = null;
  }

  /* Polling rather than event listening is deliberate. This app syncs state
     from capture-phase document listeners, which run BEFORE the field's own
     handler has committed the change, so reacting to an event here would read
     stale state. See the capture-phase note in "VPXS UI Gotchas". A short poll
     always reads state after it has settled. */
  function watchTask() {
    if (advanceTimer) return;    // an advance is already scheduled; leave it be
    stopWatching();
    if (!taskFor(steps[index])) return;
    if (refreshTask()) return;   // already satisfied; wait for Next

    pollTimer = window.setInterval(() => {
      if (!refreshTask()) return;
      stopWatching();
      advanceTimer = window.setTimeout(() => { if (active) go(1); }, SETTLE);
    }, POLL);
  }

  function render({ reveal = true, focus = true } = {}) {
    const step = steps[index];
    // Opening a tab re-renders the accordion synchronously, so the target is
    // queried after the reveal rather than before it. A redraw passes
    // reveal:false, because re-running a reveal from inside a redraw is exactly
    // the loop described above activateTab().
    if (reveal && step.reveal && REVEAL[step.reveal] && !visibleTarget(step)) REVEAL[step.reveal]();

    const node = visibleTarget(step);
    currentTarget = node;
    renderedWithTarget = Boolean(node);

    const task = taskFor(step);
    const missing = !node
      ? `<p class="tour-tip-missing">${step.missing || 'This part of the app is not on screen yet.'}</p>`
      : '';
    const taskBlock = task && node
      ? `<div class="tour-tip-task">
           <p class="tour-task-label">Your turn</p>
           <p class="tour-task-instruction">${task.instruction}</p>
           <p class="tour-task-status"></p>
         </div>`
      : '';

    tip.innerHTML = `
      <p class="tour-tip-step">Step ${index + 1} of ${steps.length}</p>
      <h3 class="tour-tip-title"></h3>
      <div class="tour-tip-body">${typeof step.body === 'function' ? step.body() : step.body}${missing}</div>
      ${taskBlock}
      <div class="tour-tip-actions">
        <button class="tour-btn tour-btn-skip" type="button" data-tour="exit">Skip tour</button>
        <span class="tour-spacer"></span>
        <button class="tour-btn" type="button" data-tour="back">Back</button>
        <button class="tour-btn tour-btn-primary" type="button" data-tour="next"></button>
      </div>`;

    // Step titles are data, so they go in as text rather than as markup.
    tip.querySelector('.tour-tip-title').textContent =
      typeof step.title === 'function' ? step.title() : step.title;
    tip.querySelector('[data-tour="next"]').textContent =
      index === steps.length - 1 ? 'Finish' : 'Next';
    tip.querySelector('[data-tour="back"]').disabled = index === 0;

    if (node) {
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      // Measure again once the smooth scroll settles, or the spotlight lands
      // where the target used to be.
      window.setTimeout(reposition, 280);
    }

    reposition();
    window.requestAnimationFrame(reposition);
    watchTask();
    watchTarget();
    watchVariant();
    // Never steal focus on a redraw: the search step exists precisely to be
    // used while the user is typing somewhere else.
    if (focus) tip.focus();
  }

  function locked() {
    const task = taskFor(steps[index]);
    return Boolean(task) && !task.done();
  }

  function go(delta) {
    const next = index + delta;
    if (next < 0) return;
    stopWatching();
    if (next >= steps.length) { stop(); return; }
    index = next;
    render();
  }

  function onKey(event) {
    if (!active) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stop(); return; }
    if (event.key === 'ArrowRight') { event.preventDefault(); if (!locked()) go(1); return; }
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
  }

  function onClick(event) {
    const action = event.target.closest?.('[data-tour]')?.dataset.tour;
    if (!action) return;
    if (action === 'exit') stop();
    if (action === 'next' && !locked()) go(1);
    if (action === 'back') go(-1);
  }

  function start(requested = 'overview') {
    build();
    if (active) return;
    mode = ORDER[requested] ? requested : 'overview';
    steps = ORDER[mode].map(id => STEP[id]).filter(Boolean);
    active = true;
    index = 0;
    lastFocus = document.activeElement;
    root.hidden = false;
    root.dataset.mode = mode;
    document.body.classList.add('tour-open');
    tip.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    render();
  }

  function stop() {
    if (!active) return;
    active = false;
    stopWatching();
    currentTarget = null;
    root.hidden = true;
    document.body.classList.remove('tour-open');
    tip.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, true);
    const restore = lastFocus && lastFocus.isConnected ? lastFocus : document.getElementById('helpBtn');
    restore?.focus?.();
    lastFocus = null;
  }

  /* Drives the real search box rather than reaching into private state, which
     is the same approach the YML importer uses. */
  function loadDemoTable() {
    const input = document.getElementById('idInput');
    const form = document.getElementById('searchForm');
    if (!input || !form) return Promise.resolve(false);

    input.value = DEMO_TABLE.id;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    return new Promise(resolve => {
      const deadline = Date.now() + 12000;
      const check = () => {
        if (tableLoaded()) return resolve(true);
        if (Date.now() > deadline) return resolve(false);
        window.setTimeout(check, 90);
      };
      check();
    });
  }

  function closeHelpDialog() {
    const dialog = document.getElementById('helpDialog');
    if (dialog?.open) dialog.close();
  }

  function bindLaunchers() {
    document.getElementById('startWalkthroughBtn')?.addEventListener('click', () => {
      closeHelpDialog();
      window.requestAnimationFrame(() => start('overview'));
    });

    const demoButton = document.getElementById('startWalkthroughDemoBtn');
    demoButton?.addEventListener('click', async () => {
      if (tableLoaded() && !window.confirm(
        `Load ${DEMO_TABLE.name} for the guided build? This replaces the build currently open.`
      )) return;

      closeHelpDialog();
      demoButton.disabled = true;
      const ok = await loadDemoTable();
      demoButton.disabled = false;
      // Guided mode only makes sense with the table in place; without it the
      // locked steps could never be satisfied, so fall back to the overview.
      if (!ok) console.warn(`Could not load the demo table ${DEMO_TABLE.id}.`);
      start(ok ? 'guided' : 'overview');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindLaunchers, { once: true });
  } else {
    bindLaunchers();
  }

  window.VPS_WALKTHROUGH = Object.freeze({
    start,
    stop,
    loadDemoTable,
    demoTable: () => ({ ...DEMO_TABLE }),
    order: requested => (ORDER[requested] || ORDER.overview).slice()
  });
})();
