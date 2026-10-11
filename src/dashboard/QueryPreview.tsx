import { useMemo, useState } from 'react';
import {
  generateAzQueries,
  generatePrefixQueries,
  generateSuffixQueries,
  generateTemplateQueries,
  LETTERS,
  parseAffixInput,
  type GeneratedQuery,
} from '../core/queryGeneration';
import { normalizeText } from '../core/keywords';
import type { Project, ProjectPatch, ResearchMethod } from '../shared/types';
import { RESEARCH_METHODS, RESEARCH_METHOD_LABELS } from '../shared/types';
import { errorMessage } from '../ui/components';

interface Props {
  project: Project;
  onSave: (patch: ProjectPatch) => Promise<void>;
}

const LIST_FIELD: Partial<Record<ResearchMethod, 'prefixes' | 'suffixes' | 'templates'>> = {
  prefix: 'prefixes',
  suffix: 'suffixes',
  template: 'templates',
};

const LIST_HINT: Partial<Record<ResearchMethod, string>> = {
  prefix: 'One prefix per line, e.g. best, affordable, cheap',
  suffix: 'One suffix per line, e.g. near me, cost, prices',
  template: 'One template per line using {seed} and optionally {letter}, e.g. {seed} for {letter}',
};

function parseTemplates(value: string): string[] {
  return value.split('\n').map(normalizeText).filter(Boolean);
}

/** Edits a project's prefix/suffix/template lists and previews the queries each method would run. */
export function QueryPreview({ project, onSave }: Props) {
  const [method, setMethod] = useState<ResearchMethod>('az');
  const [startLetter, setStartLetter] = useState('a');
  const [drafts, setDrafts] = useState({
    prefixes: project.prefixes.join('\n'),
    suffixes: project.suffixes.join('\n'),
    templates: project.templates.join('\n'),
  });
  const field = LIST_FIELD[method];

  const preview = useMemo((): { queries: GeneratedQuery[]; error?: string } => {
    try {
      switch (method) {
        case 'az':
          return { queries: generateAzQueries(project.seed, { startLetter }) };
        case 'prefix':
          return { queries: generatePrefixQueries(project.seed, parseAffixInput(drafts.prefixes)) };
        case 'suffix':
          return { queries: generateSuffixQueries(project.seed, parseAffixInput(drafts.suffixes)) };
        case 'template':
          return { queries: generateTemplateQueries(project.seed, parseTemplates(drafts.templates)) };
      }
    } catch (e) {
      return { queries: [], error: errorMessage(e) };
    }
  }, [method, startLetter, drafts, project.seed]);

  const dirty = field !== undefined && drafts[field] !== project[field].join('\n');

  async function save() {
    if (!field) return;
    const list = field === 'templates' ? parseTemplates(drafts.templates) : parseAffixInput(drafts[field]);
    await onSave({ [field]: list });
    setDrafts((d) => ({ ...d, [field]: list.join('\n') }));
  }

  return (
    <section className="card stack" aria-labelledby="queries-heading">
      <h2 id="queries-heading">Research queries</h2>
      <div className="tabs" role="tablist" aria-label="Research method">
        {RESEARCH_METHODS.map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={m === method}
            className={`tab${m === method ? ' active' : ''}`}
            onClick={() => setMethod(m)}
          >
            {RESEARCH_METHOD_LABELS[m]}
          </button>
        ))}
      </div>

      <div className="preview-grid" role="tabpanel">
        <div className="stack">
          {method === 'az' ? (
            <div className="field">
              <label htmlFor="start-letter">Start from letter</label>
              <select id="start-letter" className="input" value={startLetter} onChange={(e) => setStartLetter(e.target.value)}>
                {LETTERS.map((l) => (
                  <option key={l} value={l}>
                    {l.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            field && (
              <div className="field">
                <label htmlFor={`list-${field}`}>{RESEARCH_METHOD_LABELS[method]} list</label>
                <textarea
                  id={`list-${field}`}
                  className="input"
                  rows={8}
                  value={drafts[field]}
                  onChange={(e) => setDrafts((d) => ({ ...d, [field]: e.target.value }))}
                />
                <span className="hint">{LIST_HINT[method]}</span>
                <div className="row">
                  <button className="btn btn-primary" type="button" disabled={!dirty || Boolean(preview.error)} onClick={() => void save()}>
                    Save list
                  </button>
                  {dirty && <span className="muted small">Unsaved changes</span>}
                </div>
              </div>
            )
          )}
        </div>

        <div className="stack">
          <div className="muted small" aria-live="polite">
            {preview.error ? '' : `${preview.queries.length} queries`}
          </div>
          {preview.error ? (
            <div className="alert alert-error" role="alert">
              {preview.error}
            </div>
          ) : preview.queries.length === 0 ? (
            <p className="muted">Add entries to preview queries.</p>
          ) : (
            <ol className="query-list">
              {preview.queries.map((q) => (
                <li key={q.key}>{q.text}</li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
