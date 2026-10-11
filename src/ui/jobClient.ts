import { useEffect, useState } from 'react';
import type { JobState, JobStatus } from '../core/collectionState';
import type { BackgroundRequest, BackgroundResponse } from '../shared/messages';

const JOB_STORAGE_KEY = 'nichespark.job';

/** Sends a job command to the background worker; throws with its error message on failure. */
export async function sendJobCommand(request: BackgroundRequest): Promise<JobState | null> {
  const response = (await chrome.runtime.sendMessage(request)) as BackgroundResponse | undefined;
  if (!response) throw new Error('The NicheSpark background worker did not respond. Try reloading the extension.');
  if (!response.ok) throw new Error(response.error);
  return response.job;
}

/** Live view of the collection job, updated whenever the background saves progress. */
export function useJob(): JobState | null | undefined {
  const [job, setJob] = useState<JobState | null | undefined>(undefined);
  useEffect(() => {
    // Asking the worker (not just storage) also wakes it so interrupted jobs are detected.
    sendJobCommand({ type: 'job/get' })
      .then(setJob)
      .catch(() => setJob(null));
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && JOB_STORAGE_KEY in changes) setJob((changes[JOB_STORAGE_KEY]?.newValue as JobState | undefined) ?? null);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  return job;
}

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  running: 'Running',
  paused: 'Paused',
  awaiting_user: 'Needs your action',
  interrupted: 'Interrupted',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
