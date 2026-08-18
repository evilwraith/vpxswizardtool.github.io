(() => {
  'use strict';

  const utils = window.VPS_UTILS;
  if (!utils) return;

  const { escapeHtml, normalizeArray, wrapText } = utils;

  function cleanYamlString(value) {
    return String(value).replace(/"/g, "'").trim();
  }

  function normalizeAdditionalRoms(value) {
    if (!Array.isArray(value)) return [];
    return value.map(entry => {
      if (!entry || typeof entry !== 'object') return null;
      const normalized = {
        vpsId: String(entry.vpsId || '').trim(),
        checksum: String(entry.checksum || '').trim().toUpperCase(),
        versionOverride: String(entry.versionOverride || '').trim(),
        urlOverride: String(entry.urlOverride || '').trim()
      };
      // vpsId is legitimately empty when ROM Override is active (no VPS DB
      // entry to pull one from — see additionalRomsController.js), so a
      // real entry is one with EITHER a vpsId or a checksum, not vpsId alone.
      return (normalized.vpsId || normalized.checksum) ? normalized : null;
    }).filter(Boolean);
  }

  const CHECKSUM_KEYS = [
    'vpxChecksum', 'backglassChecksum', 'romChecksum', 'coloredROMChecksum',
    'coloredROMChecksumSecondary', 'pupChecksum', 'diffChecksum', 'altSoundChecksum'
  ];

  function uppercaseChecksums(data) {
    CHECKSUM_KEYS.forEach(key => {
      const value = data[key];
      if (typeof value === 'string') data[key] = value.toUpperCase();
      else if (Array.isArray(value)) data[key] = value.map(item => String(item).toUpperCase());
    });
  }

  function prepareData(values, omit) {
    const data = { ...values };

    // `enabled` is only written to YAML when the user opts in to "Disable for
    // Wizard" (enabled === false). Any other state is omitted from output.
    delete data.bass;
    delete data.applyFixes;

    uppercaseChecksums(data);

    // The table-level NSFW flag is exclusive: when set, per-asset NSFW keys
    // must never appear alongside it (covers imported YAML that has both).
    if (data.nsfw === true) {
      Object.values(window.VPS_YML_FIELDS?.CATEGORY_CONFIG || {}).forEach(config => {
        if (config.nsfwField) delete data[config.nsfwField];
      });
    }

    const primaryColorChecksum = Array.isArray(data.coloredROMChecksum)
      ? data.coloredROMChecksum[0]
      : data.coloredROMChecksum;
    const secondaryColorChecksum = data.coloredROMChecksumSecondary
      ?? (Array.isArray(data.coloredROMChecksum) ? data.coloredROMChecksum[1] : '');

    if (data.coloredROMPin2DMD === true) {
      const checksums = [primaryColorChecksum, secondaryColorChecksum]
        .map(value => String(value || '').trim())
        .filter(Boolean);
      if (checksums.length) data.coloredROMChecksum = checksums;
      else delete data.coloredROMChecksum;
    } else {
      delete data.coloredROMPin2DMD;
      // Outside PAL/VNI mode any entries beyond index 0 are "additional"
      // checksums from the checksum-additional modal, not the PAL/VNI
      // secondary slot — preserve them instead of collapsing to primary only.
      const checksums = (Array.isArray(data.coloredROMChecksum) ? data.coloredROMChecksum : [data.coloredROMChecksum])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      if (!checksums.length) delete data.coloredROMChecksum;
      else if (checksums.length === 1) data.coloredROMChecksum = checksums[0];
      else data.coloredROMChecksum = checksums;
    }
    delete data.coloredROMChecksumSecondary;

    ['testers', 'backglassAuthorsOverride', 'diffAuthorsOverride', 'altSoundAuthorsOverride'].forEach(key => {
      const normalized = normalizeArray(data[key]);
      if (normalized.length) data[key] = normalized;
      else delete data[key];
    });

    const altSoundChecksums = normalizeArray(data.altSoundChecksum);
    if (altSoundChecksums.length === 1) data.altSoundChecksum = altSoundChecksums[0];
    else if (altSoundChecksums.length > 1) data.altSoundChecksum = altSoundChecksums;
    else delete data.altSoundChecksum;

    const additionalRoms = normalizeAdditionalRoms(data.additionalRoms);
    if (additionalRoms.length) data.additionalRoms = additionalRoms;
    else delete data.additionalRoms;

    ['fps', 'tableYearOverride'].forEach(key => {
      if (data[key] === '' || data[key] === undefined || data[key] === null) {
        delete data[key];
        return;
      }
      const parsed = Number.parseInt(data[key], 10);
      if (Number.isFinite(parsed)) data[key] = parsed;
      else delete data[key];
    });

    Object.keys(data).forEach(key => {
      if (omit.has(key) || key.startsWith('__') || key.endsWith('_check')) delete data[key];
    });

    return data;
  }

  function scalarIsPresent(value, key = '') {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') return value.trim() !== '';
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'boolean') return key === 'enabled' ? value === false : value === true;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return false;
  }

  // Derived from fields.js's declared field types so any field holding a URL
  // (not just ones suffixed UrlOverride/FileUrl) gets the same treatment —
  // falls back to the old suffix heuristic if fields.js hasn't loaded yet.
  const URL_FIELD_NAMES = (() => {
    const names = new Set();
    (window.VPS_YML_FIELDS?.WIZARD_STEPS || []).forEach(step => {
      (step.fields || []).forEach(field => {
        if (field.type === 'url') names.add(field.yml_field);
      });
    });
    return names;
  })();

  function isUrlField(name) {
    return URL_FIELD_NAMES.has(name) || name.endsWith('UrlOverride') || name.endsWith('FileUrl') || name === 'urlOverride';
  }

  function serializeScalar(name, value, indent = '') {
    if (typeof value === 'number' || typeof value === 'boolean') {
      return `${indent}${name}: ${value}\n`;
    }

    const cleanValue = cleanYamlString(value);
    if (isUrlField(name)) {
      // The yamllint rule this comment suppresses checks the full rendered
      // line, not the URL value alone — a value well under 120 characters
      // can still push `name: "value"` over the limit once the key and
      // quoting overhead are added. Compare the actual line length so the
      // comment (and therefore our own >120-char check below) lines up with
      // what real yamllint would flag.
      const renderedLength = indent.length + name.length + 4 + cleanValue.length;
      const prefix = renderedLength > 120
        ? `${indent}# yamllint disable-line rule:line-length\n`
        : '';
      return `${prefix}${indent}${name}: "${cleanValue.replace(/\n+/g, ' ')}"\n`;
    }

    if (cleanValue.includes('\n') || cleanValue.length > 120) {
      let output = `${indent}${name}: >-\n`;
      wrapText(cleanValue, Math.max(40, 120 - indent.length)).forEach(line => {
        output += line ? `${indent}  ${line}\n` : `${indent}  \n`;
      });
      return output;
    }

    return `${indent}${name}: "${cleanValue}"\n`;
  }

  function serializeObjectList(name, items) {
    let yaml = `${name}:\n`;
    const propertyOrder = ['vpsId', 'checksum', 'versionOverride', 'urlOverride'];

    items.forEach(item => {
      const properties = propertyOrder
        .filter(key => scalarIsPresent(item[key], key))
        .map(key => [key, item[key]]);
      if (!properties.length) return;

      const [firstName, firstValue] = properties.shift();
      const firstLine = serializeScalar(firstName, firstValue, '  ').replace(/^  /, '  - ');
      yaml += firstLine;
      properties.forEach(([key, value]) => {
        yaml += serializeScalar(key, value, '    ');
      });
    });

    return yaml;
  }

  function buildYaml(values, options = {}) {
    const omit = options.omit instanceof Set ? options.omit : new Set(options.omit || []);
    const data = prepareData(values, omit);
    const entries = Object.entries(data)
      .filter(([key, value]) => scalarIsPresent(value, key))
      .sort(([left], [right]) => left.localeCompare(right));

    let yaml = '---\n';

    entries.forEach(([name, value]) => {
      if (Array.isArray(value)) {
        if (value.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
          yaml += serializeObjectList(name, value);
          return;
        }

        yaml += `${name}:\n`;
        value.forEach(item => {
          yaml += `  - "${cleanYamlString(item)}"\n`;
        });
        return;
      }

      yaml += serializeScalar(name, value);
    });

    return yaml;
  }

  function highlightYaml(yaml) {
    return String(yaml)
      .split('\n')
      .map(line => {
        if (line.startsWith('#') || line.trimStart().startsWith('#') || line === '---') {
          return `<span class="yml-comment">${escapeHtml(line)}</span>`;
        }

        const objectListMatch = line.match(/^(\s*-\s+)([^:#][^:]*):(.*)$/);
        if (objectListMatch) {
          return `${escapeHtml(objectListMatch[1])}<span class="yml-key">${escapeHtml(objectListMatch[2])}</span>:<span class="yml-value">${escapeHtml(objectListMatch[3])}</span>`;
        }

        const listMatch = line.match(/^(\s*-\s+)(.*)$/);
        if (listMatch) {
          return `${escapeHtml(listMatch[1])}<span class="yml-value">${escapeHtml(listMatch[2])}</span>`;
        }

        const keyMatch = line.match(/^(\s*)([^:#][^:]*):(.*)$/);
        if (!keyMatch) return escapeHtml(line);

        return `${escapeHtml(keyMatch[1])}<span class="yml-key">${escapeHtml(keyMatch[2])}</span>:<span class="yml-value">${escapeHtml(keyMatch[3])}</span>`;
      })
      .join('\n');
  }

  utils.buildYaml = buildYaml;
  utils.highlightYaml = highlightYaml;
  utils.normalizeAdditionalRoms = normalizeAdditionalRoms;
})();