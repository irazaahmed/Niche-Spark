import { LIMITS } from '../shared/constants';
import type { ResearchMethod } from '../shared/types';
import { normalizeKey, normalizeText } from './keywords';

export const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

export interface GeneratedQuery {
  text: string;
  key: string;
  method: ResearchMethod;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Returns an error message for an invalid seed, or null when valid. */
export function validateSeed(seed: string): string | null {
  const s = normalizeText(seed);
  if (!s) return 'Enter a seed keyword.';
  if (s.length > LIMITS.seedMaxLength) return `Seed keyword must be ${LIMITS.seedMaxLength} characters or fewer.`;
  if (/[{}]/.test(s)) return 'Seed keyword cannot contain { or }.';
  return null;
}

function requireSeed(seed: string): string {
  const error = validateSeed(seed);
  if (error) throw new ValidationError(error);
  return normalizeText(seed);
}

/**
 * Cleans a user-entered prefix/suffix list: trims, collapses whitespace,
 * drops blanks and case-insensitive duplicates, and enforces length limits.
 * Order is preserved (first occurrence wins).
 */
export function cleanAffixList(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const text = normalizeText(raw);
    if (!text) continue;
    if (text.length > LIMITS.affixMaxLength) {
      throw new ValidationError(`"${text.slice(0, 20)}…" is longer than ${LIMITS.affixMaxLength} characters.`);
    }
    const key = normalizeKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  if (out.length > LIMITS.maxAffixes) throw new ValidationError(`Use at most ${LIMITS.maxAffixes} entries.`);
  return out;
}

/** Parses a textarea value (one entry per line, commas also accepted) into a clean list. */
export function parseAffixInput(value: string): string[] {
  return cleanAffixList(value.split(/[\n,]/));
}

/** Removes duplicate queries (by normalized key), keeping the first occurrence. */
export function dedupeQueries(queries: readonly GeneratedQuery[]): GeneratedQuery[] {
  const seen = new Set<string>();
  return queries.filter((q) => {
    if (!q.key || seen.has(q.key)) return false;
    seen.add(q.key);
    return true;
  });
}

function makeQuery(text: string, method: ResearchMethod): GeneratedQuery {
  const clean = normalizeText(text);
  if (clean.length > LIMITS.queryMaxLength) {
    throw new ValidationError(`Query "${clean.slice(0, 30)}…" exceeds ${LIMITS.queryMaxLength} characters.`);
  }
  return { text: clean, key: normalizeKey(clean), method };
}

export interface AzOptions {
  /** Start from this letter (inclusive). Defaults to "a". */
  startLetter?: string;
}

/** "seed a", "seed b", … "seed z". */
export function generateAzQueries(seed: string, options: AzOptions = {}): GeneratedQuery[] {
  const s = requireSeed(seed);
  const start = (options.startLetter ?? 'a').toLowerCase();
  const startIndex = LETTERS.indexOf(start);
  if (startIndex < 0) throw new ValidationError('Start letter must be a single letter from a to z.');
  return dedupeQueries(LETTERS.slice(startIndex).map((l) => makeQuery(`${s} ${l}`, 'az')));
}

/** "prefix seed" for each prefix. */
export function generatePrefixQueries(seed: string, prefixes: readonly string[]): GeneratedQuery[] {
  const s = requireSeed(seed);
  return dedupeQueries(cleanAffixList(prefixes).map((p) => makeQuery(`${p} ${s}`, 'prefix')));
}

/** "seed suffix" for each suffix. */
export function generateSuffixQueries(seed: string, suffixes: readonly string[]): GeneratedQuery[] {
  const s = requireSeed(seed);
  return dedupeQueries(cleanAffixList(suffixes).map((x) => makeQuery(`${s} ${x}`, 'suffix')));
}

const PLACEHOLDER_RE = /\{([^{}]*)\}/g;
const SUPPORTED_PLACEHOLDERS = new Set(['seed', 'letter']);

/** Returns an error message for an invalid template, or null when valid. */
export function validateTemplate(template: string): string | null {
  const t = normalizeText(template);
  if (!t) return 'Template is empty.';
  // Every brace must belong to a well-formed {name} placeholder.
  const stripped = t.replace(PLACEHOLDER_RE, '');
  if (/[{}]/.test(stripped)) return `Template "${t}" has unbalanced braces.`;
  const names = [...t.matchAll(PLACEHOLDER_RE)].map((m) => (m[1] ?? '').trim());
  const unknown = names.find((n) => !SUPPORTED_PLACEHOLDERS.has(n));
  if (unknown !== undefined) return `Template "${t}" uses unknown placeholder {${unknown}}. Use {seed} or {letter}.`;
  if (!names.includes('seed')) return `Template "${t}" must include {seed}.`;
  if (names.filter((n) => n === 'letter').length > 1) return `Template "${t}" can use {letter} only once.`;
  return null;
}

/**
 * Expands templates such as "best {seed}", "{seed} near me" or "{seed} {letter}".
 * A template containing {letter} expands to 26 queries (a–z).
 */
export function generateTemplateQueries(seed: string, templates: readonly string[]): GeneratedQuery[] {
  const s = requireSeed(seed);
  if (templates.length > LIMITS.maxTemplates) throw new ValidationError(`Use at most ${LIMITS.maxTemplates} templates.`);
  const out: GeneratedQuery[] = [];
  for (const raw of templates) {
    if (!normalizeText(raw)) continue;
    const error = validateTemplate(raw);
    if (error) throw new ValidationError(error);
    const fill = (letter?: string) =>
      normalizeText(raw).replace(PLACEHOLDER_RE, (_, name: string) => (name.trim() === 'seed' ? s : (letter ?? '')));
    const usesLetter = /\{\s*letter\s*\}/.test(raw);
    const texts = usesLetter ? LETTERS.map(fill) : [fill()];
    for (const text of texts) out.push(makeQuery(text, 'template'));
  }
  return dedupeQueries(out);
}
