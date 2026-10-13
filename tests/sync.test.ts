// Cloud sync tests. IndexedDB is fake-indexeddb and the cloud is an in-memory
// stand-in for the Neon Data API (FakeCloud below); no network is used.
// The real Data API and row-level security were checked separately against Neon.
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateAzQueries } from '../src/core/queryGeneration';
import { IndexedDbStorage, openDatabase } from '../src/storage/indexedDbStorage';
import type { CloudApi, PullCursor, UpsertRow } from '../src/sync/cloudApi';
import { PostgrestCloudApi } from '../src/sync/cloudApi';
import { EMPTY_CURSORS, SyncEngine, type SyncCursors } from '../src/sync/syncEngine';
import type { RemoteRow, SyncKind } from '../src/sync/types';

/** The 26 letter queries ("seed a" … "seed z"), without the two seed queries A to Z now starts with. */
const azLetters = (seed: string) => generateAzQueries(seed).filter((q) => / [a-z]$/.test(q.text));

class FakeCloud implements CloudApi {
  tables: Record<SyncKind, Map<string, RemoteRow>> = { project: new Map(), query: new Map(), keyword: new Map() };
  private clock = Date.parse('2026-10-12T00:00:00Z');
  upserts = 0;
  failNext = false;

  private stamp() {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  async upsert(kind: SyncKind, rows: readonly UpsertRow[]) {
    if (!rows.length) return;
    if (this.failNext) {
      this.failNext = false;
      throw new TypeError('Failed to fetch');
    }
    this.upserts++;
    const at = this.stamp();
    for (const r of rows) {
      this.tables[kind].set(r.id, { id: r.id, ...(kind === 'project' ? {} : { project_id: r.project_id }), data: structuredClone(r.data), deleted: r.deleted, updated_at: at });
      if (kind === 'project' && r.deleted) {
        for (const child of ['query', 'keyword'] as const) {
          for (const [id, row] of this.tables[child]) if (row.project_id === r.id) this.tables[child].delete(id);
        }
      }
    }
  }

  async pull(kind: SyncKind, since: string | null, after: PullCursor | null, limit: number) {
    return [...this.tables[kind].values()]
      .filter((r) =>
        after
          ? r.updated_at > after.updatedAt || (r.updated_at === after.updatedAt && r.id > after.id)
          : !since || r.updated_at >= since,
      )
      .sort((a, b) => (a.updated_at === b.updated_at ? (a.id < b.id ? -1 : 1) : a.updated_at < b.updated_at ? -1 : 1))
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }
}

function device(cloud: CloudApi, name: string) {
  const storage = new IndexedDbStorage(new IDBFactory(), name);
  let cursors: SyncCursors = { ...EMPTY_CURSORS };
  const engine = new SyncEngine(storage, cloud, { load: async () => cursors, save: async (c) => void (cursors = c) });
  return { storage, engine };
}

describe('outbox change tracking', () => {
  let s: IndexedDbStorage;
  beforeEach(() => {
    s = new IndexedDbStorage(new IDBFactory(), 'outbox');
  });

  it('records every kind of change in the same transaction', async () => {
    let notified = 0;
    s.setChangeListener(() => notified++);
    const p = await s.createProject({ name: 'P', seed: 'car wash' });
    const [q] = await s.addQueries(p.id, azLetters('car wash').slice(0, 1));
    await s.recordQueryOutcome(p.id, q!.id, { status: 'succeeded', suggestions: ['car wash near me'], at: 5 });
    const keys = (await s.readOutbox(100)).map((e) => `${e.op}:${e.key}`).sort();
    expect(keys).toEqual([`put:keyword:${p.id}:car wash near me`, `put:project:${p.id}`, `put:query:${q!.id}`].sort());
    expect(notified).toBe(3);

    await s.deleteKeywords(p.id, [`${p.id}:car wash near me`]);
    expect((await s.readOutbox(100)).find((e) => e.kind === 'keyword')?.op).toBe('delete');
  });

  it('acknowledges only entries that were not rewritten during a push', async () => {
    const p = await s.createProject({ name: 'P', seed: 'car wash' });
    const read = await s.readOutbox(10);
    await s.updateProject(p.id, { name: 'Renamed' }); // rewrites the entry with a new rev
    await s.ackOutbox(read);
    expect(await s.outboxSize()).toBe(1);
    await s.ackOutbox(await s.readOutbox(10));
    expect(await s.outboxSize()).toBe(0);
  });

  it('does not leave an outbox entry when a write fails', async () => {
    await expect(s.updateProject('missing', { name: 'x' })).rejects.toThrow();
    expect(await s.outboxSize()).toBe(0);
  });

  it('queues all local data for upload and wipes everything', async () => {
    const p = await s.createProject({ name: 'P', seed: 'car wash' });
    await s.addQueries(p.id, azLetters('car wash').slice(0, 3));
    await s.ackOutbox(await s.readOutbox(100));
    expect(await s.markAllForUpload()).toBe(4);
    expect(await s.hasLocalData()).toBe(true);
    await s.wipeAll();
    expect(await s.hasLocalData()).toBe(false);
    expect(await s.outboxSize()).toBe(0);
    expect(await s.listQueries(p.id)).toEqual([]);
  });

  it('upgrades a version 1 database without losing data', async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const open = factory.open('legacy', 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore('projects', { keyPath: 'id' }).put({ id: 'old', name: 'Old', seed: 'old seed', prefixes: [], suffixes: [], templates: [], googleDomain: 'www.google.com', language: 'en', createdAt: 1, updatedAt: 1 });
        db.createObjectStore('queries', { keyPath: 'id' }).createIndex('projectId', 'projectId');
        db.createObjectStore('keywords', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      };
      open.onsuccess = () => {
        open.result.close();
        resolve();
      };
      open.onerror = () => reject(open.error);
    });
    const upgraded = new IndexedDbStorage(factory, 'legacy');
    expect((await upgraded.listProjects()).map((p) => p.name)).toEqual(['Old']);
    expect(await upgraded.outboxSize()).toBe(0);
    expect(await upgraded.markAllForUpload()).toBe(1);
    const db = await openDatabase(factory, 'legacy');
    expect([...db.objectStoreNames].sort()).toEqual(['keywords', 'outbox', 'projects', 'queries']);
    db.close();
  });
});

