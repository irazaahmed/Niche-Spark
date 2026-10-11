// JSON backup format: export a whole project, and validate a backup file
// before it is imported. Imports always create a new project (see storage).
import { LIMITS, SUPPORTED_GOOGLE_DOMAINS } from '../shared/constants';
import type { KeywordRecord, Project, QueryRecord, QueryStatus, ResearchMethod } from '../shared/types';
import { RESEARCH_METHODS } from '../shared/types';
import { normalizeKey, normalizeText } from './keywords';
import { ValidationError } from './queryGeneration';

export const BACKUP_FORMAT = 'nichespark-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const MAX_KEYWORDS = 500_000;
const MAX_QUERIES = 100_000;
const QUERY_STATUSES: readonly QueryStatus[] = ['pending', 'succeeded', 'empty', 'failed'];

export interface BackupProject {
  name: string;
  seed: string;
  googleDomain: string;
  language: string;
  prefixes: string[];
  suffixes: string[];
  templates: string[];
  createdAt: number;
  updatedAt: number;
}

export interface BackupQuery {
  text: string;
  method: ResearchMethod;
  position: number;
  status: QueryStatus;
  attempts: number;
  suggestionCount: number;
  lastError?: string;
  lastAttemptAt?: number;
  createdAt: number;
}

export interface BackupKeyword {
  text: string;
  sourceQueries: string[];
  methods: ResearchMethod[];
  firstCollectedAt: number;
  lastCollectedAt: number;
  collectionCount: number;
}

export interface ProjectBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  app: { name: 'NicheSpark'; version: string };
  project: BackupProject;
  queries: BackupQuery[];
  keywords: BackupKeyword[];
}

/** Builds a backup. Internal ids are left out; they are re-created on import. */
export function buildBackup(
  project: Project,
  queries: readonly QueryRecord[],
  keywords: readonly KeywordRecord[],
  appVersion: string,
  now = new Date(),
): ProjectBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    app: { name: 'NicheSpark', version: appVersion },
    project: {
      name: project.name,
      seed: project.seed,
      googleDomain: project.googleDomain,
      language: project.language,
      prefixes: [...project.prefixes],
      suffixes: [...project.suffixes],
      templates: [...project.templates],
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    queries: queries.map((q) => {
      const out: BackupQuery = {
        text: q.text,
        method: q.method,
        position: q.position,
        status: q.status,
        attempts: q.attempts,
        suggestionCount: q.suggestionCount,
        createdAt: q.createdAt,
      };
      if (q.lastError !== undefined) out.lastError = q.lastError;
      if (q.lastAttemptAt !== undefined) out.lastAttemptAt = q.lastAttemptAt;
      return out;
    }),
    keywords: keywords.map((k) => ({
      text: k.text,
      sourceQueries: [...k.sourceQueries],
      methods: [...k.methods],
      firstCollectedAt: k.firstCollectedAt,
      lastCollectedAt: k.lastCollectedAt,
      collectionCount: k.collectionCount,
    })),
  };
}

export function serializeBackup(backup: ProjectBackup): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

// ── Validation ─────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

class Checker {
  constructor(private readonly errors: string[]) {}

  fail(path: string, message: string) {
    if (this.errors.length < 20) this.errors.push(`${path} ${message}`);
  }
  obj(v: unknown, path: string): Obj | null {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Obj;
    this.fail(path, 'must be an object.');
    return null;
  }
  text(o: Obj, key: string, path: string, { required = true, max = 1000 } = {}): string | undefined {
    const v = o[key];
    if (v === undefined && !required) return undefined;
    if (typeof v !== 'string') {
      this.fail(`${path}.${key}`, 'must be text.');
      return undefined;
    }
    if (v.length > max) this.fail(`${path}.${key}`, `is longer than ${max} characters.`);
    return v;
  }
  time(o: Obj, key: string, path: string, required = true): number | undefined {
    const v = o[key];
    if (v === undefined && !required) return undefined;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 8.64e15) {
      this.fail(`${path}.${key}`, 'must be a valid timestamp.');
      return undefined;
    }
    return v;
  }
  count(o: Obj, key: string, path: string): number | undefined {
    const v = o[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      this.fail(`${path}.${key}`, 'must be a whole number of 0 or more.');
      return undefined;
    }
    return v;
  }
  textList(o: Obj, key: string, path: string, max: number): string[] | undefined {
    const v = o[key];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
      this.fail(`${path}.${key}`, 'must be a list of text.');
      return undefined;
    }
    if (v.length > max) this.fail(`${path}.${key}`, `has more than ${max} entries.`);
    return v as string[];
  }
  method(v: unknown, path: string): ResearchMethod | undefined {
    if (typeof v === 'string' && (RESEARCH_METHODS as readonly string[]).includes(v)) return v as ResearchMethod;
    this.fail(path, `must be one of ${RESEARCH_METHODS.join(', ')}.`);
    return undefined;
  }
}

