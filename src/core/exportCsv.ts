import type { KeywordRecord } from '../shared/types';
import { RESEARCH_METHOD_LABELS } from '../shared/types';

export const CSV_HEADERS = [
  'Keyword',
  'Normalized key',
  'Research methods',
  'Source queries',
  'First collected (UTC)',
  'Last collected (UTC)',
  'Times seen',
] as const;

/**
 * Escapes one CSV field (RFC 4180): fields containing a comma, quote or line
 * break are quoted and inner quotes doubled. Values that a spreadsheet would
 * run as a formula (=, +, -, @, tab, CR at the start) get a leading apostrophe
 * so opening the file can never execute anything (OWASP CSV injection).
 */
export function escapeCsvField(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Byte-order mark: tells Excel the file is UTF-8. */
export const UTF8_BOM = String.fromCharCode(0xfeff);

/**
 * Builds a CSV file for the given keywords, one row per keyword. Multiple
 * source queries and methods are joined with " | ". Starts with a UTF-8 BOM
 * so Excel shows non-Latin keywords correctly; uses CRLF line endings.
 */
export function keywordsToCsv(keywords: readonly KeywordRecord[]): string {
  const rows = [CSV_HEADERS.map(escapeCsvField).join(',')];
  for (const k of keywords) {
    rows.push(
      [
        k.text,
        k.key,
        k.methods.map((m) => RESEARCH_METHOD_LABELS[m]).join(' | '),
        k.sourceQueries.join(' | '),
        iso(k.firstCollectedAt),
        iso(k.lastCollectedAt),
        k.collectionCount,
      ]
        .map(escapeCsvField)
        .join(','),
    );
  }
  return `${UTF8_BOM}${rows.join('\r\n')}\r\n`;
}

/** Plain text for the clipboard: one keyword per line, as displayed. */
export function keywordsToLines(keywords: readonly KeywordRecord[]): string {
  return keywords.map((k) => k.text).join('\n');
}

/** A safe file name such as "nichespark-mobile-car-detailing-2026-10-12.csv". */
export function exportFileName(projectName: string, extension: string, date = new Date(), suffix = ''): string {
  const slug =
    projectName
      .normalize('NFKD')
      .replace(/\p{M}/gu, '') // strip accent marks left by NFKD
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project';
  // Local calendar date, so a file saved just after midnight carries today's date.
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `nichespark-${slug}${suffix ? `-${suffix}` : ''}-${day}.${extension}`;
}
