export type ResearchMethod = 'az' | 'prefix' | 'suffix' | 'question' | 'template';

export const RESEARCH_METHODS: readonly ResearchMethod[] = ['az', 'prefix', 'suffix', 'question', 'template'];

export const RESEARCH_METHOD_LABELS: Record<ResearchMethod, string> = {
  az: 'A to Z',
  prefix: 'Prefix',
  suffix: 'Suffix',
  question: 'Questions',
  template: 'Template',
};

export interface Project {
  id: string;
  name: string;
  seed: string;
  /** Google Search host, e.g. "www.google.com". Must be in SUPPORTED_GOOGLE_DOMAINS. */
  googleDomain: string;
  /** Interface language passed to Google as `hl`, e.g. "en". */
  language: string;
  prefixes: string[];
  suffixes: string[];
  templates: string[];
  createdAt: number;
  updatedAt: number;
}

export type NewProjectInput = Pick<Project, 'name' | 'seed'> &
  Partial<Pick<Project, 'googleDomain' | 'language' | 'prefixes' | 'suffixes' | 'templates'>>;

export type ProjectPatch = Partial<
  Pick<Project, 'name' | 'seed' | 'googleDomain' | 'language' | 'prefixes' | 'suffixes' | 'templates'>
>;

/**
 * Outcome of a query.
 * - pending: not yet attempted successfully (includes never-run queries)
 * - succeeded: suggestions were captured and saved
 * - empty: the collection ran correctly but Google showed no suggestions
 * - failed: the collection did not complete (timeout, missing dropdown, blocked, ...)
 */
export type QueryStatus = 'pending' | 'succeeded' | 'empty' | 'failed';

export interface QueryRecord {
  /** `${projectId}:${method}:${key}` */
  id: string;
  projectId: string;
  text: string;
  key: string;
  method: ResearchMethod;
  /** Insertion order within the project; queries run in this order. */
  position: number;
  status: QueryStatus;
  attempts: number;
  suggestionCount: number;
  lastError?: string;
  lastAttemptAt?: number;
  createdAt: number;
}

export interface KeywordRecord {
  /** `${projectId}:${key}` */
  id: string;
  projectId: string;
  /** Display text as first captured (trimmed, whitespace-collapsed). */
  text: string;
  /** Normalized deduplication key. */
  key: string;
  sourceQueries: string[];
  methods: ResearchMethod[];
  firstCollectedAt: number;
  lastCollectedAt: number;
  collectionCount: number;
}

export interface QueryCounts {
  total: number;
  pending: number;
  succeeded: number;
  empty: number;
  failed: number;
}
