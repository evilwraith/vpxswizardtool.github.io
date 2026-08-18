# VPXS YML Builder

A browser-based workspace for creating, validating, editing, copying, and downloading VPXS table configuration files using data from the Virtual Pinball Spreadsheet database.

The builder is designed for repeat use: search for a table or reopen an existing `.yml` file, select the assets that apply, complete the enabled configuration tabs, review the generated YAML, and move directly to the next build.

## Table of contents

- [Live site](#live-site)
- [What the builder does](#what-the-builder-does)
- [Instructions](#instructions)
- [Fast repeat-use workflow](#fast-repeat-use-workflow)
- [Edit an existing YML](#edit-an-existing-yml)
- [Asset selection](#asset-selection)
- [Configuration panel](#configuration-panel)
- [Validation and status indicators](#validation-and-status-indicators)
- [VPS database updates](#vps-database-updates)
- [Checksum and archive tools](#checksum-and-archive-tools)
- [YAML behavior](#yaml-behavior)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Saved browser data](#saved-browser-data)
- [Project structure](#project-structure)
- [Repository policy files](#repository-policy-files)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Version history](#version-history)
- [Credits and bundled software](#credits-and-bundled-software)

## Live site

**VPXS YML Builder:** https://moxassault.github.io/

## What the builder does

- Searches the Virtual Pinball Spreadsheet database by table name or VPS ID.
- Opens supported `.yml` files and loads their values back into the editor.
- Confirms before replacing a build that is already open.
- Filters unsupported table formats and unavailable or broken database entries.
- Supports VPX, Backglass, ROM, Color ROM, PUP Pack, and VPU Patch assets.
- Generates a live YAML preview while configuration values are entered.
- Validates required values, checksums, bundled-asset requirements, override relationships, and line length.
- Calculates MD5 checksums from files dropped onto supported checksum fields.
- Reads ZIP, RAR, and 7Z PUP Pack archives and offers discovered directories as Archive Root choices.
- Saves unfinished work and recent completed builds in the browser.
- Verifies that search is using the latest published VPS database version.

## Instructions

1. Search for a table by VPS table ID or name, or drop an existing `.yml` file into **Drop YML to Edit**.
2. Choose the correct table from the search results when starting a new build.
3. Select a VPX file and any additional assets that apply to the build.
4. Open the enabled Configuration Panel tabs and complete the required fields.
5. Drop supported files onto checksum fields to calculate MD5 values automatically, or enter valid hashes manually.
6. Review the YAML Preview and correct any fields marked with an error dot.
7. Select **Validate** to see the complete error and warning list.
8. Select **Copy** or **Download & Clear** when the build passes validation.

## Fast repeat-use workflow

1. Search for a table.
2. Select the applicable assets.
3. Complete only the enabled configuration tabs.
4. Use the YAML Preview status dot to inspect the build and jump to the first error.
5. Validate the configuration.
6. Download the YML and automatically clear the workspace for the next table.

The active build autosaves in the current browser. Recent copied and downloaded builds can be reopened from **Recent Build History**.

## Edit an existing YML

Use the compact **Drop YML to Edit** area in the header to reopen a generated VPXS configuration.

- Only one file ending in `.yml` can be opened at a time.
- Files larger than 2 MB are rejected.
- The file is read and parsed in the browser; it is not uploaded.
- When a build is already open, the builder asks for confirmation before replacing it.
- The imported `tableVPSId` and asset VPS IDs are checked against the current VPS database before the active build is cleared.
- The importer supports the flat VPXS structure used by this builder, including scalars, booleans, numbers, arrays, and folded or literal text blocks.
- Unsupported top-level keys are skipped and reported after the import completes.
- A loading toaster remains visible while the file is parsed, matched to the database, and applied to the form.
- After loading, the page remains at its current scroll position instead of forcing the Configuration Panel into view.
- Editing, validation, copying, and downloading continue normally after the import finishes.

## Asset selection

The Assets Panel lists the available asset categories for the selected table:

- **VPX**
- **Backglass**
- **ROM**
- **Color ROM**
- **PUP Pack**
- **Alt Sound**
- **VPU Patch**

Each asset row shows its current state and available database entries. Broken entries are disabled. Supported artwork includes compact thumbnail previews.

A green asset badge is clickable and jumps to that asset's configuration tab. The Configuration Panel appears whenever at least one asset is selected or marked as bundled; selecting a VPX first is not required to begin entering other asset details.

An optional asset that is merely **Available** does not count as a Preview caution when it is not selected or bundled.

## Configuration panel

The Configuration Panel contains tabs for Main, VPX, Backglass, ROM, Color ROM, PUP Pack, Alt Sound, and VPU Patch settings.

- **Main** contains the Game VPS ID, FPS, tagline, notes, testers, and table metadata overrides.
- The selected-game header card includes a copy icon beside the Game VPS ID without changing the ID text color.
- **Disable for Wizard** is unchecked by default. Checking it writes `enabled: false` to the YAML; leaving it unchecked omits the key entirely. Its tooltip appears only while hovering or focusing the checkbox and text.
- Asset-specific tabs become available when their asset is selected or marked as bundled.
- Advanced Config sections contain optional metadata and override fields.
- URL and Version Override fields must be supplied together for ROM, Color ROM, Alt Sound, and VPU Patch entries.
- Backglass URL Override requires Backglass Authors Override and Backglass Image Override.
- Alt Sound Checksum is required whenever Alt Sound is selected, URL-overridden, or bundled; a single checksum is written as a plain value, multiple as a list.
- VPU Patch Checksum is required whenever the VPU Patch tab is enabled.
- The VPU Patch ID is informational and does not display a field-level error border or error dot.
- Configuration tooltips are raised above neighboring fields and panel edges.

## Validation and status indicators

Validation errors block Copy and Download. Warnings are allowed but should be reviewed.

The builder provides several status indicators:

- Asset-row status labels.
- Asset badges in the Assets Panel heading.
- Configuration-tab error and warning markers.
- Field-level red error dots with custom tooltips.
- A combined YAML Preview status dot covering both assets and configuration tabs.

Hover or keyboard-focus the YAML Preview status dot to see active state counts. Unavailable entries and unused optional assets reported only as **Available** are omitted from the breakdown. Click the dot, or press Enter or Space while it is focused, to move to the first current validation error.

## VPS database updates

When the page opens, the builder immediately checks the Virtual Pinball Spreadsheet `lastUpdated.json` version.

- A top-entry toast shows the checking state.
- If the cached version matches, the builder continues using it.
- If a newer version exists, the database is downloaded, validated, and stored in IndexedDB.
- If the update check fails, the most recent verified cache remains available.
- While the page stays open, the version is checked again every two hours.
- Returning to a tab that has been inactive for at least two hours triggers a catch-up check.

The full database is downloaded only when the published version changes.

## Checksum and archive tools

Supported checksum fields accept file drag-and-drop and calculate MD5 in the browser. Hashing runs in a Web Worker when available so the interface remains responsive.

Accepted file types depend on the field, including:

- VPX files
- DirectB2S files
- ROM archives
- Single Color ROM files using `.crz`, `.pal`, or `.pac`
- Double Color ROM PAL/VNI pairs using one `.pal` and one `.vni` file in either checksum field
- PUP Pack ZIP, RAR, and 7Z archives
- Alt Sound ZIP, RAR, and 7Z archives
- VPU Patch files

For PAL/VNI pairs, both checksum fields initially accept either extension. After the first file is dropped, that extension is removed from the other field so the pair cannot contain two files of the same type. Unchecking **PAL/VNI** clears both checksum fields and their dropped-file metadata.

When a supported PUP Pack archive is dropped onto the PUP Pack Checksum field, the builder also reads its directory structure. Discovered directories are sorted from top-level paths downward and offered in the PUP Pack Archive Root selector.

Files are processed by the browser and are not uploaded by this application.

## YAML behavior

- YAML keys are emitted in alphabetical order.
- Empty strings and empty arrays are omitted.
- `enabled: false` is emitted only when Disable for Wizard is checked; otherwise the key is omitted entirely.
- FPS and `tableYearOverride` are emitted as integers.
- Testers and Backglass author overrides are emitted as YAML arrays.
- A single checksum is emitted as a string.
- Multiple checksums are emitted as a YAML list.
- PAL/VNI Color ROM mode emits `coloredROMPin2DMD: true` and a two-item `coloredROMChecksum` list.
- URL fields that exceed the line-length limit receive the supported yamllint comment.
- Long non-URL text values use folded YAML blocks.
- Unsupported UI-only values are excluded from output.
- VPU Patch values use `diffVPSId`, `diffChecksum`, `diffUrlOverride`, and `diffVersionOverride`.
- Alt Sound output supports `altSoundVPSId`, `altSoundBundled`, `altSoundChecksum`, `altSoundUrlOverride`, `altSoundVersionOverride`, `altSoundArchiveFormat`, `altSoundArchiveRoot`, `altSoundAuthorsOverride`, and `altSoundNotes` when applicable.
- PUP Pack output supports `pupVPSId`, `pupBundled`, `pupChecksum`, `pupFileUrl`, `pupVersion`, `pupArchiveFormat`, `pupArchiveRoot`, `pupRequired`, and `pupNotes` when applicable.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `/` | Focus and select the table search field |
| `Ctrl`/`Cmd` + `Enter` | Validate the current build |
| `Ctrl`/`Cmd` + `Shift` + `Enter` | Download the YAML and clear the workspace |
| `Escape` | Close an open dialog |
| `Enter` or `Space` on the preview status dot | Open the first validation error |

## Saved browser data

The application stores the following information in the current browser:

- Theme preference.
- Active configuration tab.
- Current unfinished draft.
- Recent completed build snapshots.
- Last verified VPS database and version metadata.

No sign-in is required. Clearing site data in the browser removes these saved values.

## Project structure

```text
index.html
css.src/
  1variables.css
  base.css
  search.css
  card.css
  category.css
  modal.css
  vpsDbToast.css
  uiEnhancements.css
  v090.css
  v091.css
  ymlImport.css
  v0103.css
js.src/
  fields.js
  utilities.js
  apiHelper.js
  vpsDbToast.js
  searchHelper.js
  uiHelper.js
  uiEnhancements.js
  v090Enhancements.js
  v091Corrections.js
  main.js
  ymlImport.js
  v0102Fixes.js
  nativeTooltipCleanup.js
vendor/libarchive/
  libarchive.js
  worker-bundle.js
  libarchive.wasm
  LICENSE
fixtures/
  pup-test.zip
  pup-test.7z
  pup-test.rar
test-runtime.html
README.md
```

### Main integration points

- `js.src/fields.js` defines categories, configuration tabs, fields, options, YAML exclusions, and reusable values.
- `js.src/utilities.js` contains YAML generation, formatting, asset-state, checksum, and archive helpers.
- `js.src/apiHelper.js` verifies, downloads, validates, and caches VPS database data.
- `js.src/vpsDbToast.js` displays immediate and scheduled database-check status.
- `js.src/searchHelper.js` filters and ranks table search results.
- `js.src/uiHelper.js` renders table, asset, field, tab, checksum, and archive controls.
- `js.src/uiEnhancements.js` contains image containment, field error markers, Advanced Config spacing, and combined preview status behavior.
- `js.src/v090Enhancements.js` manages Help tabs, additional validation, Color ROM behavior, clickable asset badges, and refined preview status behavior.
- `js.src/v091Corrections.js` contains follow-up field, tooltip, and validation-display corrections.
- `js.src/main.js` manages application state, validation, drafts, history, keyboard shortcuts, and output actions.
- `js.src/ymlImport.js` parses and loads supported `.yml` files into the existing interface.
- `js.src/v0102Fixes.js` preserves scroll position after imports and removes unused available assets from Preview caution counts.
- `css.src/v0103.css` standardizes modal placement near the top of the viewport.

## Repository policy files (planned, not yet added)

These files are described here as a spec for what they should contain once added — none of the four currently exist in the repository root. `vendor/libarchive/LICENSE` is a separate, existing file: the scoped upstream MIT notice for the bundled libarchive.js library only.

- `SECURITY.md` should explain browser-side processing, dependency boundaries, reporting guidance, and information that should not be submitted publicly.
- `CODE_OF_CONDUCT.md` should define expected behavior and restrictions against misuse, resale, paywalling, or monetary exploitation of the repository and hosted site.
- `CONTRIBUTING.md` should contain contribution guidance, project credits, and attribution details.
- `LICENSE` (root) would need a license choice from the maintainer before it's added; it would not automatically relicense `vendor/libarchive.js`, which keeps its own upstream MIT notice regardless.

## Troubleshooting

### The site loads without styling or scripts

Open browser developer tools and check for `404` responses. The repository must preserve the `css.src`, `js.src`, and `vendor` folder names and paths exactly as referenced by `index.html`.

### Search reports that the database could not be verified

The builder will use the last verified IndexedDB copy when available. Check the browser console and `window.getVPSDBStatus()` for the active source and state.

### A checksum drop is rejected

Confirm that the dropped file extension matches the field hint. Each checksum control accepts only the file types appropriate for that asset. In PAL/VNI mode, the second file must use the extension not already assigned to the first field.

### A PUP archive checksum works but no directories appear

The archive may not contain nested directories, may be damaged, or may use an unsupported archive feature. The checksum can still be used when MD5 calculation succeeds.

### Copy or Download does nothing

Select **Validate**. Blocking validation errors open the results dialog instead of allowing invalid YAML to be copied or downloaded.

### A previous build reappears after refreshing

The current draft is intentionally restored from browser storage. Use **Clear** or **Download & Clear** to remove the active draft.

### A YML file is rejected

Confirm that the file ends in `.yml`, is smaller than 2 MB, contains top-level VPXS fields, and includes valid `tableVPSId` and `vpxVPSId` values. Nested custom mappings are not part of the supported import format.

### An imported asset cannot be loaded

The imported asset ID must still be available for the imported table in the current VPS database. Broken, removed, or mismatched entries are rejected before the active build is replaced.

### A VPU Patch tab shows an error after Clear Section

A selected or bundled VPU Patch still requires a valid checksum. The error belongs on **VPU Patch Checksum**; the informational VPU Patch ID should not display a red border or error dot.

## FAQ

### Does the site upload my VPX, ROM, Backglass, Color ROM, PUP, or YML files?

No. Dropped checksum files, archive directory data, and imported YML files are processed in the browser.

### Does the site edit the Virtual Pinball Spreadsheet database?

No. The database is read-only from this application. The builder only uses it to locate tables and available assets.

### Why does the database toast appear every time the site opens?

It confirms whether the cached database matches the latest published `lastUpdated.json` version. The initial check prevents searches from silently using stale data.

### Why does the site check again every two hours?

The VPS database can change while the page remains open. The periodic check compares only the lightweight version file unless a newer database is available.

### Can I continue working if the database host is unavailable?

Yes, after at least one successful load. The last verified database remains in IndexedDB and is used as a fallback.

### Why are some asset choices disabled?

Entries marked as broken or unavailable by the VPS database cannot be selected for a valid build.

### Why does an unused available asset not appear as a caution?

Availability alone does not require action. The Preview breakdown counts assets that are selected, bundled, conflicting, or required; unused optional assets are omitted.

### Why are some configuration tabs disabled?

Asset-specific tabs become available only when their asset is selected or marked as bundled.

### Is Disable for Wizard enabled by default?

No. It's unchecked by default, meaning the table stays enabled for Wizard. Check it only when you specifically want this table disabled for Wizard; that writes `enabled: false` to the YAML.

### Why is Copy or Download blocked?

The generated YAML has at least one validation error. Warnings are allowed, but errors must be corrected first.

### What does the YAML Preview dot represent?

It combines active Assets Panel states with enabled Configuration Panel states. Hover or keyboard-focus the dot to see active status counts, or activate it to move to the first current error.

### What is stored in Recent Build History?

The newest copied or downloaded snapshot for each table, including its YAML and editable form state. Up to eight recent tables are retained.

### What happens when I open a YML while another build is loaded?

The builder asks for confirmation. It validates and parses the new file before clearing the current build, then loads the imported table, assets, and field values.

## Version history

Newest versions are listed first.

### Unreleased — Documentation catch-up for Alt Sound and VPU Patch

- The Alt Sound and VPU Patch asset categories, their Configuration Panel tabs, checksum/archive handling, and validation rules had shipped in the application but were missing from this README's asset list, configuration panel section, and file tree. This entry documents that catch-up; it does not represent new application behavior.
- Corrected the file tree below to match the actual repository contents (added the missing `pup-test.rar` fixture; removed references to policy files that don't exist yet — see "Repository policy files" below).

### v0.10.3 — Modal alignment and consolidated documentation

- Positioned every application dialog at the same upper-page starting point.
- Moved dialogs closer to the top of the viewport while retaining responsive safe-area handling.
- Replaced the Help modal title **Fast repeat-use workflow** with **Help**.
- Preserved the Help modal's existing overall footprint and tab-panel sizing.
- Updated the consolidated README with all missing changes through v0.10.3.

### v0.10.2 — Import position and Preview caution corrections

- Prevented completed YML imports from forcing the page to scroll to the Configuration Panel.
- Excluded unused optional assets marked only as **Available** from Preview caution counts.
- Kept selected, bundled, conflicting, required, and configuration states in the Preview breakdown.

### v0.10.1 — Header alignment and documentation rollback

- Aligned the search area with the right edge of the main game-card/workspace column.
- Aligned the Drop YML and header-action area with the YAML Preview column.
- Restored the README to a single consolidated document and removed the split documentation pages.

### v0.10.0 — YML editing and repository policy files

- Added the compact **Drop YML to Edit** control between search and the header actions.
- Restricted imports to one `.yml` file at a time and added a 2 MB size limit.
- Added confirmation before replacing an open build.
- Added loading, success, and error toaster states for YML imports.
- Added safe parsing for flat VPXS YAML values, arrays, and multiline text.
- Added current-database validation for imported table and asset VPS IDs.
- Added `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, and a scoped third-party `LICENSE` notice.

### v0.9.2 — Validation-display corrections

- Changed the Enable tooltip to **This option is disabled by default.**
- Restricted the tooltip trigger to the checkbox and its text.
- Prevented the informational VPU Patch ID from displaying a red border or field-level error dot, including during Clear Section rerenders.
- Kept required VPU Patch checksum errors attached to the checksum field.

### v0.9.1 — Follow-up interface corrections

- Moved the Game VPS ID copy icon to the selected-game header card without changing the existing ID text color.
- Changed the second Color ROM placeholder to `Color ROM Checksum #2   (ROM name)`.
- Raised Configuration Panel tooltips above neighboring fields and panel edges.
- Made unchecking PAL/VNI clear both Color ROM checksum fields and dropped-file metadata.

### v0.9.0 — Workflow, Color ROM, and Help improvements

- Added slim-line Instructions, Help, and FAQ tabs to the Help dialog.
- Added a compact copy control for the selected table's Game VPS ID.
- Allowed the Configuration Panel to open when any asset is selected, even without a VPX selection.
- Made every safe green asset badge clickable.
- Fixed Enable for Wizard off and added a custom tooltip.
- Added `.crz`, `.pal`, and `.pac` support for single Color ROM files.
- Allowed PAL/VNI files to be dropped into either checksum field and dynamically removed duplicate extensions from the remaining field.
- Reorganized the Color ROM grid and renamed the second checksum field.
- Improved PUP Pack Required alignment.
- Added two-way URL and Version Override validation for ROM, Color ROM, and VPU Patch.
- Added Backglass URL dependency validation and required VPU Patch checksums.
- Removed unavailable entries from the preview tooltip and made the preview dot open the first error.
- Updated the footer credit and linked the Virtual Pinball Spreadsheet site.

### v0.8.0 — Interface validation and documentation

- Constrained selected table artwork to its designated thumbnail frame.
- Restyled Advanced Config as a properly inset sub-panel with balanced spacing.
- Combined Assets Panel and Configuration Panel states in the YAML Preview status indicator.
- Added a status breakdown showing each active state and quantity.
- Added field-level error-dot overlays and invalid-control highlighting.
- Rebuilt the README with complete instructions, workflow, FAQ, troubleshooting, architecture, and descending semantic version history.

### v0.7.0 — Verified database updates and status toast

- Added `lastUpdated.json` version verification.
- Added IndexedDB storage for the last verified VPS database.
- Added safe replacement, validation, source fallbacks, and mid-download version confirmation.
- Added an immediate top-entry status toast with checking, updating, current, updated, warning, and error states.
- Added two-hour checks and inactive-tab catch-up checks.

### v0.6.0 — Validation and archive support

- Added browser-side validation based on the upstream validator and table example.
- Added Color ROM Serum and PAL/VNI checksum behavior.
- Renamed VPU Patch output fields to the upstream `diff*` keys.
- Added `pupVPSId` and `pupBundled` output support.
- Standardized ID and checksum control sizing.
- Added PUP Pack archive directory browsing for ZIP, RAR, and 7Z files.
- Bundled libarchive.js and WebAssembly locally.
- Improved light-theme checkbox and status colors.

### v0.5.0 — Status system and recent builds

- Added the Green, Yellow, Orange, and Red asset-state system.
- Added fixed-size text asset badges and tab issue indicators.
- Added `enabled: false` by default.
- Added complete recent-build snapshots with Edit, Copy, Download, and Delete actions.
- Added table manufacturer, table year, and VPU Patch override fields.
- Removed deprecated override toggles and older fix controls.

### v0.4.0 — Checksum workflow and interface cleanup

- Added browser-side MD5 file drag-and-drop.
- Moved hashing into a Web Worker.
- Added checksum progress feedback.
- Renamed interface sections and improved selection metadata.
- Added Recent Build History management and confirmed history clearing.
- Removed preset controls.

### v0.3.0 — Asset filtering and patch relationships

- Excluded unsupported Future Pinball and Pinball FX table formats.
- Detected VPU Patch entries from table-file feature metadata.
- Filtered VPU Patches by their selected parent VPX.
- Cleared incompatible patches when the parent VPX changed.
- Improved thumbnail containment and field labeling.

### v0.2.0 — Tabbed configuration workspace

- Replaced top-level configuration accordions with Main, VPX, Backglass, ROM, Color ROM, PUP Pack, and VPU Patch tabs.
- Added a fixed-height compact configuration workspace.
- Opened Advanced Config sections by default.
- Reduced repeated descriptions and moved field names into placeholders.

### v0.1.0 — Compact workspace foundation

- Replaced the original linear wizard with a repeat-use workspace.
- Added table search, asset selection, live YAML preview, browser-saved drafts, recent builds, keyboard shortcuts, and light/dark themes.
- Added CDN database loading with a GitHub fallback.

## Credits and bundled software

Table and asset data is provided by the **Virtual Pinball Spreadsheet** project.

Archive browsing uses **libarchive.js** and its WebAssembly worker. The bundled upstream MIT license is included at `vendor/libarchive/LICENSE`. Additional attribution and contribution details are maintained in `CONTRIBUTING.md`, and the repository-level third-party notice is available in `LICENSE`.
