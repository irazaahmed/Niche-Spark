import { useCallback, useEffect, useState } from 'react';
import type { NewProjectInput, Project, QueryCounts } from '../shared/types';
import { getStorage } from '../storage';
import { Brand, ErrorAlert, NewProjectForm } from '../ui/components';
import { isActive } from '../core/collectionState';
import { focusTab, JobPanel } from '../ui/JobPanel';
import { useJob } from '../ui/jobClient';
import { dashboardUrl, getLastProjectId, setLastProjectId } from '../ui/preferences';
import { StartControls } from '../ui/StartControls';
import { useRemoteChange } from '../ui/account';
import { AccountBar } from '../ui/AuthGate';
import { addPackToList, type ModifierPack } from '../core/modifierPacks';
import type { ResearchMethod } from '../shared/types';

interface Summary {
  keywords: number;
  queries: QueryCounts;
}

export function Popup() {
  const storage = getStorage();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const job = useJob();
  const remoteChange = useRemoteChange();

  const load = useCallback(async () => {
    try {
      const list = await storage.listProjects();
      const last = await getLastProjectId();
      setProjects(list);
      setSelectedId(list.some((p) => p.id === last) ? last : list[0]?.id);
      setCreating(list.length === 0);
    } catch (e) {
      setError(e);
      setProjects([]);
    }
  }, [storage]);

  useEffect(() => {
    void load();
  }, [load, remoteChange]);

  useEffect(() => {
    if (!selectedId) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    void setLastProjectId(selectedId);
    Promise.all([storage.countKeywords(selectedId), storage.countQueries(selectedId)])
      .then(([keywords, queries]) => !cancelled && setSummary({ keywords, queries }))
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [selectedId, storage, job?.updatedAt, remoteChange]);

  async function addPack(project: Project, method: ResearchMethod, pack: ModifierPack) {
    const field = method === 'prefix' ? 'prefixes' : method === 'suffix' ? 'suffixes' : method === 'template' ? 'templates' : null;
    if (!field) return;
    const { list } = addPackToList(project[field], pack);
    await storage.updateProject(project.id, { [field]: list });
    await load();
  }

  async function create(input: NewProjectInput) {
    const project = await storage.createProject(input);
    await setLastProjectId(project.id);
    await load();
  }

  const selected = projects?.find((p) => p.id === selectedId);

  return (
    <main className="popup stack">
      <Brand />
      <AccountBar compact />
      <ErrorAlert error={error} />

      {projects === null ? (
        <p className="muted" role="status">
          Loading projects…
        </p>
      ) : creating ? (
        <section className="card stack" aria-labelledby="new-project-heading">
          <h2 id="new-project-heading" className="section-title">
            New research project
          </h2>
          <NewProjectForm onCreate={create} />
          {projects.length > 0 && (
            <button className="btn" type="button" onClick={() => setCreating(false)}>
              Cancel
            </button>
          )}
        </section>
      ) : (
        <section className="stack" aria-label="Current project">
          <div className="field">
            <label htmlFor="project-select">Project</label>
            <div className="row nowrap">
              <select
                id="project-select"
                className="input"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button className="btn" type="button" onClick={() => setCreating(true)}>
                New
              </button>
            </div>
          </div>

          {selected && (
            <div className="card stack">
              <div>
                <div className="muted small">Seed keyword</div>
                <div className="seed">{selected.seed}</div>
              </div>
              <dl className="stats">
                <div>
                  <dt>Keywords</dt>
                  <dd>{summary?.keywords ?? '–'}</dd>
                </div>
                <div>
                  <dt>Completed</dt>
                  <dd>{summary ? summary.queries.succeeded + summary.queries.empty : '–'}</dd>
                </div>
                <div>
                  <dt>Pending</dt>
                  <dd>{summary?.queries.pending ?? '–'}</dd>
                </div>
                <div>
                  <dt>Failed</dt>
                  <dd>{summary?.queries.failed ?? '–'}</dd>
                </div>
              </dl>
            </div>
          )}

          {job && (isActive(job) || job.projectId === selectedId) && (
            <JobPanel job={job} onOpenTab={() => focusTab(job.tabId)} />
          )}

          {selected && !isActive(job) && (
            <section className="card" aria-label="Start collection">
              <StartControls
                project={selected}
                counts={summary?.queries ?? null}
                onAddPack={(method, pack) => addPack(selected, method, pack)}
              />
            </section>
          )}

          <button
            className="btn btn-primary"
            type="button"
            onClick={() => void chrome.tabs.create({ url: dashboardUrl(selectedId) })}
          >
            Open dashboard
          </button>
        </section>
      )}
    </main>
  );
}
