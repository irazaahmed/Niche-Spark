import { describe, expect, it } from 'vitest';
import { filterKeywords, listSourceQueries, sortKeywords } from '../src/core/keywordFilters';
import type { KeywordRecord } from '../src/shared/types';

const kw = (text: string, extra: Partial<KeywordRecord> = {}): KeywordRecord => ({
  id: `p:${text}`,
  projectId: 'p',
  text,
  key: text.toLowerCase(),
  sourceQueries: ['seed a'],
  methods: ['az'],
  firstCollectedAt: 100,
  lastCollectedAt: 100,
  collectionCount: 1,
  ...extra,
});

const list = [
  kw('Seed Apple', { firstCollectedAt: 300, lastCollectedAt: 900, collectionCount: 2 }),
  kw('seed banana', { methods: ['suffix'], sourceQueries: ['seed b', 'seed banana'], firstCollectedAt: 100, lastCollectedAt: 400 }),
  kw('best seed', { methods: ['prefix', 'az'], sourceQueries: ['best seed'], firstCollectedAt: 200, lastCollectedAt: 200, collectionCount: 5 }),
  kw('seed 10 tips', { firstCollectedAt: 200, lastCollectedAt: 200 }),
  kw('seed 9 tips', { firstCollectedAt: 200, lastCollectedAt: 200 }),
];

describe('filterKeywords', () => {
  it('searches case-insensitively with normalized whitespace', () => {
    expect(filterKeywords(list, { search: '  APPLE ' }).map((k) => k.text)).toEqual(['Seed Apple']);
    expect(filterKeywords(list, { search: 'seed   b' }).map((k) => k.text)).toEqual(['seed banana']);
  });

  it('filters by any of the selected methods', () => {
    expect(filterKeywords(list, { methods: ['prefix'] }).map((k) => k.text)).toEqual(['best seed']);
    expect(filterKeywords(list, { methods: ['suffix', 'prefix'] })).toHaveLength(2);
    expect(filterKeywords(list, { methods: [] })).toHaveLength(5);
  });

  it('filters by source query and combines filters', () => {
    expect(filterKeywords(list, { sourceQuery: 'SEED B' }).map((k) => k.text)).toEqual(['seed banana']);
    expect(filterKeywords(list, { sourceQuery: 'seed a', search: 'apple' }).map((k) => k.text)).toEqual(['Seed Apple']);
    expect(filterKeywords(list, { sourceQuery: 'seed a', methods: ['suffix'] })).toEqual([]);
  });
});

describe('sortKeywords', () => {
  it('sorts alphabetically with natural number order, both directions', () => {
    expect(sortKeywords(list, 'alpha-asc').map((k) => k.text)).toEqual(['best seed', 'seed 9 tips', 'seed 10 tips', 'Seed Apple', 'seed banana']);
    expect(sortKeywords(list, 'alpha-desc')[0]?.text).toBe('seed banana');
  });

  it('sorts by dates and count with alphabetical tie-breaks', () => {
    expect(sortKeywords(list, 'newest').map((k) => k.text)).toEqual(['Seed Apple', 'best seed', 'seed 9 tips', 'seed 10 tips', 'seed banana']);
    expect(sortKeywords(list, 'oldest')[0]?.text).toBe('seed banana');
    expect(sortKeywords(list, 'last-collected')[0]?.text).toBe('Seed Apple');
    expect(sortKeywords(list, 'most-seen').map((k) => k.collectionCount)).toEqual([5, 2, 1, 1, 1]);
  });

  it('does not mutate the input', () => {
    const copy = [...list];
    sortKeywords(list, 'alpha-desc');
    expect(list).toEqual(copy);
  });
});

describe('listSourceQueries', () => {
  it('lists distinct source queries alphabetically', () => {
    expect(listSourceQueries(list)).toEqual(['best seed', 'seed a', 'seed b', 'seed banana']);
  });
});
