// Chrome-specific implementations of the scheduler's dependencies.
import type { JobState } from '../core/collectionState';
import { DEFAULT_COLLECT_OPTIONS, type CollectResult } from '../shared/collection';
import type { ContentRequest, ContentPingResponse } from '../shared/messages';
import type { Project } from '../shared/types';
import { getStorage } from '../storage';
import { PageUnavailableError, type GoogleDriver, type SchedulerDeps } from './scheduler';

export const JOB_STORAGE_KEY = 'nichespark.job';

const PAGE_HELP =
  'Could not reach Google in the NicheSpark tab. If Google is showing a consent, sign-in, or verification page, complete it in that tab, then click Resume.';

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function googleUrl(project: Project) {
  return `https://${project.googleDomain}/?hl=${encodeURIComponent(project.language)}`;
}

async function getTab(tabId: number): Promise<chrome.tabs.Tab | undefined> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return undefined;
  }
}

function waitForTabLoad(tabId: number, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && info.status === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    void getTab(tabId).then((t) => t?.status === 'complete' && done());
  });
}

async function sendToTab<T>(tabId: number, message: ContentRequest, timeoutMs: number): Promise<T> {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, message) as Promise<T>,
    delay(timeoutMs).then(() => {
      throw new PageUnavailableError('The Google tab did not respond in time.');
    }),
  ]);
}

async function ping(tabId: number): Promise<ContentPingResponse | undefined> {
  try {
    const r = await sendToTab<ContentPingResponse | undefined>(tabId, { type: 'content/ping' }, 3000);
    return r?.ok ? r : undefined;
  } catch {
    return undefined;
  }
}

async function waitForContentScript(tabId: number, attempts = 6): Promise<ContentPingResponse | undefined> {
  for (let i = 0; i < attempts; i++) {
    const r = await ping(tabId);
    if (r) return r;
    await delay(500);
  }
  return undefined;
}

export const chromeGoogleDriver: GoogleDriver = {
  async ensureTab(project, tabId) {
    let tab = tabId !== undefined ? await getTab(tabId) : undefined;
    // tab.url is only visible for hosts NicheSpark has access to (the Google domains).
    if (tab && tab.url && new URL(tab.url).host !== project.googleDomain) {
      await chrome.tabs.update(tab.id!, { url: googleUrl(project) });
      await waitForTabLoad(tab.id!);
    }
    if (!tab) {
      tab = await chrome.tabs.create({ url: googleUrl(project), active: false });
      await waitForTabLoad(tab.id!);
    }
    const id = tab.id!;
    let status = await waitForContentScript(id, tab.status === 'complete' ? 2 : 6);
    if (!status) {
      // The content script may be missing (e.g. the extension was reloaded): reload once.
      await chrome.tabs.reload(id);
      await waitForTabLoad(id);
      status = await waitForContentScript(id);
    }
    if (!status) throw new PageUnavailableError(PAGE_HELP);
    return id;
  },

  async collect(tabId, query) {
    try {
      const result = await sendToTab<CollectResult | undefined>(
        tabId,
        { type: 'content/collect', query },
        DEFAULT_COLLECT_OPTIONS.timeoutMs + DEFAULT_COLLECT_OPTIONS.clearWaitMs + 5000,
      );
      if (!result) throw new PageUnavailableError(PAGE_HELP);
      return result;
    } catch (e) {
      if (e instanceof PageUnavailableError) throw e;
      throw new PageUnavailableError(PAGE_HELP);
    }
  },
};

export function createChromeDeps(): SchedulerDeps {
  return {
    storage: getStorage(),
    google: chromeGoogleDriver,
    async loadJob() {
      const r = await chrome.storage.local.get(JOB_STORAGE_KEY);
      return (r[JOB_STORAGE_KEY] as JobState | undefined) ?? null;
    },
    async saveJob(job) {
      await chrome.storage.local.set({ [JOB_STORAGE_KEY]: job });
    },
    sleep(ms, wake) {
      return new Promise<void>((resolve) => {
        // Extension API calls keep the MV3 service worker alive during long delays.
        const keepAlive = setInterval(() => void chrome.runtime.getPlatformInfo(), 20000);
        const finish = () => {
          clearTimeout(timer);
          clearInterval(keepAlive);
          wake.onWake = undefined;
          resolve();
        };
        const timer = setTimeout(finish, ms);
        wake.onWake = finish;
      });
    },
    now: () => Date.now(),
    random: () => Math.random(),
    newId: () => crypto.randomUUID(),
  };
}
