// Background service worker: owns the collection scheduler.
import type { BackgroundRequest, BackgroundResponse } from '../shared/messages';
import { createChromeDeps } from './chromeDeps';
import { startDevReload } from './devReload';
import { CollectionScheduler } from './scheduler';

const scheduler = new CollectionScheduler(createChromeDeps());

if (__NS_DEV_RELOAD_PORT__) {
  // Service workers cannot use dynamic import(); this call is removed from production builds.
  startDevReload(__NS_DEV_RELOAD_PORT__);
}

async function handle(message: BackgroundRequest) {
  switch (message.type) {
    case 'job/get':
      return scheduler.getJob();
    case 'job/start': {
      const { type: _type, ...options } = message;
      return scheduler.start(options);
    }
    case 'job/retryFailed':
      return scheduler.retryFailed(message.projectId, message.method, message.delayMs);
    case 'job/pause':
      return scheduler.pause();
    case 'job/resume':
      return scheduler.resume();
    case 'job/cancel':
      return scheduler.cancel();
  }
}

chrome.runtime.onMessage.addListener((message: BackgroundRequest, sender, sendResponse) => {
  // Only accept commands from NicheSpark's own pages, never from content scripts.
  if (sender.id !== chrome.runtime.id || sender.tab || !message?.type?.startsWith('job/')) return false;
  handle(message)
    .then((job) => sendResponse({ ok: true, job: job ?? null } satisfies BackgroundResponse))
    .catch((e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) } satisfies BackgroundResponse));
  return true;
});
