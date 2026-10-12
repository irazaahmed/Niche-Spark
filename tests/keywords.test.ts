import { describe, expect, it } from 'vitest';
import { cleanSuggestions, findEchoKeywords, isQueryEcho, meaningfulSuggestions, mergeSuggestion, normalizeKey, normalizeText } from '../src/core/keywords';

describe('normalization', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeText('  mobile \t car\n\ndetailing  ')).toBe('mobile car detailing');
    expect(normalizeText(`a${String.fromCharCode(0xa0)}b`)).toBe('a b'); // non-breaking space
  });

  it('builds a case-insensitive key', () => {
    expect(normalizeKey(' Mobile CAR  Detailing ')).toBe('mobile car detailing');
  });

  it('normalizes Unicode composition so equivalent strings dedupe', () => {
    const composed = `caf${String.fromCharCode(0xe9)}`;
    const decomposed = `cafe${String.fromCharCode(0x301)}`;
    expect(normalizeKey(composed)).toBe(normalizeKey(decomposed));
  });

  it('preserves non-Latin text', () => {
    expect(normalizeKey('  Ärzte  Berlin ')).toBe('ärzte berlin');
    expect(normalizeText('洗车 服务')).toBe('洗车 服务');
  });
});

describe('cleanSuggestions', () => {
  it('drops blanks and duplicates within a response', () => {
    expect(cleanSuggestions(['A', ' a ', '', 'b'])).toEqual(['A', 'b']);
  });
});

describe('mergeSuggestion', () => {
  const P = 'p1';

  it('creates a new record', () => {
    const r = mergeSuggestion(undefined, P, '  Mobile Car Detailing Near Me ', { query: 'mobile car detailing n', method: 'az' }, 100);
    expect(r).toEqual({
      id: 'p1:mobile car detailing near me',
      projectId: P,
      text: 'Mobile Car Detailing Near Me',
      key: 'mobile car detailing near me',
      sourceQueries: ['mobile car detailing n'],
      methods: ['az'],
      firstCollectedAt: 100,
      lastCollectedAt: 100,
      collectionCount: 1,
    });
  });

  it('preserves original text and accumulates sources and methods', () => {
    const a = mergeSuggestion(undefined, P, 'Mobile Car Detailing', { query: 'q1', method: 'az' }, 100);
    const b = mergeSuggestion(a, P, 'mobile car detailing', { query: 'q2', method: 'suffix' }, 200);
    const c = mergeSuggestion(b, P, 'MOBILE car detailing', { query: 'q1', method: 'az' }, 300);
    expect(c.text).toBe('Mobile Car Detailing');
    expect(c.sourceQueries).toEqual(['q1', 'q2']);
    expect(c.methods).toEqual(['az', 'suffix']);
    expect(c.firstCollectedAt).toBe(100);
    expect(c.lastCollectedAt).toBe(300);
    expect(c.collectionCount).toBe(3);
  });

  it('does not mutate the existing record', () => {
    const a = mergeSuggestion(undefined, P, 'x', { query: 'q1', method: 'az' }, 1);
    const snapshot = structuredClone(a);
    mergeSuggestion(a, P, 'x', { query: 'q2', method: 'prefix' }, 2);
    expect(a).toEqual(snapshot);
  });

  it('refuses to merge a different keyword or project', () => {
    const a = mergeSuggestion(undefined, P, 'x', { query: 'q', method: 'az' }, 1);
    expect(() => mergeSuggestion(a, P, 'y', { query: 'q', method: 'az' }, 2)).toThrow();
    expect(() => mergeSuggestion(a, 'p2', 'x', { query: 'q', method: 'az' }, 2)).toThrow();
  });
});

describe('query echoes', () => {
  it('detects an echo of an unfinished A to Z query', () => {
    expect(isQueryEcho('mobile repairing a', 'mobile repairing a')).toBe(true);
    expect(isQueryEcho('  Mobile  Repairing B ', 'mobile repairing b')).toBe(true);
    expect(isQueryEcho('best laptop for z', 'best laptop for z')).toBe(true); // {letter} template
  });

  it('keeps real completions of A to Z queries', () => {
    expect(isQueryEcho('mobile repairing app', 'mobile repairing a')).toBe(false);
    expect(isQueryEcho('mobile repairing', 'mobile repairing a')).toBe(false);
  });

  it('keeps the echo of prefix and suffix queries, which is a real keyword', () => {
    expect(isQueryEcho('mobile repairing near me', 'mobile repairing near me')).toBe(false);
    expect(isQueryEcho('best mobile repairing', 'best mobile repairing')).toBe(false);
  });

  it('filters suggestion lists and finds old echo keywords', () => {
    expect(meaningfulSuggestions('mobile repairing a', ['mobile repairing a', 'mobile repairing app', 'mobile repairing apron'])).toEqual([
      'mobile repairing app',
      'mobile repairing apron',
    ]);
    const echo = mergeSuggestion(undefined, 'p', 'mobile repairing a', { query: 'mobile repairing a', method: 'az' }, 1);
    const real = mergeSuggestion(undefined, 'p', 'mobile repairing app', { query: 'mobile repairing a', method: 'az' }, 1);
    const suffix = mergeSuggestion(undefined, 'p', 'mobile repairing near me', { query: 'mobile repairing near me', method: 'suffix' }, 1);
    expect(findEchoKeywords([echo, real, suffix]).map((k) => k.text)).toEqual(['mobile repairing a']);
  });
});
