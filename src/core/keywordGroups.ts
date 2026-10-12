// Keyword grouping: assigns each keyword a search-intent theme and finds the
// modifier words that recur after removing the seed. Rule-based and English
// only, so results are predictable and explainable; it groups, it never guesses
// volume or ranks keywords.
import type { KeywordRecord } from '../shared/types';
import { normalizeKey } from './keywords';

export type KeywordTheme = 'questions' | 'price' | 'local' | 'commercial' | 'business' | 'learning' | 'other';

export const THEME_ORDER: readonly KeywordTheme[] = ['questions', 'price', 'local', 'commercial', 'business', 'learning', 'other'];

export const THEME_LABELS: Record<KeywordTheme, string> = {
  questions: 'Questions',
  price: 'Price & cost',
  local: 'Local / near me',
  commercial: 'Compare & reviews',
  business: 'Business & jobs',
  learning: 'Learning & guides',
  other: 'Other',
};

const QUESTION_START = /^(how|what|why|where|when|which|who|whom|whose|can|could|is|are|does|do|did|should|will|would)\b/;
// Each pattern matches whole words in the normalized keyword. Order is priority:
// business first, so "jobs near me" or "startup cost" count as business, not local/price.
const THEME_PATTERNS: Array<[Exclude<KeywordTheme, 'questions' | 'other'>, RegExp]> = [
  ['business', /\b(business|businesses|jobs?|salary|salaries|income|earnings?|franchise|start ?up|startup|hiring|careers?|license|licence|insurance|equipment|kit|tools|for sale)\b/],
  ['price', /\b(price|prices|pricing|cost|costs|cheap|cheapest|affordable|rate|rates|fee|fees|charges?|quote|quotes|budget|free|discount|deals?|low cost)\b/],
  ['local', /\b(near me|nearby|near|open now|in my area|local|home service|at home|delivery|come to my house|within \d+ mi)\b/],
  ['commercial', /\b(best|top|reviews?|rating|ratings|vs|versus|compare|comparison|alternatives?|recommended|reliable|trusted)\b/],
  ['learning', /\b(course|courses|training|class|classes|tutorial|tutorials|guide|guides|tips|learn|learning|beginners?|book|books|pdf|certification|certificate|institute|diploma|ideas)\b/],
];

/** The search-intent theme of one keyword (first match in THEME_ORDER). */
export function detectTheme(keyword: string): KeywordTheme {
  const k = normalizeKey(keyword);
  if (QUESTION_START.test(k)) return 'questions';
  for (const [theme, re] of THEME_PATTERNS) if (re.test(k)) return theme;
  return 'other';
}

const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'of', 'in', 'on', 'at', 'to', 'with', 'my', 'your', 'me', 'near', 'by', 'from']);

/**
 * The first meaningful word a keyword adds to the seed, e.g. "course" for
 * "mobile repairing course online" with seed "mobile repairing".
 * Returns null when the keyword adds nothing but stopwords.
 */
export function keywordModifier(keyword: string, seed: string): string | null {
  const seedWords = new Set(normalizeKey(seed).split(' '));
  for (const word of normalizeKey(keyword).split(' ')) {
    if (!word || seedWords.has(word) || STOPWORDS.has(word) || word.length < 2) continue;
    return word;
  }
  return null;
}

export interface GroupSummary<K extends string> {
  key: K;
  count: number;
}

/** Keyword counts per theme, in THEME_ORDER, omitting empty themes. */
export function summarizeThemes(keywords: readonly KeywordRecord[]): GroupSummary<KeywordTheme>[] {
  const counts = new Map<KeywordTheme, number>();
  for (const k of keywords) {
    const t = detectTheme(k.text);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return THEME_ORDER.filter((t) => counts.has(t)).map((t) => ({ key: t, count: counts.get(t)! }));
}

/**
 * Modifiers shared by at least `minCount` keywords, most common first (ties
 * alphabetical). Single-use modifiers are left out: they aren't groups.
 */
export function summarizeModifiers(keywords: readonly KeywordRecord[], seed: string, minCount = 2, limit = 16): GroupSummary<string>[] {
  const counts = new Map<string, number>();
  for (const k of keywords) {
    const m = keywordModifier(k.text, seed);
    if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}
