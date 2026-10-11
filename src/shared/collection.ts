// Contract between the background scheduler and the Google adapter.

export type CollectFailureReason =
  /** Google is showing a CAPTCHA / unusual-traffic page. Needs the user. */
  | 'blocked'
  /** The page has no Google search box. */
  | 'no_search_box'
  /** Suggestions did not appear or settle in time. */
  | 'timeout'
  /** The search box changed during collection (e.g. the user typed). */
  | 'interrupted'
  /** The Google tab could not be reached (closed, navigating, consent page, …). */
  | 'page_unavailable'
  | 'error';

export type CollectResult =
  | { status: 'succeeded'; suggestions: string[] }
  | { status: 'empty' }
  | { status: 'failed'; reason: CollectFailureReason; message: string };

export interface CollectOptions {
  /** Maximum time to wait for suggestions after entering the query. */
  timeoutMs: number;
  /** The suggestion list must be unchanged for this long before it is read. */
  settleMs: number;
  /** If no dropdown is visible for this long, the query is reported as empty. */
  emptyAfterMs: number;
  /** Wait after clearing the box so the previous query's dropdown is replaced. */
  clearWaitMs: number;
}

export const DEFAULT_COLLECT_OPTIONS: CollectOptions = {
  timeoutMs: 6000,
  settleMs: 400,
  emptyAfterMs: 2000,
  clearWaitMs: 400,
};
