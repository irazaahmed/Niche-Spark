// `npm run dev`: rebuilds the extension on every file change and tells the
// loaded extension to reload itself. Load dist/ once with "Load unpacked";
// after that, no manual reloads are needed while this runs.
import { rmSync } from 'node:fs';
import { build } from 'vite';
import { WebSocketServer } from 'ws';

const PORT = 35729;
process.env.NS_DEV_RELOAD_PORT = String(PORT);

const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });
wss.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `[dev] Port ${PORT} is busy: is "npm run dev" already running in another terminal?` : e);
  process.exit(1);
});
let buildId = '';
const message = () => JSON.stringify({ type: 'build', buildId });
wss.on('connection', (socket) => {
  if (buildId) socket.send(message());
  socket.on('message', () => {}); // keepalive pings from the extension
});
// Regular traffic keeps the extension service worker connected.
setInterval(() => wss.clients.forEach((c) => c.send(JSON.stringify({ type: 'ping' }))), 20000);

rmSync('dist', { recursive: true, force: true });

let ready = false; // ignore events from the initial builds; they are announced once below
let timer;
function onBuilt() {
  if (!ready) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    buildId = String(Date.now());
    console.log(`[dev] build ${buildId} ready, notifying ${wss.clients.size} extension connection(s)`);
    wss.clients.forEach((c) => c.send(message()));
  }, 300);
}

async function watch(name, configFile) {
  const watcher = await build({ configFile, mode: 'development', build: { watch: {}, emptyOutDir: false, minify: false } });
  watcher.on('event', (e) => {
    if (e.code === 'END') onBuilt();
    if (e.code === 'ERROR') console.error(`[dev] ${name} build failed:`, e.error?.message ?? e.error);
    if (e.code === 'BUNDLE_END') e.result?.close();
  });
}

await watch('main', 'vite.config.ts');
await watch('content', 'vite.content.config.ts');
setTimeout(() => {
  ready = true;
  onBuilt();
}, 1500);
console.log(`[dev] watching for changes; reload server on ws://127.0.0.1:${PORT}`);
