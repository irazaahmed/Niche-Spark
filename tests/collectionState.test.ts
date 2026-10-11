import { describe, expect, it } from 'vitest';
import {
  applyQueryOutcome,
  cancelJob,
  clampDelay,
  createJob,
  interruptJob,
  isActive,
  JobTransitionError,
  MAX_CONSECUTIVE_FAILURES,
  pauseJob,
  remainingQueries,
  resumeJob,
  setCurrentQuery,
  type JobState,
} from '../src/core/collectionState';

const input = (n = 3, skipped = 0) => ({
  id: 'job1',
  projectId: 'p1',
  projectName: 'Project',
  method: 'az' as const,
  queryIds: Array.from({ length: n }, (_, i) => `q${i}`),
  skipped,
  delayMs: 4000,
  now: 1,
});

const fail = (reason: 'timeout' | 'blocked' | 'interrupted' | 'page_unavailable' = 'timeout') =>
  ({ status: 'failed', reason, message: `${reason} happened` }) as const;

describe('createJob', () => {
  it('starts running at cursor 0 with skipped count', () => {
    const job = createJob(null, input(3, 2));
    expect(job).toMatchObject({ status: 'running', cursor: 0, counts: { skipped: 2, succeeded: 0 } });
    expect(remainingQueries(job)).toBe(3);
  });

  it('completes immediately when there is nothing to collect', () => {
    expect(createJob(null, input(0, 26)).status).toBe('completed');
  });

  it('refuses to start while another job is active', () => {
    const running = createJob(null, input());
    expect(() => createJob(running, input())).toThrow(JobTransitionError);
    expect(() => createJob(pauseJob(running, 2), input())).toThrow(JobTransitionError);
    expect(() => createJob(interruptJob(running, 2), input())).toThrow(JobTransitionError);
    expect(createJob(cancelJob(running, 2), input()).status).toBe('running');
  });

  it('clamps the delay to a conservative range', () => {
    expect(clampDelay(100)).toBe(2000);
    expect(clampDelay(10 ** 9)).toBe(60000);
    expect(clampDelay(Number.NaN)).toBe(4000);
    expect(createJob(null, { ...input(), delayMs: 0 }).delayMs).toBe(2000);
  });
});

describe('transitions', () => {
  it('pauses, resumes, and cancels', () => {
    const job = createJob(null, input());
    const paused = pauseJob(job, 2);
    expect(paused.status).toBe('paused');
    expect(() => pauseJob(paused, 3)).toThrow(JobTransitionError);
    const resumed = resumeJob(paused, 3);
    expect(resumed.status).toBe('running');
    expect(resumed.message).toBeUndefined();
    const cancelled = cancelJob(resumed, 4);
    expect(cancelled.status).toBe('cancelled');
    expect(isActive(cancelled)).toBe(false);
    expect(() => resumeJob(cancelled, 5)).toThrow(JobTransitionError);
    expect(() => cancelJob(cancelled, 5)).toThrow(JobTransitionError);
  });

  it('marks running jobs interrupted (and leaves others alone)', () => {
    const job = createJob(null, input());
    expect(interruptJob(job, 2).status).toBe('interrupted');
    const paused = pauseJob(job, 2);
    expect(interruptJob(paused, 3)).toBe(paused);
    expect(resumeJob(interruptJob(job, 2), 3).status).toBe('running');
  });

  it('clears the current query when leaving running', () => {
    const job = setCurrentQuery(createJob(null, input()), 'seed a', 2);
    expect(job.currentQuery).toBe('seed a');
    expect(pauseJob(job, 3).currentQuery).toBeUndefined();
  });
});

describe('applyQueryOutcome', () => {
  it('advances and counts each outcome type, then completes', () => {
    let job: JobState = createJob(null, input(3));
    job = applyQueryOutcome(job, { status: 'succeeded', keywordsAdded: 5 }, 2);
    job = applyQueryOutcome(job, { status: 'empty' }, 3);
    job = applyQueryOutcome(job, fail(), 4);
    expect(job.status).toBe('completed');
    expect(job.cursor).toBe(3);
    expect(job.counts).toMatchObject({ succeeded: 1, empty: 1, failed: 1, keywordsAdded: 5 });
    expect(job.message).toMatch(/1 failed/);
  });

  it('pauses after repeated consecutive failures', () => {
    let job: JobState = createJob(null, input(10));
    job = applyQueryOutcome(job, fail(), 2);
    job = applyQueryOutcome(job, { status: 'empty' }, 3); // resets the streak
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) job = applyQueryOutcome(job, fail(), 4 + i);
    expect(job.status).toBe('paused');
    expect(job.message).toMatch(/failed queries in a row/);
    expect(job.cursor).toBe(2 + MAX_CONSECUTIVE_FAILURES);
    expect(resumeJob(job, 99).consecutiveFailures).toBe(0);
  });

  it('waits for the user on blocked pages without advancing or counting', () => {
    const job = createJob(null, input());
    const next = applyQueryOutcome(job, fail('blocked'), 2);
    expect(next.status).toBe('awaiting_user');
    expect(next.cursor).toBe(0);
    expect(next.counts.failed).toBe(0);
    expect(next.message).toBe('blocked happened');
    expect(applyQueryOutcome(job, fail('page_unavailable'), 2).status).toBe('awaiting_user');
  });

  it('records an in-flight result after pause/cancel without changing that status', () => {
    const paused = pauseJob(createJob(null, input(1)), 2);
    const after = applyQueryOutcome(paused, { status: 'succeeded', keywordsAdded: 2 }, 3);
    expect(after.status).toBe('paused');
    expect(after.counts.succeeded).toBe(1);
    expect(after.cursor).toBe(1);

    const cancelled = cancelJob(createJob(null, input()), 2);
    expect(applyQueryOutcome(cancelled, fail(), 3).status).toBe('cancelled');
  });
});
