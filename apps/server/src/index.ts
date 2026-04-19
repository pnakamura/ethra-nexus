import { buildApp } from './app'
import { closeDb } from '@ethra-nexus/db'

// ============================================================
// Ethra Nexus Server — Entry Point
//
// Inicia o Fastify com conexão direta ao PostgreSQL via Drizzle.
// Endpoints: /api/v1/health, /api/v1/auth, /api/v1/agents, etc.
// ============================================================

const PORT = Number(process.env['PORT'] ?? 3000)
const HOST = process.env['HOST'] ?? '0.0.0.0'

async function main() {
  console.log('[Nexus] Starting server...')

  const app = await buildApp()

  try {
    await app.listen({ port: PORT, host: HOST })
    console.log(`[Nexus] Server listening on http://${HOST}:${PORT}`)
    console.log('[Nexus] Routes:')
    console.log('  GET  /api/v1/health')
    console.log('  POST /api/v1/auth/login')
    console.log('  GET  /api/v1/agents')
    console.log('  POST /api/v1/agents')
    console.log('  GET  /api/v1/tickets')
    console.log('  POST /api/v1/tickets')
    console.log('  POST /api/v1/wiki/pages')
    console.log('  GET  /api/v1/wiki/index/strategic')
    console.log('  POST /api/v1/wiki/search')
    console.log('  POST /api/v1/wiki/pages/:id/reembed')
    console.log('  POST /api/v1/wiki/ingest')
    console.log('  POST /api/v1/wiki/ingest/stream')
    console.log('  POST /api/v1/wiki/sync/filesystem')
    console.log('  POST /api/v1/agents/:id/ask')
    console.log('  GET  /api/v1/wiki/agent-writes/pending')
    console.log('  POST /api/v1/wiki/agent-writes')
    console.log('  POST /api/v1/wiki/agent-writes/:id/approve')
    console.log('  POST /api/v1/wiki/agent-writes/:id/reject')
    console.log('  GET  /api/v1/tickets/:id')
    console.log('  PATCH /api/v1/tickets/:id')
    console.log('  POST /api/v1/tickets/:id/reject')
  } catch (err) {
    console.error('[Nexus] Fatal:', err)
    await closeDb()
    process.exit(1)
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[Nexus] Shutting down...')
    await app.close()
    await closeDb()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
