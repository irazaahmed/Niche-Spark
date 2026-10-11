// Content script injected on supported Google Search pages.
// Suggestion capture (the Google Autocomplete adapter) is added in Phase 4.
// This script only answers runtime messages; it reads nothing else from the page.
import type { ContentPingResponse, ContentRequest } from '../shared/messages';
import { GOOGLE_SELECTORS } from './googleSelectors';

chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
  if (message?.type === 'content/ping') {
    const response: ContentPingResponse = {
      ok: true,
      host: location.host,
      searchBoxFound: Boolean(document.querySelector(GOOGLE_SELECTORS.searchBox)),
    };
    sendResponse(response);
  }
  return false;
});
