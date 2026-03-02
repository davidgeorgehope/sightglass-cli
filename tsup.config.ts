import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    dts: true,
    banner: { js: '#!/usr/bin/env node' },
    external: ['better-sqlite3'],
  },
  {
    entry: { 'hooks/pretooluse': 'src/hooks/pretooluse.ts' },
    format: ['esm'],
    dts: false,
    banner: { js: '#!/usr/bin/env node' },
    noExternal: [/.*/],
    splitting: false,
  },
]);
