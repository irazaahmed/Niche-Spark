/// <reference types="vitest/config" />
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const outDir = process.env.NS_OUT_DIR ?? 'dist';

/**
 * Development builds get a fixed extension ID (scripts/dev-extension-key.json),
 * because Google sign-in only returns to known extension IDs. The Chrome Web
 * Store build (`npm run package`) sets NS_STORE_BUILD and keeps the store's ID.
 */
function pinDevExtensionId(): Plugin {
  return {
    name: 'nichespark-dev-extension-key',
    apply: 'build',
    closeBundle() {
      if (process.env.NS_STORE_BUILD) return;
      const file = resolve(import.meta.dirname, outDir, 'manifest.json');
      const manifest = JSON.parse(readFileSync(file, 'utf8'));
      manifest.key = JSON.parse(readFileSync(resolve(import.meta.dirname, 'scripts/dev-extension-key.json'), 'utf8')).key;
      writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
    },
  };
}

// Builds the extension pages (popup, dashboard) and the module service worker.
// The content script is built separately (vite.content.config.ts) because
// Chrome content scripts cannot be ES modules.
export default defineConfig({
  plugins: [react(), pinDevExtensionId()],
  define: {
    // Non-zero only under `npm run dev` (scripts/dev.mjs); enables auto-reload.
    __NS_DEV_RELOAD_PORT__: JSON.stringify(Number(process.env.NS_DEV_RELOAD_PORT ?? 0)),
    // Local auth bridge for testing (see docs/accounts.md); empty uses nichespark.tech.
    __NS_AUTH_BRIDGE__: JSON.stringify(process.env.NS_STORE_BUILD ? '' : (process.env.NS_AUTH_BRIDGE ?? '')),
  },
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'popup.html'),
        dashboard: resolve(import.meta.dirname, 'dashboard.html'),
        background: resolve(import.meta.dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
