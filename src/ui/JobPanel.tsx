import { useState } from 'react';
import { isActive, remainingQueries, RESUMABLE_STATUSES, type JobState } from '../core/collectionState';
import type { BackgroundRequest } from '../shared/messages';
import { RESEARCH_METHOD_LABELS } from '../shared/types';
import { ErrorAlert } from './components';
import { JOB_STATUS_LABELS, sendJobCommand } from './jobClient';
import { QueryText } from './QueryText';

/** Shows the current collection job with pause / resume / cancel controls. */
export function JobPanel({ job, onOpenTab }: { job: JobState; onOpenTab?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const total = job.queryIds.length;
  const done = Math.min(job.cursor, total);
  const percent = total ? Math.round((done / total) * 100) : 100;

  async function command(request: BackgroundRequest) {
    setBusy(true);
    setError(null);
    try {
      await sendJobCommand(request);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`card stack job job-${job.status}`} aria-labelledby="job-heading" aria-live="polite">
      <div className="row spread">
        <h2 id="job-heading" className="job-title">
          {RESEARCH_METHOD_LABELS[job.method]} · {job.projectName}
        </h2>
        <span className={`badge badge-${job.status}`}>{JOB_STATUS_LABELS[job.status]}</span>
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-label="Collection progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <div className="progress-bar" style={{ width: `${percent}%` }} />
      </div>
      <div className="muted small">
        {done} of {total} queries · {job.counts.succeeded} with suggestions · {job.counts.empty} empty · {job.counts.failed} failed
        {job.counts.skipped ? ` · ${job.counts.skipped} already done` : ''} · {job.counts.keywordsAdded} new keywords
      </div>
      {job.status === 'running' && job.currentQuery && (
        <div className="small">
          Collecting: <strong><QueryText text={job.currentQuery} /></strong>
        </div>
      )}
      {job.message && <div className={`alert ${job.status === 'awaiting_user' ? 'alert-error' : 'alert-info'}`}>{job.message}</div>}
      <ErrorAlert error={error} />
      {isActive(job) && (
        <div className="row">
          {job.status === 'running' && (
            <button className="btn" type="button" disabled={busy} onClick={() => void command({ type: 'job/pause' })}>
              Pause
            </button>
          )}
          {RESUMABLE_STATUSES.includes(job.status) && (
            <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void command({ type: 'job/resume' })}>
              Resume ({remainingQueries(job)} left)
            </button>
          )}
          <button className="btn btn-danger" type="button" disabled={busy} onClick={() => void command({ type: 'job/cancel' })}>
            Cancel
          </button>
          {job.status === 'awaiting_user' && job.tabId !== undefined && onOpenTab && (
            <button className="btn" type="button" onClick={onOpenTab}>
              Open Google tab
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function focusTab(tabId: number | undefined) {
  if (tabId === undefined) return;
  void chrome.tabs.update(tabId, { active: true }).then(async (t) => {
    if (t?.windowId !== undefined) await chrome.windows.update(t.windowId, { focused: true });
  });
}
