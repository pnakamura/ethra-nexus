import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { getDb, tenants } from '@ethra-nexus/db'
import bcrypt from 'bcryptjs'

// ============================================================
// Auth Routes — login e signup com JWT
//
// POST /auth/login  { slug, password } → JWT token
// POST /auth/signup { name, slug, password } → JWT token + 201
//
// Segurança:
//   - senha armazenada como bcrypt hash (custo 12)
//   - JWT expira em 24h
//   - rate limiting aplicado pelo Fastify no nível do app
// ============================================================

interface LoginBody { slug: string; password: string }
interface SignupBody { name: string; slug: string; password: string }

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: LoginBody }>('/auth/login', async (request, reply) => {
    const { slug, password } = request.body
    if (!slug || !password) {
      return reply.status(400).send({ error: 'slug and password are required' })
    }
    const db = getDb()
    const result = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1)
    const tenant = result[0]
    if (!tenant || !tenant.password_hash) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }
    const valid = await bcrypt.compare(password, tenant.password_hash)
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }
    const token = app.jwt.sign(
      { tenantId: tenant.id, slug: tenant.slug, role: 'admin' },
      { expiresIn: '24h' },
    )
    return { token, tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug } }
  })

  app.post<{ Body: SignupBody }>('/auth/signup', async (request, reply) => {
    const { name, slug, password } = request.body
    if (!name || !slug || !password) {
      return reply.status(400).send({ error: 'name, slug and password are required' })
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return reply.status(400).send({ error: 'slug must be lowercase letters, numbers and hyphens only' })
    }
    if (password.length < 8) {
      return reply.status(400).send({ error: 'password must be at least 8 characters' })
    }
    const db = getDb()
    const existing = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1)
    if (existing[0]) {
      return reply.status(409).send({ error: 'slug already taken' })
    }
    const password_hash = await bcrypt.hash(password, 12)
    const inserted = await db.insert(tenants).values({ name, slug, password_hash }).returning()
    const tenant = inserted[0]
    if (!tenant) {
      return reply.status(500).send({ error: 'Failed to create tenant' })
    }
    const token = app.jwt.sign(
      { tenantId: tenant.id, slug: tenant.slug, role: 'admin' },
      { expiresIn: '24h' },
    )
    return reply.status(201).send({
      token,
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    })
  })
}
