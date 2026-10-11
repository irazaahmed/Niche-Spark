import { describe, expect, it } from 'vitest';
import {
  cleanAffixList,
  dedupeQueries,
  generateAzQueries,
  generatePrefixQueries,
  generateSuffixQueries,
  generateTemplateQueries,
  parseAffixInput,
  validateSeed,
  validateTemplate,
  ValidationError,
} from '../src/core/queryGeneration';

const SEED = 'mobile car detailing';

describe('A to Z generation', () => {
  it('generates seed + a..z in order', () => {
    const q = generateAzQueries(SEED);
    expect(q).toHaveLength(26);
    expect(q[0]).toEqual({ text: 'mobile car detailing a', key: 'mobile car detailing a', method: 'az' });
    expect(q[25]?.text).toBe('mobile car detailing z');
  });

  it('starts from a selected letter (case-insensitive)', () => {
    const q = generateAzQueries(SEED, { startLetter: 'X' });
    expect(q.map((x) => x.text)).toEqual(['mobile car detailing x', 'mobile car detailing y', 'mobile car detailing z']);
  });

  it('rejects an invalid start letter', () => {
    expect(() => generateAzQueries(SEED, { startLetter: '1' })).toThrow(ValidationError);
    expect(() => generateAzQueries(SEED, { startLetter: 'ab' })).toThrow(ValidationError);
  });

  it('normalizes the seed whitespace', () => {
    expect(generateAzQueries('  Mobile   Car\tDetailing ')[1]?.text).toBe('Mobile Car Detailing b');
  });

  it('is deterministic', () => {
    expect(generateAzQueries(SEED)).toEqual(generateAzQueries(SEED));
  });

  it('rejects empty or invalid seeds', () => {
    expect(() => generateAzQueries('   ')).toThrow(ValidationError);
    expect(() => generateAzQueries('a'.repeat(101))).toThrow(ValidationError);
    expect(() => generateAzQueries('bad {seed}')).toThrow(ValidationError);
    expect(validateSeed('ok seed')).toBeNull();
  });
});

describe('prefix and suffix generation', () => {
  it('places prefixes before the seed', () => {
    const q = generatePrefixQueries(SEED, ['best', 'affordable', 'cheap', 'professional']);
    expect(q.map((x) => x.text)).toEqual([
      'best mobile car detailing',
      'affordable mobile car detailing',
      'cheap mobile car detailing',
      'professional mobile car detailing',
    ]);
    expect(q.every((x) => x.method === 'prefix')).toBe(true);
  });

  it('places suffixes after the seed', () => {
    const q = generateSuffixQueries(SEED, ['near me', 'cost', 'prices', 'services']);
    expect(q.map((x) => x.text)).toEqual([
      'mobile car detailing near me',
      'mobile car detailing cost',
      'mobile car detailing prices',
      'mobile car detailing services',
    ]);
    expect(q.every((x) => x.method === 'suffix')).toBe(true);
  });

  it('drops blank and duplicate affixes (case-insensitive, whitespace-normalized)', () => {
    expect(generateSuffixQueries(SEED, ['cost', ' ', 'COST', 'near  me', 'near me']).map((x) => x.text)).toEqual([
      'mobile car detailing cost',
      'mobile car detailing near me',
    ]);
  });

  it('returns no queries for an empty list', () => {
    expect(generatePrefixQueries(SEED, [])).toEqual([]);
  });

  it('rejects overly long affixes', () => {
    expect(() => cleanAffixList(['x'.repeat(61)])).toThrow(ValidationError);
  });

  it('parses textarea input by lines and commas', () => {
    expect(parseAffixInput('best\ncheap, affordable\n\n best ')).toEqual(['best', 'cheap', 'affordable']);
  });
});

describe('template generation', () => {
  it('expands simple templates', () => {
    const q = generateTemplateQueries(SEED, ['best {seed}', '{seed} near me', '{ seed } cost']);
    expect(q.map((x) => x.text)).toEqual([
      'best mobile car detailing',
      'mobile car detailing near me',
      'mobile car detailing cost',
    ]);
    expect(q.every((x) => x.method === 'template')).toBe(true);
  });

  it('expands {letter} to a..z', () => {
    const q = generateTemplateQueries(SEED, ['{seed} {letter}']);
    expect(q).toHaveLength(26);
    expect(q[2]?.text).toBe('mobile car detailing c');
  });

  it('removes duplicates across templates', () => {
    const q = generateTemplateQueries(SEED, ['best {seed}', 'BEST  {seed}', '{seed} {letter}', '{seed} a']);
    expect(q).toHaveLength(27);
  });

  it('skips blank templates', () => {
    expect(generateTemplateQueries(SEED, ['', '  '])).toEqual([]);
  });

  it.each([
    ['', 'empty'],
    ['best seed', 'must include {seed}'],
    ['{seed} {city}', 'unknown placeholder'],
    ['{seed', 'unbalanced'],
    ['seed} {seed}', 'unbalanced'],
    ['{seed} {letter} {letter}', 'only once'],
  ])('rejects malformed template %j', (template, message) => {
    expect(validateTemplate(template)).toMatch(new RegExp(message, 'i'));
    if (template.trim()) expect(() => generateTemplateQueries(SEED, [template])).toThrow(ValidationError);
  });

  it('accepts valid templates', () => {
    expect(validateTemplate('{seed} for {letter}')).toBeNull();
  });
});

describe('dedupeQueries', () => {
  it('keeps the first occurrence', () => {
    const out = dedupeQueries([
      { text: 'A b', key: 'a b', method: 'prefix' },
      { text: 'a B', key: 'a b', method: 'suffix' },
    ]);
    expect(out).toEqual([{ text: 'A b', key: 'a b', method: 'prefix' }]);
  });
});
