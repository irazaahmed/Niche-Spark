import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Content script: a single classic (IIFE) bundle injected on Google Search pages.
export default defineConfig({
  // public/ (manifest, icons) is copied by the main build only.
  publicDir: false,
  build: {
    outDir: process.env.NS_OUT_DIR ?? 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content/index.ts'),
      formats: ['iife'],
      name: 'NicheSparkContent',
      fileName: () => 'content.js',
    },
  },
});
