// Neon Data API (PostgREST) client for the sync tables in db/schema.sql.
import type { RemoteRow, SyncKind, SyncRecord } from './types';

export interface UpsertRow {
  id: string;
  project_id?: string;
  data: SyncRecord | null;
  deleted: boolean;
}

export interface PullCursor {
  updatedAt: string;
  id: string;
}

export interface CloudApi {
  upsert(kind: SyncKind, rows: readonly UpsertRow[]): Promise<void>;
  /** Rows changed at or after `since`, after `after` in (updated_at, id) order. */
  pull(kind: SyncKind, since: string | null, after: PullCursor | null, limit: number): Promise<RemoteRow[]>;
}

export class CloudError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CloudError';
  }
}

const TABLE: Record<SyncKind, string> = { project: 'projects', query: 'queries', keyword: 'keywords' };

/** PostgREST value quoting for use inside or=(...) filters. */
const quote = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export class PostgrestCloudApi implements CloudApi {
  constructor(
    private readonly baseUrl: string,
    /** Returns a valid JWT; `force` asks for a fresh one after a 401. */
    private readonly getToken: (force?: boolean) => Promise<string>,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async call(path: string, init: RequestInit): Promise<Response> {
    let res: Response | undefined;
    for (const force of [false, true]) {
      const token = await this.getToken(force);
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers as Record<string, string>) },
      });
      if (res.status !== 401) break;
    }
    if (!res!.ok) {
      let message = `Sync request failed (${res!.status}).`;
      try {
        const body = (await res!.json()) as { message?: string };
        if (body?.message) message = `Sync request failed: ${body.message}`;
      } catch {
        /* non-JSON error */
      }
      throw new CloudError(message, res!.status);
    }
    return res!;
  }

  async upsert(kind: SyncKind, rows: readonly UpsertRow[]) {
    if (!rows.length) return;
    // Every row must have the same keys for a bulk insert.
    const body = rows.map((r) => (kind === 'project' ? { id: r.id, data: r.data, deleted: r.deleted } : { id: r.id, project_id: r.project_id ?? '', data: r.data, deleted: r.deleted }));
    await this.call(`/${TABLE[kind]}?on_conflict=user_id,id`, {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(body),
    });
  }

  async pull(kind: SyncKind, since: string | null, after: PullCursor | null, limit: number) {
    const params = new URLSearchParams({
      select: kind === 'project' ? 'id,data,deleted,updated_at' : 'id,project_id,data,deleted,updated_at',
      order: 'updated_at.asc,id.asc',
      limit: String(limit),
    });
    if (after) {
      params.set('or', `(updated_at.gt.${quote(after.updatedAt)},and(updated_at.eq.${quote(after.updatedAt)},id.gt.${quote(after.id)}))`);
    } else if (since) {
      params.set('updated_at', `gte.${since}`);
    }
    const res = await this.call(`/${TABLE[kind]}?${params}`, { method: 'GET' });
    return (await res.json()) as RemoteRow[];
  }
}
