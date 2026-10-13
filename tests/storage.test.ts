// Contract tests run against both StorageService implementations.
// IndexedDB is provided by fake-indexeddb (an in-process mock), not a real browser.
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateAzQueries, generateSuffixQueries, ValidationError } from '../src/core/queryGeneration';
import { IndexedDbStorage, openDatabase } from '../src/storage/indexedDbStorage';
import { MemoryStorage } from '../src/storage/memoryStorage';
import { NotFoundError, StorageError, type StorageService } from '../src/storage/StorageService';

/** The 26 letter queries ("seed a" … "seed z"), without the two seed queries A to Z now starts with. */
const azLetters = (seed: string) => generateAzQueries(seed).filter((q) => / [a-z]$/.test(q.text));

let clock = 1_000;
const now = () => ++clock;

const implementations: Array<[string, () => StorageService]> = [
  ['MemoryStorage', () => new MemoryStorage(now)],
  ['IndexedDbStorage', () => new IndexedDbStorage(new IDBFactory(), 'test-db', now)],
];

describe.each(implementations)('%s', (_name, make) => {
  let s: StorageService;
  beforeEach(() => {
    s = make();
  });

  describe('projects', () => {
    it('creates with defaults and normalized fields', async () => {
      const p = await s.createProject({ name: '  Detailing ', seed: ' mobile   car detailing ' });
      expect(p).toMatchObject({
        name: 'Detailing',
        seed: 'mobile car detailing',
        googleDomain: 'www.google.com',
        language: 'en',
        prefixes: ['best', 'cheap', 'top', 'affordable'],
        suffixes: ['near me', 'cost', 'price', 'reviews', 'for beginners'],
        templates: ['how much does {seed} cost', 'is {seed} worth it', '{seed} for {letter}'],
      });
      expect(p.id).toBeTruthy();
      expect(await s.getProject(p.id)).toEqual(p);
    });

    it('validates input', async () => {
      await expect(s.createProject({ name: '', seed: 'x' })).rejects.toThrow(ValidationError);
      await expect(s.createProject({ name: 'n', seed: ' ' })).rejects.toThrow(ValidationError);
      await expect(s.createProject({ name: 'n', seed: 's', googleDomain: 'evil.example' })).rejects.toThrow(ValidationError);
      await expect(s.createProject({ name: 'n', seed: 's', templates: ['no seed'] })).rejects.toThrow(ValidationError);
      expect(await s.listProjects()).toEqual([]);
    });

    it('lists most recently updated first and reopens projects', async () => {
      const a = await s.createProject({ name: 'A', seed: 'a' });
      const b = await s.createProject({ name: 'B', seed: 'b' });
      expect((await s.listProjects()).map((p) => p.name)).toEqual(['B', 'A']);
      await s.updateProject(a.id, { name: 'A2' });
      expect((await s.listProjects()).map((p) => p.name)).toEqual(['A2', 'B']);
      expect((await s.getProject(b.id))?.name).toBe('B');
    });

    it('renames and updates lists with cleaning', async () => {
      const p = await s.createProject({ name: 'A', seed: 'a' });
      const u = await s.updateProject(p.id, { name: 'Renamed', suffixes: ['cost', 'COST', ' near me '] });
      expect(u.name).toBe('Renamed');
      expect(u.suffixes).toEqual(['cost', 'near me']);
      expect(u.updatedAt).toBeGreaterThan(p.updatedAt);
      expect(u.createdAt).toBe(p.createdAt);
    });

    it('throws NotFoundError for unknown projects', async () => {
      await expect(s.updateProject('missing', { name: 'x' })).rejects.toThrow(NotFoundError);
      await expect(s.deleteProject('missing')).rejects.toThrow(NotFoundError);
      await expect(s.addQueries('missing', [])).rejects.toThrow(NotFoundError);
    });

    it('deletes a project with its queries and keywords only', async () => {
      const a = await s.createProject({ name: 'A', seed: 'a' });
      const b = await s.createProject({ name: 'B', seed: 'b' });
      const [qa] = await s.addQueries(a.id, azLetters('a').slice(0, 1));
      const [qb] = await s.addQueries(b.id, azLetters('b').slice(0, 1));
      await s.recordQueryOutcome(a.id, qa!.id, { status: 'succeeded', suggestions: ['shared kw'], at: 5 });
      await s.recordQueryOutcome(b.id, qb!.id, { status: 'succeeded', suggestions: ['shared kw'], at: 5 });
      await s.deleteProject(a.id);
      expect(await s.getProject(a.id)).toBeUndefined();
      expect(await s.listQueries(a.id)).toEqual([]);
      expect(await s.listKeywords(a.id)).toEqual([]);
      expect(await s.listKeywords(b.id)).toHaveLength(1);
      expect(await s.listQueries(b.id)).toHaveLength(1);
    });
  });

  describe('queries', () => {
    it('adds queries as pending in generation order', async () => {
      const p = await s.createProject({ name: 'A', seed: 'seed' });
      await s.addQueries(p.id, azLetters('seed'));
      const list = await s.listQueries(p.id);
      expect(list).toHaveLength(26);
      expect(list[0]).toMatchObject({ text: 'seed a', method: 'az', status: 'pending', attempts: 0, position: 0 });
      expect(list.map((q) => q.text)).toEqual(azLetters('seed').map((q) => q.text));
      expect(await s.countQueries(p.id)).toEqual({ total: 26, pending: 26, succeeded: 0, empty: 0, failed: 0 });
    });

    it('does not reset existing queries when re-added (skip completed)', async () => {
      const p = await s.createProject({ name: 'A', seed: 'seed' });
      const [first] = await s.addQueries(p.id, azLetters('seed'));
      await s.recordQueryOutcome(p.id, first!.id, { status: 'succeeded', suggestions: ['seed apple'], at: 10 });
      const again = await s.addQueries(p.id, azLetters('seed'));
      expect(again[0]?.status).toBe('succeeded');
      expect(await s.listQueries(p.id)).toHaveLength(26);
    });

    it('filters by method and keeps the same text separate per method', async () => {
      const p = await s.createProject({ name: 'A', seed: 'seed' });
      await s.addQueries(p.id, generateSuffixQueries('seed', ['a', 'cost']));
      await s.addQueries(p.id, azLetters('seed'));
      expect(await s.listQueries(p.id, 'suffix')).toHaveLength(2);
      expect(await s.listQueries(p.id, 'az')).toHaveLength(26);
    });

    it('records failed and empty outcomes honestly and can reset failures', async () => {
      const p = await s.createProject({ name: 'A', seed: 'seed' });
      const [q1, q2, q3] = await s.addQueries(p.id, azLetters('seed'));
      await s.recordQueryOutcome(p.id, q1!.id, { status: 'failed', suggestions: [], error: 'Timed out', at: 1 });
      await s.recordQueryOutcome(p.id, q2!.id, { status: 'empty', suggestions: [], at: 2 });
      await s.recordQueryOutcome(p.id, q3!.id, { status: 'succeeded', suggestions: ['seed c1', 'seed c2'], at: 3 });
      expect(await s.countQueries(p.id)).toEqual({ total: 26, pending: 23, succeeded: 1, empty: 1, failed: 1 });
      const failed = (await s.listQueries(p.id)).find((q) => q.id === q1!.id)!;
      expect(failed).toMatchObject({ status: 'failed', lastError: 'Timed out', attempts: 1 });
      expect(await s.listKeywords(p.id)).toHaveLength(2);

      expect(await s.resetFailedQueries(p.id)).toBe(1);
      const reset = (await s.listQueries(p.id)).find((q) => q.id === q1!.id)!;
      expect(reset.status).toBe('pending');
      expect(reset.attempts).toBe(1);

      await s.recordQueryOutcome(p.id, q1!.id, { status: 'succeeded', suggestions: ['seed a1'], at: 4 });
      const retried = (await s.listQueries(p.id)).find((q) => q.id === q1!.id)!;
      expect(retried.lastError).toBeUndefined();
      expect(retried.attempts).toBe(2);
    });

    it('rejects inconsistent outcomes without changing data', async () => {
      const p = await s.createProject({ name: 'A', seed: 'seed' });
      const [q] = await s.addQueries(p.id, azLetters('seed'));
      await expect(s.recordQueryOutcome(p.id, q!.id, { status: 'succeeded', suggestions: [' '], at: 1 })).rejects.toThrow(ValidationError);
      await expect(s.recordQueryOutcome(p.id, q!.id, { status: 'empty', suggestions: ['x'], at: 1 })).rejects.toThrow(ValidationError);
      await expect(s.recordQueryOutcome(p.id, q!.id, { status: 'failed', suggestions: [], at: 1 })).rejects.toThrow(ValidationError);
      await expect(s.recordQueryOutcome(p.id, 'nope', { status: 'empty', suggestions: [], at: 1 })).rejects.toThrow(NotFoundError);
      expect((await s.countQueries(p.id)).pending).toBe(26);
      expect(await s.listKeywords(p.id)).toEqual([]);
    });

    it('does not record a query against another project', async () => {
      const a = await s.createProject({ name: 'A', seed: 'a' });
      const b = await s.createProject({ name: 'B', seed: 'b' });
      const [q] = await s.addQueries(a.id, azLetters('a'));
      await expect(s.recordQueryOutcome(b.id, q!.id, { status: 'empty', suggestions: [], at: 1 })).rejects.toThrow(NotFoundError);
    });
  });

  describe('keywords', () => {
    it('deduplicates across queries and preserves source relationships', async () => {
      const p = await s.createProject({ name: 'A', seed: 'car detailing' });
      const [az] = await s.addQueries(p.id, azLetters('car detailing').slice(13, 14)); // "car detailing n"
      const [sx] = await s.addQueries(p.id, generateSuffixQueries('car detailing', ['near']));
      const r1 = await s.recordQueryOutcome(p.id, az!.id, {
        status: 'succeeded',
        suggestions: ['Car Detailing Near Me', 'car detailing nyc', 'car detailing near me'],
        at: 100,
      });
      expect(r1).toMatchObject({ keywordsAdded: 2, keywordsUpdated: 0 });
      expect(r1.query.suggestionCount).toBe(2);

      const r2 = await s.recordQueryOutcome(p.id, sx!.id, {
        status: 'succeeded',
        suggestions: ['  car   detailing NEAR me ', 'car detailing near me open now'],
        at: 200,
      });
      expect(r2).toMatchObject({ keywordsAdded: 1, keywordsUpdated: 1 });

      const kws = await s.listKeywords(p.id);
      expect(kws).toHaveLength(3);
      const nearMe = kws.find((k) => k.key === 'car detailing near me')!;
      expect(nearMe).toMatchObject({
        text: 'Car Detailing Near Me',
        sourceQueries: ['car detailing n', 'car detailing near'],
        methods: ['az', 'suffix'],
        firstCollectedAt: 100,
        lastCollectedAt: 200,
        collectionCount: 2,
      });
      expect(await s.countKeywords(p.id)).toBe(3);
    });

    it('keeps keyword collections separate per project', async () => {
      const a = await s.createProject({ name: 'A', seed: 'x' });
      const b = await s.createProject({ name: 'B', seed: 'x' });
      const [qa] = await s.addQueries(a.id, azLetters('x'));
      await s.recordQueryOutcome(a.id, qa!.id, { status: 'succeeded', suggestions: ['x a'], at: 1 });
      expect(await s.listKeywords(b.id)).toEqual([]);
    });

    it('deletes selected keywords only within the project', async () => {
      const a = await s.createProject({ name: 'A', seed: 'x' });
      const b = await s.createProject({ name: 'B', seed: 'y' });
      const [qa] = await s.addQueries(a.id, azLetters('x'));
      const [qb] = await s.addQueries(b.id, azLetters('y'));
      await s.recordQueryOutcome(a.id, qa!.id, { status: 'succeeded', suggestions: ['k1', 'k2'], at: 1 });
      await s.recordQueryOutcome(b.id, qb!.id, { status: 'succeeded', suggestions: ['k3'], at: 1 });
      const [k3] = await s.listKeywords(b.id);
      const deleted = await s.deleteKeywords(a.id, [`${a.id}:k1`, k3!.id, 'missing']);
      expect(deleted).toBe(1);
      expect((await s.listKeywords(a.id)).map((k) => k.key)).toEqual(['k2']);
      expect(await s.listKeywords(b.id)).toHaveLength(1);
    });
  });
});

