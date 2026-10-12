// Background service worker: owns the collection scheduler, sign-in, and sync.
import { isActive } from '../core/collectionState';
import type { AccountRequest, AccountResponse, BackgroundRequest, BackgroundResponse } from '../shared/messages';
import { getStorage } from '../storage';
import { UnsyncedChangesError } from './account';
import { createAccount } from './accountDeps';
import { createChromeDeps } from './chromeDeps';
import { startDevReload } from './devReload';
import { CollectionScheduler } from './scheduler';

const SYNC_ALARM = 'nichespark-sync';

const scheduler = new CollectionScheduler(createChromeDeps());
const account = createAccount(async () => {
  if (isActive(await scheduler.getJob())) await scheduler.cancel();
  await scheduler.idle();
});

// Every saved change (from this worker or an extension page) schedules a sync.
getStorage().setChangeListener(() => account.requestSync());

if (__NS_DEV_RELOAD_PORT__) {
  // Service workers cannot use dynamic import(); this call is removed from production builds.
  startDevReload(__NS_DEV_RELOAD_PORT__);
}

// Regular pulls bring in changes made on other devices.
void chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) void account.syncNow();
});
void account.syncNow();

async function handleJob(message: BackgroundRequest) {
  switch (message.type) {
    case 'job/get':
      return scheduler.getJob();
    case 'job/start': {
      if (!(await account.user())) throw new Error('Sign in to NicheSpark to start collecting.');
      const { type: _type, ...options } = message;
      return scheduler.start(options);
    }
    case 'job/retryFailed':
      if (!(await account.user())) throw new Error('Sign in to NicheSpark to start collecting.');
      return scheduler.retryFailed(message.projectId, message.method, message.delayMs);
    case 'job/pause':
      return scheduler.pause();
    case 'job/resume':
      return scheduler.resume();
    case 'job/cancel':
      return scheduler.cancel();
  }
}

async function handleAccount(message: AccountRequest) {
  switch (message.type) {
    case 'auth/get':
      return account.user();
    case 'auth/sign-in':
      return account.signIn(message.email, message.password);
    case 'auth/sign-up':
      return account.signUp(message.email, message.password, message.name);
    case 'auth/google':
      return account.signInWithGoogle();
    case 'auth/forgot':
      await account.forgotPassword(message.email);
      return account.user();
    case 'auth/sign-out':
      await account.signOut(message.force);
      return null;
    case 'sync/request':
      account.requestSync();
      return account.user();
    case 'sync/now':
      await account.syncNow(true);
      return account.user();
  }
}

function isExtensionPage(sender: chrome.runtime.MessageSender) {
  return sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(''));
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

chrome.runtime.onMessage.addListener((message: BackgroundRequest | AccountRequest, sender, sendResponse) => {
  // Only accept commands from NicheSpark's own pages (the popup, or the dashboard in a tab),
  // never from content scripts, whose sender URL is the web page.
  if (!isExtensionPage(sender) || typeof message?.type !== 'string') return false;
  if (message.type.startsWith('job/')) {
    handleJob(message as BackgroundRequest)
      .then((job) => sendResponse({ ok: true, job: job ?? null } satisfies BackgroundResponse))
      .catch((e: unknown) => sendResponse({ ok: false, error: errorText(e) } satisfies BackgroundResponse));
    return true;
  }
  if (message.type.startsWith('auth/') || message.type.startsWith('sync/')) {
    handleAccount(message as AccountRequest)
      .then((user) => sendResponse({ ok: true, user: user ?? null } satisfies AccountResponse))
      .catch((e: unknown) =>
        sendResponse({
          ok: false,
          error: errorText(e),
          ...(e instanceof UnsyncedChangesError ? { code: 'unsynced' as const } : {}),
        } satisfies AccountResponse),
      );
    return true;
  }
  return false;
});
