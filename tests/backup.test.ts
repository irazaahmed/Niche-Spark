import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { buildBackup, parseBackup, serializeBackup, type ProjectBackup } from '../src/core/backup';
import { generateAzQueries, generateSuffixQueries, ValidationError } from '../src/core/queryGeneration';
import { IndexedDbStorage } from '../src/storage/indexedDbStorage';
import { MemoryStorage } from '../src/storage/memoryStorage';
import type { StorageService } from '../src/storage/StorageService';

/** The 26 letter queries ("seed a" … "seed z"), without the two seed queries A to Z now starts with. */
const azLetters = (seed: string) => generateAzQueries(seed).filter((q) => / [a-z]$/.test(q.text));

async function sampleProject(s: StorageService) {
  const p = await s.createProject({ name: 'Detailing', seed: 'car detailing', suffixes: ['cost', 'near me'], templates: ['best {seed}'] });
  const [a, b] = await s.addQueries(p.id, azLetters('car detailing').slice(0, 2));
  const [c] = await s.addQueries(p.id, generateSuffixQueries('car detailing', ['cost']));
  await s.recordQueryOutcome(p.id, a!.id, { status: 'succeeded', suggestions: ['Car Detailing Austin', 'car detailing atlanta'], at: 1000 });
  await s.recordQueryOutcome(p.id, b!.id, { status: 'failed', suggestions: [], error: 'Timed out', at: 2000 });
  await s.recordQueryOutcome(p.id, c!.id, { status: 'succeeded', suggestions: ['car detailing austin', 'car detailing cost uk'], at: 3000 });
  return p;
}

async function exportProject(s: StorageService, id: string): Promise<ProjectBackup> {
  const project = (await s.getProject(id))!;
  return buildBackup(project, await s.listQueries(id), await s.listKeywords(id), '0.1.1', new Date(Date.UTC(2026, 9, 12)));
}

describe('buildBackup / parseBackup', () => {
  it('round-trips a project through JSON', async () => {
    const s = new MemoryStorage();
    const p = await sampleProject(s);
    const backup = await exportProject(s, p.id);
    expect(backup).toMatchObject({ format: 'nichespark-backup', version: 1, exportedAt: '2026-10-12T00:00:00.000Z' });
    expect(backup.keywords).toHaveLength(3);
    expect(JSON.stringify(backup)).not.toContain(p.id); // internal ids are not exported
    const parsed = parseBackup(serializeBackup(backup));
    expect(parsed.project).toEqual(backup.project);
    expect(parsed.queries).toEqual(backup.queries);
    expect(new Set(parsed.keywords.map((k) => k.text))).toEqual(new Set(backup.keywords.map((k) => k.text)));
  });

  it('accepts a leading BOM', async () => {
    const s = new MemoryStorage();
    const backup = await exportProject(s, (await sampleProject(s)).id);
    expect(() => parseBackup(String.fromCharCode(0xfeff) + serializeBackup(backup))).not.toThrow();
  });

  it('merges duplicate keywords in a file without losing sources', async () => {
    const s = new MemoryStorage();
    const backup = await exportProject(s, (await sampleProject(s)).id);
    backup.keywords.push({ text: '  CAR detailing   ATLANTA ', sourceQueries: ['other query'], methods: ['template'], firstCollectedAt: 10, lastCollectedAt: 5000, collectionCount: 2 });
    const parsed = parseBackup(JSON.stringify(backup));
    const atlanta = parsed.keywords.find((k) => k.text.toLowerCase() === 'car detailing atlanta')!;
    expect(parsed.keywords).toHaveLength(3);
    expect(atlanta.sourceQueries).toEqual(['car detailing a', 'other query']);
    expect(atlanta.methods).toEqual(['az', 'template']);
    expect(atlanta).toMatchObject({ firstCollectedAt: 10, lastCollectedAt: 5000, collectionCount: 3 });
  });

  it.each([
    ['not json', 'not valid JSON'],
    ['[]', 'must be an object'],
    ['{"format":"other"}', 'not a NicheSpark backup'],
    ['{"format":"nichespark-backup","version":2}', 'Unsupported backup version 2'],
  ])('rejects %j', (text, message) => {
    expect(() => parseBackup(text)).toThrow(new RegExp(message));
  });

  it('lists field problems with their location', async () => {
    const s = new MemoryStorage();
    const backup = (await exportProject(s, (await sampleProject(s)).id)) as unknown as Record<string, any>;
    backup.project.googleDomain = 'www.example.com';
    backup.queries[0].status = 'done';
    backup.keywords[1].methods = ['magic'];
    backup.keywords[2].firstCollectedAt = -5;
    let message = '';
    try {
      parseBackup(JSON.stringify(backup));
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      message = (e as Error).message;
    }
    expect(message).toContain('project.googleDomain "www.example.com" is not a supported Google domain.');
    expect(message).toContain('queries[0].status must be one of');
    expect(message).toContain('keywords[1].methods[0] must be one of');
    expect(message).toContain('keywords[2].firstCollectedAt must be a valid timestamp.');
  });

  it('rejects missing lists and empty names', () => {
    const base = { format: 'nichespark-backup', version: 1, project: { name: ' ', seed: 'x', googleDomain: 'www.google.com', language: 'en', prefixes: [], suffixes: [], templates: [], createdAt: 1, updatedAt: 1 } };
    expect(() => parseBackup(JSON.stringify(base))).toThrow(/queries must be a list[\s\S]*keywords must be a list|project.name is empty/);
  });
});

