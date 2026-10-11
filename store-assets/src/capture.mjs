// Renders Chrome Web Store screenshots (1280x800) of the real built extension
// pages with real collected data.
// Usage: npm run build (or have `npm run dev` running), then
//        node store-assets/src/capture.mjs <backup.json>
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'store-assets');
const SRC = join(OUT, 'src');
const backupPath = process.argv[2];
if (!backupPath) throw new Error('Pass the backup JSON path');
const backupText = readFileSync(backupPath, 'utf8');
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4323;
const DEBUG_PORT = 9333;

// ── Local server: dist/ + harness files ───────────────────────────────
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const routes = {
    '/__shim.js': join(SRC, 'shim.js'),
    '/__backup.json': backupPath,
    '/__popup-frame.html': join(SRC, 'popup-frame.html'),
    '/__logo.svg': join(SRC, 'logo.svg'),
  };
  const file = routes[p] ?? join(DIST, p === '/' ? 'dashboard.html' : p);
  if (!existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  let body = readFileSync(file);
  if (file.startsWith(DIST) && file.endsWith('.html')) body = body.toString().replace('<head>', '<head><script src="/__shim.js"></script>');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// ── Headless Chrome over the DevTools protocol ────────────────────────
const profile = join(tmpdir(), `ns-capture-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    if (targets.some((t) => t.type === 'page')) break;
  } catch {
    /* not up yet */
  }
  await sleep(200);
}
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const go = async (path) => {
  const [base, hash = ''] = path.split('#');
  const url = `http://127.0.0.1:${PORT}${base}${base.includes('?') ? '&' : '?'}r=${Date.now()}${hash ? '#' + hash : ''}`;
  await send('Page.navigate', { url });
  await sleep(1800);
};
const shot = async (name) => {
  await sleep(500);
  // No clip: the emulated viewport is exactly 1280x800 (clip uses page coordinates, which breaks after scrolling).
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
  console.log('saved', name);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });

// 1. Import the real backup through the dashboard's own import button.
await go('/');
const projectId = await evaluate(`
  window.confirm = () => true;
  const text = await (await fetch('/__backup.json')).text();
  const input = document.getElementById('import-file');
  const dt = new DataTransfer();
  dt.items.add(new File([text], 'backup.json', { type: 'application/json' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  for (let i = 0; i < 50 && !location.hash.includes('project='); i++) await new Promise((r) => setTimeout(r, 100));
  return decodeURIComponent(location.hash.split('project=')[1] || '');
`);
if (!projectId) throw new Error('Import failed');

// A finished job summary that matches the imported data (real counts).
const backup = JSON.parse(backupText);
const az = backup.queries.filter((q) => q.method === 'az');
const job = {
  id: 'job-1',
  projectId,
  projectName: backup.project.name,
  method: 'az',
  queryIds: az.map((_, i) => `q${i}`),
  cursor: az.length,
  status: 'completed',
  message: 'Finished.' + (az.some((q) => q.status === 'failed') ? ` ${az.filter((q) => q.status === 'failed').length} failed: use Retry failed to try them again.` : ''),
  counts: {
    succeeded: az.filter((q) => q.status === 'succeeded').length,
    empty: az.filter((q) => q.status === 'empty').length,
    failed: az.filter((q) => q.status === 'failed').length,
    skipped: 0,
    keywordsAdded: backup.keywords.filter((k) => k.methods.includes('az')).length,
  },
  consecutiveFailures: 0,
  delayMs: 4000,
  startedAt: Date.now() - 200000,
  updatedAt: Date.now(),
};
await evaluate(`await chrome.storage.local.set({ 'nichespark.job': ${JSON.stringify(job)}, 'ui.lastProjectId': ${JSON.stringify(projectId)} }); return true;`);

const scrollTo = (selector, offset = 16) => evaluate(`const el = document.querySelector(${JSON.stringify(selector)}); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - ${offset}); return scrollY;`);

// 2. Keyword table (the main value of the product).
await go(`/#project=${encodeURIComponent(projectId)}`);
await evaluate(`
  const set = (id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('kw-sort', 'alpha-asc'); return true;`);
await scrollTo('#keywords-heading', 24);
await shot('screenshot-1-keywords.png');

// 3. Filters, selection and bulk actions.
await evaluate(`
  const set = (id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('kw-method', 'suffix');
  await new Promise((r) => setTimeout(r, 300));
  [...document.querySelectorAll('tbody tr input[type=checkbox]')].slice(0, 4).forEach((cb) => cb.click());
  return true;`);
await scrollTo('#keywords-heading', 24);
await shot('screenshot-2-filters-export.png');

// 4. Project overview with the finished job.
await go(`/#project=${encodeURIComponent(projectId)}`);
await evaluate('window.scrollTo(0, 0); return true;');
await shot('screenshot-3-project.png');

// 5. Suffix research: editable list and per-query status.
await evaluate(`[...document.querySelectorAll('[role=tab]')].find((b) => b.textContent.trim() === 'Suffix').click(); return true;`);
await scrollTo('#queries-heading', 24);
await shot('screenshot-4-queries.png');

// 6. Popup, framed on a branded background.
await go('/__popup-frame.html');
await shot('screenshot-5-popup.png');

ws.close();
chrome.kill();
server.close();
await sleep(500);
rmSync(profile, { recursive: true, force: true });
console.log('done');
