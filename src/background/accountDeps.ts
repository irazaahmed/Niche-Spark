// Chrome-specific wiring for accounts and sync.
import { AuthService, type StoredAuth } from '../auth/authService';
import { AUTH_BRIDGE_URL, AUTH_STORAGE_KEY, DATA_API_URL, DATA_OWNER_KEY, SYNC_STATE_KEY, SYNC_STATUS_KEY, type SyncStatus } from '../shared/cloud';
import { getStorage } from '../storage';
import { PostgrestCloudApi } from '../sync/cloudApi';
import { EMPTY_CURSORS, SyncEngine, type SyncCursors } from '../sync/syncEngine';
import { AccountController } from './account';

async function read<T>(key: string): Promise<T | null> {
  const r = await chrome.storage.local.get(key);
  return (r[key] as T | undefined) ?? null;
}

async function write(key: string, value: unknown) {
  if (value === null) await chrome.storage.local.remove(key);
  else await chrome.storage.local.set({ [key]: value });
}

export function createAccount(cancelJob: () => Promise<void>): AccountController {
  const auth = new AuthService({
    bridgeUrl: AUTH_BRIDGE_URL,
    fetch: (...args) => fetch(...args),
    load: () => read<StoredAuth>(AUTH_STORAGE_KEY),
    save: (a) => write(AUTH_STORAGE_KEY, a),
    redirectUrl: () => chrome.identity.getRedirectURL(),
    launchWebAuthFlow: (url) => chrome.identity.launchWebAuthFlow({ url, interactive: true }),
    now: () => Date.now(),
  });
  const store = getStorage();
  const engine = new SyncEngine(store, new PostgrestCloudApi(DATA_API_URL, (force) => auth.getToken(force)), {
    load: async () => (await read<SyncCursors>(SYNC_STATE_KEY)) ?? { ...EMPTY_CURSORS },
    save: (c) => write(SYNC_STATE_KEY, c),
  });
  return new AccountController({
    auth,
    store,
    engine,
    getOwner: () => read<string>(DATA_OWNER_KEY),
    setOwner: (id) => write(DATA_OWNER_KEY, id),
    resetCursors: () => write(SYNC_STATE_KEY, null),
    loadStatus: () => read<SyncStatus>(SYNC_STATUS_KEY),
    saveStatus: (s) => write(SYNC_STATUS_KEY, s),
    cancelJob,
    now: () => Date.now(),
  });
}
