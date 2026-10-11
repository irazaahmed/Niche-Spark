// Development only: reloads the extension when `npm run dev` finishes a rebuild.
// Included only in dev builds (see __NS_DEV_RELOAD_PORT__); production builds never contain it.
const LAST_BUILD_KEY = 'dev.lastBuildId';

export function startDevReload(port: number) {
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  const connect = () => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://localhost:${port}`);
    } catch {
      setTimeout(connect, 3000);
      return;
    }
    ws.onmessage = async (event) => {
      const data = JSON.parse(String(event.data)) as { type: string; buildId?: string };
      if (data.type !== 'build' || !data.buildId) return;
      // storage.session is cleared by an extension reload, so the first build id
      // seen after a reload is just recorded. A different id means a newer build.
      const stored = (await chrome.storage.session.get(LAST_BUILD_KEY))[LAST_BUILD_KEY];
      await chrome.storage.session.set({ [LAST_BUILD_KEY]: data.buildId });
      if (stored && stored !== data.buildId) {
        console.info('[NicheSpark dev] new build detected, reloading extension');
        chrome.runtime.reload();
      }
    };
    ws.onopen = () => {
      // WebSocket traffic keeps the MV3 service worker alive while developing.
      keepAlive = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('keepalive'), 20000);
    };
    ws.onclose = () => {
      clearInterval(keepAlive);
      setTimeout(connect, 3000);
    };
  };

  connect();
}
