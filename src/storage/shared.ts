// Logic shared by every StorageService implementation, so behavior stays identical.
import { DEFAULT_GOOGLE_DOMAIN, DEFAULT_LANGUAGE, LIMITS, SUPPORTED_GOOGLE_DOMAINS } from '../shared/constants';
import type { KeywordRecord, NewProjectInput, Project, ProjectPatch, QueryCounts, QueryRecord } from '../shared/types';
import type { ProjectBackup } from '../core/backup';
import { cleanSuggestions, keywordId, normalizeKey, normalizeText } from '../core/keywords';
import { cleanAffixList, validateSeed, validateTemplate, ValidationError, type GeneratedQuery } from '../core/queryGeneration';
import type { QueryOutcome } from './StorageService';

export function newId(): string {
  return crypto.randomUUID();
}

export function queryId(projectId: string, q: Pick<GeneratedQuery, 'method' | 'key'>): string {
  return `${projectId}:${q.method}:${q.key}`;
}

function validateProjectFields(fields: ProjectPatch): ProjectPatch {
  const out: ProjectPatch = {};
  if (fields.name !== undefined) {
    const name = normalizeText(fields.name);
    if (!name) throw new ValidationError('Enter a project name.');
    if (name.length > LIMITS.projectNameMaxLength) {
      throw new ValidationError(`Project name must be ${LIMITS.projectNameMaxLength} characters or fewer.`);
    }
    out.name = name;
  }
  if (fields.seed !== undefined) {
    const error = validateSeed(fields.seed);
    if (error) throw new ValidationError(error);
    out.seed = normalizeText(fields.seed);
  }
  if (fields.googleDomain !== undefined) {
    if (!(SUPPORTED_GOOGLE_DOMAINS as readonly string[]).includes(fields.googleDomain)) {
      throw new ValidationError(`Unsupported Google domain: ${fields.googleDomain}`);
    }
    out.googleDomain = fields.googleDomain;
  }
  if (fields.language !== undefined) {
    const lang = fields.language.trim();
    if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang)) throw new ValidationError(`Invalid language code: ${fields.language}`);
    out.language = lang;
  }
  if (fields.prefixes !== undefined) out.prefixes = cleanAffixList(fields.prefixes);
  if (fields.suffixes !== undefined) out.suffixes = cleanAffixList(fields.suffixes);
  if (fields.templates !== undefined) {
    if (fields.templates.length > LIMITS.maxTemplates) throw new ValidationError(`Use at most ${LIMITS.maxTemplates} templates.`);
    const templates = fields.templates.map(normalizeText).filter(Boolean);
    for (const t of templates) {
      const error = validateTemplate(t);
      if (error) throw new ValidationError(error);
    }
    out.templates = [...new Set(templates)];
  }
  return out;
}

export function buildProject(input: NewProjectInput, now: number): Project {
  const fields = validateProjectFields({
    googleDomain: DEFAULT_GOOGLE_DOMAIN,
    language: DEFAULT_LANGUAGE,
    prefixes: [],
    suffixes: [],
    templates: [],
    ...input,
  });
  return {
    id: newId(),
    name: fields.name!,
    seed: fields.seed!,
    googleDomain: fields.googleDomain!,
    language: fields.language!,
    prefixes: fields.prefixes!,
    suffixes: fields.suffixes!,
    templates: fields.templates!,
    createdAt: now,
    updatedAt: now,
  };
}

export function applyProjectPatch(project: Project, patch: ProjectPatch, now: number): Project {
  return { ...project, ...validateProjectFields(patch), updatedAt: now };
}

export function buildQueryRecord(projectId: string, q: GeneratedQuery, position: number, now: number): QueryRecord {
  return {
    id: queryId(projectId, q),
    projectId,
    text: q.text,
    key: q.key,
    method: q.method,
    position,
    status: 'pending',
    attempts: 0,
    suggestionCount: 0,
    createdAt: now,
  };
}

/** Validates an outcome and returns the suggestions to merge. */
export function checkOutcome(outcome: QueryOutcome): string[] {
  const suggestions = cleanSuggestions(outcome.suggestions);
  if (outcome.status === 'succeeded' && suggestions.length === 0) {
    throw new ValidationError('A succeeded outcome must include at least one suggestion; use "empty" instead.');
  }
  if (outcome.status !== 'succeeded' && suggestions.length > 0) {
    throw new ValidationError(`An outcome with status "${outcome.status}" cannot include suggestions.`);
  }
  if (outcome.status === 'failed' && !outcome.error) {
    throw new ValidationError('A failed outcome must include an error message.');
  }
  return suggestions;
}

export function applyOutcome(query: QueryRecord, outcome: QueryOutcome, suggestionCount: number): QueryRecord {
  const next: QueryRecord = {
    ...query,
    status: outcome.status,
    attempts: query.attempts + 1,
    suggestionCount,
    lastAttemptAt: outcome.at,
  };
  if (outcome.error) next.lastError = outcome.error;
  else delete next.lastError;
  return next;
}

export function countStatuses(queries: readonly QueryRecord[]): QueryCounts {
  const counts: QueryCounts = { total: queries.length, pending: 0, succeeded: 0, empty: 0, failed: 0 };
  for (const q of queries) counts[q.status]++;
  return counts;
}

export function sortQueries(queries: QueryRecord[]): QueryRecord[] {
  return queries.sort((a, b) => a.position - b.position);
}

/** Picks a project name that doesn't clash: "Name", then "Name (imported)", "Name (imported 2)", … */
export function uniqueImportName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const base = normalizeText(name).slice(0, LIMITS.projectNameMaxLength - 14) || 'Imported project';
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? `${base} (imported)` : `${base} (imported ${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Turns a validated backup into brand-new records for a NEW project. Nothing
 * from the file is used as an id, so an import can never overwrite or merge
 * into an existing project.
 */
export function buildImportRecords(
  backup: ProjectBackup,
  existingNames: readonly string[],
  now: number,
): { project: Project; queries: QueryRecord[]; keywords: KeywordRecord[] } {
  const project = buildProject(
    {
      name: uniqueImportName(backup.project.name, existingNames),
      seed: backup.project.seed,
      googleDomain: backup.project.googleDomain,
      language: backup.project.language,
      prefixes: backup.project.prefixes,
      suffixes: backup.project.suffixes,
      templates: backup.project.templates,
    },
    now,
  );
  const queries = new Map<string, QueryRecord>();
  for (const q of [...backup.queries].sort((a, b) => a.position - b.position)) {
    const text = normalizeText(q.text);
    const key = normalizeKey(text);
    const id = queryId(project.id, { method: q.method, key });
    if (queries.has(id)) continue;
    const record: QueryRecord = {
      id,
      projectId: project.id,
      text,
      key,
      method: q.method,
      position: queries.size,
      status: q.status,
      attempts: q.attempts,
      suggestionCount: q.suggestionCount,
      createdAt: q.createdAt,
    };
    if (q.lastError !== undefined) record.lastError = q.lastError;
    if (q.lastAttemptAt !== undefined) record.lastAttemptAt = q.lastAttemptAt;
    queries.set(id, record);
  }
  const keywords = backup.keywords.map((k): KeywordRecord => {
    const key = normalizeKey(k.text);
    return {
      id: keywordId(project.id, key),
      projectId: project.id,
      text: normalizeText(k.text),
      key,
      sourceQueries: [...k.sourceQueries],
      methods: [...k.methods],
      firstCollectedAt: k.firstCollectedAt,
      lastCollectedAt: k.lastCollectedAt,
      collectionCount: k.collectionCount,
    };
  });
  return { project, queries: [...queries.values()], keywords };
}
