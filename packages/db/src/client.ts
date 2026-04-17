import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

// ============================================================
// Database Client — pool de conexão direta ao PostgreSQL
//
// Conexão via DATABASE_URL — sem PostgREST, sem intermediários.
// Pool gerencia connections automaticamente.
// ============================================================

let pool: Pool | null = null
let db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getDb() {
  if (db) return db

  const connectionString = process.env['DATABASE_URL']
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required')
  }

  pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  })

  db = drizzle(pool, { schema })
  return db
}

export function getPool(): Pool {
  if (!pool) {
    getDb() // initializes pool as side effect
  }
  return pool!
}

export type Database = ReturnType<typeof getDb>

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
    db = null
  }
}