describe.each([
  ['MemoryStorage', () => new MemoryStorage()],
  ['IndexedDbStorage', () => new IndexedDbStorage(new IDBFactory(), 'import-test')],
] as Array<[string, () => StorageService]>)('%s.importProject', (_name, make) => {
  it('imports as a new project with all data, never touching the original', async () => {
    const s = make();
    const original = await sampleProject(s);
    const before = { queries: await s.listQueries(original.id), keywords: await s.listKeywords(original.id) };
    const backup = parseBackup(serializeBackup(await exportProject(s, original.id)));

    const imported = await s.importProject(backup);
    expect(imported.id).not.toBe(original.id);
    expect(imported.name).toBe('Detailing (imported)');
    expect(imported).toMatchObject({ seed: 'car detailing', suffixes: ['cost', 'near me'], templates: ['best {seed}'] });

    expect(await s.listQueries(original.id)).toEqual(before.queries);
    expect(await s.listKeywords(original.id)).toEqual(before.keywords);

    const queries = await s.listQueries(imported.id);
    expect(queries.map((q) => [q.text, q.status])).toEqual(before.queries.map((q) => [q.text, q.status]));
    expect(queries.every((q) => q.projectId === imported.id && q.id.startsWith(imported.id))).toBe(true);
    expect(await s.countQueries(imported.id)).toMatchObject({ succeeded: 2, failed: 1 });

    const keywords = await s.listKeywords(imported.id);
    expect(keywords).toHaveLength(3);
    const austin = keywords.find((k) => k.key === 'car detailing austin')!;
    expect(austin).toMatchObject({ text: 'Car Detailing Austin', sourceQueries: ['car detailing a', 'car detailing cost'], methods: ['az', 'suffix'], collectionCount: 2 });

    // Importing again picks the next free name.
    expect((await s.importProject(backup)).name).toBe('Detailing (imported 2)');
    expect(await s.listProjects()).toHaveLength(3);
  });

  it('keeps working with imported data (collection continues where it left off)', async () => {
    const s = make();
    const original = await sampleProject(s);
    const imported = await s.importProject(parseBackup(serializeBackup(await exportProject(s, original.id))));
    const again = await s.addQueries(imported.id, azLetters('car detailing').slice(0, 3));
    expect(again.map((q) => q.status)).toEqual(['succeeded', 'failed', 'pending']);
    expect(await s.resetFailedQueries(imported.id)).toBe(1);
  });
});
