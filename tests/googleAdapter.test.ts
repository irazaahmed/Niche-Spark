// @vitest-environment jsdom
// Adapter tests against a simulated Google page (jsdom). The fixture mirrors the
// DOM structure observed on www.google.com, but this is NOT a live Google test.
import { beforeEach, describe, expect, it } from 'vitest';
import { collectSuggestions, readVisibleOptions, type AdapterEnv } from '../src/content/googleAdapter';

const FAST = { timeoutMs: 800, settleMs: 60, emptyAfterMs: 200, clearWaitMs: 30 };

interface Row {
  text: string;
  history?: boolean;
  entity?: string;
}

/** Renders rows into the visible listbox the way Google does (hidden second listbox included). */
function render(rows: Row[] | null) {
  const visible = document.getElementById('lb-visible')!;
  visible.hidden = rows === null || rows.length === 0;
  visible.innerHTML = (rows ?? [])
    .map(
      (r) => `<li class="sbct"><div class="eIPGRd"><div class="sbic ${r.history ? 'sb27' : 'sb43'}"></div>
        <div role="option" class="lnnVSe" aria-label="${r.text.toLowerCase()}">
          <div class="wM6W7d"><span>${r.text}</span></div>
          <div class="ClJ9Yb"><span class="dKU7sc">${r.entity ?? ''}</span></div>
        </div></div></li>`,
    )
    .join('');
}

let respond: (value: string) => Row[] | null | 'ignore';
let pathname = '/';

const env: AdapterEnv = {
  get document() {
    return document;
  },
  location: {
    get pathname() {
      return pathname;
    },
  },
  now: () => performance.now(),
  isVisible: (el) => !el.closest('[hidden]'),
};

beforeEach(() => {
  pathname = '/';
  document.body.innerHTML = `
    <form><textarea name="q"></textarea></form>
    <ul role="listbox" id="lb-visible" hidden></ul>
    <ul role="listbox" id="lb-hidden" hidden><li><div role="option" aria-label="stale hidden"><div class="wM6W7d">stale hidden</div></div></li></ul>`;
  respond = () => null;
  document.querySelector('textarea')!.addEventListener('input', (e) => {
    const value = (e.target as HTMLTextAreaElement).value;
    // Google answers asynchronously; the old list stays visible meanwhile.
    setTimeout(() => {
      const rows = respond(value);
      if (rows !== 'ignore') render(rows);
    }, 40);
  });
});

describe('readVisibleOptions', () => {
  it('reads only visible rows, uses clean text, and flags history rows', () => {
    render([{ text: 'Pizza', entity: 'Dish' }, { text: 'zoho mail', history: true }]);
    expect(readVisibleOptions(env)).toEqual([
      { text: 'Pizza', history: false },
      { text: 'zoho mail', history: true },
    ]);
  });
});

describe('collectSuggestions', () => {
  it('captures suggestions for the query and skips search-history rows', async () => {
    respond = (v) =>
      v === ''
        ? [{ text: 'my past search', history: true }]
        : v === 'mobile car detailing a'
          ? [{ text: 'mobile car detailing austin' }, { text: 'mobile car detailing appointment', history: true }, { text: 'Mobile Car Detailing Atlanta', entity: 'Topic' }]
          : null;
    const result = await collectSuggestions('mobile car detailing a', FAST, env);
    expect(result).toEqual({ status: 'succeeded', suggestions: ['mobile car detailing austin', 'Mobile Car Detailing Atlanta'] });
    expect(document.querySelector('textarea')!.value).toBe('mobile car detailing a');
  });

  it('does not return the previous query\'s stale suggestions', async () => {
    render([{ text: 'old suggestion one' }, { text: 'old suggestion two' }]);
    // Clearing the box does not change the dropdown; the new query does, later.
    respond = (v) => (v === '' ? 'ignore' : [{ text: `${v} new` }]);
    const result = await collectSuggestions('fresh query', FAST, env);
    expect(result).toEqual({ status: 'succeeded', suggestions: ['fresh query new'] });
  });

  it('waits for the list to settle before reading', async () => {
    respond = (v) => {
      if (!v) return null;
      setTimeout(() => render([{ text: `${v} 1` }, { text: `${v} 2` }]), 30);
      return [{ text: `${v} 1` }];
    };
    const result = await collectSuggestions('q', FAST, env);
    expect(result).toEqual({ status: 'succeeded', suggestions: ['q 1', 'q 2'] });
  });

  it('reports empty when Google shows no dropdown', async () => {
    respond = () => null;
    expect(await collectSuggestions('zzqx nothing', FAST, env)).toEqual({ status: 'empty' });
  });

  it('reports empty when only history rows match', async () => {
    respond = (v) => (v ? [{ text: `${v} from history`, history: true }] : null);
    expect(await collectSuggestions('abc', FAST, env)).toEqual({ status: 'empty' });
  });

  it('reports a timeout when the dropdown never updates', async () => {
    render([{ text: 'stuck suggestion' }]);
    respond = () => 'ignore';
    const result = await collectSuggestions('anything', FAST, env);
    expect(result).toMatchObject({ status: 'failed', reason: 'timeout' });
  });

  it('reports blocked on the unusual-traffic page without touching it', async () => {
    pathname = '/sorry/index';
    const result = await collectSuggestions('q', FAST, env);
    expect(result).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(document.querySelector('textarea')!.value).toBe('');
  });

  it('reports blocked when a CAPTCHA appears during collection', async () => {
    respond = () => {
      document.body.insertAdjacentHTML('beforeend', '<form id="captcha-form"></form>');
      return 'ignore';
    };
    expect(await collectSuggestions('q', FAST, env)).toMatchObject({ status: 'failed', reason: 'blocked' });
  });

  it('reports a missing search box', async () => {
    document.querySelector('form')!.remove();
    expect(await collectSuggestions('q', FAST, env)).toMatchObject({ status: 'failed', reason: 'no_search_box' });
  });

  it('reports interruption if the box changes mid-collection', async () => {
    respond = (v) => {
      if (v === 'q') setTimeout(() => (document.querySelector('textarea')!.value = 'user typed'), 5);
      return 'ignore';
    };
    expect(await collectSuggestions('q', FAST, env)).toMatchObject({ status: 'failed', reason: 'interrupted' });
  });

  it('rejects an empty query', async () => {
    expect(await collectSuggestions('   ', FAST, env)).toMatchObject({ status: 'failed', reason: 'error' });
  });
});
