// Collection scheduler: runs one job at a time, paces queries, persists state
// after every step, and never marks a query complete unless the adapter
// actually captured a result. Browser specifics are injected (see chromeDeps.ts).
import {
  applyQueryOutcome,
  cancelJob,
  completeIfDone,
  createJob,
  DEFAULT_DELAY_MS,
  interruptJob,
  isActive,
  JobTransitionError,
  pauseJob,
  requireUser,
  resumeJob,
  setCurrentQuery,
  type JobState,
  type ProcessedOutcome,
} from '../core/collectionState';
import { generateQueriesForMethod, ValidationError } from '../core/queryGeneration';
import type { CollectResult } from '../shared/collection';
import type { Project, ResearchMethod } from '../shared/types';
import type { StorageService } from '../storage/StorageService';

export class PageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageUnavailableError';
  }
}

export interface GoogleDriver {
  /** Returns a tab showing the project's Google domain, reusing `tabId` when possible. Throws PageUnavailableError. */
  ensureTab(project: Project, tabId: number | undefined): Promise<number>;
  collect(tabId: number, query: string): Promise<CollectResult>;
}

export interface SchedulerDeps {
  storage: StorageService;
  google: GoogleDriver;
  loadJob(): Promise<JobState | null>;
  saveJob(job: JobState): Promise<void>;
  /** Resolves after `ms`, or early when `wake` is called. */
  sleep(ms: number, wake: { onWake?: () => void }): Promise<void>;
  now(): number;
  random(): number;
  newId(): string;
}

export interface StartOptions {
  projectId: string;
  method: ResearchMethod;
  startLetter?: string;
  /** Only collect queries whose normalized key is listed. */
  selectedKeys?: string[];
  /** Re-run queries that already succeeded or were empty. */
  recollect?: boolean;
  delayMs?: number;
}

/** Random extra delay (0–50% of the base) so requests are not perfectly periodic. */
export function pacedDelay(baseMs: number, random: number): number {
  return Math.round(baseMs * (1 + 0.5 * random));
}

export class CollectionScheduler {
  private job: JobState | null = null;
  private loop: Promise<void> | null = null;
  private wake: { onWake?: () => void } = {};
  private ready: Promise<void>;

  constructor(private readonly deps: SchedulerDeps) {
    this.ready = this.init();
  }

  /** A job still "running" in storage means the worker stopped mid-job. */
  private async init() {
    const stored = await this.deps.loadJob();
    if (stored?.status === 'running') {
      this.job = interruptJob(stored, this.deps.now());
      await this.deps.saveJob(this.job);
    } else {
      this.job = stored;
    }
  }

  async getJob(): Promise<JobState | null> {
    await this.ready;
    return this.job;
  }

  async start(options: StartOptions): Promise<JobState> {
    await this.ready;
    if (isActive(this.job)) throw new JobTransitionError('Another collection job is still active. Finish or cancel it first.');
    const { storage } = this.deps;
    const project = await storage.getProject(options.projectId);
    if (!project) throw new ValidationError('Project not found.');

    let queries = generateQueriesForMethod(project, options.method, options.startLetter ? { startLetter: options.startLetter } : {});
    if (options.selectedKeys) {
      const keys = new Set(options.selectedKeys);
      queries = queries.filter((q) => keys.has(q.key));
    }
    if (queries.length === 0) {
      throw new ValidationError(
        options.method === 'az' ? 'There are no queries to collect.' : `Add at least one ${options.method} entry before collecting.`,
      );
    }
    const records = await storage.addQueries(project.id, queries);
    const todo = records.filter((r) => options.recollect || r.status === 'pending' || r.status === 'failed');
    return this.begin(project, options.method, todo.map((r) => r.id), records.length - todo.length, options.delayMs);
  }

  async retryFailed(projectId: string, method: ResearchMethod, delayMs?: number): Promise<JobState> {
    await this.ready;
    if (isActive(this.job)) throw new JobTransitionError('Another collection job is still active. Finish or cancel it first.');
    const project = await this.deps.storage.getProject(projectId);
    if (!project) throw new ValidationError('Project not found.');
    const failed = (await this.deps.storage.listQueries(projectId, method)).filter((q) => q.status === 'failed');
    if (failed.length === 0) throw new ValidationError('There are no failed queries to retry.');
    await this.deps.storage.resetFailedQueries(projectId, method);
    return this.begin(project, method, failed.map((q) => q.id), 0, delayMs);
  }

