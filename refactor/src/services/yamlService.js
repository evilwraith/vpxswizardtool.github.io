(() => {
  'use strict';

  const formatting = window.VPS_FORMATTING;
  if (!formatting) throw new Error('VPS formatting utilities must load before the YAML service.');

  const { escapeHtml, normalizeArray, wrapText } = formatting;

  function cleanYamlString(value) {
    return String(value).replace(/"/g, "'").trim();
  }

  function isMd5Hash(value) {
    return typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value.trim());
  }

  function normalizeChecksumValue(value) {
    if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
    if (value === undefined || value === null || value === '') return [];
    return [String(value).trim()].filter(Boolean);
  }

  function buildYaml(values, options = {}) {
    const data = { ...values };
    const omit = options.omit instanceof Set ? options.omit : new Set(options.omit || []);

    // `enabled` is only written to YAML when the user opts in to "Disable for
    // Wizard" (enabled === false). Any other state is omitted from output.
    delete data.bass;
    delete data.applyFixes;

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
      if (primaryColorChecksum) data.coloredROMChecksum = String(primaryColorChecksum).trim();
      else delete data.coloredROMChecksum;
    }
    delete data.coloredROMChecksumSecondary;

    ['testers', 'backglassAuthorsOverride'].forEach(key => {
      const normalized = normalizeArray(data[key]);
      if (normalized.length) data[key] = normalized;
      else delete data[key];
    });

    ['fps', 'tableYearOverride'].forEach(key => {
      if (data[key] === '' || data[key] === undefined || data[key] === null) {
        delete data[key];
        return;
      }
      const parsed = Number.parseInt(data[key], 10);
      if (Number.isFinite(parsed)) data[key] = parsed;
      else delete data[key];
    });

    const entries = Object.entries(data)
      .filter(([key, value]) => {
        if (omit.has(key) || key.startsWith('__') || key.endsWith('_check')) return false;
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'string') return value.trim() !== '';
        if (typeof value === 'number') return Number.isFinite(value);
        if (typeof value === 'boolean') return key === 'enabled' ? value === false : value === true;
        return false;
      })
      .sort(([left], [right]) => left.localeCompare(right));

    let yaml = '---\n';

    entries.forEach(([name, value]) => {
      if (Array.isArray(value)) {
        yaml += `${name}:\n`;
        value.forEach(item => {
          yaml += `  - "${cleanYamlString(item)}"\n`;
        });
        return;
      }

      if (typeof value === 'number' || typeof value === 'boolean') {
        yaml += `${name}: ${value}\n`;
        return;
      }

      const cleanValue = cleanYamlString(value);
      const isUrlField = name.endsWith('UrlOverride') || name.endsWith('FileUrl');

      if (isUrlField) {
        if (cleanValue.length > 120) {
          yaml += '# yamllint disable-line rule:line-length\n';
        }
        yaml += `${name}: "${cleanValue.replace(/\n+/g, ' ')}"\n`;
        return;
      }

      if (cleanValue.includes('\n') || cleanValue.length > 120) {
        yaml += `${name}: >-\n`;
        wrapText(cleanValue, 120).forEach(line => {
          yaml += line ? `  ${line}\n` : '  \n';
        });
        return;
      }

      yaml += `${name}: "${cleanValue}"\n`;
    });

    return yaml;
  }

  function highlightYaml(yaml) {
    return String(yaml)
      .split('\n')
      .map(line => {
        if (line.startsWith('#') || line === '---') {
          return `<span class="yml-comment">${escapeHtml(line)}</span>`;
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

  window.VPS_YAML_SERVICE = {
    buildYaml,
    highlightYaml,
    isMd5Hash,
    normalizeChecksumValue
  };
})();
