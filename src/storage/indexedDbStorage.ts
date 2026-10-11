import type { KeywordRecord, NewProjectInput, Project, ProjectPatch, QueryRecord, ResearchMethod } from '../shared/types';
import { keywordId, mergeSuggestion, normalizeKey } from '../core/keywords';
import type { GeneratedQuery } from '../core/queryGeneration';
import { NotFoundError, StorageError, type QueryOutcome, type RecordOutcomeResult, type StorageService } from './StorageService';
import {
  applyOutcome,
  applyProjectPatch,
  buildProject,
  buildQueryRecord,
  checkOutcome,
  countStatuses,
  queryId,
  sortQueries,
} from './shared';

export const DB_NAME = 'nichespark';
export const DB_VERSION = 1;

type StoreName = 'projects' | 'queries' | 'keywords';

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
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(new StorageError('Could not open the NicheSpark database.', { cause: open.error }));
    open.onblocked = () => reject(new StorageError('The NicheSpark database is blocked by another open extension page. Close other NicheSpark tabs and try again.'));
  });
}

/** IndexedDB-backed StorageService (shared by the service worker, popup, and dashboard). */
export class IndexedDbStorage implements StorageService {
  private dbPromise: Promise<IDBDatabase> | undefined;

  constructor(
    private readonly factory: IDBFactory = indexedDB,
    private readonly dbName = DB_NAME,
    private readonly now: () => number = Date.now,
  ) {}

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
    await this.run(['projects'], 'readwrite', (tx) => request(tx.objectStore('projects').add(project)));
    return project;
  }

  updateProject(id: string, patch: ProjectPatch) {
    return this.run(['projects'], 'readwrite', async (tx) => {
      const next = applyProjectPatch(await this.getProjectIn(tx, id), patch, this.now());
      await request(tx.objectStore('projects').put(next));
      return next;
    });
  }

  deleteProject(id: string) {
    return this.run(['projects', 'queries', 'keywords'], 'readwrite', async (tx) => {
      await this.getProjectIn(tx, id);
      for (const store of ['queries', 'keywords'] as const) {
        const keys = await request(tx.objectStore(store).index('projectId').getAllKeys(id));
        for (const key of keys) await request(tx.objectStore(store).delete(key));
      }
      await request(tx.objectStore('projects').delete(id));
    });
  }

  addQueries(projectId: string, queries: readonly GeneratedQuery[]) {
    return this.run(['projects', 'queries'], 'readwrite', async (tx) => {
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
    return this.run(['queries'], 'readwrite', async (tx) => {
      const all = await this.byProject<QueryRecord>(tx, 'queries', projectId);
      let n = 0;
      for (const q of all) {
        if (q.status === 'failed' && (!method || q.method === method)) {
          await request(tx.objectStore('queries').put({ ...q, status: 'pending' }));
          n++;
        }
      }
      return n;
    });
  }

  async recordQueryOutcome(projectId: string, id: string, outcome: QueryOutcome): Promise<RecordOutcomeResult> {
    const suggestions = checkOutcome(outcome);
    return this.run(['projects', 'queries', 'keywords'], 'readwrite', async (tx) => {
      await this.getProjectIn(tx, projectId);
      const query = await request<QueryRecord | undefined>(tx.objectStore('queries').get(id));
      if (!query || query.projectId !== projectId) throw new NotFoundError(`Query ${id}`);
      const keywords = tx.objectStore('keywords');
      let added = 0;
      let updated = 0;
      for (const s of suggestions) {
        const existing = await request<KeywordRecord | undefined>(keywords.get(keywordId(projectId, normalizeKey(s))));
        await request(keywords.put(mergeSuggestion(existing, projectId, s, { query: query.text, method: query.method }, outcome.at)));
        if (existing) updated++;
        else added++;
      }
      const next = applyOutcome(query, outcome, suggestions.length);
      await request(tx.objectStore('queries').put(next));
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

  deleteKeywords(projectId: string, ids: readonly string[]) {
    return this.run(['projects', 'keywords'], 'readwrite', async (tx) => {
      let n = 0;
      for (const id of ids) {
        const kw = await request<KeywordRecord | undefined>(tx.objectStore('keywords').get(id));
        if (kw?.projectId === projectId) {
          await request(tx.objectStore('keywords').delete(id));
          n++;
        }
      }
      if (n) await this.touch(tx, projectId);
      return n;
    });
  }
}
