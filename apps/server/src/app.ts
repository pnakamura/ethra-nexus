import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import jwt from '@fastify/jwt'
import fastifyStatic from '@fastify/static'
import { join } from 'path'
import { getDb } from '@ethra-nexus/db'
import type { Database } from '@ethra-nexus/db'
import { healthRoutes } from './routes/health'
import { authRoutes } from './routes/auth'
import { agentRoutes } from './routes/agents'
import { ticketRoutes } from './routes/tickets'
import { wikiRoutes } from './routes/wiki'
import { wikiAgentWritesRoutes } from './routes/wiki-agent-writes'
import { aiosRoutes } from './routes/aios'
import { schedulesRoutes } from './routes/schedules'
import { eventSubscriptionsRoutes } from './routes/event-subscriptions'
import { webhookRoutes } from './routes/webhooks'
import { agentSkillsRoutes } from './routes/agent-skills'
import { agentChannelsRoutes } from './routes/agent-channels'
import { a2aManagementRoutes, a2aProtocolRoutes, a2aPublicRoutes } from './routes/a2a'
import { wizardRoutes } from './routes/wizard'
import { dashboardRoutes } from './routes/dashboard'
import { startSchedulerLoop } from '@ethra-nexus/agents'

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
    const publicPaths = ['/api/v1/health', '/api/v1/auth/login', '/api/v1/auth/signup', '/api/v1/webhooks', '/.well-known', '/api/v1/a2a']
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
  await app.register(aiosRoutes, { prefix: '/api/v1' })
  await app.register(schedulesRoutes, { prefix: '/api/v1' })
  await app.register(eventSubscriptionsRoutes, { prefix: '/api/v1' })
  await app.register(webhookRoutes, { prefix: '/api/v1' })
  await app.register(agentSkillsRoutes, { prefix: '/api/v1' })
  await app.register(agentChannelsRoutes, { prefix: '/api/v1' })
  await app.register(a2aPublicRoutes)
  await app.register(a2aManagementRoutes, { prefix: '/api/v1' })
  await app.register(a2aProtocolRoutes, { prefix: '/api/v1' })
  await app.register(wizardRoutes, { prefix: '/api/v1' })
  await app.register(dashboardRoutes, { prefix: '/api/v1' })

  startSchedulerLoop()

  // Serve React frontend (production Docker: apps/web/dist → /app/public)
  if (process.env['NODE_ENV'] === 'production') {
    await app.register(fastifyStatic, {
      root: join(process.cwd(), 'public'),
      prefix: '/',
    })
    app.setNotFoundHandler((_request, reply) => {
      // SPA fallback — serve index.html for all unmatched non-API routes
      // (API 404s are handled by the routes themselves)
      return reply.sendFile('index.html')
    })
  }

  return app
}
