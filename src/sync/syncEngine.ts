// Two-way sync between local IndexedDB and the cloud tables.
//
// Push: every local change is recorded in the outbox in the same transaction as
// the change itself; push uploads the current version of each changed record
// (or a tombstone for deletions) and then acknowledges the outbox entries.
// Pull: downloads rows changed since the last pull, per table, and applies them
// locally. A record with an unpushed local change keeps the local version.
// Conflicts between devices resolve as "last upload wins" per record.
import type { CloudApi, PullCursor, UpsertRow } from './cloudApi';
import { SYNC_KINDS, type OutboxEntry, type SyncKind, type SyncStore } from './types';

export interface SyncCursors {
  project: string | null;
  query: string | null;
  keyword: string | null;
}

export interface SyncStateStore {
  load(): Promise<SyncCursors>;
  save(cursors: SyncCursors): Promise<void>;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  /** Whether pulled rows changed local data (rather than echoing this device's own uploads). */
  changed: boolean;
}

export const PUSH_BATCH = 500;
export const PULL_PAGE = 1000;
/** Re-read a little before the last cursor, to cover writes that committed out of timestamp order. */
export const PULL_OVERLAP_MS = 60_000;
const MAX_PUSH_ROUNDS = 1000;

export const EMPTY_CURSORS: SyncCursors = { project: null, query: null, keyword: null };

export class SyncEngine {
  constructor(
    private readonly store: SyncStore,
    private readonly api: CloudApi,
    private readonly state: SyncStateStore,
  ) {}

  async sync(): Promise<SyncResult> {
    const pushed = await this.push();
    const { pulled, changed } = await this.pull();
    return { pushed, pulled, changed };
  }

  async push(): Promise<number> {
    let total = 0;
    for (let round = 0; round < MAX_PUSH_ROUNDS; round++) {
      const entries = await this.store.readOutbox(PUSH_BATCH);
      if (!entries.length) break;
      const records = await this.store.getRecords(entries);
      const rows: Record<SyncKind, UpsertRow[]> = { project: [], query: [], keyword: [] };
      entries.forEach((e, i) => {
        const row = toRow(e, records[i]);
        if (row) rows[e.kind].push(row);
      });
      // Projects first, so a project tombstone's server-side cleanup runs before any stale child arrives.
      for (const kind of SYNC_KINDS) await this.api.upsert(kind, rows[kind]);
      await this.store.ackOutbox(entries);
      total += rows.project.length + rows.query.length + rows.keyword.length;
    }
    return total;
  }

  async pull(): Promise<{ pulled: number; changed: boolean }> {
    const cursors = { ...(await this.state.load()) };
    let total = 0;
    let changed = false;
    for (const kind of SYNC_KINDS) {
      const last = cursors[kind];
      const since = last ? new Date(Date.parse(last) - PULL_OVERLAP_MS).toISOString() : null;
      let after: PullCursor | null = null;
      let newest = last;
      for (;;) {
        const rows = await this.api.pull(kind, since, after, PULL_PAGE);
        if (!rows.length) break;
        if (await this.store.applyRemote(kind, rows)) changed = true;
        total += rows.length;
        const tail = rows[rows.length - 1]!;
        after = { updatedAt: tail.updated_at, id: tail.id };
        if (!newest || Date.parse(tail.updated_at) > Date.parse(newest)) newest = tail.updated_at;
        if (rows.length < PULL_PAGE) break;
      }
      cursors[kind] = newest;
      await this.state.save(cursors);
    }
    return { pulled: total, changed };
  }
}

function toRow(entry: OutboxEntry, record: unknown): UpsertRow | undefined {
  const base = entry.kind === 'project' ? { id: entry.id } : { id: entry.id, project_id: entry.projectId };
  if (entry.op === 'delete') return { ...base, data: null, deleted: true };
  // A "put" whose record is gone was superseded by a deletion (e.g. its project was deleted).
  if (!record) return undefined;
  return { ...base, data: record as UpsertRow['data'], deleted: false };
}
