import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_GOOGLE_DOMAINS } from '../src/shared/constants';

const manifest = JSON.parse(readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8'));

describe('manifest', () => {
  it('is Manifest V3 with a module service worker', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' });
  });

  it('matches content scripts and host permissions to the supported Google domains exactly', () => {
    const expected = SUPPORTED_GOOGLE_DOMAINS.map((d) => `https://${d}/*`);
    expect(manifest.host_permissions).toEqual(expected);
    expect(manifest.content_scripts[0].matches).toEqual(expected);
  });

  it('requests only the expected permissions', () => {
    expect(manifest.permissions).toEqual(['storage', 'unlimitedStorage']);
    const json = JSON.stringify(manifest);
    for (const broad of ['<all_urls>', 'history', 'cookies', 'webRequest', '*://*/*']) {
      expect(json).not.toContain(broad);
    }
  });
});