  private async begin(project: Project, method: ResearchMethod, queryIds: string[], skipped: number, delayMs?: number) {
    const job = createJob(this.job, {
      id: this.deps.newId(),
      projectId: project.id,
      projectName: project.name,
      method,
      queryIds,
      skipped,
      delayMs: delayMs ?? this.job?.delayMs ?? DEFAULT_DELAY_MS,
      now: this.deps.now(),
    });
    // Keep the Google tab from the previous job so it can be reused.
    if (this.job?.tabId !== undefined) job.tabId = this.job.tabId;
    await this.commit(job);
    this.kick();
    return job;
  }

  async pause(): Promise<JobState> {
    return this.transition((job, now) => pauseJob(job, now));
  }

  async resume(): Promise<JobState> {
    const job = await this.transition((j, now) => resumeJob(j, now));
    this.kick();
    return job;
  }

  async cancel(): Promise<JobState> {
    return this.transition((job, now) => cancelJob(job, now));
  }

  /** Resolves when the current run loop (if any) exits. For tests. */
  async idle(): Promise<void> {
    await this.ready;
    while (this.loop) await this.loop;
  }

  private async transition(fn: (job: JobState, now: number) => JobState): Promise<JobState> {
    await this.ready;
    if (!this.job) throw new JobTransitionError('There is no collection job.');
    const next = fn(this.job, this.deps.now());
    await this.commit(next);
    this.wake.onWake?.(); // cut short any delay so pause/cancel take effect promptly
    return next;
  }

  private async commit(job: JobState) {
    this.job = job;
    await this.deps.saveJob(job);
  }

  private kick() {
    if (this.loop) return;
    this.loop = this.run().finally(() => {
      this.loop = null;
    });
  }

  private async run() {
    const { storage, google, now } = this.deps;
    let first = true;
    while (this.job?.status === 'running') {
      const job = this.job;
      if (job.cursor >= job.queryIds.length) {
        // e.g. resumed after the last in-flight query finished while paused
        await this.commit(completeIfDone(job, now()));
        break;
      }

      if (!first) {
        await this.deps.sleep(pacedDelay(job.delayMs, this.deps.random()), this.wake);
        if (this.job?.status !== 'running' || this.job.id !== job.id) break;
      }
      first = false;

      const project = await storage.getProject(job.projectId);
      const queryId = job.queryIds[job.cursor]!;
      const query = project && (await storage.getQuery(project.id, queryId));
      if (!project || !query) {
        await this.commit(cancelJob(this.job, now(), 'The project or its queries were deleted, so collection stopped.'));
        break;
      }

      await this.commit(setCurrentQuery(this.job, query.text, now()));

      let result: CollectResult;
      try {
        const tabId = await google.ensureTab(project, this.job.tabId);
        if (this.job.tabId !== tabId) await this.commit({ ...this.job, tabId });
        result = await google.collect(tabId, query.text);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        result = { status: 'failed', reason: e instanceof PageUnavailableError ? 'page_unavailable' : 'error', message };
      }

      const outcome = await this.persist(project.id, queryId, result);
      if (!outcome) break;
      // Apply to the latest state: the user may have paused or cancelled meanwhile.
      await this.commit(applyQueryOutcome(this.job, outcome, now()));
    }
  }

  /** Saves a real result. Returns null if the job had to stop because saving failed. */
  private async persist(projectId: string, queryId: string, result: CollectResult): Promise<ProcessedOutcome | null> {
    const at = this.deps.now();
    if (result.status === 'failed' && ['blocked', 'page_unavailable', 'no_search_box'].includes(result.reason)) {
      return result; // never attempted for real: query stays pending
    }
    try {
      if (result.status === 'succeeded') {
        const r = await this.deps.storage.recordQueryOutcome(projectId, queryId, { status: 'succeeded', suggestions: result.suggestions, at });
        return { status: 'succeeded', keywordsAdded: r.keywordsAdded };
      }
      if (result.status === 'empty') {
        await this.deps.storage.recordQueryOutcome(projectId, queryId, { status: 'empty', suggestions: [], at });
        return { status: 'empty' };
      }
      await this.deps.storage.recordQueryOutcome(projectId, queryId, { status: 'failed', suggestions: [], error: result.message, at });
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (this.job) await this.commit(requireUser(this.job, this.deps.now(), `Could not save results: ${message}`));
      return null;
    }
  }
}

