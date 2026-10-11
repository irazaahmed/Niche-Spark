// Typed runtime messages between extension contexts.
import type { JobState } from '../core/collectionState';
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
