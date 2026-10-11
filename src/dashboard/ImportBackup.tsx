import { useRef, useState } from 'react';
import { MAX_BACKUP_BYTES, parseBackup } from '../core/backup';
import type { Project } from '../shared/types';
import { getStorage } from '../storage';
import { ErrorAlert } from '../ui/components';
import { readFileText } from '../ui/download';

/** Imports a NicheSpark JSON backup as a new project. Existing projects are never changed. */
export function ImportBackup({ onImported }: { onImported: (project: Project) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const backup = parseBackup(await readFileText(file, MAX_BACKUP_BYTES));
      const ok = window.confirm(
        `Import "${backup.project.name}" from this backup?\n\n${backup.keywords.length} keywords and ${backup.queries.length} queries will be added as a NEW project. Your existing projects are not changed.`,
      );
      if (!ok) return;
      const project = await getStorage().importProject(backup);
      setNotice(`Imported as "${project.name}" with ${backup.keywords.length} keywords.`);
      await onImported(project);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="stack import-box">
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        id="import-file"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <button className="btn" type="button" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Importing…' : 'Import backup (JSON)'}
      </button>
      {notice && (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      )}
      <ErrorAlert error={error} />
      <p className="muted small">
        Your data lives only in this browser. Use <strong>Backup (JSON)</strong> on a project to save a copy; removing the
        extension or clearing its data deletes everything.
      </p>
    </div>
  );
}
