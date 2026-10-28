// Headless Chrome for the tests that need a real browser.
//
// Why this exists: the archive engines are WASM running in a browser worker,
// and the app is a page of IIFEs hanging off window.*. Neither can be driven
// from Node alone, so until 2026-09-30 every claim about real decompression
// was proved by hand on a throwaway page and could not be repeated. This file
// is the repeatable version.
//
// Still no dependencies. Chrome is driven over the DevTools protocol through
// Node's built-in WebSocket (Node 22+), the repo is served by node:http, and
// nothing is installed. Chrome itself must be on the machine: it is on
// GitHub's ubuntu runners, and locally it is found in the usual places or
// named with CHROME_PATH.
//
// A missing Chrome FAILS the test rather than skipping it. A skipped browser
// suite reads as green, and a green suite that tested nothing is the exact
// trap this repo has shipped before.
//
//   const app = await openApp();
//   const value = await app.run(async name => { ... in the page ... }, 'arg');
//   app.warnings  -> every console.warn the page has logged
//   await app.close();
//
// Two options for tests that drive the builder like a user (added 2026-10-02):
//
//   openApp({ db: records })   installs records as window.__VPS_DB_OVERRIDE__
//                              before any page script runs, so the app's own
//                              preload takes them instead of the network.
//                              It survives app.reload().
//   openApp({ downloads: true }) saves what the page downloads to a temp
//                              folder; await app.nextDownload() returns
//                              { filename, text } for the next one.
//
//   await app.reload();        loads the page again, keeping its storage, and
//                              waits for that navigation's own load event.
//   await app.reset();         the same with the page's localStorage emptied.
//   openApp({ windowSize: [1400, 900] }) sizes the window, for tests that
//                              measure layout (Chrome's default is 800x600,
//                              which is the app's one-column phone layout).

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { REPO } from './harness.mjs';

const START_TIMEOUT_MS = 20000;
const CALL_TIMEOUT_MS = 60000;
// Under run.js's 180 s per-file limit, so this file always cleans up first.
const WATCHDOG_MS = 150000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

export function findChrome() {
  if (process.env.CHROME_PATH) {
    if (existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    throw new Error('CHROME_PATH is set but nothing exists at ' + process.env.CHROME_PATH);
  }
  const local = process.env.LOCALAPPDATA || '';
  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : [];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  if (process.platform !== 'win32') {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      const found = spawnSync('which', [name], { encoding: 'utf8' });
      if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
    }
  }
  throw new Error('no Chrome or Edge found - install one, or set CHROME_PATH to its executable');
}

// Serves the repo read-only, loopback only, with caching off so a test never
// runs against a stale copy of anything.
async function serveRepo() {
  const root = path.resolve(REPO);
  const server = createServer(async (req, res) => {
    // A malformed escape ("%E0%A4%A") makes decodeURIComponent throw, and a
    // throw in an async handler is an unhandled rejection that kills the run.
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, 'http://local').pathname).replace(/^\/+/, '') || 'index.html';
    } catch {
      res.writeHead(400).end();
      return;
    }
    const full = path.resolve(root, rel);
    if (full !== root && !full.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(full);
      res.writeHead(200, {
        'content-type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store'
      }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, base: 'http://127.0.0.1:' + server.address().port + '/' };
}

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(what + ' timed out after ' + ms + ' ms')), ms); })
  ]).finally(() => clearTimeout(timer));
}

