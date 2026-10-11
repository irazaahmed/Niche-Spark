// Typed runtime messages between extension contexts.

export type ContentRequest = { type: 'content/ping' };

export interface ContentPingResponse {
  ok: true;
  host: string;
  /** Whether a Google search box was found on the page. */
  searchBoxFound: boolean;
}

export type BackgroundRequest = { type: 'bg/ping' };

export interface BackgroundPingResponse {
  ok: true;
  version: string;
}
