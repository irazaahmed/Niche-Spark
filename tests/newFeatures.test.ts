import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CollectionScheduler } from '../src/background/scheduler';
import { buildBackup, parseBackup, serializeBackup } from '../src/core/backup';
import { filterKeywords } from '../src/core/keywordFilters';
import { detectTheme, keywordModifier, summarizeModifiers, summarizeThemes } from '../src/core/keywordGroups';
import { mergeSuggestion } from '../src/core/keywords';
import { addPackToList, PREFIX_PACKS, SUFFIX_PACKS } from '../src/core/modifierPacks';
import { generateQueriesForMethod, generateQuestionQueries, QUESTION_WORDS, ValidationError } from '../src/core/queryGeneration';
import { MemoryStorage } from '../src/storage/memoryStorage';
import type { KeywordRecord } from '../src/shared/types';

const kw = (text: string): KeywordRecord => mergeSuggestion(undefined, 'p', text, { query: 'q', method: 'az' }, 1);

describe('Questions method', () => {
  it('puts every question word before the seed', () => {
    const q = generateQuestionQueries('mobile repairing');
    expect(q).toHaveLength(QUESTION_WORDS.length);
    expect(q[0]).toEqual({ text: 'how mobile repairing', key: 'how mobile repairing', method: 'question' });
    expect(q.map((x) => x.text)).toContain('how much mobile repairing');
    expect(q.every((x) => x.method === 'question')).toBe(true);
  });

  it('is available through generateQueriesForMethod and validates the seed', () => {
    const project = { seed: 'seo', prefixes: [], suffixes: [], templates: [] };
    expect(generateQueriesForMethod(project, 'question').map((q) => q.text)).toContain('what is seo');
    expect(() => generateQuestionQueries('  ')).toThrow(ValidationError);
  });

  it('runs as a collection job and keeps question keywords', async () => {
    const storage = new MemoryStorage();
    let saved: unknown = null;
    const scheduler = new CollectionScheduler({
      storage,
      google: { ensureTab: async () => 1, collect: async (_t, q) => ({ status: 'succeeded', suggestions: [`${q} at home`] }) },
      loadJob: async () => null,
      saveJob: async (j) => void (saved = j),
      sleep: async () => {},
      now: () => 1,
      random: () => 0,
      newId: () => 'job',
    });
    const p = await storage.createProject({ name: 'P', seed: 'mobile repairing' });
    await scheduler.start({ projectId: p.id, method: 'question' });
    await scheduler.idle();
    const keywords = await storage.listKeywords(p.id);
    expect(keywords).toHaveLength(QUESTION_WORDS.length);
    expect(keywords.every((k) => k.methods.includes('question'))).toBe(true);
    expect(saved).toMatchObject({ status: 'completed' });
  });

  it('survives a JSON backup round trip', async () => {
    const s = new MemoryStorage();
    const p = await s.createProject({ name: 'P', seed: 'seo' });
    const [q] = await s.addQueries(p.id, generateQuestionQueries('seo'));
    await s.recordQueryOutcome(p.id, q!.id, { status: 'succeeded', suggestions: ['how seo works'], at: 1 });
    const backup = parseBackup(serializeBackup(buildBackup((await s.getProject(p.id))!, await s.listQueries(p.id), await s.listKeywords(p.id), 't')));
    expect(backup.keywords[0]?.methods).toEqual(['question']);
    const imported = await s.importProject(backup);
    expect((await s.listKeywords(imported.id))[0]?.methods).toEqual(['question']);
  });
});

describe('ready-made packs', () => {
  it('adds new words, keeps order, and skips duplicates case-insensitively', () => {
    const pricing = SUFFIX_PACKS.find((p) => p.id === 'pricing')!;
    const { list, added } = addPackToList(['near me', 'COST'], pricing);
    expect(list.slice(0, 2)).toEqual(['near me', 'COST']);
    expect(list).not.toContain('cost');
    expect(added).toBe(pricing.words.length - 1);
    expect(addPackToList(list, pricing).added).toBe(0);
  });

  it('only contains clean, unique, short entries', () => {
    for (const pack of [...PREFIX_PACKS, ...SUFFIX_PACKS]) {
      expect(new Set(pack.words).size).toBe(pack.words.length);
      for (const w of pack.words) {
        expect(w).toBe(w.trim().toLowerCase());
        expect(w.length).toBeLessThanOrEqual(60);
        expect(w).not.toMatch(/[{}]/);
      }
    }
  });
});

describe('keyword grouping', () => {
  it.each([
    ['how much does mobile repairing cost', 'questions'],
    ['mobile repairing price list', 'price'],
    ['cheap mobile repairing', 'price'],
    ['mobile repairing near me', 'local'],
    ['mobile car detailing near me within 5 mi', 'local'],
    ['best mobile repairing shop reviews', 'commercial'],
    ['mobile repairing course online', 'learning'],
    ['mobile repairing business plan', 'business'],
    ['mobile repairing jobs', 'business'],
    ['mobile car detailing jobs near me', 'business'],
    ['mobile car detailing insurance cost', 'business'],
    ['mobile repairing karachi', 'other'],
  ])('%s → %s', (text, theme) => {
    expect(detectTheme(text)).toBe(theme);
  });

  it('finds the first word a keyword adds to the seed', () => {
    expect(keywordModifier('mobile repairing course online', 'mobile repairing')).toBe('course');
    expect(keywordModifier('best mobile repairing', 'mobile repairing')).toBe('best');
    expect(keywordModifier('mobile repairing in karachi', 'mobile repairing')).toBe('karachi');
    expect(keywordModifier('mobile repairing', 'mobile repairing')).toBeNull();
  });

  it('summarizes themes and shared modifiers, and filters by them', () => {
    const list = ['mobile repairing course', 'mobile repairing course online', 'mobile repairing price', 'mobile repairing tools', 'mobile repairing tools kit'].map(kw);
    expect(summarizeThemes(list)).toEqual([
      { key: 'price', count: 1 },
      { key: 'business', count: 2 },
      { key: 'learning', count: 2 },
    ]);
    expect(summarizeModifiers(list, 'mobile repairing')).toEqual([
      { key: 'course', count: 2 },
      { key: 'tools', count: 2 },
    ]);
    expect(filterKeywords(list, { theme: 'learning' }).map((k) => k.text)).toEqual(['mobile repairing course', 'mobile repairing course online']);
    expect(filterKeywords(list, { modifier: 'tools', seed: 'mobile repairing' })).toHaveLength(2);
  });

  it('groups the real "mobile car detailing" dataset sensibly', () => {
    const backup = parseBackup(readFileSync(new URL('../store-assets/src/real-data-backup.json', import.meta.url), 'utf8'));
    const keywords = backup.keywords.map((k) => kw(k.text));
    const themes = Object.fromEntries(summarizeThemes(keywords).map((g) => [g.key, g.count]));
    expect(themes.price).toBeGreaterThanOrEqual(25);
    expect(themes.local).toBeGreaterThanOrEqual(12);
    expect(themes.business).toBeGreaterThanOrEqual(12);
    expect(themes.other).toBeGreaterThan(themes.price ?? 0); // city completions dominate
    const modifiers = summarizeModifiers(keywords, 'mobile car detailing').map((m) => m.key);
    expect(modifiers).toEqual(expect.arrayContaining(['prices', 'business', 'cheap']));
  });
});
