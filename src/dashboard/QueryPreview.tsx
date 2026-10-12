import { useMemo, useState } from 'react';
import {
  generateAzQueries,
  generatePrefixQueries,
  generateQuestionQueries,
  QUESTION_WORDS,
  generateSuffixQueries,
  generateTemplateQueries,
  LETTERS,
  parseAffixInput,
  type GeneratedQuery,
} from '../core/queryGeneration';
import { normalizeText } from '../core/keywords';
import { addPackToList, PREFIX_PACKS, SUFFIX_PACKS, type ModifierPack } from '../core/modifierPacks';
import type { Project, ProjectPatch, QueryCounts, QueryRecord, QueryStatus, ResearchMethod } from '../shared/types';
import { RESEARCH_METHODS, RESEARCH_METHOD_LABELS } from '../shared/types';
import { errorMessage } from '../ui/components';
import { StartControls } from '../ui/StartControls';

const STATUS_LABELS: Record<QueryStatus, string> = { pending: 'Pending', succeeded: 'Done', empty: 'Empty', failed: 'Failed' };

interface Props {
  project: Project;
  records: QueryRecord[];
  counts: QueryCounts | null;
  jobActive: boolean;
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
export function QueryPreview({ project, records, counts, jobActive, onSave }: Props) {
  const [method, setMethod] = useState<ResearchMethod>('az');
  const [startLetter, setStartLetter] = useState('a');
  const [drafts, setDrafts] = useState({
    prefixes: project.prefixes.join('\n'),
    suffixes: project.suffixes.join('\n'),
    templates: project.templates.join('\n'),
  });
  const field = LIST_FIELD[method];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const statusByKey = useMemo(() => {
    const m = new Map<string, QueryRecord>();
    for (const r of records) if (r.method === method) m.set(r.key, r);
    return m;
  }, [records, method]);
  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const preview = useMemo((): { queries: GeneratedQuery[]; error?: string } => {
    try {
      switch (method) {
        case 'az':
          return { queries: generateAzQueries(project.seed, { startLetter }) };
        case 'prefix':
          return { queries: generatePrefixQueries(project.seed, parseAffixInput(drafts.prefixes)) };
        case 'suffix':
          return { queries: generateSuffixQueries(project.seed, parseAffixInput(drafts.suffixes)) };
        case 'question':
          return { queries: generateQuestionQueries(project.seed) };
        case 'template':
          return { queries: generateTemplateQueries(project.seed, parseTemplates(drafts.templates)) };
      }
    } catch (e) {
      return { queries: [], error: errorMessage(e) };
    }
  }, [method, startLetter, drafts, project.seed]);

  const dirty = field !== undefined && drafts[field] !== project[field].join('\n');
  const packs = method === 'prefix' ? PREFIX_PACKS : method === 'suffix' ? SUFFIX_PACKS : [];
  const [packNote, setPackNote] = useState('');

  function addPack(pack: ModifierPack) {
    if (field !== 'prefixes' && field !== 'suffixes') return;
    const current = drafts[field].split(/[\n,]/).map(normalizeText).filter(Boolean);
    const { list, added } = addPackToList(current, pack);
    setDrafts((d) => ({ ...d, [field]: list.join('\n') }));
    setPackNote(added ? `Added ${added} from "${pack.label}". Review the list, then Save list.` : `Everything in "${pack.label}" is already in your list.`);
  }

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
            onClick={() => {
              setMethod(m);
              setSelected(new Set());
              setPackNote('');
            }}
          >
            {RESEARCH_METHOD_LABELS[m]}
          </button>
        ))}
      </div>

      <div className="preview-grid" role="tabpanel">
        <div className="stack">
          {method === 'question' ? (
            <div className="stack">
              <p className="small">
                Puts a question word before your seed so Google suggests the questions people actually ask, ideal for blog
                posts and FAQs.
              </p>
              <div className="tags">
                {QUESTION_WORDS.map((w) => (
                  <span key={w} className="tag">
                    {w}
                  </span>
                ))}
              </div>
              <p className="muted small">Tick queries on the right to collect only some of them.</p>
            </div>
          ) : method === 'az' ? (
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
                {packs.length > 0 && (
                  <div className="packs">
                    <span className="small">Add a ready-made list:</span>
                    <div className="row">
                      {packs.map((p) => (
                        <button key={p.id} type="button" className="btn btn-sm" title={`${p.description}: ${p.words.join(', ')}`} onClick={() => addPack(p)}>
                          + {p.label}
                        </button>
                      ))}
                    </div>
                    {packNote && (
                      <span className="muted small" role="status">
                        {packNote}
                      </span>
                    )}
                  </div>
                )}
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
          <div className="row spread muted small" aria-live="polite">
            <span>{preview.error ? '' : `${preview.queries.length} queries${selected.size ? ` · ${selected.size} selected` : ''}`}</span>
            {selected.size > 0 && (
              <button className="link" type="button" onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            )}
          </div>
          {preview.error ? (
            <div className="alert alert-error" role="alert">
              {preview.error}
            </div>
          ) : preview.queries.length === 0 ? (
            <p className="muted">Add entries to preview queries.</p>
          ) : (
            <ul className="query-list">
              {preview.queries.map((q) => {
                const rec = statusByKey.get(q.key);
                return (
                  <li key={q.key}>
                    <label className="query-row">
                      <input type="checkbox" checked={selected.has(q.key)} onChange={() => toggle(q.key)} />
                      <span className="query-text">{q.text}</span>
                      {rec && (
                        <span className={`status status-${rec.status}`} title={rec.lastError ?? `${rec.suggestionCount} suggestions`}>
                          {STATUS_LABELS[rec.status]}
                          {rec.status === 'succeeded' ? ` · ${rec.suggestionCount}` : ''}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="collect-box">
        <h3 className="collect-title">Collect from Google</h3>
        <StartControls
          key={method}
          project={project}
          counts={counts}
          method={method}
          startLetter={startLetter}
          disabled={jobActive || Boolean(preview.error)}
          {...(field ? { listCount: preview.queries.length } : {})}
          {...(dirty ? { beforeStart: save } : {})}
          {...(selected.size ? { selectedKeys: [...selected] } : {})}
        />
        {jobActive && <p className="muted small">A collection job is active. Pause, finish, or cancel it to start another.</p>}
      </div>
    </section>
  );
}
