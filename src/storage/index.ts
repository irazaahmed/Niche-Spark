import { IndexedDbStorage } from './indexedDbStorage';
import type { StorageService } from './StorageService';

export type { StorageService } from './StorageService';
export { StorageError, NotFoundError } from './StorageService';

let instance: StorageService | undefined;

/** The extension's shared storage service (IndexedDB on the extension origin). */
export function getStorage(): StorageService {
  instance ??= new IndexedDbStorage();
  return instance;
}
