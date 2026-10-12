import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { SyncStatus } from '../shared/cloud';
import { AccountCommandError, sendAccountCommand, useAccount, useSyncStatus } from './account';
import { Brand, ErrorAlert } from './components';

type Mode = 'sign-in' | 'sign-up' | 'forgot';

const PRIVACY_URL = 'https://nichespark.tech/privacy.html';

/** Shows the sign-in screen until the user is signed in, then the page. */
export function AuthGate({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  const user = useAccount();
  if (user === undefined) return <p className="muted auth-loading">Loading…</p>;
  if (!user) return <AuthScreen compact={compact} />;
  return <>{children}</>;
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function AuthScreen({ compact }: { compact: boolean }) {
  const id = useId();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'forgot') {
      void run(async () => {
        await sendAccountCommand({ type: 'auth/forgot', email: email.trim() });
        setNotice('If an account exists for this email, a password reset link is on its way. Check your inbox and spam folder.');
      });
      return;
    }
    if (mode === 'sign-up' && password.length < 8) {
      setError(new Error('Use a password of at least 8 characters.'));
      return;
    }
    void run(() =>
      sendAccountCommand(
        mode === 'sign-up'
          ? { type: 'auth/sign-up', email: email.trim(), password, name: name.trim() }
          : { type: 'auth/sign-in', email: email.trim(), password },
      ),
    );
  }

  function switchTo(next: Mode) {
    setMode(next);
    setError(null);
    setNotice('');
  }

  const title = mode === 'sign-up' ? 'Create your free account' : mode === 'forgot' ? 'Reset your password' : 'Sign in to NicheSpark';

  return (
    <div className={`auth-screen${compact ? ' auth-compact' : ''}`}>
      <div className="auth-card card stack">
        <Brand />
        <div>
          <h1 className="auth-title">{title}</h1>
          {mode !== 'forgot' && (
            <p className="muted small">Your projects and keywords are saved to your account, so they are safe and available on any computer.</p>
          )}
        </div>

        {mode !== 'forgot' && (
          <>
            <button type="button" className="btn btn-google" disabled={busy} onClick={() => void run(() => sendAccountCommand({ type: 'auth/google' }))}>
              <GoogleIcon /> Continue with Google
            </button>
            <div className="auth-divider" role="separator">
              <span>or use email</span>
            </div>
          </>
        )}

        <form className="stack" onSubmit={submit} aria-label={title}>
          {mode === 'sign-up' && (
            <div className="field">
              <label htmlFor={`${id}-name`}>Name</label>
              <input id={`${id}-name`} className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={100} />
            </div>
          )}
          <div className="field">
            <label htmlFor={`${id}-email`}>Email</label>
            <input
              id={`${id}-email`}
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          {mode !== 'forgot' && (
            <div className="field">
              <label htmlFor={`${id}-password`}>Password</label>
              <input
                id={`${id}-password`}
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                minLength={mode === 'sign-up' ? 8 : undefined}
                maxLength={128}
                required
              />
              {mode === 'sign-up' && <span className="hint">At least 8 characters.</span>}
            </div>
          )}
          <ErrorAlert error={error} />
          {notice && (
            <div className="alert alert-info" role="status">
              {notice}
            </div>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'sign-up' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Sign in'}
          </button>
        </form>

        <div className="auth-links small">
          {mode === 'sign-in' && (
            <>
              <button type="button" className="link" onClick={() => switchTo('forgot')}>
                Forgot password?
              </button>
              <span>
                New here?{' '}
                <button type="button" className="link" onClick={() => switchTo('sign-up')}>
                  Create an account
                </button>
              </span>
            </>
          )}
          {mode !== 'sign-in' && (
            <button type="button" className="link" onClick={() => switchTo('sign-in')}>
              Back to sign in
            </button>
          )}
        </div>
        <p className="muted small">
          By continuing you agree to how we handle your data in our{' '}
          <a className="link" href={PRIVACY_URL} target="_blank" rel="noreferrer">
            privacy policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}

function statusText(status: SyncStatus | null | undefined): string {
  if (!status) return 'Not synced yet';
  if (status.state === 'syncing') return 'Syncing…';
  if (status.state === 'offline') return status.pending ? `Offline: ${status.pending} change${status.pending === 1 ? '' : 's'} waiting` : 'Offline';
  if (status.state === 'error') return 'Sync problem';
  if (status.pending) return `${status.pending} change${status.pending === 1 ? '' : 's'} waiting`;
  if (!status.lastSyncedAt) return 'Not synced yet';
  const mins = Math.round((Date.now() - status.lastSyncedAt) / 60000);
  return mins < 1 ? 'Synced just now' : mins < 60 ? `Synced ${mins} min ago` : `Synced at ${new Date(status.lastSyncedAt).toLocaleTimeString()}`;
}

/** Signed-in user, sync state, and sign-out. */
export function AccountBar({ compact = false }: { compact?: boolean }) {
  const user = useAccount();
  const status = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!user) return null;

  async function signOut() {
    if (!confirm('Sign out of NicheSpark? Your data stays in your account; this browser keeps no copy until you sign in again.')) return;
    setBusy(true);
    setError(null);
    try {
      await sendAccountCommand({ type: 'auth/sign-out' });
    } catch (e) {
      if (e instanceof AccountCommandError && e.code === 'unsynced') {
        if (confirm(`${e.message}\n\nSign out anyway and delete them?`)) {
          await sendAccountCommand({ type: 'auth/sign-out', force: true }).catch(setError);
        }
      } else setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setError(null);
    try {
      await sendAccountCommand({ type: 'sync/now' });
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className={`account-bar${compact ? ' account-compact' : ''}`}>
      <div className="account-who">
        <span className="account-email" title={user.email}>
          {user.email}
        </span>
        <button
          type="button"
          className={`sync-state sync-${status?.state ?? 'idle'}`}
          onClick={() => void syncNow()}
          title={status?.error ? `${status.error} Click to try again.` : 'Click to sync now'}
        >
          {statusText(status)}
        </button>
      </div>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void signOut()}>
        Sign out
      </button>
      <ErrorAlert error={error} />
    </div>
  );
}
