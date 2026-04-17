import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { getDb, tenants } from '@ethra-nexus/db'
import bcrypt from 'bcryptjs'

// ============================================================
// Auth Routes — login com JWT
//
// POST /auth/login { slug, password } → JWT token
//
// Segurança:
//   - senha armazenada como bcrypt hash (custo 12)
//   - JWT expira em 24h
//   - rate limiting aplicado pelo Fastify no nível do app
// ============================================================

interface LoginBody {
  slug: string
  password: string
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: LoginBody }>('/auth/login', async (request, reply) => {
    const { slug, password } = request.body

    if (!slug || !password) {
      return reply.status(400).send({ error: 'slug and password are required' })
    }

    const db = getDb()
    const result = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1)
    const tenant = result[0]

    if (!tenant) {
      // Resposta genérica — não revela se o slug existe
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    if (!tenant.password_hash) {
      // Tenant sem senha configurada — acesso bloqueado
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    const valid = await bcrypt.compare(password, tenant.password_hash)
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    const token = app.jwt.sign(
      {
        tenantId: tenant.id,
        slug: tenant.slug,
        role: 'admin',
      },
      { expiresIn: '24h' },
    )

    return { token, tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug } }
  })
}
