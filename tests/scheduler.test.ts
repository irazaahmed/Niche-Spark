// Scheduler tests with a fake Google driver and in-memory storage (no browser).
import { beforeEach, describe, expect, it } from 'vitest';
import { CollectionScheduler, PageUnavailableError, pacedDelay, type GoogleDriver, type SchedulerDeps } from '../src/background/scheduler';
import type { JobState } from '../src/core/collectionState';
import { MemoryStorage } from '../src/storage/memoryStorage';
import type { CollectResult } from '../src/shared/collection';

type Responder = (query: string, call: number) => CollectResult | Promise<CollectResult>;

function setup(respond: Responder, stored: JobState | null = null) {
  const storage = new MemoryStorage();
  let saved: JobState | null = stored;
  const history: JobState[] = [];
  const queries: string[] = [];
  const sleeps: number[] = [];
  let calls = 0;
  let id = 0;
  const google: GoogleDriver = {
    ensureTab: async () => 7,
    collect: async (_tab, q) => {
      queries.push(q);
      return respond(q, calls++);
    },
  };
  const deps: SchedulerDeps = {
    storage,
    google,
    loadJob: async () => saved,
    saveJob: async (job) => {
      saved = job;
      history.push(job);
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => 1000 + calls,
    random: () => 0,
    newId: () => `job${++id}`,
  };
  const scheduler = new CollectionScheduler(deps);
  return { scheduler, storage, queries, sleeps, history, get saved() { return saved; } };
}

const ok = (q: string): CollectResult => ({ status: 'succeeded', suggestions: [`${q}1`, `${q}2`] });

describe('CollectionScheduler', () => {
  let env: ReturnType<typeof setup>;

  beforeEach(() => {
    env = setup(ok);
  });

  it('runs A to Z, saves keywords with sources, and completes', async () => {
    const p = await env.storage.createProject({ name: 'P', seed: 'seed' });
    await env.scheduler.start({ projectId: p.id, method: 'az', startLetter: 'x', delayMs: 3000 });
    await env.scheduler.idle();
    expect(env.queries).toEqual(['seed x', 'seed y', 'seed z']);
    expect(env.saved).toMatchObject({ status: 'completed', cursor: 3, counts: { succeeded: 3, keywordsAdded: 6 } });
    expect(env.sleeps).toEqual([3000, 3000]); // paced between queries, not before the first
    const kws = await env.storage.listKeywords(p.id);
    expect(kws.find((k) => k.key === 'seed x1')?.sourceQueries).toEqual(['seed x']);
    expect((await env.storage.countQueries(p.id)).succeeded).toBe(3);
  });

  it('persists progress after every query', async () => {
    const p = await env.storage.createProject({ name: 'P', seed: 's' });
    await env.scheduler.start({ projectId: p.id, method: 'az', startLetter: 'y' });
    await env.scheduler.idle();
    const cursors = env.history.map((h) => h.cursor);
    expect(cursors).toContain(1);
    expect(cursors).toContain(2);
  });

  it('skips already completed queries unless re-collecting', async () => {
    const p = await env.storage.createProject({ name: 'P', seed: 's' });
    await env.scheduler.start({ projectId: p.id, method: 'az', startLetter: 'y' });
    await env.scheduler.idle();
    await env.scheduler.start({ projectId: p.id, method: 'az', startLetter: 'x' });
    await env.scheduler.idle();
    expect(env.queries).toEqual(['s y', 's z', 's x']);
    expect(env.saved?.counts.skipped).toBe(2);
    await env.scheduler.start({ projectId: p.id, method: 'az', startLetter: 'z', recollect: true });
    await env.scheduler.idle();
    expect(env.queries.at(-1)).toBe('s z');
  });

  it('collects only selected queries', async () => {
    const p = await env.storage.createProject({ name: 'P', seed: 's', suffixes: ['cost', 'near me', 'price'] });
    await env.scheduler.start({ projectId: p.id, method: 'suffix', selectedKeys: ['s near me'] });
    await env.scheduler.idle();
    expect(env.queries).toEqual(['s near me']);
  });

  it('rejects starting with no entries or while active', async () => {
    const p = await env.storage.createProject({ name: 'P', seed: 's' });
    await env.storage.updateProject(p.id, { prefixes: [] });
    await expect(env.scheduler.start({ projectId: p.id, method: 'prefix' })).rejects.toThrow(/at least one prefix/);
    let release!: () => void;
    const slow = setup(() => new Promise((r) => (release = () => r({ status: 'empty' }))));
    const p2 = await slow.storage.createProject({ name: 'P', seed: 's' });
    await slow.scheduler.start({ projectId: p2.id, method: 'az' });
    await expect(slow.scheduler.start({ projectId: p2.id, method: 'az' })).rejects.toThrow(/still active/);
    await slow.scheduler.cancel();
    release();
    await slow.scheduler.idle();
    expect(slow.saved?.status).toBe('cancelled');
  });

  it('records failures honestly, then retries only failed queries', async () => {
    const e = setup((q) => (q.endsWith(' y') ? { status: 'failed', reason: 'timeout', message: 'slow' } : q.endsWith(' z') ? { status: 'empty' } : ok(q)));
    const p = await e.storage.createProject({ name: 'P', seed: 's' });
    await e.scheduler.start({ projectId: p.id, method: 'az', startLetter: 'x' });
    await e.scheduler.idle();
    expect(e.saved).toMatchObject({ status: 'completed', counts: { succeeded: 1, failed: 1, empty: 1 } });
    expect(await e.storage.countQueries(p.id)).toMatchObject({ succeeded: 1, failed: 1, empty: 1 });

    await e.scheduler.retryFailed(p.id, 'az');
    await e.scheduler.idle();
    expect(e.queries.slice(3)).toEqual(['s y']);
    await expect(e.scheduler.retryFailed(p.id, 'suffix')).rejects.toThrow(/no failed/);
  });

  it('pauses for the user on a CAPTCHA without marking the query failed, and resumes there', async () => {
    let blocked = true;
    const e = setup((q) => (blocked && q.endsWith(' y') ? { status: 'failed', reason: 'blocked', message: 'captcha' } : ok(q)));
    const p = await e.storage.createProject({ name: 'P', seed: 's' });
    await e.scheduler.start({ projectId: p.id, method: 'az', startLetter: 'x' });
    await e.scheduler.idle();
    expect(e.saved).toMatchObject({ status: 'awaiting_user', cursor: 1, message: 'captcha' });
    expect(await e.storage.countQueries(p.id)).toMatchObject({ succeeded: 1, pending: 2, failed: 0 });

    blocked = false;
    await e.scheduler.resume();
    await e.scheduler.idle();
    expect(e.queries).toEqual(['s x', 's y', 's y', 's z']);
    expect(e.saved?.status).toBe('completed');
  });

  it('waits for the user when the Google tab is unavailable', async () => {
    const e = setup(ok);
    const p = await e.storage.createProject({ name: 'P', seed: 's' });
    (e.scheduler as unknown as { deps: SchedulerDeps }).deps.google.ensureTab = async () => {
      throw new PageUnavailableError('consent page');
    };
    await e.scheduler.start({ projectId: p.id, method: 'az' });
    await e.scheduler.idle();
    expect(e.saved).toMatchObject({ status: 'awaiting_user', cursor: 0, message: 'consent page' });
  });

  it('pauses mid-job and keeps the in-flight result', async () => {
    let scheduler!: CollectionScheduler;
    const e = setup(async (q, call) => {
      if (call === 1) await scheduler.pause();
      return ok(q);
    });
    scheduler = e.scheduler;
    const p = await e.storage.createProject({ name: 'P', seed: 's' });
    await e.scheduler.start({ projectId: p.id, method: 'az' });
    await e.scheduler.idle();
    expect(e.saved).toMatchObject({ status: 'paused', cursor: 2, counts: { succeeded: 2 } });
    await e.scheduler.resume();
    await e.scheduler.idle();
    // A to Z: the seed, the seed plus a space, then 26 letters.
    expect(e.saved).toMatchObject({ status: 'completed', cursor: 28 });
    expect(new Set(e.queries).size).toBe(28);
  });

  it('marks a job left running by a stopped worker as interrupted, and can resume it', async () => {
    const first = setup(ok);
    const p = await first.storage.createProject({ name: 'P', seed: 's' });
    await first.scheduler.start({ projectId: p.id, method: 'az', startLetter: 'y' });
    await first.scheduler.idle();
    const running = { ...first.saved!, status: 'running' as const, cursor: 1 };
    const restarted = setup(ok, running);
    expect((await restarted.scheduler.getJob())?.status).toBe('interrupted');
    expect(restarted.saved?.status).toBe('interrupted');
  });

  it('stops when the project is deleted mid-job', async () => {
    let storageRef!: MemoryStorage;
    let pid = '';
    const e = setup(async (q, call) => {
      if (call === 0) await storageRef.deleteProject(pid);
      return ok(q);
    });
    storageRef = e.storage;
    const p = await e.storage.createProject({ name: 'P', seed: 's' });
    pid = p.id;
    await e.scheduler.start({ projectId: p.id, method: 'az' });
    await e.scheduler.idle();
    expect(e.saved?.status).toBe('awaiting_user'); // saving the in-flight result failed
    expect(e.saved?.message).toMatch(/Could not save/);
  });
});

describe('query echoes', () => {
  it('never saves Google echoing an A to Z query, but keeps prefix/suffix echoes', async () => {
    const e = setup((q) => ({ status: 'succeeded', suggestions: [q, `${q}pp`] }));
    const p = await e.storage.createProject({ name: 'P', seed: 'mobile repairing', suffixes: ['near me'] });
    await e.scheduler.start({ projectId: p.id, method: 'az', startLetter: 'z' });
    await e.scheduler.idle();
    await e.scheduler.start({ projectId: p.id, method: 'suffix' });
    await e.scheduler.idle();
    const keys = (await e.storage.listKeywords(p.id)).map((k) => k.key).sort();
    expect(keys).toEqual(['mobile repairing near me', 'mobile repairing near mepp', 'mobile repairing zpp']);
    const az = (await e.storage.listQueries(p.id, 'az'))[0]!;
    expect(az).toMatchObject({ status: 'succeeded', suggestionCount: 1 });
  });

  it('marks an A to Z query empty when Google only echoed it back', async () => {
    const e = setup((q) => ({ status: 'succeeded', suggestions: [q] }));
    const p = await e.storage.createProject({ name: 'P', seed: 'mobile repairing' });
    await e.scheduler.start({ projectId: p.id, method: 'az', startLetter: 'z' });
    await e.scheduler.idle();
    expect(await e.storage.listKeywords(p.id)).toEqual([]);
    expect((await e.storage.countQueries(p.id)).empty).toBe(1);
    expect(e.saved?.counts).toMatchObject({ empty: 1, succeeded: 0 });
  });
});

describe('pacedDelay', () => {
  it('adds up to 50% jitter', () => {
    expect(pacedDelay(4000, 0)).toBe(4000);
    expect(pacedDelay(4000, 1)).toBe(6000);
  });
});
