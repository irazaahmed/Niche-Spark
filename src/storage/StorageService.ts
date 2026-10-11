import type {
  KeywordRecord,
  NewProjectInput,
  Project,
  ProjectPatch,
  QueryCounts,
  QueryRecord,
  QueryStatus,
  ResearchMethod,
} from '../shared/types';
import type { GeneratedQuery } from '../core/queryGeneration';

export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageError';
  }
}

export class NotFoundError extends StorageError {
  constructor(what: string) {
    super(`${what} was not found.`);
    this.name = 'NotFoundError';
  }
}

export interface QueryOutcome {
  status: Exclude<QueryStatus, 'pending'>;
  /** Captured suggestion texts. Must be empty unless status is "succeeded". */
  suggestions: string[];
  error?: string;
  at: number;
}

export interface RecordOutcomeResult {
  query: QueryRecord;
  keywordsAdded: number;
  keywordsUpdated: number;
}

/**
 * Persistent storage for projects, queries, and keywords.
 * UI and collection code depend only on this interface, so the backing store
 * (IndexedDB today, possibly a sync service later) can change.
 */
export interface StorageService {
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(input: NewProjectInput): Promise<Project>;
  updateProject(id: string, patch: ProjectPatch): Promise<Project>;
  /** Deletes the project and all of its queries and keywords. */
  deleteProject(id: string): Promise<void>;

  /**
   * Adds generated queries to a project as "pending". Queries that already
   * exist (same method and key) are left untouched, so completed work is kept.
   * Returns every record matching the input, in input order.
   */
  addQueries(projectId: string, queries: readonly GeneratedQuery[]): Promise<QueryRecord[]>;
  getQuery(projectId: string, id: string): Promise<QueryRecord | undefined>;
  listQueries(projectId: string, method?: ResearchMethod): Promise<QueryRecord[]>;
  countQueries(projectId: string): Promise<QueryCounts>;
  /** Resets failed queries (optionally of one method) back to pending. Returns how many were reset. */
  resetFailedQueries(projectId: string, method?: ResearchMethod): Promise<number>;

  /**
   * Atomically stores the result of one query: updates the query status and
   * merges any suggestions into the project's keyword collection.
   */
  recordQueryOutcome(projectId: string, queryId: string, outcome: QueryOutcome): Promise<RecordOutcomeResult>;

  listKeywords(projectId: string): Promise<KeywordRecord[]>;
  countKeywords(projectId: string): Promise<number>;
  deleteKeywords(projectId: string, ids: readonly string[]): Promise<number>;
}