describe('SyncEngine between two devices', () => {
  let cloud: FakeCloud;
  let a: ReturnType<typeof device>;
  let b: ReturnType<typeof device>;
  beforeEach(() => {
    cloud = new FakeCloud();
    a = device(cloud, 'device-a');
    b = device(cloud, 'device-b');
  });

  async function collectOne(storage: IndexedDbStorage, suggestions: string[]) {
    const p = await storage.createProject({ name: 'Detailing', seed: 'car detailing' });
    const [q] = await storage.addQueries(p.id, azLetters('car detailing').slice(0, 2));
    await storage.recordQueryOutcome(p.id, q!.id, { status: 'succeeded', suggestions, at: 10 });
    return p;
  }

  it('uploads local changes and downloads them on another device', async () => {
    const p = await collectOne(a.storage, ['car detailing prices', 'car detailing near me']);
    const pushed = await a.engine.sync();
    expect(pushed.pushed).toBe(5); // project, 2 queries, 2 keywords
    expect(await a.storage.outboxSize()).toBe(0);

    const pulled = await b.engine.sync();
    expect(pulled.changed).toBe(true);
    expect(await b.storage.getProject(p.id)).toEqual(await a.storage.getProject(p.id));
    expect(await b.storage.listQueries(p.id)).toEqual(await a.storage.listQueries(p.id));
    expect((await b.storage.listKeywords(p.id)).map((k) => k.text).sort()).toEqual(['car detailing near me', 'car detailing prices']);
    // Pulling must not queue the downloaded rows for upload again.
    expect(await b.storage.outboxSize()).toBe(0);
  });

  it('reports no change when a pull only returns this device’s own uploads', async () => {
    await collectOne(a.storage, ['car detailing prices']);
    await a.engine.sync();
    const again = await a.engine.sync();
    expect(again.changed).toBe(false);
  });

  it('syncs keyword deletions and project deletions', async () => {
    const p = await collectOne(a.storage, ['car detailing prices', 'car detailing near me']);
    await a.engine.sync();
    await b.engine.sync();

    await b.storage.deleteKeywords(p.id, [`${p.id}:car detailing prices`]);
    await b.engine.sync();
    await a.engine.sync();
    expect((await a.storage.listKeywords(p.id)).map((k) => k.text)).toEqual(['car detailing near me']);

    await a.storage.deleteProject(p.id);
    await a.engine.sync();
    expect(cloud.tables.keyword.size).toBe(0); // server removes the project's children
    await b.engine.sync();
    expect(await b.storage.getProject(p.id)).toBeUndefined();
    expect(await b.storage.listKeywords(p.id)).toEqual([]);
    expect(await b.storage.listQueries(p.id)).toEqual([]);
  });

  it('keeps a pending local change instead of the downloaded version', async () => {
    const p = await collectOne(a.storage, ['x y']);
    await a.engine.sync();
    await b.engine.sync();
    await a.storage.updateProject(p.id, { name: 'From A' });
    await a.engine.sync();
    await b.storage.updateProject(p.id, { name: 'From B' });
    await b.engine.pull(); // B has not pushed yet
    expect((await b.storage.getProject(p.id))?.name).toBe('From B');
    await b.engine.sync();
    await a.engine.sync();
    expect((await a.storage.getProject(p.id))?.name).toBe('From B'); // last upload wins
  });

  it('keeps changes queued when the network fails, and sends them later', async () => {
    await collectOne(a.storage, ['car detailing prices']);
    cloud.failNext = true;
    await expect(a.engine.sync()).rejects.toThrow('Failed to fetch');
    expect(await a.storage.outboxSize()).toBeGreaterThan(0);
    await a.engine.sync();
    expect(await a.storage.outboxSize()).toBe(0);
    expect(cloud.tables.keyword.size).toBe(1);
  });

  it('pages through large pulls', async () => {
    const p = await a.storage.createProject({ name: 'Big', seed: 'big seed' });
    const [q] = await a.storage.addQueries(p.id, azLetters('big seed').slice(0, 1));
    const suggestions = Array.from({ length: 1205 }, (_, i) => `big seed ${i}`);
    await a.storage.recordQueryOutcome(p.id, q!.id, { status: 'succeeded', suggestions, at: 10 });
    await a.engine.sync(); // pushes in batches of 500
    expect(cloud.upserts).toBeGreaterThanOrEqual(3);
    await b.engine.sync();
    expect(await b.storage.countKeywords(p.id)).toBe(1205);
  });

  it('ignores malformed rows from the cloud', async () => {
    const p = await collectOne(a.storage, ['ok keyword']);
    await a.engine.sync();
    await b.engine.sync();
    const changed = await b.storage.applyRemote('keyword', [
      { id: `${p.id}:bad`, project_id: p.id, data: { id: 'other' } as never, deleted: false, updated_at: '2030-01-01T00:00:00Z' },
      { id: `${p.id}:orphan`, project_id: 'nope', data: { id: `${p.id}:orphan`, projectId: 'nope', text: 't', key: 't', sourceQueries: [] } as never, deleted: false, updated_at: '2030-01-01T00:00:00Z' },
    ]);
    expect(changed).toBe(false);
    expect((await b.storage.listKeywords(p.id)).map((k) => k.text)).toEqual(['ok keyword']);
  });
});

