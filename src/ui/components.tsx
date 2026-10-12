import { useId, useState, type FormEvent } from 'react';
import { PRODUCT_NAME, TAGLINE } from '../shared/constants';
import type { NewProjectInput } from '../shared/types';
import { currentTheme, setTheme, type Theme } from './themePreference';

export function Brand() {
  return (
    <div className="brand">
      <img src="icons/icon-48.png" alt="" />
      <div>
        <div className="brand-name">{PRODUCT_NAME}</div>
        <div className="brand-tagline">{TAGLINE}</div>
      </div>
      <ThemeToggle />
    </div>
  );
}

/** Switches between light and dark; the choice is remembered on this computer. */
export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(currentTheme);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => {
        setTheme(next);
        setThemeState(next);
      }}
    >
      {theme === 'dark' ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      {errorMessage(error)}
    </div>
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Form for creating a project from a seed keyword. Name defaults to the seed. */
export function NewProjectForm({ onCreate }: { onCreate: (input: NewProjectInput) => Promise<void> }) {
  const id = useId();
  const [seed, setSeed] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate({ seed, name: name.trim() || seed });
      setSeed('');
      setName('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} aria-label="Create project">
      <div className="field">
        <label htmlFor={`${id}-seed`}>Seed keyword</label>
        <input
          id={`${id}-seed`}
          className="input"
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          placeholder="e.g. mobile car detailing"
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-name`}>Project name</label>
        <input
          id={`${id}-name`}
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Defaults to the seed keyword"
        />
      </div>
      <ErrorAlert error={error} />
      <button className="btn btn-primary" type="submit" disabled={busy || !seed.trim()}>
        {busy ? 'Creating…' : 'Create project'}
      </button>
    </form>
  );
}
