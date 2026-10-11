// Pure collection-job state machine. The background scheduler persists this
// state after every transition so progress survives popup closure and
// service-worker restarts.
import type { CollectFailureReason } from '../shared/collection';
import type { ResearchMethod } from '../shared/types';

export type JobStatus =
  | 'running'
  /** Paused by the user, or automatically after repeated failures. */
  | 'paused'
  /** Google needs the user (CAPTCHA, consent page, closed tab). */
  | 'awaiting_user'
  /** The service worker restarted mid-job; the user can resume. */
  | 'interrupted'
  | 'completed'
  | 'cancelled';

export const ACTIVE_STATUSES: readonly JobStatus[] = ['running', 'paused', 'awaiting_user', 'interrupted'];
export const RESUMABLE_STATUSES: readonly JobStatus[] = ['paused', 'awaiting_user', 'interrupted'];

export interface JobCounts {
  succeeded: number;
  empty: number;
  failed: number;
  /** Already-completed queries skipped at start. */
  skipped: number;
  keywordsAdded: number;
}

export interface JobState {
  id: string;
  projectId: string;
  projectName: string;
  method: ResearchMethod;
  /** Query record ids to process, in order. */
  queryIds: string[];
  /** Index of the next query to process. */
  cursor: number;
  status: JobStatus;
  message?: string;
  currentQuery?: string;
  counts: JobCounts;
  consecutiveFailures: number;
  delayMs: number;
  tabId?: number;
  startedAt: number;
  updatedAt: number;
}

export const MAX_CONSECUTIVE_FAILURES = 3;
export const MIN_DELAY_MS = 2000;
export const MAX_DELAY_MS = 60000;
export const DEFAULT_DELAY_MS = 4000;

export class JobTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobTransitionError';
  }
}

export const isActive = (job: JobState | null | undefined): boolean => !!job && ACTIVE_STATUSES.includes(job.status);

export interface NewJobInput {
  id: string;
  projectId: string;
  projectName: string;
  method: ResearchMethod;
  queryIds: string[];
  skipped: number;
  delayMs: number;
  now: number;
}

export function clampDelay(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_DELAY_MS;
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, Math.round(ms)));
}

export function createJob(previous: JobState | null | undefined, input: NewJobInput): JobState {
  if (isActive(previous)) {
    throw new JobTransitionError('Another collection job is still active. Finish or cancel it first.');
  }
  const base: JobState = {
    id: input.id,
    projectId: input.projectId,
    projectName: input.projectName,
    method: input.method,
    queryIds: [...input.queryIds],
    cursor: 0,
    status: 'running',
    counts: { succeeded: 0, empty: 0, failed: 0, skipped: input.skipped, keywordsAdded: 0 },
    consecutiveFailures: 0,
    delayMs: clampDelay(input.delayMs),
    startedAt: input.now,
    updatedAt: input.now,
  };
  return input.queryIds.length === 0
    ? { ...base, status: 'completed', message: 'All queries were already completed. Nothing to collect.' }
    : base;
}

function withStatus(job: JobState, status: JobStatus, now: number, message?: string): JobState {
  const next: JobState = { ...job, status, updatedAt: now };
  if (message) next.message = message;
  else delete next.message;
  if (status !== 'running') delete next.currentQuery;
  return next;
}

export function pauseJob(job: JobState, now: number): JobState {
  if (job.status !== 'running') throw new JobTransitionError(`Cannot pause a ${job.status} job.`);
  return withStatus(job, 'paused', now, 'Paused.');
}

export function resumeJob(job: JobState, now: number): JobState {
  if (!RESUMABLE_STATUSES.includes(job.status)) throw new JobTransitionError(`Cannot resume a ${job.status} job.`);
  return { ...withStatus(job, 'running', now), consecutiveFailures: 0 };
}

export function cancelJob(job: JobState, now: number, message = 'Cancelled. Collected keywords were kept.'): JobState {
  if (!isActive(job)) throw new JobTransitionError(`Cannot cancel a ${job.status} job.`);
  return withStatus(job, 'cancelled', now, message);
}

/** Completes a running job whose cursor has reached the end. */
export function completeIfDone(job: JobState, now: number): JobState {
  if (job.status !== 'running' || job.cursor < job.queryIds.length) return job;
  const failedNote = job.counts.failed ? ` ${job.counts.failed} failed: use Retry failed to try them again.` : '';
  return withStatus(job, 'completed', now, `Finished.${failedNote}`);
}

/** Marks a job that was running when the service worker stopped. */
export function interruptJob(job: JobState, now: number): JobState {
  if (job.status !== 'running') return job;
  return withStatus(job, 'interrupted', now, 'Collection stopped unexpectedly (the extension restarted). Resume to continue.');
}

export function requireUser(job: JobState, now: number, message: string): JobState {
  if (!isActive(job)) return job;
  return withStatus(job, 'awaiting_user', now, message);
}

export function setCurrentQuery(job: JobState, query: string, now: number): JobState {
  return { ...job, currentQuery: query, updatedAt: now };
}

export type ProcessedOutcome =
  | { status: 'succeeded'; keywordsAdded: number }
  | { status: 'empty' }
  | { status: 'failed'; reason: CollectFailureReason; message: string };

/** Reasons that mean the query was never really attempted; the job waits for the user instead. */
const NEEDS_USER: readonly CollectFailureReason[] = ['blocked', 'page_unavailable', 'no_search_box'];

export function needsUser(outcome: ProcessedOutcome): boolean {
  return outcome.status === 'failed' && NEEDS_USER.includes(outcome.reason);
}

/**
 * Applies the outcome of the query at `cursor`. Outcomes that need the user do
 * not advance the cursor, so the same query is retried on resume.
 * The status only changes if the job is still running (a pause or cancel
 * requested during an in-flight query is kept).
 */
export function applyQueryOutcome(job: JobState, outcome: ProcessedOutcome, now: number): JobState {
  if (needsUser(outcome) && outcome.status === 'failed') {
    return job.status === 'running' ? requireUser(job, now, outcome.message) : job;
  }
  const counts = { ...job.counts };
  let consecutiveFailures = 0;
  if (outcome.status === 'succeeded') {
    counts.succeeded++;
    counts.keywordsAdded += outcome.keywordsAdded;
  } else if (outcome.status === 'empty') {
    counts.empty++;
  } else {
    counts.failed++;
    consecutiveFailures = job.consecutiveFailures + 1;
  }
  let next: JobState = { ...job, counts, consecutiveFailures, cursor: job.cursor + 1, updatedAt: now };
  delete next.currentQuery;
  if (next.status !== 'running') return next;

  if (next.cursor >= next.queryIds.length) {
    next = completeIfDone(next, now);
  } else if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    const reason = outcome.status === 'failed' ? ` Last error: ${outcome.message}` : '';
    next = withStatus(next, 'paused', now, `Paused after ${consecutiveFailures} failed queries in a row.${reason}`);
  }
  return next;
}

export function remainingQueries(job: JobState): number {
  return Math.max(0, job.queryIds.length - job.cursor);
}