/**
 * Parses and validates a backup file's text. Throws ValidationError listing
 * what is wrong (up to 20 problems). Keyword keys are recomputed from the
 * text, and duplicates inside the file are merged without losing sources.
 */
export function parseBackup(text: string): ProjectBackup {
  if (text.length > MAX_BACKUP_BYTES) throw new ValidationError('The backup file is larger than 50 MB.');
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) /* tolerate a BOM */;
  } catch {
    throw new ValidationError('This file is not valid JSON. Choose a backup exported from NicheSpark.');
  }
  const errors: string[] = [];
  const c = new Checker(errors);
  const root = c.obj(raw, 'The file');
  if (!root) throw new ValidationError(errors.join('\n'));
  if (root.format !== BACKUP_FORMAT) {
    throw new ValidationError('This is not a NicheSpark backup file (the "format" field is missing or different).');
  }
  if (root.version !== BACKUP_VERSION) {
    throw new ValidationError(`Unsupported backup version ${String(root.version)}. This version of NicheSpark reads version ${BACKUP_VERSION}.`);
  }

  const p = c.obj(root.project, 'project');
  let project: BackupProject | undefined;
  if (p) {
    const name = c.text(p, 'name', 'project', { max: LIMITS.projectNameMaxLength });
    const seed = c.text(p, 'seed', 'project', { max: LIMITS.seedMaxLength });
    const googleDomain = c.text(p, 'googleDomain', 'project', { max: 100 });
    if (googleDomain !== undefined && !(SUPPORTED_GOOGLE_DOMAINS as readonly string[]).includes(googleDomain)) {
      c.fail('project.googleDomain', `"${googleDomain}" is not a supported Google domain.`);
    }
    const language = c.text(p, 'language', 'project', { max: 10 });
    const prefixes = c.textList(p, 'prefixes', 'project', LIMITS.maxAffixes);
    const suffixes = c.textList(p, 'suffixes', 'project', LIMITS.maxAffixes);
    const templates = c.textList(p, 'templates', 'project', LIMITS.maxTemplates);
    const createdAt = c.time(p, 'createdAt', 'project');
    const updatedAt = c.time(p, 'updatedAt', 'project');
    if (name !== undefined && !normalizeText(name)) c.fail('project.name', 'is empty.');
    if (seed !== undefined && !normalizeText(seed)) c.fail('project.seed', 'is empty.');
    if (name && seed && googleDomain && language && prefixes && suffixes && templates && createdAt !== undefined && updatedAt !== undefined) {
      project = { name, seed, googleDomain, language, prefixes, suffixes, templates, createdAt, updatedAt };
    }
  }

  const queries: BackupQuery[] = [];
  if (!Array.isArray(root.queries)) c.fail('queries', 'must be a list.');
  else if (root.queries.length > MAX_QUERIES) c.fail('queries', `has more than ${MAX_QUERIES} entries.`);
  else {
    root.queries.forEach((item, i) => {
      const path = `queries[${i}]`;
      const q = c.obj(item, path);
      if (!q) return;
      const text = c.text(q, 'text', path, { max: LIMITS.queryMaxLength });
      const method = c.method(q.method, `${path}.method`);
      const status = q.status;
      if (typeof status !== 'string' || !(QUERY_STATUSES as readonly string[]).includes(status)) {
        c.fail(`${path}.status`, `must be one of ${QUERY_STATUSES.join(', ')}.`);
      }
      const position = c.count(q, 'position', path);
      const attempts = c.count(q, 'attempts', path);
      const suggestionCount = c.count(q, 'suggestionCount', path);
      const createdAt = c.time(q, 'createdAt', path);
      const lastError = c.text(q, 'lastError', path, { required: false, max: 2000 });
      const lastAttemptAt = c.time(q, 'lastAttemptAt', path, false);
      if (text !== undefined && !normalizeText(text)) c.fail(`${path}.text`, 'is empty.');
      if (text && method && position !== undefined && attempts !== undefined && suggestionCount !== undefined && createdAt !== undefined) {
        const out: BackupQuery = { text, method, position, status: status as QueryStatus, attempts, suggestionCount, createdAt };
        if (lastError !== undefined) out.lastError = lastError;
        if (lastAttemptAt !== undefined) out.lastAttemptAt = lastAttemptAt;
        queries.push(out);
      }
    });
  }

  const merged = new Map<string, BackupKeyword>();
  if (!Array.isArray(root.keywords)) c.fail('keywords', 'must be a list.');
  else if (root.keywords.length > MAX_KEYWORDS) c.fail('keywords', `has more than ${MAX_KEYWORDS} entries.`);
  else {
    root.keywords.forEach((item, i) => {
      const path = `keywords[${i}]`;
      const k = c.obj(item, path);
      if (!k) return;
      const text = c.text(k, 'text', path, { max: 500 });
      const sourceQueries = c.textList(k, 'sourceQueries', path, 10_000);
      const methodsRaw = k.methods;
      let methods: ResearchMethod[] | undefined;
      if (!Array.isArray(methodsRaw) || methodsRaw.length === 0) c.fail(`${path}.methods`, 'must be a non-empty list.');
      else {
        const list = methodsRaw.map((m, j) => c.method(m, `${path}.methods[${j}]`));
        if (list.every(Boolean)) methods = list as ResearchMethod[];
      }
      const firstCollectedAt = c.time(k, 'firstCollectedAt', path);
      const lastCollectedAt = c.time(k, 'lastCollectedAt', path);
      const collectionCount = c.count(k, 'collectionCount', path);
      if (text !== undefined && !normalizeText(text)) c.fail(`${path}.text`, 'is empty.');
      if (firstCollectedAt !== undefined && lastCollectedAt !== undefined && firstCollectedAt > lastCollectedAt) {
        c.fail(path, 'has firstCollectedAt after lastCollectedAt.');
      }
      if (!text || !normalizeText(text) || !sourceQueries || !methods || firstCollectedAt === undefined || lastCollectedAt === undefined || collectionCount === undefined) return;
      const key = normalizeKey(text);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          text: normalizeText(text),
          sourceQueries: [...new Set(sourceQueries.map(normalizeText).filter(Boolean))],
          methods: [...new Set(methods)],
          firstCollectedAt,
          lastCollectedAt,
          collectionCount: Math.max(1, collectionCount),
        });
      } else {
        existing.sourceQueries = [...new Set([...existing.sourceQueries, ...sourceQueries.map(normalizeText).filter(Boolean)])];
        existing.methods = [...new Set([...existing.methods, ...methods])];
        existing.firstCollectedAt = Math.min(existing.firstCollectedAt, firstCollectedAt);
        existing.lastCollectedAt = Math.max(existing.lastCollectedAt, lastCollectedAt);
        existing.collectionCount += Math.max(1, collectionCount);
      }
    });
  }

  if (errors.length || !project) {
    throw new ValidationError(`The backup file has problems and was not imported:\n• ${errors.join('\n• ')}`);
  }
  const exportedAt = typeof root.exportedAt === 'string' ? root.exportedAt : '';
  const app = c.obj(root.app, 'app');
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    app: { name: 'NicheSpark', version: app && typeof app.version === 'string' ? app.version : 'unknown' },
    project,
    queries,
    keywords: [...merged.values()],
  };
}
