// Sign-in and account/data-ownership tests with a mocked auth bridge (no network).
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { AccountController, UnsyncedChangesError } from '../src/background/account';
import { AuthError, AuthService, tokenExpiry, type StoredAuth } from '../src/auth/authService';
import type { AccountUser, SyncStatus } from '../src/shared/cloud';
import { IndexedDbStorage } from '../src/storage/indexedDbStorage';
import type { SyncEngine } from '../src/sync/syncEngine';

const user = (id = 'u1'): AccountUser => ({ id, email: `${id}@example.com`, name: id, image: null, emailVerified: false });

function jwt(expSeconds: number) {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'EdDSA' })}.${b64({ sub: 'u1', exp: expSeconds })}.sig`;
}

function makeAuth(replies: Record<string, (body: Record<string, unknown>) => { status: number; body: unknown }>, opts: { now?: number; final?: string | Error } = {}) {
  let stored: StoredAuth | null = null;
  const calls: { action: string; body: Record<string, unknown> }[] = [];
  const service = new AuthService({
    bridgeUrl: 'https://bridge.example/api/auth',
    fetch: (async (url: string, init: RequestInit) => {
      const action = String(url).split('/').pop()!;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ action, body });
      const reply = replies[action]?.(body) ?? { status: 404, body: { error: 'Unknown action.' } };
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    }) as typeof fetch,
    load: async () => stored,
    save: async (a) => void (stored = a),
    redirectUrl: () => 'https://extid.chromiumapp.org/',
    launchWebAuthFlow: async () => {
      if (opts.final instanceof Error) throw opts.final;
      return opts.final;
    },
    now: () => opts.now ?? 1_000_000_000_000,
  });
  return { service, calls, stored: () => stored };
}

const session = (exp = 2_000_000_000) => ({ status: 200, body: { user: user(), jar: '__Secure-neon-auth.session_token=abc', token: jwt(exp) } });

describe('AuthService', () => {
  it('reads the JWT expiry', () => {
    expect(tokenExpiry(jwt(1_800_000_000), 5)).toBe(1_800_000_000_000);
    expect(tokenExpiry('not-a-jwt', 5)).toBe(5);
  });

  it('signs in with email and stores the session', async () => {
    const { service, calls, stored } = makeAuth({ 'sign-in': () => session() });
    expect(await service.signIn('u1@example.com', 'pw-123456')).toEqual(user());
    expect(calls[0]).toEqual({ action: 'sign-in', body: { email: 'u1@example.com', password: 'pw-123456' } });
    expect(stored()).toMatchObject({ jar: '__Secure-neon-auth.session_token=abc', tokenExp: 2_000_000_000_000 });
  });

  it('shows the bridge error message', async () => {
    const { service } = makeAuth({ 'sign-in': () => ({ status: 401, body: { error: 'Invalid email or password' } }) });
    await expect(service.signIn('a@b.co', 'wrong')).rejects.toMatchObject({ message: 'Invalid email or password', status: 401 });
  });

  it('refreshes the token only when it is close to expiry', async () => {
    const now = 1_000_000_000_000;
    const { service, calls } = makeAuth({ 'sign-in': () => session(now / 1000 + 30), session: () => session(now / 1000 + 900) }, { now });
    await service.signIn('u1@example.com', 'pw-123456');
    const [t1, t2] = await Promise.all([service.getToken(), service.getToken()]);
    expect(t1).toBe(t2);
    expect(calls.filter((c) => c.action === 'session')).toHaveLength(1); // concurrent refreshes share one call
    await service.getToken();
    expect(calls.filter((c) => c.action === 'session')).toHaveLength(1);
  });

  it('signs out locally when the session has ended, but not on network errors', async () => {
    const now = 1_000_000_000_000;
    const ended = makeAuth({ 'sign-in': () => session(now / 1000), session: () => ({ status: 401, body: { error: 'ended' } }) }, { now });
    await ended.service.signIn('u1@example.com', 'pw-123456');
    await expect(ended.service.getToken()).rejects.toBeInstanceOf(AuthError);
    expect(ended.stored()).toBeNull();

    const flaky = makeAuth({ 'sign-in': () => session(now / 1000), session: () => ({ status: 502, body: { error: 'down' } }) }, { now });
    await flaky.service.signIn('u1@example.com', 'pw-123456');
    await expect(flaky.service.getToken()).rejects.toThrow('down');
    expect(flaky.stored()).not.toBeNull();
  });

  it('completes Google sign-in with the verifier from the redirect', async () => {
    const { service, calls } = makeAuth(
      {
        'social-start': () => ({ status: 200, body: { url: 'https://auth.example/start', jar: 'challenge=1' } }),
        'social-finish': () => session(),
      },
      { final: 'https://extid.chromiumapp.org/?neon_auth_session_verifier=v123' },
    );
    expect(await service.signInWithGoogle()).toEqual(user());
    expect(calls[0]!.body).toEqual({ provider: 'google', redirect: 'https://extid.chromiumapp.org/' });
    expect(calls[1]).toEqual({ action: 'social-finish', body: { verifier: 'v123', jar: 'challenge=1' } });
  });

  it('reports a cancelled or failed Google sign-in', async () => {
    const start = { 'social-start': () => ({ status: 200, body: { url: 'https://auth.example/start', jar: 'c=1' } }) };
    await expect(makeAuth(start, { final: new Error('The user did not approve access.') }).service.signInWithGoogle()).rejects.toThrow('Google sign-in was cancelled.');
    await expect(makeAuth(start, { final: 'https://extid.chromiumapp.org/?error=access_denied' }).service.signInWithGoogle()).rejects.toThrow('access_denied');
  });
});

function makeAccount(opts: { owner?: string | null; syncFails?: boolean } = {}) {
  const store = new IndexedDbStorage(new IDBFactory(), `acct-${Math.random()}`);
  let owner = opts.owner ?? null;
  let status: SyncStatus | null = null;
  let signedIn: AccountUser | null = null;
  const auth = {
    current: async () => (signedIn ? ({ user: signedIn } as StoredAuth) : null),
    signIn: async () => (signedIn = user('u1')),
    signUp: async () => (signedIn = user('u1')),
    signInWithGoogle: async () => (signedIn = user('u1')),
    signOut: vi.fn(async () => void (signedIn = null)),
    forgotPassword: async () => {},
  } as unknown as AuthService;
  const engine = {
    sync: vi.fn(async () => {
      if (opts.syncFails) throw new TypeError('Failed to fetch');
      await store.ackOutbox(await store.readOutbox(10_000));
      return { pushed: 0, pulled: 0, changed: false };
    }),
  } as unknown as SyncEngine;
  const cancelJob = vi.fn(async () => {});
  const account = new AccountController({
    auth,
    store,
    engine,
    getOwner: async () => owner,
    setOwner: async (id) => void (owner = id),
    resetCursors: async () => {},
    loadStatus: async () => status,
    saveStatus: async (s) => void (status = s),
    cancelJob,
    now: () => 42,
  });
  return { account, store, auth, engine, cancelJob, owner: () => owner, status: () => status };
}

describe('AccountController', () => {
  it('uploads data saved before accounts existed on the first sign-in', async () => {
    const t = makeAccount();
    await t.store.createProject({ name: 'Old', seed: 'old seed' });
    await t.store.ackOutbox(await t.store.readOutbox(10)); // as if it predates change tracking
    await t.account.signIn('u1@example.com', 'pw');
    expect(t.owner()).toBe('u1');
    expect((await t.store.listProjects()).map((p) => p.name)).toEqual(['Old']);
    await vi.waitFor(() => expect(t.status()?.state).toBe('idle'));
    expect(t.engine.sync).toHaveBeenCalled();
  });

  it("removes another account's leftover data before signing in", async () => {
    const t = makeAccount({ owner: 'someone-else' });
    await t.store.createProject({ name: 'Theirs', seed: 'their seed' });
    await t.account.signIn('u1@example.com', 'pw');
    expect(await t.store.listProjects()).toEqual([]);
    expect(t.cancelJob).toHaveBeenCalled();
    expect(t.owner()).toBe('u1');
  });

  it('signs out after uploading, and removes local data', async () => {
    const t = makeAccount({ owner: 'u1' });
    await t.account.signIn('u1@example.com', 'pw');
    await t.store.createProject({ name: 'Mine', seed: 'my seed' });
    await t.account.signOut();
    expect(t.auth.signOut).toHaveBeenCalled();
    expect(await t.store.listProjects()).toEqual([]);
    expect(t.owner()).toBeNull();
  });

  it('refuses to sign out with changes it could not upload, unless forced', async () => {
    const t = makeAccount({ owner: 'u1', syncFails: true });
    await t.account.signIn('u1@example.com', 'pw');
    await t.store.createProject({ name: 'Unsynced', seed: 'my seed' });
    await expect(t.account.signOut()).rejects.toBeInstanceOf(UnsyncedChangesError);
    expect((await t.store.listProjects()).map((p) => p.name)).toEqual(['Unsynced']);
    expect(t.status()?.state).toBe('offline');
    await t.account.signOut(true);
    expect(await t.store.listProjects()).toEqual([]);
  });
});
