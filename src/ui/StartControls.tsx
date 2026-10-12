import { useId, useState } from 'react';
import { DEFAULT_DELAY_MS, MAX_DELAY_MS, MIN_DELAY_MS } from '../core/collectionState';
import { PREFIX_PACKS, SUFFIX_PACKS, TEMPLATE_EXAMPLES, type ModifierPack } from '../core/modifierPacks';
import { LETTERS } from '../core/queryGeneration';
import type { Project, QueryCounts, ResearchMethod } from '../shared/types';
import { RESEARCH_METHODS, RESEARCH_METHOD_LABELS } from '../shared/types';
import { ErrorAlert } from './components';
import { sendJobCommand } from './jobClient';

const listFor = (project: Project, method: ResearchMethod) =>
  method === 'prefix' ? project.prefixes : method === 'suffix' ? project.suffixes : method === 'template' ? project.templates : null;

const packsFor = (method: ResearchMethod): readonly ModifierPack[] =>
  method === 'prefix' ? PREFIX_PACKS : method === 'suffix' ? SUFFIX_PACKS : method === 'template' ? [TEMPLATE_EXAMPLES] : [];

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
  /**
   * Number of entries in an edited-but-unsaved list (dashboard). When given,
   * it replaces the saved list's length for the "list is empty" check.
   */
  listCount?: number;
  /** Runs before the job starts, e.g. saving an edited list. Start shows "Save & start". */
  beforeStart?: () => Promise<void>;
  /** When the method's list is empty, offer one-click ready-made lists (popup). */
  onAddPack?: (method: ResearchMethod, pack: ModifierPack) => Promise<void>;
}

/** Method choice, pacing, and the Start / Retry failed buttons. */
export function StartControls({
  project,
  counts,
  selectedKeys,
  method: controlled,
  onMethodChange,
  disabled,
  startLetter: givenLetter,
  listCount,
  beforeStart,
  onAddPack,
}: Props) {
  const id = useId();
  const [ownMethod, setOwnMethod] = useState<ResearchMethod>('az');
  const method = controlled ?? ownMethod;
  const [ownLetter, setStartLetter] = useState('a');
  const startLetter = givenLetter ?? ownLetter;
  const [delaySec, setDelaySec] = useState(DEFAULT_DELAY_MS / 1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const list = listFor(project, method);
  const entries = list === null ? null : (listCount ?? list.length);
  const listEmpty = entries === 0;
  const delayMs = Math.round(delaySec * 1000);
  const label = RESEARCH_METHOD_LABELS[method];

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
    run(async () => {
      await beforeStart?.();
      await sendJobCommand({
        type: 'job/start',
        projectId: project.id,
        method,
        delayMs,
        ...(method === 'az' ? { startLetter } : {}),
        ...(selectedKeys ? { selectedKeys } : {}),
      });
    });
  const retry = () => run(() => sendJobCommand({ type: 'job/retryFailed', projectId: project.id, method, delayMs }));
  const startText = selectedKeys ? `Collect ${selectedKeys.length} selected` : `Start ${label}`;

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

      {list !== null && !listEmpty && listCount === undefined && (
        <p className="muted small">
          Uses this project&apos;s {label.toLowerCase()} list ({list.length}): {list.slice(0, 4).join(', ')}
          {list.length > 4 ? ', …' : ''}. Edit it in the dashboard.
        </p>
      )}

      {listEmpty && (
        <div className="empty-list">
          <p className="small">
            This project has no {label.toLowerCase()} {method === 'template' ? 'templates' : 'entries'} yet.
          </p>
          {onAddPack ? (
            <div className="row">
              {packsFor(method).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  title={p.words.join(', ')}
                  onClick={() => void run(() => onAddPack(method, p))}
                >
                  + {p.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="muted small">Add some on the left, or pick a ready-made list.</p>
          )}
        </div>
      )}

      <ErrorAlert error={error} />
      <div className="row">
        <button
          className="btn btn-primary"
          type="button"
          disabled={disabled || busy || listEmpty || selectedKeys?.length === 0}
          onClick={() => void start()}
        >
          {beforeStart ? `Save list & ${startText.charAt(0).toLowerCase()}${startText.slice(1)}` : startText}
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
