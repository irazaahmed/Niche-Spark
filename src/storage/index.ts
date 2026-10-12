import { IndexedDbStorage } from './indexedDbStorage';

export type { StorageService } from './StorageService';
export { StorageError, NotFoundError } from './StorageService';

let instance: IndexedDbStorage | undefined;

/** The extension's shared storage service (IndexedDB on the extension origin). */
export function getStorage(): IndexedDbStorage {
  instance ??= new IndexedDbStorage();
  return instance;
}
