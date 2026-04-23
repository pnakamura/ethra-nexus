import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@ethra-nexus/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
  test: {
    passWithNoTests: true,
  },
})
