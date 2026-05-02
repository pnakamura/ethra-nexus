import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@ethra-nexus/core': resolve(__dirname, '../core/src/index.ts'),
      '@ethra-nexus/db': resolve(__dirname, '../db/src/index.ts'),
    },
  },
  test: {
    passWithNoTests: true,
    server: {
      deps: {
        // mammoth is CJS-only with legacy transitive deps; prevent vite from bundling it
        external: [/node_modules\/mammoth/],
      },
    },
  },
})
