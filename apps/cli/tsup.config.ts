import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/bin.ts'],
    format: ['esm'],
    platform: 'node',
    banner: { js: '#!/usr/bin/env node' },
    clean: false,
  },
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    platform: 'node',
    dts: true,
    clean: false,
  },
]);
