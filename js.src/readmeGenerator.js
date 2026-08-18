(() => {
  'use strict';

  const UI = window.VPS_UI;
  if (!UI) return;

  const TEMPLATE_URLS = {
    manual: 'https://raw.githubusercontent.com/TheOminousOsie/VPXS_4KP_Readme_Gen/main/Content/man_README.md',
    wizard: 'https://raw.githubusercontent.com/TheOminousOsie/VPXS_4KP_Readme_Gen/main/Content/wiz_README.md'
  };

  const FILE_ARRAYS = ['tableFiles', 'b2sFiles', 'romFiles', 'pupPackFiles', 'altColorFiles'];
  const snapshot = { record: null, selections: null, values: null };
  const templateCache = new Map();
  const baseRenderTableStrip = UI.renderTableStrip.bind(UI);
  const baseRenderAssetMatrix = UI.renderAssetMatrix.bind(UI);

  let toast = null;
  let toastTitle = null;
  let toastMessage = null;
  let toastHideTimer = null;
  let toastRemoveTimer = null;
  let generating = false;

  UI.renderTableStrip = function renderTableStripWithReadmeSnapshot(container, record, selections, values, ...rest) {
    snapshot.record = record || null;
    snapshot.selections = selections || null;
    snapshot.values = values || null;
    return baseRenderTableStrip(container, record, selections, values, ...rest);
  };

  UI.renderAssetMatrix = function renderAssetMatrixWithReadmeSnapshot(container, record, selections, values, ...rest) {
    snapshot.record = record || snapshot.record;
    snapshot.selections = selections || snapshot.selections;
    snapshot.values = values || snapshot.values;
    return baseRenderAssetMatrix(container, record, selections, values, ...rest);
  };

  function normalizeArray(value) {
    if (Array.isArray(value)) return value.map(item => String(item ?? '').trim()).filter(Boolean);
    return String(value ?? '').split(',').map(item => item.trim()).filter(Boolean);
  }

  function hasText(value) {
    return Array.isArray(value)
      ? value.some(item => String(item ?? '').trim())
      : String(value ?? '').trim().length > 0;
  }

  function convertTitle(title) {
    const value = String(title || '').trim();
    const matchThe = value.match(/^(JP'?s\s*)?(The)\s+(.+)$/i);
    const matchJps = value.match(/^(JP'?s)\s+(.+)$/i);

    if (matchThe?.[2]) return `${matchThe[3]}, ${matchThe[1] || ''}${matchThe[2]}`;
    if (matchJps) return `${matchJps[2]}, ${matchJps[1]}`;
    return value;
  }

  function sanitizeId(value) {
    return String(value || 'output').replace(/[^a-zA-Z0-9-_]/g, '_');
  }

  function replaceToken(template, token, value) {
    return template.split(`{${token}}`).join(String(value ?? ''));
  }

  function replaceTokens(template, replacements) {
    return Object.entries(replacements).reduce(
      (output, [token, value]) => replaceToken(output, token, value),
      template
    );
  }

  function findFile(record, id) {
    const target = String(id || '').trim();
    if (!record || !target) return null;

    for (const key of FILE_ARRAYS) {
      const file = Array.isArray(record[key])
        ? record[key].find(candidate => String(candidate?.id || '') === target)
        : null;
      if (file) return file;
    }
    return null;
  }

  function firstUsableUrl(file) {
    const urls = Array.isArray(file?.urls) ? file.urls : [];
    for (const entry of urls) {
      if (typeof entry === 'string' && entry.trim()) return entry.trim();
      if (entry && entry.broken !== true && String(entry.url || '').trim()) return String(entry.url).trim();
    }
    return '';
  }

  function websiteName(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./i, '');
      return host.split('.')[0] || host || 'Link';
    } catch (_) {
      return 'Link';
    }
  }

  function getFileExtension(url) {
    try {
      const pathname = new URL(url).pathname;
      const match = pathname.match(/\.([a-z0-9]+)$/i);
      return match ? `.${match[1]}` : '.webp';
    } catch (_) {
      const match = String(url || '').match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
      return match ? `.${match[1]}` : '.webp';
    }
  }

  function fileMetadata(record, id, options = {}) {
    const overrideUrl = String(options.urlOverride || '').trim();
    if (overrideUrl) {
      return {
        link: overrideUrl,
        website: websiteName(overrideUrl),
        version: String(options.versionOverride || '').trim() || 'N/A',
        author: normalizeArray(options.authors).join(', ') || 'N/A'
      };
    }

    const file = findFile(record, id);
    if (!file) return { link: '#', website: 'N/A', version: 'N/A', author: 'N/A' };

    const link = firstUsableUrl(file);
    const authors = normalizeArray(options.authors).length
      ? normalizeArray(options.authors)
      : normalizeArray(file.authors).slice(0, 3);

    return {
      link: link || '#',
      website: link ? websiteName(link) : 'N/A',
      version: String(options.versionOverride || file.version || '').trim() || 'N/A',
      author: authors.join(', ') || 'N/A'
    };
  }

  function applyFileMetadata(template, prefix, metadata) {
    return replaceTokens(template, {
      [`${prefix}Link`]: metadata.link,
      [`${prefix}Website`]: metadata.website,
      [`${prefix}Version`]: metadata.version,
      [`${prefix}Author`]: metadata.author
    });
  }

  function tableDisplayName(record, values) {
    const name = String(values.tableNameOverride || '').trim() || convertTitle(record?.name || 'Unknown Table');
    const manufacturer = String(values.tableManufacturerOverride || record?.manufacturer || 'Unknown').trim();
    const year = String(values.tableYearOverride || record?.year || 'Unknown').trim();
    return {
      name: `${name} (${manufacturer} ${year})`,
      manufacturer,
      year
    };
  }

  function commonReplacements(record, values, mode) {
    const table = tableDisplayName(record, values);
    const testers = normalizeArray(values.testers);
    const testerText = mode === 'wizard'
      ? testers.map(name => `  - ${name === 'OminousOsie' ? 'Ominous Osie 🌸' : name}`).join('\n')
      : testers.map(name => name === 'OminousOsie' ? 'Ominous Osie 🌸' : name).join(', ');

    return {
      name: table.name,
      manufacturer: table.manufacturer,
      year: table.year,
      hasBackglass: hasText(values.backglassChecksum) ? '✅' : '❌',
      hasDMD: hasText(values.romChecksum) ? '✅' : '❌',
      hasROM: hasText(values.romChecksum) ? '✅' : '❌',
      hasPup: hasText(values.pupChecksum) ? '✅' : '❌',
      fps: String(values.fps ?? ''),
      testers: testerText,
      tagline: String(values.tagline || ''),
      mainNotes: String(values.mainNotes || ''),
      tableNotes: String(values.tableNotes || ''),
      vpxNotes: String(values.vpxNotes || values.tableNotes || ''),
      backglassNotes: String(values.backglassNotes || ''),
      romNotes: String(values.romNotes || ''),
      coloredROMNotes: String(values.coloredROMNotes || ''),
      pupNotes: String(values.pupNotes || '')
    };
  }

  async function fetchTemplate(mode) {
    if (templateCache.has(mode)) return templateCache.get(mode);
    const response = await fetch(TEMPLATE_URLS[mode], { cache: 'no-cache' });
    if (!response.ok) throw new Error(`README template request failed with status ${response.status}.`);
    const template = await response.text();
    templateCache.set(mode, template);
    return template;
  }

  function buildWizardReadme(template, record, values) {
    return replaceTokens(template, commonReplacements(record, values, 'wizard'));
  }

  function buildManualReadme(template, record, values) {
    let readme = replaceTokens(template, commonReplacements(record, values, 'manual'));

    readme = applyFileMetadata(readme, 'table', fileMetadata(record, values.vpxVPSId));

    if (hasText(values.backglassChecksum) && values.backglassBundled !== true) {
      readme = applyFileMetadata(readme, 'b2s', fileMetadata(record, values.backglassVPSId, {
        urlOverride: values.backglassUrlOverride,
        authors: values.backglassAuthorsOverride
      }));
    } else if (values.backglassBundled === true) {
      readme = applyFileMetadata(readme, 'b2s', fileMetadata(record, values.vpxVPSId, {
        authors: values.backglassAuthorsOverride
      }));
    } else {
      readme = applyFileMetadata(readme, 'b2s', fileMetadata(null, ''));
    }

    if (hasText(values.romChecksum) && values.romBundled !== true) {
      readme = applyFileMetadata(readme, 'rom', fileMetadata(record, values.romVPSId, {
        urlOverride: values.romUrlOverride,
        versionOverride: values.romVersionOverride
      }));
    } else if (values.romBundled === true) {
      readme = applyFileMetadata(readme, 'rom', fileMetadata(record, values.vpxVPSId));
    } else {
      readme = applyFileMetadata(readme, 'rom', fileMetadata(null, ''));
    }

    if (hasText(values.coloredROMChecksum) && values.coloredROMBundled !== true) {
      readme = applyFileMetadata(readme, 'altColor', fileMetadata(record, values.coloredROMVPSId, {
        urlOverride: values.coloredROMUrlOverride,
        versionOverride: values.coloredROMVersionOverride
      }));
    } else if (values.coloredROMBundled === true) {
      readme = applyFileMetadata(readme, 'altColor', fileMetadata(record, values.vpxVPSId));
    } else {
      readme = applyFileMetadata(readme, 'altColor', fileMetadata(null, ''));
    }

    if (hasText(values.pupChecksum)) {
      const pupMetadata = values.pupFileUrl
        ? {
            link: String(values.pupFileUrl).trim(),
            website: websiteName(values.pupFileUrl),
            version: String(values.pupVersion || '').trim() || 'N/A',
            author: 'N/A'
          }
        : fileMetadata(record, values.pupVPSId, { versionOverride: values.pupVersion });
      readme = applyFileMetadata(readme, 'pupPack', pupMetadata);
    } else {
      readme = applyFileMetadata(readme, 'pupPack', fileMetadata(null, ''));
    }

    return readme;
  }

  function previewImage(record, values) {
    const selectedId = String(values.vpxVPSId || '').trim();
    const file = Array.isArray(record?.tableFiles)
      ? record.tableFiles.find(candidate => String(candidate?.id || '') === selectedId)
      : null;
    const vpxUrl = String(file?.imgUrl || '').trim();
    if (vpxUrl) {
      return { url: vpxUrl, name: `${sanitizeId(selectedId)}-preview${getFileExtension(vpxUrl)}` };
    }

    // The selected VPX has no image of its own — fall back to the main
    // game preview image (the same cover art shown on the table's header
    // card) rather than shipping a README with no artwork at all.
    const coverUrl = String(window.VPS_UTILS?.getCoverUrl?.(record) || '').trim();
    if (!coverUrl) return { url: '', name: '' };
    return {
      url: coverUrl,
      name: `${sanitizeId(record?.id || selectedId)}-preview${getFileExtension(coverUrl)}`
    };
  }

  function downloadTextFile(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function downloadImage(url, filename) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Preview image request failed with status ${response.status}.`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  function ensureToast() {
    if (toast?.isConnected) return toast;

    toast = document.createElement('div');
    toast.id = 'readmeGeneratorToast';
    toast.className = 'vps-db-toast readme-generator-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-atomic', 'true');
    toast.hidden = true;

    const indicator = document.createElement('span');
    indicator.className = 'vps-db-toast-indicator';
    indicator.setAttribute('aria-hidden', 'true');

    const copy = document.createElement('div');
    copy.className = 'vps-db-toast-copy';
    toastTitle = document.createElement('strong');
    toastTitle.className = 'vps-db-toast-title';
    toastMessage = document.createElement('span');
    toastMessage.className = 'vps-db-toast-message';
    copy.append(toastTitle, toastMessage);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'vps-db-toast-close';
    close.setAttribute('aria-label', 'Dismiss README generation status');
    close.textContent = '×';
    close.addEventListener('click', hideToast);

    toast.append(indicator, copy, close);
    document.body.appendChild(toast);
    return toast;
  }

  function hideToast() {
    window.clearTimeout(toastHideTimer);
    window.clearTimeout(toastRemoveTimer);
    if (!toast || toast.hidden) return;
    toast.classList.remove('is-visible');
    toastRemoveTimer = window.setTimeout(() => {
      if (toast) toast.hidden = true;
    }, 320);
  }

  function showToast(state, title, message) {
    ensureToast();
    window.clearTimeout(toastHideTimer);
    window.clearTimeout(toastRemoveTimer);

    const activeToasts = [...document.querySelectorAll('.vps-db-toast.is-visible')]
      .filter(candidate => candidate !== toast && !candidate.hidden);
    toast.style.setProperty('--readme-toast-offset', `${activeToasts.length * 58}px`);
    toast.dataset.state = state === 'loading' ? 'checking' : state === 'success' ? 'updated' : state === 'warning' ? 'warning' : 'error';
    toastTitle.textContent = title;
    toastMessage.textContent = message;
    toast.hidden = false;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => toast.classList.add('is-visible'));
    });

    if (state !== 'loading') {
      toastHideTimer = window.setTimeout(hideToast, state === 'error' ? 7000 : 5200);
    }
  }

  function setGenerating(active, currentButton = null) {
    generating = active;
    document.querySelectorAll('.readme-action-btn').forEach(button => {
      button.disabled = active;
      button.classList.toggle('is-loading', active && button === currentButton);
      if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent;
      button.textContent = active && button === currentButton ? 'Generating…' : button.dataset.defaultLabel;
    });
  }

  async function generateReadme(mode, button) {
    if (generating) return;

    const record = snapshot.record;
    const values = snapshot.values;
    if (!record || !values) {
      showToast('error', 'No build loaded', 'Load a table before generating a README.');
      return;
    }
    if (!hasText(values.vpxVPSId)) {
      showToast('error', 'VPX selection required', 'Select a VPX file before generating a README.');
      return;
    }

    setGenerating(true, button);
    const label = mode === 'manual' ? 'Manual README' : 'Wizard README';
    showToast('loading', `Generating ${label}`, 'Preparing table details, links, and preview artwork.');

    try {
      const template = await fetchTemplate(mode);
      const image = previewImage(record, values);
      let readme = mode === 'manual'
        ? buildManualReadme(template, record, values)
        : buildWizardReadme(template, record, values);

      if (image.name) readme = replaceToken(readme, 'previewImageName', image.name);

      const filename = `${sanitizeId(values.vpxVPSId)}_README.md`;
      downloadTextFile(readme, filename);

      if (image.url && image.name) {
        try {
          await downloadImage(image.url, image.name);
          showToast('success', `${label} downloaded`, `${filename} and ${image.name} were sent to your Downloads folder.`);
        } catch (imageError) {
          console.warn('README generated, but preview image download failed.', imageError);
          showToast('warning', `${label} downloaded`, `${filename} was downloaded, but the preview image could not be downloaded automatically.`);
        }
      } else {
        showToast('warning', `${label} downloaded`, `${filename} was downloaded. No preview image was available for the selected VPX or the table itself.`);
      }
    } catch (error) {
      console.error(`Unable to generate ${label}`, error);
      showToast('error', `${label} failed`, error?.message || 'The README could not be generated.');
    } finally {
      setGenerating(false);
    }
  }

  function init() {
    const manualButton = document.getElementById('manualReadmeBtn');
    const wizardButton = document.getElementById('wizardReadmeBtn');
    if (!manualButton || !wizardButton) return;

    manualButton.addEventListener('click', () => generateReadme('manual', manualButton));
    wizardButton.addEventListener('click', () => generateReadme('wizard', wizardButton));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