export async function openApp({ page = 'index.html', db = null, downloads = false, windowSize = null } = {}) {
  const chromePath = findChrome();
  const { server, base } = await serveRepo();
  const profile = await mkdtemp(path.join(tmpdir(), 'vpxs-chrome-'));
  // Inside the profile, so the cleanup that deletes the profile takes it too.
  const downloadDir = path.join(profile, 'downloads');

  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    // Nothing leaves the machine. Google Fonts and the VPS database fail fast
    // instead of making a result depend on the network.
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'
  ];
  // GitHub's ubuntu-24.04 runners block the user namespaces Chrome's sandbox
  // needs, so Chrome will not start there with it on. Off on CI only.
  if (process.env.CI) args.push('--no-sandbox');
  if (windowSize) args.push('--window-size=' + windowSize.join(','));
  args.push('about:blank');

  const chrome = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  const running = () => chrome.exitCode === null && chrome.signalCode === null;

  // Last resort if this process ends without close(): a crash, process.exit,
  // or the watchdog below. 'exit' handlers must be synchronous, so this only
  // kills Chrome; the temp profile is left for the OS to reap.
  const killOnExit = () => { if (running()) { try { chrome.kill(); } catch (_) { /* gone */ } } };
  process.once('exit', killOnExit);

  // run.js kills a file that runs past 180 s, but on Windows that kill is a
  // TerminateProcess - no signal, no handler, and Chrome would be orphaned.
  // So the file keeps its own shorter deadline and cleans up first.
  // Set while the watchdog or a signal is tearing down. Calls still in
  // flight are then abandoned rather than rejected: a rejection would reach
  // the test's top-level await and end the process before cleanup finished.
  let abandoning = false;
  const watchdog = setTimeout(async () => {
    console.error('browser.mjs: watchdog fired after ' + WATCHDOG_MS / 1000 + ' s - closing Chrome');
    abandoning = true;
    await cleanup();
    process.exit(1);
  }, WATCHDOG_MS);
  watchdog.unref();

  // SIGTERM is how a Linux runner stops a job; clean up rather than orphan.
  const onSignal = async () => { abandoning = true; await cleanup(); process.exit(1); };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);

  let cleaned = null;
  const cleanup = () => cleaned || (cleaned = (async () => {
    clearTimeout(watchdog);
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
    if (running()) {
      try { chrome.kill(); } catch (_) { /* already gone */ }
      await withTimeout(new Promise(resolve => chrome.once('exit', resolve)), 5000, 'chrome exit').catch(() => {});
    }
    process.off('exit', killOnExit);
    // Drop any connection Chrome still holds, or close() waits on it.
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  })());

  let ws;
  try {
    const wsUrl = await withTimeout(new Promise((resolve, reject) => {
      const onData = chunk => {
        stderr += chunk;
        const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) {
          // Found it; stop collecting for the life of the process.
          chrome.stderr.off('data', onData);
          chrome.stderr.resume();
          resolve(match[1]);
        }
      };
      chrome.stderr.on('data', onData);
      chrome.once('error', reject);
      chrome.once('exit', code => reject(new Error('chrome exited (' + code + ') before it was ready:\n' + stderr)));
    }), START_TIMEOUT_MS, 'chrome start');

    ws = new WebSocket(wsUrl);
    await withTimeout(new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('could not connect to chrome')), { once: true });
    }), START_TIMEOUT_MS, 'devtools connect');
  } catch (error) {
    await cleanup();
    throw error;
  }

  let nextId = 0;
  const pending = new Map();
  const events = [];
  const warnings = [];
  const errors = [];

  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' ');
      if (message.params.type === 'warning') warnings.push(text);
      if (message.params.type === 'error') errors.push(text);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      errors.push(details.exception?.description || details.text);
    }
    // A copy: a one-shot listener removes itself mid-loop, and iterating the
    // live array would then skip the listener after it.
    [...events].forEach(listener => listener(message));
  });

  // If Chrome dies mid-test, fail every call in flight now rather than let
  // each one sit out its full timeout.
  let closedReason = null;
  const failPending = reason => {
    closedReason = closedReason || reason;
    if (abandoning) return;
    for (const { reject } of pending.values()) reject(new Error(closedReason));
    pending.clear();
  };
  ws.addEventListener('close', () => failPending('connection to chrome closed'));
  ws.addEventListener('error', () => failPending('connection to chrome failed'));

  const send = (method, params = {}, sessionId) => {
    const id = ++nextId;
    return withTimeout(new Promise((resolve, reject) => {
      if (closedReason) { reject(new Error(closedReason + ' (' + method + ')')); return; }
      pending.set(id, { resolve, reject });
      try {
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    }), CALL_TIMEOUT_MS, method)
      .finally(() => pending.delete(id))
      // During teardown, abandon ANY failure - including this call's own
      // timeout, which can still fire while cleanup runs - so nothing reaches
      // the test's top-level await before cleanup has finished.
      .catch(error => abandoning ? new Promise(() => {}) : Promise.reject(error));
  };

  // Navigates and waits for the load event of THIS navigation, matched by the
  // loaderId Page.navigate returns. Waiting for the next load event of any
  // kind (the method until 2026-10-06) cannot tell which page fired it.
  // Load events are collected from before the command is sent, because one
  // can arrive before the command's own reply.
  let sessionId;
  const navigate = async url => {
    const loadedIds = new Set();
    let wanted = null;
    let done;
    const loaded = new Promise(resolve => { done = resolve; });
    const listener = message => {
      if (message.method !== 'Page.lifecycleEvent' || message.sessionId !== sessionId) return;
      if (message.params.name !== 'load') return;
      loadedIds.add(message.params.loaderId);
      if (loadedIds.has(wanted)) done();
    };
    events.push(listener);
    try {
      const result = await send('Page.navigate', { url }, sessionId);
      if (result.errorText) throw new Error('navigation to ' + url + ' failed: ' + result.errorText);
      wanted = result.loaderId;
      if (loadedIds.has(wanted)) done();
      await withTimeout(loaded, CALL_TIMEOUT_MS, 'page load');
    } finally {
      events.splice(events.indexOf(listener), 1);
    }
  };

  // Downloads are reported on the browser connection, not the page session.
  // Chrome names the saved file after the page's suggested filename.
  const started = new Map();
  const finished = [];
  const waiting = [];
  if (downloads) {
    events.push(message => {
      if (message.method === 'Browser.downloadWillBegin') {
        started.set(message.params.guid, message.params.suggestedFilename);
      }
      if (message.method === 'Browser.downloadProgress' && message.params.state !== 'inProgress') {
        const filename = started.get(message.params.guid);
        const entry = { filename, state: message.params.state };
        const waiter = waiting.shift();
        if (waiter) waiter(entry);
        else finished.push(entry);
      }
    });
  }

  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
    await send('Runtime.enable', {}, sessionId);
    await send('Page.enable', {}, sessionId);
    await send('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId);
    if (db) {
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: 'window.__VPS_DB_OVERRIDE__ = ' + JSON.stringify(db) + ';'
      }, sessionId);
    }
    if (downloads) {
      await send('Browser.setDownloadBehavior', {
        behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true
      });
    }
    await navigate(base + page);
  } catch (error) {
    try { ws.close(); } catch (_) { /* ignore */ }
    await cleanup();
    throw error;
  }

  // Runs fn inside the page with JSON-serialisable args and returns its
  // JSON-serialisable result. A throw in the page rejects here with the
  // page's own message.
  async function run(fn, ...fnArgs) {
    const expression = '(' + fn.toString() + ')(...' + JSON.stringify(fnArgs) + ')';
    const result = await send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true
    }, sessionId);
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      throw new Error(details.exception?.description || details.text);
    }
    return result.result.value;
  }

  // Loads the page again, keeping its storage. The server sends no-store, so
  // a navigation fetches everything fresh, as Page.reload's ignoreCache did.
  async function reload() {
    await navigate(base + page);
  }

  // Loads the page again with its storage emptied. The old page is navigated
  // away first, so none of its timers (the app's 350 ms draft autosave among
  // them) can write to storage after it has been cleared.
  async function reset() {
    await navigate('about:blank');
    await send('Storage.clearDataForOrigin', {
      origin: new URL(base).origin, storageTypes: 'local_storage'
    }, sessionId);
    await navigate(base + page);
  }

  // The next finished download, read back from disk. A download that Chrome
  // cancels or fails rejects rather than returning nothing.
  async function nextDownload(ms = 10000) {
    if (!downloads) throw new Error('openApp was not given downloads: true');
    const entry = finished.shift() || await withTimeout(
      new Promise(resolve => waiting.push(resolve)), ms, 'download'
    );
    if (entry.state !== 'completed') throw new Error('download of ' + entry.filename + ' ended ' + entry.state);
    const text = await readFile(path.join(downloadDir, entry.filename), 'utf8');
    return { filename: entry.filename, text };
  }

  async function close() {
    try { ws.close(); } catch (_) { /* ignore */ }
    await cleanup();
  }

  return { run, reload, reset, nextDownload, close, warnings, errors, base };
}
