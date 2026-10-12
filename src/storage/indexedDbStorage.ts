import type { KeywordRecord, NewProjectInput, Project, ProjectPatch, QueryRecord, ResearchMethod } from '../shared/types';
import { keywordId, mergeSuggestion, normalizeKey } from '../core/keywords';
import type { GeneratedQuery } from '../core/queryGeneration';
import type { ProjectBackup } from '../core/backup';
import type { OutboxEntry, RemoteRow, SyncKind, SyncRecord, SyncStore } from '../sync/types';
import { NotFoundError, StorageError, type QueryOutcome, type RecordOutcomeResult, type StorageService } from './StorageService';
import {
  applyOutcome,
  applyProjectPatch,
  buildImportRecords,
  buildProject,
  buildQueryRecord,
  checkOutcome,
  countStatuses,
  newId,
  queryId,
  sortQueries,
} from './shared';

export const DB_NAME = 'nichespark';
/** v2 adds the "outbox" store of changes waiting to be synced. */
export const DB_VERSION = 2;

type StoreName = 'projects' | 'queries' | 'keywords' | 'outbox';

const DATA_STORES = ['projects', 'queries', 'keywords'] as const;
const STORE_OF: Record<SyncKind, 'projects' | 'queries' | 'keywords'> = { project: 'projects', query: 'queries', keyword: 'keywords' };

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function openDatabase(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let open: IDBOpenDBRequest;
    try {
      open = factory.open(name, DB_VERSION);
    } catch (cause) {
      reject(new StorageError('Could not open the NicheSpark database.', { cause }));
      return;
    }
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('queries')) {
        db.createObjectStore('queries', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('keywords')) {
        db.createObjectStore('keywords', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'key' });
    };
    open.onsuccess = () => {
      // Another context upgrading the schema must not be blocked by this connection.
      open.result.onversionchange = () => open.result.close();
      resolve(open.result);
    };
    open.onerror = () => reject(new StorageError('Could not open the NicheSpark database.', { cause: open.error }));
    open.onblocked = () => reject(new StorageError('The NicheSpark database is blocked by another open extension page. Close other NicheSpark tabs and try again.'));
  });
}

/**
 * IndexedDB-backed StorageService (shared by the service worker, popup, and dashboard).
 * Every change is also written to the "outbox" in the same transaction, so the
 * sync engine never misses a change even if the worker stops right after it.
 */
export class IndexedDbStorage implements StorageService, SyncStore {
  private dbPromise: Promise<IDBDatabase> | undefined;
  private changeListener: (() => void) | undefined;

  constructor(
    private readonly factory: IDBFactory = indexedDB,
    private readonly dbName = DB_NAME,
    private readonly now: () => number = Date.now,
  ) {}

