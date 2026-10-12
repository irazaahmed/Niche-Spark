import { describe, expect, it } from 'vitest';
import { UTF8_BOM, escapeCsvField, exportFileName, keywordsToCsv, keywordsToLines } from '../src/core/exportCsv';
import type { KeywordRecord } from '../src/shared/types';

const kw = (text: string, extra: Partial<KeywordRecord> = {}): KeywordRecord => ({
  id: `p:${text.toLowerCase()}`,
  projectId: 'p',
  text,
  key: text.toLowerCase(),
  sourceQueries: ['seed a'],
  methods: ['az'],
  firstCollectedAt: Date.UTC(2026, 9, 11, 10, 0, 0),
  lastCollectedAt: Date.UTC(2026, 9, 12, 8, 30, 0),
  collectionCount: 1,
  ...extra,
});

describe('escapeCsvField', () => {
  it('leaves plain values alone', () => {
    expect(escapeCsvField('mobile car detailing')).toBe('mobile car detailing');
    expect(escapeCsvField(3)).toBe('3');
  });

  it('quotes commas, quotes and line breaks, doubling inner quotes', () => {
    expect(escapeCsvField('cost, prices')).toBe('"cost, prices"');
    expect(escapeCsvField('the "best" one')).toBe('"the ""best"" one"');
    expect(escapeCsvField('a\nb')).toBe('"a\nb"');
    expect(escapeCsvField('a\r\nb')).toBe('"a\r\nb"');
  });

  it('neutralizes spreadsheet formulas', () => {
    expect(escapeCsvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCsvField('+1')).toBe("'+1");
    expect(escapeCsvField('-cmd')).toBe("'-cmd");
    expect(escapeCsvField('@sum')).toBe("'@sum");
  });
});

describe('keywordsToCsv', () => {
  it('writes a BOM, headers, CRLF rows, joined sources and ISO dates', () => {
    const csv = keywordsToCsv([
      kw('Mobile Car Detailing Near Me', { sourceQueries: ['seed n', 'seed near'], methods: ['az', 'suffix'], collectionCount: 2 }),
    ]);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('Keyword,Normalized key,Research methods,Source queries,First collected (UTC),Last collected (UTC),Times seen,Theme');
    expect(lines[1]).toBe(
      'Mobile Car Detailing Near Me,mobile car detailing near me,A to Z | Suffix,seed n | seed near,2026-10-11T10:00:00.000Z,2026-10-12T08:30:00.000Z,2,Local / near me',
    );
    expect(lines[2]).toBe('');
  });

  it('preserves Unicode', () => {
    const csv = keywordsToCsv([kw('Ärzte in München'), kw('洗车服务'), kw('کار واش')]);
    expect(csv).toContain('Ärzte in München');
    expect(csv).toContain('洗车服务');
    expect(csv).toContain('کار واش');
  });

  it('exports only headers for an empty list', () => {
    expect(keywordsToCsv([]).split('\r\n').filter(Boolean)).toHaveLength(1);
  });
});

describe('clipboard and file names', () => {
  it('copies one keyword per line', () => {
    expect(keywordsToLines([kw('a b'), kw('C d')])).toBe('a b\nC d');
  });

  it('builds safe file names', () => {
    const d = new Date(2026, 9, 12, 0, 30); // local time, just after midnight
    expect(exportFileName('Mobile Car Detailing!', 'csv', d)).toBe('nichespark-mobile-car-detailing-2026-10-12.csv');
    expect(exportFileName('Café / Ärzte', 'json', d, 'backup')).toBe('nichespark-cafe-arzte-backup-2026-10-12.json');
    expect(exportFileName('洗车', 'csv', d)).toBe('nichespark-project-2026-10-12.csv');
  });
});
