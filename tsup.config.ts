import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/hooks/pretooluse.ts'],
  format: ['esm'],
  dts: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: ['better-sqlite3'],
});
