// Types shared by local storage change tracking and the cloud sync engine.
import type { KeywordRecord, Project, QueryRecord } from '../shared/types';

export type SyncKind = 'project' | 'query' | 'keyword';

export const SYNC_KINDS: readonly SyncKind[] = ['project', 'query', 'keyword'];

/** A local change waiting to be pushed. One entry per record; newer changes replace older ones. */
export interface OutboxEntry {
  /** `${kind}:${id}` */
  key: string;
  kind: SyncKind;
  id: string;
  projectId: string;
  op: 'put' | 'delete';
  /** Changes on every write, so an entry rewritten during a push is not acknowledged by mistake. */
  rev: string;
}

export type SyncRecord = Project | QueryRecord | KeywordRecord;

/** A row as stored in the cloud (see db/schema.sql). */
export interface RemoteRow {
  id: string;
  project_id?: string;
  data: SyncRecord | null;
  deleted: boolean;
  updated_at: string;
}

/** Local side of sync, implemented by IndexedDbStorage. */
export interface SyncStore {
  readOutbox(limit: number): Promise<OutboxEntry[]>;
  outboxSize(): Promise<number>;
  /** Current local version of each entry's record (undefined if it no longer exists). */
  getRecords(entries: readonly OutboxEntry[]): Promise<(SyncRecord | undefined)[]>;
  /** Removes entries that have not been rewritten since they were read. */
  ackOutbox(entries: readonly OutboxEntry[]): Promise<void>;
  /**
   * Applies pulled rows without queueing them for upload. Rows with pending local
   * changes are skipped. Resolves true if any local data actually changed.
   */
  applyRemote(kind: SyncKind, rows: readonly RemoteRow[]): Promise<boolean>;
  /** Queues every local record for upload (first sign-in with existing local data). */
  markAllForUpload(): Promise<number>;
  hasLocalData(): Promise<boolean>;
  /** Deletes all local projects, queries, keywords, and pending changes. */
  wipeAll(): Promise<void>;
}
