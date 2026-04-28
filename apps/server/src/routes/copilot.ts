import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    userEmail?: string
    userRole?: 'admin' | 'member'
  }
}

// Audit-revised (2026-04-28): JWT da casa contém { tenantId, email, role }.
// MVP é admin-only — sem lookup em tenant_members (table existe em SQL mas
// não é queryable pelo app code; per-user opt-in defere até JWT ter user identity).
async function requireCopilotAccess(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as { tenantId?: string; email?: string; role?: string } | undefined
  if (!user?.email) return reply.status(401).send({ error: 'Unauthorized' })
  if (user.role !== 'admin') {
    return reply.status(403).send({ error: 'Copilot is admin-only' })
  }
  request.userEmail = user.email
  request.userRole = user.role as 'admin' | 'member'
}

export async function copilotRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireCopilotAccess)

  // Health check (sanity route)
  app.get('/copilot/health', async (request) => {
    return { ok: true, user_email: request.userEmail, role: request.userRole }
  })

  // Real endpoints come in Tasks 22 and 23.
}
