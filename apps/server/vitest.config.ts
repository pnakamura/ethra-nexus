// apps/server/vitest.config.ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// All packages live in the monorepo root node_modules (npm workspace hoisting)
const root = resolve(__dirname, '../..')

const rootModules = resolve(root, 'node_modules')

export default defineConfig({
  resolve: {
    // Add root node_modules to the module resolution chain.
    // NOTE: regex find + string replacement does NOT do $1 substitution at match time
    // (resolve() runs at config load, making the path literal "node_modules/$1").
    // Use customResolver function to perform the substitution at resolve time.
    alias: [
      {
        find: /^(@ethra-nexus\/.+|fastify|@fastify\/.+|drizzle-orm|pg|openai|bcryptjs)$/,
        replacement: '$1',
        customResolver(source) {
          try {
            // Resolve the package entry point from root node_modules
            return require.resolve(source, { paths: [rootModules] })
          } catch {
            return resolve(rootModules, source)
          }
        },
      },
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
