import { useEffect, useMemo, useState } from 'react';
import { SUPPORTED_GOOGLE_DOMAINS } from '../shared/constants';
import type { KeywordRecord, Project, QueryRecord } from '../shared/types';
import { RESEARCH_METHOD_LABELS } from '../shared/types';
import { getStorage } from '../storage';
import { isActive } from '../core/collectionState';
import { countStatuses } from '../storage/shared';
import { ErrorAlert } from '../ui/components';
import { focusTab, JobPanel } from '../ui/JobPanel';
import { useJob } from '../ui/jobClient';
import { QueryPreview } from './QueryPreview';

interface Props {
  project: Project;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}

export function ProjectView({ project, onChanged, onDeleted }: Props) {
  const storage = getStorage();
  const [keywords, setKeywords] = useState<KeywordRecord[] | null>(null);
  const [queries, setQueries] = useState<QueryRecord[] | null>(null);
  const job = useJob();
  const jobForProject = job && job.projectId === project.id ? job : null;
  const counts = useMemo(() => (queries ? countStatuses(queries) : null), [queries]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([storage.listKeywords(project.id), storage.listQueries(project.id)])
      .then(([k, q]) => {
        if (cancelled) return;
        setKeywords(k);
        setQueries(q);
      })
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [project.id, project.updatedAt, storage, jobForProject?.updatedAt]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (keywords ?? [])
      .filter((k) => !q || k.key.includes(q))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [keywords, search]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (e) {
      setError(e);
    }
  }

  function rename() {
    const name = window.prompt('Rename project', project.name);
    if (name === null || name.trim() === project.name) return;
    void run(() => storage.updateProject(project.id, { name }));
  }

  function remove() {
    const ok = window.confirm(
      `Delete "${project.name}"?\n\nThis permanently removes the project and all ${keywords?.length ?? 0} collected keywords. Export a backup first if you need the data.`,
    );
    if (!ok) return;
    setError(null);
    storage
      .deleteProject(project.id)
      .then(onDeleted)
      .catch(setError);
  }

  return (
    <div className="stack">
      <header className="project-header">
        <div>
          <h1>{project.name}</h1>
          <p className="muted">
            Seed keyword: <strong>{project.seed}</strong>
          </p>
        </div>
        <div className="row">
          <button className="btn" type="button" onClick={rename}>
            Rename
          </button>
          <button className="btn btn-danger" type="button" onClick={remove}>
            Delete
          </button>
        </div>
      </header>

      <ErrorAlert error={error} />

      <section className="card settings-grid" aria-label="Project settings">
        <div className="field">
          <label htmlFor="domain">Google domain</label>
          <select
            id="domain"
            className="input"
            value={project.googleDomain}
            onChange={(e) => void run(() => storage.updateProject(project.id, { googleDomain: e.target.value }))}
          >
            {SUPPORTED_GOOGLE_DOMAINS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="language">Language code</label>
          <input
            id="language"
            className="input"
            defaultValue={project.language}
            onBlur={(e) => {
              if (e.target.value !== project.language) {
                void run(() => storage.updateProject(project.id, { language: e.target.value }));
              }
            }}
          />
          <span className="hint">Sent to Google as hl, e.g. en, de, es</span>
        </div>
        <dl className="stats">
          <div>
            <dt>Unique keywords</dt>
            <dd>{keywords?.length ?? '–'}</dd>
          </div>
          <div>
            <dt>Completed queries</dt>
            <dd>{counts ? counts.succeeded + counts.empty : '–'}</dd>
          </div>
          <div>
            <dt>Pending</dt>
            <dd>{counts?.pending ?? '–'}</dd>
          </div>
          <div>
            <dt>Failed</dt>
            <dd>{counts?.failed ?? '–'}</dd>
          </div>
        </dl>
      </section>

      {jobForProject && <JobPanel job={jobForProject} onOpenTab={() => focusTab(jobForProject.tabId)} />}
      {job && isActive(job) && !jobForProject && (
        <div className="alert alert-info">A collection job is running for another project ({job.projectName}).</div>
      )}

      <QueryPreview
        project={project}
        records={queries ?? []}
        counts={counts}
        jobActive={isActive(job)}
        onSave={(patch) => run(() => storage.updateProject(project.id, patch))}
      />

      <section className="card stack" aria-labelledby="keywords-heading">
        <div className="row spread">
          <h2 id="keywords-heading">Keywords</h2>
          <label className="visually-hidden" htmlFor="kw-search">
            Search keywords
          </label>
          <input
            id="kw-search"
            className="input search"
            type="search"
            placeholder="Search keywords"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {keywords === null ? (
          <p className="muted" role="status">
            Loading keywords…
          </p>
        ) : keywords.length === 0 ? (
          <p className="muted">
            No keywords collected yet. Collected Google Autocomplete suggestions will appear here.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Keyword</th>
                  <th scope="col">Methods</th>
                  <th scope="col">Source queries</th>
                  <th scope="col">Seen</th>
                  <th scope="col">Last collected</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((k) => (
                  <tr key={k.id}>
                    <td>{k.text}</td>
                    <td>{k.methods.map((m) => RESEARCH_METHOD_LABELS[m]).join(', ')}</td>
                    <td className="muted">{k.sourceQueries.join(' · ')}</td>
                    <td>{k.collectionCount}</td>
                    <td className="muted">{new Date(k.lastCollectedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
