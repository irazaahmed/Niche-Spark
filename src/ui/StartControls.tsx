import { useId, useState } from 'react';
import { DEFAULT_DELAY_MS, MAX_DELAY_MS, MIN_DELAY_MS } from '../core/collectionState';
import { LETTERS } from '../core/queryGeneration';
import type { Project, QueryCounts, ResearchMethod } from '../shared/types';
import { RESEARCH_METHODS, RESEARCH_METHOD_LABELS } from '../shared/types';
import { ErrorAlert } from './components';
import { sendJobCommand } from './jobClient';

const listFor = (project: Project, method: ResearchMethod) =>
  method === 'prefix' ? project.prefixes : method === 'suffix' ? project.suffixes : method === 'template' ? project.templates : null;

interface Props {
  project: Project;
  counts: QueryCounts | null;
  /** Restrict collection to these query keys (from a selection in the dashboard). */
  selectedKeys?: string[];
  method?: ResearchMethod;
  onMethodChange?: (m: ResearchMethod) => void;
  disabled?: boolean;
  /** A–Z start letter chosen elsewhere (the dashboard preview); hides the local picker. */
  startLetter?: string;
}

/** Method choice, pacing, and the Start / Retry failed buttons. */
export function StartControls({ project, counts, selectedKeys, method: controlled, onMethodChange, disabled, startLetter: givenLetter }: Props) {
  const id = useId();
  const [ownMethod, setOwnMethod] = useState<ResearchMethod>('az');
  const method = controlled ?? ownMethod;
  const [ownLetter, setStartLetter] = useState('a');
  const startLetter = givenLetter ?? ownLetter;
  const [delaySec, setDelaySec] = useState(DEFAULT_DELAY_MS / 1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const list = listFor(project, method);
  const delayMs = Math.round(delaySec * 1000);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    run(() =>
      sendJobCommand({
        type: 'job/start',
        projectId: project.id,
        method,
        delayMs,
        ...(method === 'az' ? { startLetter } : {}),
        ...(selectedKeys ? { selectedKeys } : {}),
      }),
    );
  const retry = () => run(() => sendJobCommand({ type: 'job/retryFailed', projectId: project.id, method, delayMs }));

  return (
    <div className="stack">
      <div className="start-grid">
        {!controlled && (
          <div className="field">
            <label htmlFor={`${id}-method`}>Method</label>
            <select
              id={`${id}-method`}
              className="input"
              value={method}
              onChange={(e) => {
                setOwnMethod(e.target.value as ResearchMethod);
                onMethodChange?.(e.target.value as ResearchMethod);
              }}
            >
              {RESEARCH_METHODS.map((m) => (
                <option key={m} value={m}>
                  {RESEARCH_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
        )}
        {method === 'az' && !selectedKeys && givenLetter === undefined && (
          <div className="field">
            <label htmlFor={`${id}-letter`}>Start letter</label>
            <select id={`${id}-letter`} className="input" value={startLetter} onChange={(e) => setStartLetter(e.target.value)}>
              {LETTERS.map((l) => (
                <option key={l} value={l}>
                  {l.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor={`${id}-delay`}>Delay (seconds)</label>
          <input
            id={`${id}-delay`}
            className="input"
            type="number"
            min={MIN_DELAY_MS / 1000}
            max={MAX_DELAY_MS / 1000}
            step={1}
            value={delaySec}
            onChange={(e) => setDelaySec(Number(e.target.value))}
          />
        </div>
      </div>
      {list && list.length === 0 && (
        <p className="muted small">
          No {RESEARCH_METHOD_LABELS[method].toLowerCase()} entries yet. Add them in the dashboard under Research queries.
        </p>
      )}
      <ErrorAlert error={error} />
      <div className="row">
        <button
          className="btn btn-primary"
          type="button"
          disabled={disabled || busy || (list !== null && list.length === 0) || selectedKeys?.length === 0}
          onClick={() => void start()}
        >
          {selectedKeys ? `Collect ${selectedKeys.length} selected` : `Start ${RESEARCH_METHOD_LABELS[method]}`}
        </button>
        {!selectedKeys && (
          <button className="btn" type="button" disabled={disabled || busy || !counts?.failed} onClick={() => void retry()}>
            Retry failed
          </button>
        )}
      </div>
      <p className="muted small">
        Opens Google in a background tab and reads the suggestions it shows. Completed queries are skipped. Keep the delay
        conservative; NicheSpark pauses if Google asks for verification.
      </p>
    </div>
  );
}