describe('IndexedDbStorage persistence and errors', () => {
  it('persists data across instances sharing a database', async () => {
    const factory = new IDBFactory();
    const first = new IndexedDbStorage(factory, 'persist');
    const p = await first.createProject({ name: 'A', seed: 'seed' });
    const [q] = await first.addQueries(p.id, azLetters('seed'));
    await first.recordQueryOutcome(p.id, q!.id, { status: 'succeeded', suggestions: ['seed apple'], at: 1 });

    const second = new IndexedDbStorage(factory, 'persist');
    expect((await second.getProject(p.id))?.seed).toBe('seed');
    expect(await second.countKeywords(p.id)).toBe(1);
    expect((await second.countQueries(p.id)).succeeded).toBe(1);
  });

  it('wraps database open failures in StorageError and retries later', async () => {
    const real = new IDBFactory();
    let fail = true;
    const flaky = {
      open: (name: string, version?: number) => {
        if (fail) throw new Error('disk unavailable');
        return real.open(name, version);
      },
    } as unknown as IDBFactory;
    const s = new IndexedDbStorage(flaky, 'flaky');
    await expect(s.listProjects()).rejects.toThrow(StorageError);
    fail = false;
    await expect(s.listProjects()).resolves.toEqual([]);
  });

  it('reports open request errors as StorageError', async () => {
    const failing = {
      open: () => {
        const req = {} as IDBOpenDBRequest & { error: DOMException };
        queueMicrotask(() => {
          Object.defineProperty(req, 'error', { value: new DOMException('quota', 'QuotaExceededError') });
          req.onerror?.(new Event('error') as never);
        });
        return req;
      },
    } as unknown as IDBFactory;
    await expect(openDatabase(failing, 'x')).rejects.toBeInstanceOf(StorageError);
  });

  it('rolls back the whole outcome when a write fails mid-transaction', async () => {
    const factory = new IDBFactory();
    const s = new IndexedDbStorage(factory, 'rollback');
    const p = await s.createProject({ name: 'A', seed: 'seed' });
    const [q] = await s.addQueries(p.id, azLetters('seed'));
    // Delete the project from under the storage service so touch() fails at the end of the transaction.
    const db = await openDatabase(factory, 'rollback');
    await new Promise<void>((resolve) => {
      const tx = db.transaction('projects', 'readwrite');
      tx.objectStore('projects').delete(p.id);
      tx.oncomplete = () => resolve();
    });
    await expect(s.recordQueryOutcome(p.id, q!.id, { status: 'succeeded', suggestions: ['k'], at: 1 })).rejects.toThrow(NotFoundError);
    expect(await s.listKeywords(p.id)).toEqual([]);
    expect((await s.listQueries(p.id))[0]?.status).toBe('pending');
    db.close();
  });
});
