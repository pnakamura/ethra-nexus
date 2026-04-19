import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import jwt from '@fastify/jwt'
import { getDb } from '@ethra-nexus/db'
import type { Database } from '@ethra-nexus/db'
import { healthRoutes } from './routes/health'
import { authRoutes } from './routes/auth'
import { agentRoutes } from './routes/agents'
import { ticketRoutes } from './routes/tickets'
import { wikiRoutes } from './routes/wiki'
import { wikiAgentWritesRoutes } from './routes/wiki-agent-writes'

// ============================================================
// Ethra Nexus — Fastify Application
//
// Substitui o http.createServer anterior e o @supabase/supabase-js.
// Conexão direta ao PostgreSQL via Drizzle ORM.
//
// Middleware global: JWT → tenantId injetado em toda request.
// ============================================================

// Extend Fastify types for tenant isolation
declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string
  }
}

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
    bodyLimit: 50 * 1024 * 1024, // 50MB — suporta PDFs grandes via base64
  })

  // ── Plugins ─────────────────────────────────────────────
  await app.register(cors, { origin: true })
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  })
  await app.register(jwt, {
    secret: process.env['JWT_SECRET'] ?? 'dev-secret-change-in-production',
  })

  // ── Database ────────────────────────────────────────────
  const db = getDb()
  app.decorate('db', db)

  // ── Global hook: JWT + tenant isolation ──────────────────
  app.addHook('onRequest', async (request, reply) => {
    // Skip auth for public routes
    const publicPaths = ['/api/v1/health', '/api/v1/auth/login']
    if (publicPaths.some((p) => request.url.startsWith(p))) {
      return
    }

    try {
      const decoded = await request.jwtVerify<{ tenantId: string; email: string; role: string }>()
      request.tenantId = decoded.tenantId
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
  })

  // ── Routes ──────────────────────────────────────────────
  await app.register(healthRoutes, { prefix: '/api/v1' })
  await app.register(authRoutes, { prefix: '/api/v1' })
  await app.register(agentRoutes, { prefix: '/api/v1' })
  await app.register(ticketRoutes, { prefix: '/api/v1' })
  await app.register(wikiRoutes, { prefix: '/api/v1' })
  await app.register(wikiAgentWritesRoutes, { prefix: '/api/v1' })

  return app
}
