// Content script injected on supported Google Search pages. It only acts on
// messages from NicheSpark's background worker and reads nothing beyond the
// search box and the autocomplete suggestions.
import type { CollectResult } from '../shared/collection';
import type { ContentPingResponse, ContentRequest } from '../shared/messages';
import { collectSuggestions, findSearchBox, defaultEnv } from './googleAdapter';

let busy = false;

chrome.runtime.onMessage.addListener((message: ContentRequest, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === 'content/ping') {
    const response: ContentPingResponse = { ok: true, host: location.host, searchBoxFound: Boolean(findSearchBox(defaultEnv())) };
    sendResponse(response);
    return false;
  }
  if (message?.type === 'content/collect') {
    if (busy) {
      sendResponse({ status: 'failed', reason: 'error', message: 'A query is already being collected in this tab.' } satisfies CollectResult);
      return false;
    }
    busy = true;
    collectSuggestions(message.query)
      .catch((e: unknown): CollectResult => ({ status: 'failed', reason: 'error', message: e instanceof Error ? e.message : String(e) }))
      .then((result) => sendResponse(result))
      .finally(() => {
        busy = false;
      });
    return true;
  }
  return false;
});
