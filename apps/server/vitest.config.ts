// apps/server/vitest.config.ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// All packages live in the monorepo root node_modules (npm workspace hoisting)
const root = resolve(__dirname, '../..')

export default defineConfig({
  resolve: {
    // Add root node_modules to the module resolution chain
    alias: [
      { find: /^(@ethra-nexus\/.+|fastify|@fastify\/.+|drizzle-orm|pg|openai|bcryptjs)$/, replacement: resolve(root, 'node_modules/$1') },
    ],
  },
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
    setupFiles: ['src/__tests__/setup.ts'],
    passWithNoTests: true,
  },
})
