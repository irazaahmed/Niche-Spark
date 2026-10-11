import { useCallback, useEffect, useState } from 'react';
import type { NewProjectInput, Project } from '../shared/types';
import { getStorage } from '../storage';
import { Brand, ErrorAlert, NewProjectForm } from '../ui/components';
import { setLastProjectId } from '../ui/preferences';
import { ImportBackup } from './ImportBackup';
import { ProjectView } from './ProjectView';

function projectIdFromHash(): string | undefined {
  const match = /project=([^&]+)/.exec(location.hash);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function Dashboard() {
  const storage = getStorage();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>(projectIdFromHash);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setProjects(await storage.listProjects());
    } catch (e) {
      setError(e);
      setProjects([]);
    }
  }, [storage]);

  useEffect(() => {
    void load();
    const onHash = () => setSelectedId(projectIdFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [load]);

  function select(id: string | undefined) {
    location.hash = id ? `project=${encodeURIComponent(id)}` : '';
    setSelectedId(id);
    void setLastProjectId(id);
  }

  async function create(input: NewProjectInput) {
    const project = await storage.createProject(input);
    await load();
    select(project.id);
  }

  const selected = projects?.find((p) => p.id === selectedId);

  return (
    <div className="layout">
      <aside className="sidebar stack" aria-label="Projects">
        <Brand />
        <nav className="stack">
          <h2 className="sidebar-title">Projects</h2>
          {projects === null && <p className="muted">Loading…</p>}
          {projects?.length === 0 && <p className="muted">No projects yet. Create one below.</p>}
          <ul className="project-list">
            {projects?.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`project-item${p.id === selectedId ? ' active' : ''}`}
                  aria-current={p.id === selectedId ? 'page' : undefined}
                  onClick={() => select(p.id)}
                >
                  <span className="project-name">{p.name}</span>
                  <span className="muted small">{p.seed}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <details className="card" open={projects?.length === 0}>
          <summary>New project</summary>
          <div className="new-project">
            <NewProjectForm onCreate={create} />
          </div>
        </details>
        <ImportBackup
          onImported={async (project) => {
            await load();
            select(project.id);
          }}
        />
      </aside>

      <main className="main">
        <ErrorAlert error={error} />
        {selected ? (
          <ProjectView
            key={selected.id}
            project={selected}
            onChanged={load}
            onDeleted={async () => {
              select(undefined);
              await load();
            }}
          />
        ) : (
          projects !== null && (
            <div className="empty-state card">
              <h1>Choose a project</h1>
              <p className="muted">
                {projects.length
                  ? 'Choose a project from the list to see its keywords.'
                  : 'Create your first project from a seed keyword to start researching.'}
              </p>
            </div>
          )
        )}
      </main>
    </div>
  );
}
