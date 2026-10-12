import { useEffect, useMemo, useState } from 'react';
import { exportFileName, keywordsToCsv, keywordsToLines } from '../core/exportCsv';
import { findEchoKeywords } from '../core/keywords';
import { detectTheme, summarizeModifiers, summarizeThemes, THEME_LABELS, type KeywordTheme } from '../core/keywordGroups';
import { filterKeywords, KEYWORD_SORT_LABELS, listSourceQueries, sortKeywords, type KeywordSort } from '../core/keywordFilters';
import type { KeywordRecord, Project, ResearchMethod } from '../shared/types';
import { RESEARCH_METHODS, RESEARCH_METHOD_LABELS } from '../shared/types';
import { getStorage } from '../storage';
import { ErrorAlert } from '../ui/components';
import { copyText, downloadText } from '../ui/download';

const PAGE_SIZE = 200;
const SORT_KEY = 'ui.keywordSort';

interface Props {
  project: Project;
  keywords: KeywordRecord[] | null;
  onChanged: () => Promise<void>;
}

function readSort(): KeywordSort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    if (v && v in KEYWORD_SORT_LABELS) return v as KeywordSort;
  } catch {
    /* storage unavailable */
  }
  return 'alpha-asc';
}

/** Keyword list with search, filters, sorting, selection, copy, CSV export and delete. */
export function KeywordTable({ project, keywords, onChanged }: Props) {
  const storage = getStorage();
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState<ResearchMethod | ''>('');
  const [sourceQuery, setSourceQuery] = useState('');
  const [theme, setTheme] = useState<KeywordTheme | ''>('');
  const [modifier, setModifier] = useState('');
  const [sort, setSort] = useState<KeywordSort>(readSort);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<unknown>(null);

  const all = keywords ?? [];
  const sources = useMemo(() => listSourceQueries(all), [all]);
  const visible = useMemo(
    () =>
      sortKeywords(
        filterKeywords(all, {
          search,
          methods: method ? [method] : [],
          sourceQuery,
          ...(theme ? { theme } : {}),
          ...(modifier ? { modifier, seed: project.seed } : {}),
        }),
        sort,
      ),
    [all, search, method, sourceQuery, theme, modifier, project.seed, sort],
  );
  const filtered = Boolean(search.trim() || method || sourceQuery || theme || modifier);
  const themes = useMemo(() => summarizeThemes(all), [all]);
  const modifiers = useMemo(() => summarizeModifiers(all, project.seed), [all, project.seed]);
  // Echoes of unfinished A to Z queries saved by versions before 0.2.1.
  const echoes = useMemo(() => findEchoKeywords(all), [all]);

  // Drop selections for keywords that no longer exist (deleted or re-imported).
  useEffect(() => {
    const ids = new Set(all.map((k) => k.id));
    setSelected((s) => {
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [all]);

  useEffect(() => setLimit(PAGE_SIZE), [search, method, sourceQuery, theme, modifier, sort]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const selectedKeywords = all.filter((k) => selected.has(k.id));
  const allVisibleSelected = visible.length > 0 && visible.every((k) => selected.has(k.id));

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((s) => {
      const next = new Set(s);
      if (allVisibleSelected) for (const k of visible) next.delete(k.id);
      else for (const k of visible) next.add(k.id);
      return next;
    });
  }

  async function act(fn: () => Promise<string | void>) {
    setError(null);
    try {
      const message = await fn();
      if (message) setNotice(message);
    } catch (e) {
      setError(e);
    }
  }

  const copy = (list: KeywordRecord[], label: string) =>
    act(async () => {
      await copyText(keywordsToLines(list));
      return `Copied ${list.length} ${label} keyword${list.length === 1 ? '' : 's'}.`;
    });

  const exportCsv = (list: KeywordRecord[], suffix: string) =>
    act(async () => {
      downloadText(exportFileName(project.name, 'csv', new Date(), suffix), keywordsToCsv(list), 'text/csv;charset=utf-8');
      return `Exported ${list.length} keyword${list.length === 1 ? '' : 's'} to CSV.`;
    });

  const deleteSelected = () =>
    act(async () => {
      const n = selectedKeywords.length;
      if (!window.confirm(`Delete ${n} selected keyword${n === 1 ? '' : 's'} from "${project.name}"?\n\nThis cannot be undone.`)) return;
      const deleted = await storage.deleteKeywords(project.id, [...selected]);
      setSelected(new Set());
      await onChanged();
      return `Deleted ${deleted} keyword${deleted === 1 ? '' : 's'}.`;
    });

  const removeEchoes = () =>
    act(async () => {
      const n = echoes.length;
      const examples = echoes.slice(0, 3).map((k) => `"${k.text}"`).join(", ");
      if (!window.confirm(`Remove ${n} keyword${n === 1 ? "" : "s"} that only repeat an A to Z search query (for example ${examples})?

These are not real suggestions. Other keywords are not touched.`)) return;
      const deleted = await storage.deleteKeywords(project.id, echoes.map((k) => k.id));
      await onChanged();
      return `Removed ${deleted} echo keyword${deleted === 1 ? "" : "s"}.`;
    });

  function changeSort(value: KeywordSort) {
    setSort(value);
    try {
      localStorage.setItem(SORT_KEY, value);
    } catch {
      /* not remembered */
    }
  }

  function clearFilters() {
    setSearch('');
    setMethod('');
    setSourceQuery('');
    setTheme('');
    setModifier('');
  }

  return (
    <section className="card stack" aria-labelledby="keywords-heading">
      <div className="row spread">
        <h2 id="keywords-heading">
          Keywords <span className="count-badge">{all.length}</span>
        </h2>
        <div className="row">
          <button className="btn" type="button" disabled={!all.length} onClick={() => void copy(all, 'project')}>
            Copy all
          </button>
          <button className="btn btn-primary" type="button" disabled={!all.length} onClick={() => void exportCsv(all, 'all')}>
            Export all (CSV)
          </button>
        </div>
      </div>

      <div className="filters" role="search" aria-label="Filter keywords">
        <div className="field grow">
          <label htmlFor="kw-search">Search</label>
          <input id="kw-search" className="input" type="search" placeholder="Search keywords" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="kw-method">Method</label>
          <select id="kw-method" className="input" value={method} onChange={(e) => setMethod(e.target.value as ResearchMethod | '')}>
            <option value="">All methods</option>
            {RESEARCH_METHODS.map((m) => (
              <option key={m} value={m}>
                {RESEARCH_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="kw-source">Source query</label>
          <select id="kw-source" className="input" value={sourceQuery} onChange={(e) => setSourceQuery(e.target.value)}>
            <option value="">All source queries</option>
            {sources.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="kw-theme">Theme</label>
          <select id="kw-theme" className="input" value={theme} onChange={(e) => setTheme(e.target.value as KeywordTheme | '')}>
            <option value="">All themes</option>
            {themes.map((g) => (
              <option key={g.key} value={g.key}>
                {THEME_LABELS[g.key]} ({g.count})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="kw-sort">Sort</label>
          <select id="kw-sort" className="input" value={sort} onChange={(e) => changeSort(e.target.value as KeywordSort)}>
            {(Object.keys(KEYWORD_SORT_LABELS) as KeywordSort[]).map((s) => (
              <option key={s} value={s}>
                {KEYWORD_SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {modifiers.length > 0 && (
        <div className="modifier-groups" role="group" aria-label="Group by modifier">
          <span className="muted small">Groups by modifier:</span>
          {modifiers.map((m) => (
            <button
              key={m.key}
              type="button"
              className={`chip${modifier === m.key ? ' active' : ''}`}
              aria-pressed={modifier === m.key}
              onClick={() => setModifier(modifier === m.key ? '' : m.key)}
            >
              {m.key} <span className="chip-count">{m.count}</span>
            </button>
          ))}
        </div>
      )}

      {all.length > 0 && (
        <div className="action-bar" aria-live="polite">
          <span className="muted small">
            {filtered ? `${visible.length} of ${all.length} shown` : `${all.length} keywords`}
            {selected.size > 0 && ` · ${selected.size} selected`}
            {filtered && (
              <>
                {' · '}
                <button className="link" type="button" onClick={clearFilters}>
                  Clear filters
                </button>
              </>
            )}
          </span>
          <div className="row">
            {filtered && (
              <>
                <button className="btn btn-sm" type="button" disabled={!visible.length} onClick={() => void copy(visible, 'filtered')}>
                  Copy filtered
                </button>
                <button className="btn btn-sm" type="button" disabled={!visible.length} onClick={() => void exportCsv(visible, 'filtered')}>
                  CSV: filtered
                </button>
              </>
            )}
            <button className="btn btn-sm" type="button" disabled={!selected.size} onClick={() => void copy(selectedKeywords, 'selected')}>
              Copy selected
            </button>
            <button className="btn btn-sm" type="button" disabled={!selected.size} onClick={() => void exportCsv(selectedKeywords, 'selected')}>
              CSV: selected
            </button>
            <button className="btn btn-sm btn-danger" type="button" disabled={!selected.size} onClick={() => void deleteSelected()}>
              Delete selected
            </button>
          </div>
        </div>
      )}

      {echoes.length > 0 && (
        <div className="alert alert-info cleanup-bar">
          <span>
            <strong>{echoes.length}</strong> keyword{echoes.length === 1 ? "" : "s"} only repeat an A to Z search query
            (like <em>{echoes[0]?.text}</em>) and aren&apos;t real suggestions.
          </span>
          <button className="btn btn-sm" type="button" onClick={() => void removeEchoes()}>
            Clean up
          </button>
        </div>
      )}

      {notice && (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      )}
      <ErrorAlert error={error} />

      {keywords === null ? (
        <p className="muted" role="status">
          Loading keywords…
        </p>
      ) : all.length === 0 ? (
        <div className="empty-inline">
          <p>No keywords collected yet.</p>
          <p className="muted small">Start a collection above. Google Autocomplete suggestions are saved here automatically.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-inline">
          <p>No keywords match these filters.</p>
          <button className="btn btn-sm" type="button" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col" className="check-col">
                    <input
                      type="checkbox"
                      aria-label={allVisibleSelected ? 'Unselect all shown keywords' : 'Select all shown keywords'}
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                    />
                  </th>
                  <th scope="col">Keyword</th>
                  <th scope="col">Theme</th>
                  <th scope="col">Methods</th>
                  <th scope="col">Source queries</th>
                  <th scope="col" className="num">Seen</th>
                  <th scope="col">Last collected</th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, limit).map((k) => (
                  <tr key={k.id} className={selected.has(k.id) ? 'selected' : undefined}>
                    <td className="check-col">
                      <input type="checkbox" aria-label={`Select ${k.text}`} checked={selected.has(k.id)} onChange={() => toggle(k.id)} />
                    </td>
                    <td className="kw-text">{k.text}</td>
                    <td className="muted nowrap">{THEME_LABELS[detectTheme(k.text)]}</td>
                    <td>
                      <div className="tags">
                        {k.methods.map((m) => (
                          <span key={m} className="tag">
                            {RESEARCH_METHOD_LABELS[m]}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="muted sources">{k.sourceQueries.join(' · ')}</td>
                    <td className="num">{k.collectionCount}</td>
                    <td className="muted nowrap">{new Date(k.lastCollectedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visible.length > limit && (
            <button className="btn" type="button" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, visible.length - limit)} more ({visible.length - limit} hidden)
            </button>
          )}
        </>
      )}
    </section>
  );
}