describe('PostgrestCloudApi', () => {
  it('sends upserts with merge-duplicates and retries once with a fresh token after 401', async () => {
    const calls: { url: string; init: RequestInit; token: string }[] = [];
    const tokens: boolean[] = [];
    const responses = [new Response('{}', { status: 401 }), new Response(null, { status: 201 })];
    const api = new PostgrestCloudApi(
      'https://api.example/rest/v1',
      async (force) => {
        tokens.push(!!force);
        return force ? 'fresh' : 'stale';
      },
      async (url, init) => {
        calls.push({ url: String(url), init: init!, token: (init!.headers as Record<string, string>).authorization! });
        return responses.shift()!;
      },
    );
    await api.upsert('keyword', [{ id: 'p:k', project_id: 'p', data: null, deleted: true }]);
    expect(tokens).toEqual([false, true]);
    expect(calls[1]!.token).toBe('Bearer fresh');
    expect(calls[1]!.url).toBe('https://api.example/rest/v1/keywords?on_conflict=user_id,id');
    expect((calls[1]!.init.headers as Record<string, string>).prefer).toBe('resolution=merge-duplicates,return=minimal');
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual([{ id: 'p:k', project_id: 'p', data: null, deleted: true }]);
  });

  it('builds keyset pull filters with quoted values', async () => {
    let url = '';
    const api = new PostgrestCloudApi('https://api.example/rest/v1', async () => 't', async (u) => {
      url = String(u);
      return new Response('[]', { status: 200 });
    });
    await api.pull('keyword', null, { updatedAt: '2026-10-12T00:00:01+00:00', id: 'p:a "b", (c)' }, 1000);
    const params = new URL(url).searchParams;
    expect(params.get('or')).toBe('(updated_at.gt."2026-10-12T00:00:01+00:00",and(updated_at.eq."2026-10-12T00:00:01+00:00",id.gt."p:a \\"b\\", (c)"))');
    expect(params.get('order')).toBe('updated_at.asc,id.asc');
    await api.pull('project', '2026-10-12T00:00:00.000Z', null, 10);
    expect(new URL(url).searchParams.get('updated_at')).toBe('gte.2026-10-12T00:00:00.000Z');
    expect(new URL(url).searchParams.get('select')).toBe('id,data,deleted,updated_at');
  });

  it('turns HTTP errors into CloudError with the server message', async () => {
    const api = new PostgrestCloudApi('https://api.example/rest/v1', async () => 't', async () =>
      new Response(JSON.stringify({ message: 'permission denied' }), { status: 403 }),
    );
    await expect(api.pull('project', null, null, 1)).rejects.toMatchObject({ name: 'CloudError', status: 403, message: 'Sync request failed: permission denied' });
  });
});
