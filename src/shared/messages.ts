// Typed runtime messages between extension contexts.
import type { JobState } from '../core/collectionState';
import type { AccountUser } from './cloud';
import type { ResearchMethod } from './types';

export type ContentRequest = { type: 'content/ping' } | { type: 'content/collect'; query: string };

export interface ContentPingResponse {
  ok: true;
  host: string;
  /** Whether a Google search box was found on the page. */
  searchBoxFound: boolean;
}

export type BackgroundRequest =
  | { type: 'job/get' }
  | {
      type: 'job/start';
      projectId: string;
      method: ResearchMethod;
      startLetter?: string;
      selectedKeys?: string[];
      recollect?: boolean;
      delayMs?: number;
    }
  | { type: 'job/retryFailed'; projectId: string; method: ResearchMethod; delayMs?: number }
  | { type: 'job/pause' }
  | { type: 'job/resume' }
  | { type: 'job/cancel' };

export type BackgroundResponse = { ok: true; job: JobState | null } | { ok: false; error: string };

/** Account and sync commands from extension pages to the background worker. */
export type AccountRequest =
  | { type: 'auth/get' }
  | { type: 'auth/sign-in'; email: string; password: string }
  | { type: 'auth/sign-up'; email: string; password: string; name: string }
  | { type: 'auth/google' }
  | { type: 'auth/forgot'; email: string }
  | { type: 'auth/sign-out'; force?: boolean }
  | { type: 'sync/request' }
  | { type: 'sync/now' };

export type AccountResponse =
  | { ok: true; user: AccountUser | null }
  | { ok: false; error: string; code?: 'unsynced' };
