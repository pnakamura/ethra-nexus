import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { getDb } from '@ethra-nexus/db'

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    const db = getDb()

    try {
      await db.execute(sql`SELECT 1`)
      return {
        status: 'ok',
        db: 'connected',
        timestamp: new Date().toISOString(),
      }
    } catch {
      return {
        status: 'error',
        db: 'disconnected',
        timestamp: new Date().toISOString(),
      }
    }
  })
}
