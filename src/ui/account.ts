// Page-side helpers for the account and sync state kept by the background worker.
import { useEffect, useState } from 'react';
import { AUTH_STORAGE_KEY, SYNC_STATUS_KEY, type AccountUser, type SyncStatus } from '../shared/cloud';
import type { AccountErrorCode, AccountRequest, AccountResponse } from '../shared/messages';
import { getStorage } from '../storage';

export class AccountCommandError extends Error {
  constructor(
    message: string,
    readonly code?: AccountErrorCode,
  ) {
    super(message);
    this.name = 'AccountCommandError';
  }
}

/** Sends an account command to the background worker; throws with its error message on failure. */
export async function sendAccountCommand(request: AccountRequest): Promise<AccountUser | null> {
  const response = (await chrome.runtime.sendMessage(request)) as AccountResponse | undefined;
  if (!response) throw new AccountCommandError('The NicheSpark background worker did not respond. Try reloading the extension.');
  if (!response.ok) throw new AccountCommandError(response.error, response.code);
  return response.user;
}

function useStorageValue<T>(key: string, pick: (value: unknown) => T): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    chrome.storage.local
      .get(key)
      .then((r) => alive && setValue(pick(r[key])))
      .catch(() => alive && setValue(pick(undefined)));
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && key in changes) setValue(pick(changes[key]?.newValue));
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, [key]);
  return value;
}

const pickUser = (v: unknown) => ((v as { user?: AccountUser } | undefined)?.user ?? null);
const pickStatus = (v: unknown) => (v as SyncStatus | undefined) ?? null;

/** The signed-in user (null when signed out, undefined while loading). */
export function useAccount(): AccountUser | null | undefined {
  return useStorageValue(AUTH_STORAGE_KEY, pickUser);
}

export function useSyncStatus(): SyncStatus | null | undefined {
  return useStorageValue(SYNC_STATUS_KEY, pickStatus);
}

/** Changes whenever the background applies changes made on another device. */
export function useRemoteChange(): number {
  return useSyncStatus()?.remoteChangeAt ?? 0;
}

/** Changes saved by this page ask the background worker to sync them. */
export function connectPageSync() {
  getStorage().setChangeListener(() => {
    void chrome.runtime.sendMessage({ type: 'sync/request' } satisfies AccountRequest).catch(() => {});
  });
  // Opening a page also pulls the latest data from other devices.
  void chrome.runtime.sendMessage({ type: 'sync/request' } satisfies AccountRequest).catch(() => {});
}
