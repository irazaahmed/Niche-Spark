// Account sign-in for the extension, through the NicheSpark auth bridge.
// Runs in the background worker; pages talk to it with auth/* messages.
import type { AccountUser } from '../shared/cloud';

export interface StoredAuth {
  user: AccountUser;
  /** Opaque Neon Auth session cookies, kept only to refresh the access token. */
  jar: string;
  /** Short-lived JWT for the Data API. */
  token: string;
  /** Token expiry, epoch ms. */
  tokenExp: number;
}

export interface AuthDeps {
  bridgeUrl: string;
  fetch: typeof fetch;
  load(): Promise<StoredAuth | null>;
  save(auth: StoredAuth | null): Promise<void>;
  /** chrome.identity.getRedirectURL() */
  redirectUrl(): string;
  /** chrome.identity.launchWebAuthFlow; resolves with the final redirect URL. */
  launchWebAuthFlow(url: string): Promise<string | undefined>;
  now(): number;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    /** Bridge error code, e.g. "verify_email" when the account's email needs its code. */
    readonly code = '',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

interface SessionReply {
  user: AccountUser;
  jar: string;
  token: string;
}

/** Refresh the access token this long before it expires. */
const REFRESH_MARGIN_MS = 60_000;

export function tokenExpiry(jwt: string, fallback: number): number {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : fallback;
  } catch {
    return fallback;
  }
}

export class AuthService {
  private refreshing: Promise<StoredAuth> | undefined;

  constructor(private readonly deps: AuthDeps) {}

  private async bridge<T>(action: string, body: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await this.deps.fetch(`${this.deps.bridgeUrl}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new AuthError('Could not reach the NicheSpark sign-in service. Check your internet connection.');
    }
    let data: (T & { error?: string }) | null = null;
    try {
      data = (await res.json()) as T & { error?: string };
    } catch {
      /* non-JSON */
    }
    if (!res.ok) throw new AuthError(data?.error ?? `Sign-in service error (${res.status}).`, res.status, (data as { code?: string } | null)?.code ?? '');
    return data as T;
  }

  private async store(reply: SessionReply): Promise<StoredAuth> {
    const auth: StoredAuth = {
      user: reply.user,
      jar: reply.jar,
      token: reply.token,
      tokenExp: tokenExpiry(reply.token, this.deps.now() + 10 * 60_000),
    };
    await this.deps.save(auth);
    return auth;
  }

  current(): Promise<StoredAuth | null> {
    return this.deps.load();
  }

  async signUp(email: string, password: string, name: string) {
    return (await this.store(await this.bridge<SessionReply>('sign-up', { email, password, name }))).user;
  }

  async signIn(email: string, password: string) {
    return (await this.store(await this.bridge<SessionReply>('sign-in', { email, password }))).user;
  }

  async signInWithGoogle() {
    const redirect = this.deps.redirectUrl();
    const start = await this.bridge<{ url: string; jar: string }>('social-start', { provider: 'google', redirect });
    let final: string | undefined;
    try {
      final = await this.deps.launchWebAuthFlow(start.url);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new AuthError(/did not approve|closed|cancel/i.test(message) ? 'Google sign-in was cancelled.' : `Google sign-in failed: ${message}`);
    }
    if (!final) throw new AuthError('Google sign-in was cancelled.');
    const params = new URL(final).searchParams;
    const verifier = params.get('neon_auth_session_verifier');
    if (!verifier) throw new AuthError(params.get('error') ? `Google sign-in failed: ${params.get('error')}` : 'Google sign-in did not complete.');
    return (await this.store(await this.bridge<SessionReply>('social-finish', { verifier, jar: start.jar }))).user;
  }

  /** Completes sign-up (or a sign-in blocked by verification) with the emailed 6-digit code. */
  async verifyEmail(email: string, otp: string) {
    return (await this.store(await this.bridge<SessionReply>('verify-email', { email, otp }))).user;
  }

  async resendCode(email: string) {
    await this.bridge('resend-code', { email });
  }

  async forgotPassword(email: string) {
    await this.bridge('forgot-password', { email });
  }

  async signOut() {
    const auth = await this.deps.load();
    await this.deps.save(null);
    if (auth) await this.bridge('sign-out', { jar: auth.jar }).catch(() => {});
  }

  /** A valid access token, refreshed when close to expiry (or when `force` is set). */
  async getToken(force = false): Promise<string> {
    const auth = await this.deps.load();
    if (!auth) throw new AuthError('You are signed out.', 401);
    if (!force && auth.tokenExp - REFRESH_MARGIN_MS > this.deps.now()) return auth.token;
    this.refreshing ??= this.refresh(auth).finally(() => (this.refreshing = undefined));
    return (await this.refreshing).token;
  }

  private async refresh(auth: StoredAuth): Promise<StoredAuth> {
    try {
      return await this.store(await this.bridge<SessionReply>('session', { jar: auth.jar }));
    } catch (e) {
      // An ended session signs the user out; network errors keep them signed in.
      if (e instanceof AuthError && e.status === 401) await this.deps.save(null);
      throw e;
    }
  }
}
