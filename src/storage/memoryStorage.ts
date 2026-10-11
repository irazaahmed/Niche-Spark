import type { KeywordRecord, NewProjectInput, Project, ProjectPatch, QueryRecord, ResearchMethod } from '../shared/types';
import { keywordId, mergeSuggestion, normalizeKey } from '../core/keywords';
import type { GeneratedQuery } from '../core/queryGeneration';
import type { ProjectBackup } from '../core/backup';
import { NotFoundError, type QueryOutcome, type RecordOutcomeResult, type StorageService } from './StorageService';
import {
  applyOutcome,
  applyProjectPatch,
  buildImportRecords,
  buildProject,
  buildQueryRecord,
  checkOutcome,
  countStatuses,
  queryId,
  sortQueries,
} from './shared';

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory StorageService. Used by unit tests and as the reference behavior. */
export class MemoryStorage implements StorageService {
  private projects = new Map<string, Project>();
  private queries = new Map<string, QueryRecord>();
  private keywords = new Map<string, KeywordRecord>();

  constructor(private readonly now: () => number = Date.now) {}

  async listProjects() {
    return [...this.projects.values()].map(clone).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getProject(id: string) {
    const p = this.projects.get(id);
    return p && clone(p);
  }

  async createProject(input: NewProjectInput) {
    const project = buildProject(input, this.now());
    this.projects.set(project.id, project);
    return clone(project);
  }

  async updateProject(id: string, patch: ProjectPatch) {
    const project = this.requireProject(id);
    const next = applyProjectPatch(project, patch, this.now());
    this.projects.set(id, next);
    return clone(next);
  }

  async deleteProject(id: string) {
    this.requireProject(id);
    this.projects.delete(id);
    for (const [k, q] of this.queries) if (q.projectId === id) this.queries.delete(k);
    for (const [k, kw] of this.keywords) if (kw.projectId === id) this.keywords.delete(k);
  }

  async addQueries(projectId: string, queries: readonly GeneratedQuery[]) {
    this.requireProject(projectId);
    const now = this.now();
    let position = this.projectQueries(projectId).length;
    return queries.map((q) => {
      const id = queryId(projectId, q);
      let record = this.queries.get(id);
      if (!record) {
        record = buildQueryRecord(projectId, q, position++, now);
        this.queries.set(id, record);
      }
      return clone(record);
    });
  }

  async getQuery(projectId: string, id: string) {
    const q = this.queries.get(id);
    return q && q.projectId === projectId ? clone(q) : undefined;
  }

  async listQueries(projectId: string, method?: ResearchMethod) {
    return sortQueries(this.projectQueries(projectId).filter((q) => !method || q.method === method)).map(clone);
  }

  async countQueries(projectId: string) {
    return countStatuses(this.projectQueries(projectId));
  }

  async resetFailedQueries(projectId: string, method?: ResearchMethod) {
    let n = 0;
    for (const q of this.projectQueries(projectId)) {
      if (q.status === 'failed' && (!method || q.method === method)) {
        this.queries.set(q.id, { ...q, status: 'pending' });
        n++;
      }
    }
    return n;
  }

  async recordQueryOutcome(projectId: string, id: string, outcome: QueryOutcome): Promise<RecordOutcomeResult> {
    this.requireProject(projectId);
    const query = this.queries.get(id);
    if (!query || query.projectId !== projectId) throw new NotFoundError(`Query ${id}`);
    const suggestions = checkOutcome(outcome);
    let added = 0;
    let updated = 0;
    for (const s of suggestions) {
      const kid = keywordId(projectId, normalizeKey(s));
      const existing = this.keywords.get(kid);
      this.keywords.set(kid, mergeSuggestion(existing, projectId, s, { query: query.text, method: query.method }, outcome.at));
      if (existing) updated++;
      else added++;
    }
    const next = applyOutcome(query, outcome, suggestions.length);
    this.queries.set(id, next);
    this.touch(projectId);
    return { query: clone(next), keywordsAdded: added, keywordsUpdated: updated };
  }

  async listKeywords(projectId: string) {
    return [...this.keywords.values()].filter((k) => k.projectId === projectId).map(clone);
  }

  async countKeywords(projectId: string) {
    return (await this.listKeywords(projectId)).length;
  }

  async deleteKeywords(projectId: string, ids: readonly string[]) {
    let n = 0;
    for (const id of ids) {
      if (this.keywords.get(id)?.projectId === projectId) {
        this.keywords.delete(id);
        n++;
      }
    }
    if (n) this.touch(projectId);
    return n;
  }

  async importProject(backup: ProjectBackup) {
    const names = [...this.projects.values()].map((p) => p.name);
    const { project, queries, keywords } = buildImportRecords(backup, names, this.now());
    this.projects.set(project.id, project);
    for (const q of queries) this.queries.set(q.id, q);
    for (const k of keywords) this.keywords.set(k.id, k);
    return clone(project);
  }

  private touch(projectId: string) {
    const p = this.projects.get(projectId);
    if (p) this.projects.set(projectId, { ...p, updatedAt: this.now() });
  }

  private requireProject(id: string): Project {
    const p = this.projects.get(id);
    if (!p) throw new NotFoundError(`Project ${id}`);
    return p;
  }

  private projectQueries(projectId: string) {
    return [...this.queries.values()].filter((q) => q.projectId === projectId);
  }
}
