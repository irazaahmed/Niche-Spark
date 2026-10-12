// Cloud endpoints for accounts and sync. Research data is sent only here,
// and only while the user is signed in.

/** Auth bridge on the NicheSpark website (netlify/functions/auth.mjs). */
export const AUTH_BRIDGE_URL: string = __NS_AUTH_BRIDGE__ || 'https://nichespark.tech/api/auth';

/** Neon Data API for the "nichespark" project (tables in db/schema.sql). */
export const DATA_API_URL = 'https://ep-flat-shape-b778n908.apirest.c-13.us-east-1.aws.neon.tech/neondb/rest/v1';

export const AUTH_STORAGE_KEY = 'nichespark.auth';
export const SYNC_STATE_KEY = 'nichespark.sync';
export const SYNC_STATUS_KEY = 'nichespark.syncStatus';
/** The account whose data is in local storage (used to keep accounts' data apart). */
export const DATA_OWNER_KEY = 'nichespark.owner';

export interface AccountUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  emailVerified: boolean;
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error' | 'offline';
  lastSyncedAt: number | null;
  /** Local changes not yet uploaded. */
  pending: number;
  error?: string;
  /** Set when pulled changes were applied, so open pages can refresh. */
  remoteChangeAt?: number;
}
