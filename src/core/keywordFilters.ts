import type { KeywordRecord, ResearchMethod } from '../shared/types';
import { normalizeKey } from './keywords';

export interface KeywordFilter {
  /** Case-insensitive substring match on the keyword. */
  search?: string;
  /** Keep keywords found by at least one of these methods. Empty or undefined = all. */
  methods?: readonly ResearchMethod[];
  /** Keep keywords found by this exact source query. */
  sourceQuery?: string;
}

export type KeywordSort = 'alpha-asc' | 'alpha-desc' | 'newest' | 'oldest' | 'last-collected' | 'most-seen';

export const KEYWORD_SORT_LABELS: Record<KeywordSort, string> = {
  'alpha-asc': 'A → Z',
  'alpha-desc': 'Z → A',
  newest: 'Newest first',
  oldest: 'Oldest first',
  'last-collected': 'Recently collected',
  'most-seen': 'Most seen',
};

export function filterKeywords(keywords: readonly KeywordRecord[], filter: KeywordFilter): KeywordRecord[] {
  const search = filter.search ? normalizeKey(filter.search) : '';
  const methods = filter.methods?.length ? new Set(filter.methods) : null;
  const source = filter.sourceQuery ? normalizeKey(filter.sourceQuery) : '';
  return keywords.filter(
    (k) =>
      (!search || k.key.includes(search)) &&
      (!methods || k.methods.some((m) => methods.has(m))) &&
      (!source || k.sourceQueries.some((q) => normalizeKey(q) === source)),
  );
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Returns a new sorted array; ties fall back to alphabetical order so output is deterministic. */
export function sortKeywords(keywords: readonly KeywordRecord[], sort: KeywordSort): KeywordRecord[] {
  const alpha = (a: KeywordRecord, b: KeywordRecord) => collator.compare(a.key, b.key) || a.key.localeCompare(b.key);
  const compare: Record<KeywordSort, (a: KeywordRecord, b: KeywordRecord) => number> = {
    'alpha-asc': alpha,
    'alpha-desc': (a, b) => alpha(b, a),
    newest: (a, b) => b.firstCollectedAt - a.firstCollectedAt || alpha(a, b),
    oldest: (a, b) => a.firstCollectedAt - b.firstCollectedAt || alpha(a, b),
    'last-collected': (a, b) => b.lastCollectedAt - a.lastCollectedAt || alpha(a, b),
    'most-seen': (a, b) => b.collectionCount - a.collectionCount || alpha(a, b),
  };
  return [...keywords].sort(compare[sort]);
}

/** All distinct source queries in a keyword set, alphabetically. */
export function listSourceQueries(keywords: readonly KeywordRecord[]): string[] {
  const seen = new Map<string, string>();
  for (const k of keywords) for (const q of k.sourceQueries) if (!seen.has(normalizeKey(q))) seen.set(normalizeKey(q), q);
  return [...seen.values()].sort((a, b) => collator.compare(a, b));
}