  /** Called after any change is committed (used to schedule a sync). */
  setChangeListener(listener: (() => void) | undefined) {
    this.changeListener = listener;
  }

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openDatabase(this.factory, this.dbName).catch((e) => {
      this.dbPromise = undefined; // allow a retry on the next call
      throw e;
    });
    return this.dbPromise;
  }

  /**
   * Runs `fn` inside one transaction and resolves once the transaction commits.
   * `fn` must only await IndexedDB requests, or the transaction auto-commits early.
   */
  private async run<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await this.db();
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (cause) {
      throw new StorageError('Could not start a database transaction.', { cause });
    }
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new StorageError('The database transaction was aborted.', { cause: tx.error }));
      tx.onerror = () => reject(new StorageError('The database transaction failed.', { cause: tx.error }));
    });
    done.catch(() => {}); // observed below; prevents unhandled rejection if fn throws first
    let result: T;
    try {
      result = await fn(tx);
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* already finished */
      }
      throw e;
    }
    await done;
    return result;
  }

  /** A write transaction that also covers the outbox and notifies the change listener. */
  private async write<T>(stores: StoreName[], fn: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const result = await this.run([...stores, 'outbox'], 'readwrite', fn);
    this.changeListener?.();
    return result;
  }

  private mark(tx: IDBTransaction, kind: SyncKind, id: string, projectId: string, op: OutboxEntry['op']) {
    const entry: OutboxEntry = { key: `${kind}:${id}`, kind, id, projectId, op, rev: newId() };
    return request(tx.objectStore('outbox').put(entry));
  }

  private async getProjectIn(tx: IDBTransaction, id: string): Promise<Project> {
    const p = await request<Project | undefined>(tx.objectStore('projects').get(id));
    if (!p) throw new NotFoundError(`Project ${id}`);
    return p;
  }

  private byProject<T>(tx: IDBTransaction, store: 'queries' | 'keywords', projectId: string): Promise<T[]> {
    return request<T[]>(tx.objectStore(store).index('projectId').getAll(projectId));
  }

  private async touch(tx: IDBTransaction, projectId: string) {
    const p = await this.getProjectIn(tx, projectId);
    await request(tx.objectStore('projects').put({ ...p, updatedAt: this.now() }));
    await this.mark(tx, 'project', projectId, projectId, 'put');
  }

  async listProjects() {
    const all = await this.run(['projects'], 'readonly', (tx) => request<Project[]>(tx.objectStore('projects').getAll()));
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getProject(id: string) {
    return this.run(['projects'], 'readonly', (tx) => request<Project | undefined>(tx.objectStore('projects').get(id)));
  }

  async createProject(input: NewProjectInput) {
    const project = buildProject(input, this.now());
    await this.write(['projects'], async (tx) => {
      await request(tx.objectStore('projects').add(project));
      await this.mark(tx, 'project', project.id, project.id, 'put');
    });
    return project;
  }

  updateProject(id: string, patch: ProjectPatch) {
    return this.write(['projects'], async (tx) => {
      const next = applyProjectPatch(await this.getProjectIn(tx, id), patch, this.now());
      await request(tx.objectStore('projects').put(next));
      await this.mark(tx, 'project', id, id, 'put');
      return next;
    });
  }

  deleteProject(id: string) {
    return this.write(['projects', 'queries', 'keywords'], async (tx) => {
      await this.getProjectIn(tx, id);
      for (const store of ['queries', 'keywords'] as const) {
        const keys = await request(tx.objectStore(store).index('projectId').getAllKeys(id));
        for (const key of keys) await request(tx.objectStore(store).delete(key));
      }
      await request(tx.objectStore('projects').delete(id));
      // The server removes the project's queries and keywords when it receives this tombstone.
      await this.mark(tx, 'project', id, id, 'delete');
    });
  }

  addQueries(projectId: string, queries: readonly GeneratedQuery[]) {
    return this.write(['projects', 'queries'], async (tx) => {
      await this.getProjectIn(tx, projectId);
      const store = tx.objectStore('queries');
      let position = await request(store.index('projectId').count(projectId));
      const now = this.now();
      const out: QueryRecord[] = [];
      for (const q of queries) {
        const id = queryId(projectId, q);
        let record = await request<QueryRecord | undefined>(store.get(id));
        if (!record) {
          record = buildQueryRecord(projectId, q, position++, now);
          await request(store.add(record));
          await this.mark(tx, 'query', id, projectId, 'put');
        }
        out.push(record);
      }
      return out;
    });
  }

  async getQuery(projectId: string, id: string) {
    const q = await this.run(['queries'], 'readonly', (tx) => request<QueryRecord | undefined>(tx.objectStore('queries').get(id)));
    return q?.projectId === projectId ? q : undefined;
  }

  async listQueries(projectId: string, method?: ResearchMethod) {
    const all = await this.run(['queries'], 'readonly', (tx) => this.byProject<QueryRecord>(tx, 'queries', projectId));
    return sortQueries(all.filter((q) => !method || q.method === method));
  }

  async countQueries(projectId: string) {
    return countStatuses(await this.listQueries(projectId));
  }

  resetFailedQueries(projectId: string, method?: ResearchMethod) {
    return this.write(['queries'], async (tx) => {
      const all = await this.byProject<QueryRecord>(tx, 'queries', projectId);
      let n = 0;
      for (const q of all) {
        if (q.status === 'failed' && (!method || q.method === method)) {
          await request(tx.objectStore('queries').put({ ...q, status: 'pending' }));
          await this.mark(tx, 'query', q.id, projectId, 'put');
          n++;
        }
      }
      return n;
    });
  }

  async recordQueryOutcome(projectId: string, id: string, outcome: QueryOutcome): Promise<RecordOutcomeResult> {
    const suggestions = checkOutcome(outcome);
    return this.write(['projects', 'queries', 'keywords'], async (tx) => {
      await this.getProjectIn(tx, projectId);
      const query = await request<QueryRecord | undefined>(tx.objectStore('queries').get(id));
      if (!query || query.projectId !== projectId) throw new NotFoundError(`Query ${id}`);
      const keywords = tx.objectStore('keywords');
      let added = 0;
      let updated = 0;
      for (const s of suggestions) {
        const kid = keywordId(projectId, normalizeKey(s));
        const existing = await request<KeywordRecord | undefined>(keywords.get(kid));
        await request(keywords.put(mergeSuggestion(existing, projectId, s, { query: query.text, method: query.method }, outcome.at)));
        await this.mark(tx, 'keyword', kid, projectId, 'put');
        if (existing) updated++;
        else added++;
      }
      const next = applyOutcome(query, outcome, suggestions.length);
      await request(tx.objectStore('queries').put(next));
      await this.mark(tx, 'query', id, projectId, 'put');
      await this.touch(tx, projectId);
      return { query: next, keywordsAdded: added, keywordsUpdated: updated };
    });
  }

  listKeywords(projectId: string) {
    return this.run(['keywords'], 'readonly', (tx) => this.byProject<KeywordRecord>(tx, 'keywords', projectId));
  }

  countKeywords(projectId: string) {
    return this.run(['keywords'], 'readonly', (tx) => request(tx.objectStore('keywords').index('projectId').count(projectId)));
  }

  importProject(backup: ProjectBackup) {
    return this.write(['projects', 'queries', 'keywords'], async (tx) => {
      const existing = await request<Project[]>(tx.objectStore('projects').getAll());
      const { project, queries, keywords } = buildImportRecords(backup, existing.map((p) => p.name), this.now());
      await request(tx.objectStore('projects').add(project));
      await this.mark(tx, 'project', project.id, project.id, 'put');
      // add() (not put) so an id clash fails the whole transaction instead of overwriting
      for (const q of queries) {
        await request(tx.objectStore('queries').add(q));
        await this.mark(tx, 'query', q.id, project.id, 'put');
      }
      for (const k of keywords) {
        await request(tx.objectStore('keywords').add(k));
        await this.mark(tx, 'keyword', k.id, project.id, 'put');
      }
      return project;
    });
  }

  deleteKeywords(projectId: string, ids: readonly string[]) {
    return this.write(['projects', 'keywords'], async (tx) => {
      let n = 0;
      for (const id of ids) {
        const kw = await request<KeywordRecord | undefined>(tx.objectStore('keywords').get(id));
        if (kw?.projectId === projectId) {
          await request(tx.objectStore('keywords').delete(id));
          await this.mark(tx, 'keyword', id, projectId, 'delete');
          n++;
        }
      }
      if (n) await this.touch(tx, projectId);
      return n;
    });
  }

  // ---- SyncStore ----

  readOutbox(limit: number) {
    return this.run(['outbox'], 'readonly', (tx) => request<OutboxEntry[]>(tx.objectStore('outbox').getAll(null, limit)));
  }

  outboxSize() {
    return this.run(['outbox'], 'readonly', (tx) => request(tx.objectStore('outbox').count()));
  }

  getRecords(entries: readonly OutboxEntry[]) {
    return this.run([...DATA_STORES], 'readonly', async (tx) => {
      const out: (SyncRecord | undefined)[] = [];
      for (const e of entries) out.push(await request<SyncRecord | undefined>(tx.objectStore(STORE_OF[e.kind]).get(e.id)));
      return out;
    });
  }

  ackOutbox(entries: readonly OutboxEntry[]) {
    return this.run(['outbox'], 'readwrite', async (tx) => {
      const store = tx.objectStore('outbox');
      for (const e of entries) {
        const current = await request<OutboxEntry | undefined>(store.get(e.key));
        if (current?.rev === e.rev) await request(store.delete(e.key));
      }
    });
  }

  async applyRemote(kind: SyncKind, rows: readonly RemoteRow[]): Promise<boolean> {
    if (!rows.length) return false;
    let changed = false;
    await this.run([...DATA_STORES, 'outbox'], 'readwrite', async (tx) => {
      const outbox = tx.objectStore('outbox');
      const store = tx.objectStore(STORE_OF[kind]);
      for (const row of rows) {
        // A pending local change wins; it is pushed on the next sync.
        if (await request(outbox.getKey(`${kind}:${row.id}`))) continue;
        if (kind === 'project') {
          if (row.deleted) {
            if (!(await request(store.getKey(row.id)))) continue;
            for (const child of ['queries', 'keywords'] as const) {
              const keys = await request(tx.objectStore(child).index('projectId').getAllKeys(row.id));
              for (const key of keys) await request(tx.objectStore(child).delete(key));
            }
            await request(store.delete(row.id));
            changed = true;
          } else {
            if (!isRecordFor(row, 'project')) continue;
            if (await this.putIfDifferent(store, row.data)) changed = true;
          }
          continue;
        }
        if (row.deleted) {
          if (await request(store.getKey(row.id))) {
            await request(store.delete(row.id));
            changed = true;
          }
          continue;
        }
        if (!isRecordFor(row, kind)) continue;
        // Skip children of projects this device does not have (e.g. deleted here, pending push).
        if (!(await request(tx.objectStore('projects').getKey((row.data as QueryRecord | KeywordRecord).projectId)))) continue;
        if (await this.putIfDifferent(store, row.data)) changed = true;
      }
    });
    return changed;
  }

  /** Writes a pulled record unless the local copy is identical (our own pushes come back on pull). */
  private async putIfDifferent(store: IDBObjectStore, record: SyncRecord): Promise<boolean> {
    const existing = await request<SyncRecord | undefined>(store.get(record.id));
    if (existing && stableJson(existing) === stableJson(record)) return false;
    await request(store.put(record));
    return true;
  }


  markAllForUpload() {
    return this.run([...DATA_STORES, 'outbox'], 'readwrite', async (tx) => {
      let n = 0;
      const projects = await request<Project[]>(tx.objectStore('projects').getAll());
      for (const p of projects) {
        await this.mark(tx, 'project', p.id, p.id, 'put');
        n++;
      }
      for (const [store, kind] of [['queries', 'query'], ['keywords', 'keyword']] as const) {
        const records = await request<(QueryRecord | KeywordRecord)[]>(tx.objectStore(store).getAll());
        for (const r of records) {
          await this.mark(tx, kind, r.id, r.projectId, 'put');
          n++;
        }
      }
      return n;
    });
  }

  hasLocalData() {
    return this.run(['projects'], 'readonly', async (tx) => (await request(tx.objectStore('projects').count())) > 0);
  }

  wipeAll() {
    return this.run([...DATA_STORES, 'outbox'], 'readwrite', async (tx) => {
      for (const store of [...DATA_STORES, 'outbox'] as const) await request(tx.objectStore(store).clear());
    });
  }
}

/** JSON with sorted keys (Postgres jsonb does not keep key order). */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** Basic shape check for a pulled record, so a malformed row cannot corrupt local data. */
function isRecordFor(row: RemoteRow, kind: SyncKind): row is RemoteRow & { data: SyncRecord } {
  const d = row.data as unknown as Record<string, unknown> | null;
  if (!d || typeof d !== 'object' || d.id !== row.id) return false;
  if (kind === 'project') return typeof d.name === 'string' && typeof d.seed === 'string' && Array.isArray(d.prefixes);
  if (typeof d.projectId !== 'string' || (row.project_id !== undefined && d.projectId !== row.project_id)) return false;
  if (kind === 'query') return typeof d.text === 'string' && typeof d.method === 'string' && typeof d.status === 'string';
  return typeof d.text === 'string' && typeof d.key === 'string' && Array.isArray(d.sourceQueries);
}
