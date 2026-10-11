// Background service worker. The collection scheduler is added in Phase 5.
import type { BackgroundPingResponse, BackgroundRequest } from '../shared/messages';

chrome.runtime.onInstalled.addListener(({ reason }) => {
  console.info(`[NicheSpark] installed (${reason})`);
});

chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse) => {
  if (message?.type === 'bg/ping') {
    const response: BackgroundPingResponse = { ok: true, version: chrome.runtime.getManifest().version };
    sendResponse(response);
  }
  return false;
});
