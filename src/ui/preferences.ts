// Small UI preferences kept in chrome.storage.local (not research data).
const LAST_PROJECT_KEY = 'ui.lastProjectId';

export async function getLastProjectId(): Promise<string | undefined> {
  const result = await chrome.storage.local.get(LAST_PROJECT_KEY);
  const value = result[LAST_PROJECT_KEY];
  return typeof value === 'string' ? value : undefined;
}

export async function setLastProjectId(id: string | undefined): Promise<void> {
  if (id) await chrome.storage.local.set({ [LAST_PROJECT_KEY]: id });
  else await chrome.storage.local.remove(LAST_PROJECT_KEY);
}

export function dashboardUrl(projectId?: string): string {
  const base = chrome.runtime.getURL('dashboard.html');
  return projectId ? `${base}#project=${encodeURIComponent(projectId)}` : base;
}
