import type { KeywordRecord, ResearchMethod } from '../shared/types';

/** Trims, applies Unicode NFC, and collapses all whitespace runs to a single space. */
export function normalizeText(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/** Case-insensitive deduplication key. */
export function normalizeKey(value: string): string {
  return normalizeText(value).toLowerCase();
}

export function keywordId(projectId: string, key: string): string {
  return `${projectId}:${key}`;
}

export interface SuggestionSource {
  query: string;
  method: ResearchMethod;
}

function addUnique<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? [...list] : [...list, value];
}

/**
 * Merges one captured suggestion into an existing keyword record (or creates one).
 * Never discards existing source-query or method relationships, and keeps the
 * originally displayed text.
 */
export function mergeSuggestion(
  existing: KeywordRecord | undefined,
  projectId: string,
  suggestion: string,
  source: SuggestionSource,
  at: number,
): KeywordRecord {
  const text = normalizeText(suggestion);
  const key = normalizeKey(text);
  const query = normalizeText(source.query);
  if (!existing) {
    return {
      id: keywordId(projectId, key),
      projectId,
      text,
      key,
      sourceQueries: [query],
      methods: [source.method],
      firstCollectedAt: at,
      lastCollectedAt: at,
      collectionCount: 1,
    };
  }
  if (existing.key !== key || existing.projectId !== projectId) {
    throw new Error(`Cannot merge "${text}" into keyword "${existing.text}".`);
  }
  return {
    ...existing,
    sourceQueries: addUnique(existing.sourceQueries, query),
    methods: addUnique(existing.methods, source.method),
    firstCollectedAt: Math.min(existing.firstCollectedAt, at),
    lastCollectedAt: Math.max(existing.lastCollectedAt, at),
    collectionCount: existing.collectionCount + 1,
  };
}

/**
 * Cleans raw suggestion strings captured from one query: normalizes,
 * drops blanks, and removes duplicates within the same response.
 */
export function cleanSuggestions(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const text = normalizeText(r);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/**
 * True when a suggestion is only Google echoing an unfinished query back,
 * e.g. "mobile repairing a" for the A to Z query "mobile repairing a".
 * Only queries that end in a single-character token (A to Z letters, or a
 * {letter} template) can produce such an echo. The echo of a prefix or suffix
 * query ("mobile repairing near me") is a real, meaningful keyword and is kept.
 */
export function isQueryEcho(suggestion: string, query: string): boolean {
  const q = normalizeKey(query);
  const lastToken = q.split(' ').at(-1) ?? '';
  return [...lastToken].length === 1 && normalizeKey(suggestion) === q;
}

/** Suggestions worth saving for a query: query echoes removed. */
export function meaningfulSuggestions(query: string, suggestions: readonly string[]): string[] {
  return suggestions.filter((s) => !isQueryEcho(s, query));
}

/** Keywords saved by earlier versions that are only an echo of one of their source queries. */
export function findEchoKeywords(keywords: readonly KeywordRecord[]): KeywordRecord[] {
  return keywords.filter((k) => k.sourceQueries.some((q) => isQueryEcho(k.text, q)));
}
