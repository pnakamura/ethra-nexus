// apps/server/src/__tests__/e2e/webhooks.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

vi.mock('@ethra-nexus/agents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ethra-nexus/agents')>()
  return { ...mod, startSchedulerLoop: vi.fn() }
})

const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001'
const TEST_AGENT_ID  = '00000000-0000-0000-0001-000000000001'
const AGENT_SLUG     = 'test-agent'
const WEBHOOK_SECRET = 'meu-secret-de-teste-123'

describe.skipIf(!process.env['DATABASE_URL_TEST'])('E2E: Webhook secret validation', () => {
  let app: FastifyInstance
  let subscriptionId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any

  beforeAll(async () => {
    db = await import('@ethra-nexus/db')
    const { buildApp } = await import('../../app')
    app = await buildApp()
    await app.ready()

    const drizzle = db.getDb()
    const result = await drizzle.insert(db.agentEventSubscriptions).values({
      tenant_id: TEST_TENANT_ID,
      agent_id: TEST_AGENT_ID,
      event_type: 'webhook',
      event_filter: { event_type: 'custom-event', webhook_secret: WEBHOOK_SECRET },
      skill_id: 'wiki:lint',
      input: {},
      output_channel: 'api',
    }).returning()
    subscriptionId = result[0].id
  })

  afterAll(async () => {
    const drizzle = db.getDb()
    await drizzle.delete(db.agentEventSubscriptions).where(db.eq(db.agentEventSubscriptions.id, subscriptionId))
    await app.close()
  })

  it('retorna 401 sem X-Webhook-Secret', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/${AGENT_SLUG}/custom-event`,
      payload: { data: 'test' },
    })

    expect(response.statusCode).toBe(401)
  })

  it('retorna 401 com secret errado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/${AGENT_SLUG}/custom-event`,
      headers: { 'X-Webhook-Secret': 'secret-errado' },
      payload: { data: 'test' },
    })

    expect(response.statusCode).toBe(401)
  })

  it('retorna 202 com secret correto', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/${AGENT_SLUG}/custom-event`,
      headers: { 'X-Webhook-Secret': WEBHOOK_SECRET },
      payload: { data: 'test payload' },
    })

    expect(response.statusCode).toBe(202)
    const body = response.json<{ ok: boolean; triggered: number }>()
    expect(body.ok).toBe(true)
    expect(body.triggered).toBe(1)
  })

  it('retorna 404 para agentSlug inexistente', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/agente-inexistente/custom-event',
      headers: { 'X-Webhook-Secret': WEBHOOK_SECRET },
      payload: {},
    })

    expect(response.statusCode).toBe(404)
  })
})
