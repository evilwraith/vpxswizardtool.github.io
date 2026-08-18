(() => {
  'use strict';

  const VERSION_URL = 'https://virtualpinballspreadsheet.github.io/vps-db/lastUpdated.json';
  const DATABASE_URLS = [
    'https://virtualpinballspreadsheet.github.io/vps-db/db/vpsdb.json',
    'https://raw.githubusercontent.com/VirtualPinballSpreadsheet/vps-db/main/db/vpsdb.json',
    'https://cdn.jsdelivr.net/gh/VirtualPinballSpreadsheet/vps-db@main/db/vpsdb.json'
  ];

  const CACHE_DB_NAME = 'vpxs-yml-builder-cache';
  const CACHE_DB_VERSION = 1;
  const CACHE_STORE_NAME = 'vps-database';
  const CACHE_RECORD_KEY = 'current';
  const REQUEST_TIMEOUT_MS = 20000;
  const MAX_VERSION_RETRIES = 1;

  let vpsCache = null;
  let pendingRequest = null;
  let currentStatus = {
    state: 'idle',
    version: null,
    source: null,
    checkedAt: null,
    updatedAt: null,
    message: 'VPS database has not been checked yet.'
  };

  function emitStatus(state, details = {}) {
    currentStatus = {
      ...currentStatus,
      ...details,
      state,
      checkedAt: details.checkedAt || new Date().toISOString()
    };

    window.__VPS_DB_STATUS__ = { ...currentStatus };
    window.dispatchEvent(new CustomEvent('vpsdbstatus', {
      detail: { ...currentStatus }
    }));
  }

  function appendQuery(url, key, value) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }

  function normalizeVersion(payload) {
    let value = payload;

    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      value = payload.lastUpdated ?? payload.updatedAt ?? payload.timestamp ?? payload.version;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(Math.trunc(value));
    }

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    throw new Error('Unexpected lastUpdated.json format');
  }

  function isValidRecord(record) {
    return Boolean(record)
      && typeof record === 'object'
      && typeof record.id === 'string'
      && record.id.trim().length > 0;
  }

  // Returns a sanitized copy of `data` with malformed records dropped, or
  // null if `data` isn't shaped like a database at all (not an array, or no
  // valid records survive filtering). A handful of bad records from the
  // upstream source no longer invalidates the entire downloaded dataset.
  function sanitizeDatabase(data) {
    if (!Array.isArray(data) || data.length === 0) return null;

    const validRecords = data.filter(isValidRecord);
    if (validRecords.length === 0) return null;

    const droppedCount = data.length - validRecords.length;
    if (droppedCount > 0) {
      console.warn(`VPS database: dropped ${droppedCount} malformed record(s) out of ${data.length}.`);
    }

    return validRecords;
  }

  async function fetchWithTimeout(url, {
    timeoutMs = REQUEST_TIMEOUT_MS,
    cache = 'no-store'
  } = {}) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache,
        headers: { Accept: 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function fetchLatestVersion() {
    const cacheBustedUrl = appendQuery(VERSION_URL, '_', Date.now());
    const response = await fetchWithTimeout(cacheBustedUrl, { cache: 'no-store' });
    return normalizeVersion(await response.json());
  }

  async function fetchDatabase(version) {
    const failures = [];

    for (const baseUrl of DATABASE_URLS) {
      const url = appendQuery(baseUrl, 'version', version || Date.now());

      try {
        const response = await fetchWithTimeout(url, { cache: 'no-store' });
        const rawData = await response.json();
        const data = sanitizeDatabase(rawData);

        if (!data) {
          throw new Error('Unexpected VPS database format');
        }

        return { data, source: baseUrl };
      } catch (error) {
        failures.push(`${baseUrl}: ${error.message}`);
        console.warn(`Failed to fetch VPS DB from ${baseUrl}`, error);
      }
    }

    throw new Error(`Failed to load the VPS database. ${failures.join(' | ')}`);
  }

  function openCacheDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB || typeof window.indexedDB.open !== 'function') {
        resolve(null);
        return;
      }

      const request = window.indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(CACHE_STORE_NAME)) {
          database.createObjectStore(CACHE_STORE_NAME);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Unable to open VPS database cache'));
      request.onblocked = () => reject(new Error('VPS database cache is blocked by another tab'));
    });
  }

  async function readPersistentCache() {
    let database = null;

    try {
      database = await openCacheDatabase();
      if (!database) return null;

      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(CACHE_STORE_NAME, 'readonly');
        const request = transaction.objectStore(CACHE_STORE_NAME).get(CACHE_RECORD_KEY);

        request.onsuccess = () => {
          const record = request.result;
          if (!record) { resolve(null); return; }
          const sanitized = sanitizeDatabase(record.data);
          resolve(sanitized ? { ...record, data: sanitized } : null);
        };
        request.onerror = () => reject(request.error || new Error('Unable to read VPS database cache'));
      });
    } catch (error) {
      console.warn('Unable to read the persistent VPS database cache', error);
      return null;
    } finally {
      database?.close();
    }
  }

  async function writePersistentCache(record) {
    let database = null;

    try {
      database = await openCacheDatabase();
      if (!database) return false;

      await new Promise((resolve, reject) => {
        const transaction = database.transaction(CACHE_STORE_NAME, 'readwrite');
        transaction.objectStore(CACHE_STORE_NAME).put(record, CACHE_RECORD_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Unable to save VPS database cache'));
        transaction.onabort = () => reject(transaction.error || new Error('VPS database cache update was aborted'));
      });

      return true;
    } catch (error) {
      console.warn('Unable to save the persistent VPS database cache', error);
      return false;
    } finally {
      database?.close();
    }
  }

  async function loadVerifiedDatabase({ forceRefresh = false } = {}) {
    if (Array.isArray(window.__VPS_DB_OVERRIDE__)) {
      emitStatus('override', {
        version: 'test-override',
        source: 'window.__VPS_DB_OVERRIDE__',
        message: 'Using the supplied test VPS database override.'
      });
      return window.__VPS_DB_OVERRIDE__;
    }

    const stored = await readPersistentCache();
    let latestVersion = null;

    emitStatus('checking', {
      version: stored?.version || null,
      source: stored?.source || null,
      updatedAt: stored?.updatedAt || null,
      message: 'Checking the latest VPS database version…'
    });

    try {
      latestVersion = await fetchLatestVersion();
    } catch (versionError) {
      console.warn('Unable to verify the latest VPS database version', versionError);

      if (stored) {
        emitStatus('cached-unverified', {
          version: stored.version || null,
          source: stored.source || 'IndexedDB',
          updatedAt: stored.updatedAt || null,
          message: 'Version check failed; using the last verified cached VPS database.'
        });
        return stored.data;
      }

      const fallbackVersion = `unverified-${Date.now()}`;
      const fallback = await fetchDatabase(fallbackVersion);
      emitStatus('network-unverified', {
        version: null,
        source: fallback.source,
        updatedAt: new Date().toISOString(),
        message: 'Loaded the VPS database, but its version could not be verified.'
      });
      return fallback.data;
    }

    if (!forceRefresh && stored?.version === latestVersion && sanitizeDatabase(stored.data)) {
      emitStatus('current', {
        version: latestVersion,
        source: stored.source || 'IndexedDB',
        updatedAt: stored.updatedAt || null,
        message: 'The cached VPS database matches the latest published version.'
      });
      return stored.data;
    }

    let lastError = null;

    for (let attempt = 0; attempt <= MAX_VERSION_RETRIES; attempt += 1) {
      emitStatus('updating', {
        version: latestVersion,
        source: null,
        message: stored
          ? 'A newer VPS database is available. Updating…'
          : 'Downloading the latest VPS database…'
      });

      try {
        const downloaded = await fetchDatabase(latestVersion);
        const confirmedVersion = await fetchLatestVersion();

        if (confirmedVersion !== latestVersion) {
          latestVersion = confirmedVersion;
          if (attempt < MAX_VERSION_RETRIES) continue;
          throw new Error('The VPS database changed during download; please retry.');
        }

        const updatedAt = new Date().toISOString();
        await writePersistentCache({
          version: latestVersion,
          source: downloaded.source,
          updatedAt,
          data: downloaded.data
        });

        emitStatus(stored ? 'updated' : 'current', {
          version: latestVersion,
          source: downloaded.source,
          updatedAt,
          message: stored
            ? 'The VPS database was updated to the latest published version.'
            : 'The latest VPS database is ready.'
        });

        return downloaded.data;
      } catch (error) {
        lastError = error;
        console.warn('Unable to download a verified VPS database', error);
      }
    }

    if (stored) {
      emitStatus('stale-fallback', {
        version: stored.version || null,
        source: stored.source || 'IndexedDB',
        updatedAt: stored.updatedAt || null,
        message: 'The latest database could not be downloaded; using the last verified cached version.'
      });
      return stored.data;
    }

    emitStatus('error', {
      version: latestVersion,
      source: null,
      message: lastError?.message || 'Failed to load the VPS database.'
    });
    throw lastError || new Error('Failed to load the VPS database.');
  }

  async function fetchVPSDB({ forceRefresh = false } = {}) {
    if (forceRefresh) {
      vpsCache = null;
      pendingRequest = null;
    }

    if (vpsCache) return vpsCache;
    if (pendingRequest) return pendingRequest;

    pendingRequest = loadVerifiedDatabase({ forceRefresh })
      .then(data => {
        vpsCache = data;
        return data;
      })
      .finally(() => {
        pendingRequest = null;
      });

    return pendingRequest;
  }

  window.fetchVPSDB = fetchVPSDB;
  window.getVPSDBStatus = () => ({ ...currentStatus });

  document.addEventListener('DOMContentLoaded', () => {
    fetchVPSDB().catch(error => {
      console.error('Unable to preload the VPS database', error);
    });
  }, { once: true });
})();
