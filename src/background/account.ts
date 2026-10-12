// Ties sign-in, local data ownership, and cloud sync together (background worker).
import type { AuthService } from '../auth/authService';
import { AuthError } from '../auth/authService';
import type { AccountUser, SyncStatus } from '../shared/cloud';
import { CloudError } from '../sync/cloudApi';
import type { SyncEngine } from '../sync/syncEngine';
import type { SyncStore } from '../sync/types';

export interface AccountDeps {
  auth: AuthService;
  store: SyncStore;
  engine: SyncEngine;
  getOwner(): Promise<string | null>;
  setOwner(userId: string | null): Promise<void>;
  resetCursors(): Promise<void>;
  loadStatus(): Promise<SyncStatus | null>;
  saveStatus(status: SyncStatus): Promise<void>;
  /** Stops any running collection job (before local data is wiped). */
  cancelJob(): Promise<void>;
  now(): number;
}

/** Signing out with changes that could not be uploaded. */
export class UnsyncedChangesError extends Error {
  constructor(readonly pending: number, cause: string) {
    super(`${pending} change${pending === 1 ? '' : 's'} could not be uploaded (${cause}). Signing out now would delete them from this browser.`);
    this.name = 'UnsyncedChangesError';
  }
}

export const SYNC_THROTTLE_MS = 3000;

export class AccountController {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;

  constructor(private readonly deps: AccountDeps) {}

  async user(): Promise<AccountUser | null> {
    return (await this.deps.auth.current())?.user ?? null;
  }

  async signIn(email: string, password: string) {
    return this.afterSignIn(await this.deps.auth.signIn(email, password));
  }

  async signUp(email: string, password: string, name: string) {
    return this.afterSignIn(await this.deps.auth.signUp(email, password, name));
  }

  async signInWithGoogle() {
    return this.afterSignIn(await this.deps.auth.signInWithGoogle());
  }

  async verifyEmail(email: string, otp: string) {
    return this.afterSignIn(await this.deps.auth.verifyEmail(email, otp));
  }

  resendCode(email: string) {
    return this.deps.auth.resendCode(email);
  }

  forgotPassword(email: string) {
    return this.deps.auth.forgotPassword(email);
  }

  /**
   * Local data belongs to one account at a time. Data saved before accounts
   * existed (no owner yet) is uploaded to the first account that signs in;
   * another account's leftover data is removed first.
   */
  private async afterSignIn(user: AccountUser) {
    const owner = await this.deps.getOwner();
    if (owner !== user.id) {
      if (owner) {
        await this.deps.cancelJob();
        await this.deps.store.wipeAll();
      } else if (await this.deps.store.hasLocalData()) {
        await this.deps.store.markAllForUpload();
      }
      await this.deps.resetCursors();
      await this.deps.setOwner(user.id);
    }
    void this.syncNow();
    return user;
  }

  /** Uploads what it can, then signs out and removes this account's data from the browser. */
  async signOut(force = false) {
    await this.deps.cancelJob();
    if (!force && (await this.user())) {
      try {
        await this.syncNow(true);
      } catch {
        /* reported below */
      }
      const pending = await this.deps.store.outboxSize();
      if (pending) throw new UnsyncedChangesError(pending, (await this.deps.loadStatus())?.error ?? 'offline');
    }
    await this.deps.auth.signOut();
    await this.deps.store.wipeAll();
    await this.deps.setOwner(null);
    await this.deps.resetCursors();
    await this.deps.saveStatus({ state: 'idle', lastSyncedAt: null, pending: 0 });
  }

  /** Schedules a sync soon; repeated requests within the window share one run. */
  requestSync() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.syncNow();
    }, SYNC_THROTTLE_MS);
  }

  /** Runs a sync now, after any sync already in progress. `rethrow` surfaces failures. */
  async syncNow(rethrow = false): Promise<void> {
    while (this.running) await this.running.catch(() => {});
    this.running = this.runOnce();
    try {
      await this.running;
    } catch (e) {
      if (rethrow) throw e;
    } finally {
      this.running = undefined;
    }
  }

  private async runOnce() {
    if (!(await this.user())) return;
    const previous = await this.deps.loadStatus();
    const base: SyncStatus = {
      state: 'syncing',
      lastSyncedAt: previous?.lastSyncedAt ?? null,
      pending: await this.deps.store.outboxSize(),
      ...(previous?.remoteChangeAt ? { remoteChangeAt: previous.remoteChangeAt } : {}),
    };
    await this.deps.saveStatus(base);
    try {
      const { changed } = await this.deps.engine.sync();
      await this.deps.saveStatus({
        state: 'idle',
        lastSyncedAt: this.deps.now(),
        pending: await this.deps.store.outboxSize(),
        ...(changed ? { remoteChangeAt: this.deps.now() } : base.remoteChangeAt ? { remoteChangeAt: base.remoteChangeAt } : {}),
      });
    } catch (e) {
      const offline = !(e instanceof CloudError) && !(e instanceof AuthError && e.status);
      const signedOut = e instanceof AuthError && e.status === 401;
      await this.deps.saveStatus({
        ...base,
        state: offline ? 'offline' : 'error',
        pending: await this.deps.store.outboxSize(),
        error: signedOut ? 'Your session ended. Sign in again to keep syncing.' : e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }
}
