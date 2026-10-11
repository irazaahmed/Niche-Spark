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
