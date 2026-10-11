// Google Autocomplete adapter: enters a query into the visible Google search
// box and reads the suggestions Google displays. Only suggestion text is read;
// the user's search-history rows are skipped.
import { normalizeText } from '../core/keywords';
import { DEFAULT_COLLECT_OPTIONS, type CollectOptions, type CollectResult } from '../shared/collection';
import { GOOGLE_BLOCKED_PATH_PREFIXES, GOOGLE_SELECTORS as S } from './googleSelectors';

export interface AdapterEnv {
  document: Document;
  location: Pick<Location, 'pathname'>;
  now: () => number;
  isVisible: (el: Element) => boolean;
}

interface VisibleOption {
  text: string;
  history: boolean;
}

export function defaultEnv(): AdapterEnv {
  return {
    document,
    location,
    now: () => performance.now(),
    isVisible: (el) => el.getClientRects().length > 0,
  };
}

export function isBlockedPage(env: AdapterEnv): boolean {
  return (
    GOOGLE_BLOCKED_PATH_PREFIXES.some((p) => env.location.pathname.startsWith(p)) ||
    env.document.querySelector(S.blockedPage) !== null
  );
}

export function findSearchBox(env: AdapterEnv): HTMLTextAreaElement | HTMLInputElement | null {
  return env.document.querySelector<HTMLTextAreaElement | HTMLInputElement>(S.searchBox);
}

/** Reads the currently visible suggestion rows. */
export function readVisibleOptions(env: AdapterEnv): VisibleOption[] {
  const out: VisibleOption[] = [];
  for (const option of env.document.querySelectorAll(S.option)) {
    if (!env.isVisible(option)) continue;
    const raw = option.querySelector(S.optionText)?.textContent ?? option.getAttribute('aria-label') ?? '';
    const text = normalizeText(raw);
    if (!text) continue;
    const row = option.closest(S.optionRow) ?? option;
    out.push({ text, history: row.querySelector(S.historyIcon) !== null });
  }
  return out;
}

/** Sets the box value the way user typing does, so Google's page script reacts. */
function enterText(box: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = Object.getPrototypeOf(box) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(box, value);
  else box.value = value;
  const view = box.ownerDocument.defaultView;
  const EventCtor = view?.InputEvent ?? view?.Event ?? Event;
  box.dispatchEvent(
    new EventCtor('input', { bubbles: true, ...(value ? { inputType: 'insertText', data: value.slice(-1) } : { inputType: 'deleteContentBackward' }) }),
  );
}

const signature = (opts: VisibleOption[]) => opts.map((o) => `${o.history ? 'h' : 's'}:${o.text}`).join('\n');

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Collects the autocomplete suggestions Google shows for `query`.
 *
 * 1. Clears the box and waits so the previous dropdown is replaced.
 * 2. Enters the query and watches the DOM until the visible suggestion list
 *    differs from the pre-query list and stays unchanged for `settleMs`.
 * 3. Reports `empty` only if no dropdown is visible for `emptyAfterMs`, and
 *    `timeout` if suggestions never settle.
 */
export async function collectSuggestions(
  query: string,
  options: Partial<CollectOptions> = {},
  env: AdapterEnv = defaultEnv(),
): Promise<CollectResult> {
  const o = { ...DEFAULT_COLLECT_OPTIONS, ...options };
  const text = normalizeText(query);
  if (!text) return { status: 'failed', reason: 'error', message: 'The query is empty.' };

  if (isBlockedPage(env)) {
    return { status: 'failed', reason: 'blocked', message: 'Google is showing an unusual-traffic or CAPTCHA page. Open the Google tab and resolve it yourself, then resume.' };
  }
  const box = findSearchBox(env);
  if (!box) {
    return { status: 'failed', reason: 'no_search_box', message: 'No Google search box was found on this page.' };
  }

  enterText(box, '');
  await sleep(o.clearWaitMs);
  const before = signature(readVisibleOptions(env));

  box.focus();
  enterText(box, text);
  const start = env.now();

  return new Promise<CollectResult>((resolve) => {
    let lastSig: string | null = null;
    let lastChange = start;
    let hiddenSince: number | null = null;
    let done = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const finish = (result: CollectResult) => {
      if (done) return;
      done = true;
      observer.disconnect();
      for (const t of timers) clearTimeout(t);
      resolve(result);
    };
    const later = (ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t);
        check();
      }, ms);
      timers.add(t);
    };

    const check = () => {
      if (done) return;
      if (isBlockedPage(env)) {
        return finish({ status: 'failed', reason: 'blocked', message: 'Google showed an unusual-traffic or CAPTCHA page.' });
      }
      if (normalizeText(box.value) !== text) {
        return finish({ status: 'failed', reason: 'interrupted', message: 'The Google search box changed during collection.' });
      }
      const t = env.now();
      const opts = readVisibleOptions(env);
      const sig = signature(opts);
      if (sig !== lastSig) {
        lastSig = sig;
        lastChange = t;
        if (opts.length) later(o.settleMs + 20);
      }
      if (opts.length === 0) {
        if (hiddenSince === null) {
          hiddenSince = t;
          later(o.emptyAfterMs + 20);
        }
      } else {
        hiddenSince = null;
      }

      if (opts.length > 0 && sig !== before && t - lastChange >= o.settleMs) {
        const suggestions = opts.filter((x) => !x.history).map((x) => x.text);
        return finish(suggestions.length ? { status: 'succeeded', suggestions } : { status: 'empty' });
      }
      if (hiddenSince !== null && t - hiddenSince >= o.emptyAfterMs) {
        return finish({ status: 'empty' });
      }
      if (t - start >= o.timeoutMs) {
        return finish({ status: 'failed', reason: 'timeout', message: `Google suggestions did not appear within ${Math.round(o.timeoutMs / 1000)} seconds.` });
      }
    };

    const observer = new (env.document.defaultView?.MutationObserver ?? MutationObserver)(check);
    observer.observe(env.document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    later(o.timeoutMs + 20);
    check();
  });
}
