import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Content script: a single classic (IIFE) bundle injected on Google Search pages.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content/index.ts'),
      formats: ['iife'],
      name: 'NicheSparkContent',
      fileName: () => 'content.js',
    },
  },
});
