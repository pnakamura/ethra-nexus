// packages/agents/src/__tests__/event-bus.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

function makeSelectResult(rows: unknown[]) {
  const p = Promise.resolve(rows)
  Object.assign(p, { limit: vi.fn().mockResolvedValue(rows) })
  return p
}

const mockWhere = vi.fn()

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockWhere,
      }),
    }),
  }),
  agentEventSubscriptions: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
}))

const { emitEvent, drainEventQueue, matchesFilter } = await import('../lib/scheduler/event-bus')

describe('matchesFilter', () => {
  it('retorna true se filtro estiver vazio', () => {
    expect(matchesFilter({}, { threshold: 90 })).toBe(true)
  })
  it('retorna true se threshold do payload >= threshold do filtro', () => {
    expect(matchesFilter({ threshold: 75 }, { threshold: 90 })).toBe(true)
    expect(matchesFilter({ threshold: 75 }, { threshold: 75 })).toBe(true)
  })
  it('retorna false se threshold do payload < threshold do filtro', () => {
    expect(matchesFilter({ threshold: 75 }, { threshold: 50 })).toBe(false)
  })
})

describe('drainEventQueue', () => {
  beforeEach(() => { drainEventQueue() })

  it('retorna array vazio se fila estiver vazia', () => {
    expect(drainEventQueue()).toEqual([])
  })
})

describe('emitEvent', () => {
  beforeEach(() => {
    drainEventQueue()
    vi.clearAllMocks()
  })

  it('enfileira evento quando subscription faz match', async () => {
    const subscription = {
      tenant_id: 'tenant-1',
      agent_id: 'agent-1',
      event_type: 'budget_alert',
      event_filter: {},
      skill_id: 'wiki:lint',
      input: {},
      output_channel: 'api',
      enabled: true,
    }
    mockWhere.mockReturnValue(makeSelectResult([subscription]))

    await emitEvent('budget_alert', { threshold: 90 }, 'tenant-1')

    const queue = drainEventQueue()
    expect(queue).toHaveLength(1)
    expect(queue[0]!.subscription.skill_id).toBe('wiki:lint')
    expect(queue[0]!.payload).toEqual({ threshold: 90 })
  })

  it('não enfileira se subscription não faz match pelo filtro threshold', async () => {
    const subscription = {
      tenant_id: 'tenant-1',
      agent_id: 'agent-1',
      event_type: 'budget_alert',
      event_filter: { threshold: 75 },
      skill_id: 'wiki:lint',
      input: {},
      output_channel: 'api',
      enabled: true,
    }
    mockWhere.mockReturnValue(makeSelectResult([subscription]))

    await emitEvent('budget_alert', { threshold: 50 }, 'tenant-1')

    expect(drainEventQueue()).toHaveLength(0)
  })

  it('não enfileira quando DB retorna zero subscriptions', async () => {
    mockWhere.mockReturnValue(makeSelectResult([]))

    await emitEvent('wiki_ingested', { page_id: 'p1' }, 'tenant-2')

    expect(drainEventQueue()).toHaveLength(0)
  })

  it('erro no DB é não-fatal (não propaga exceção)', async () => {
    mockWhere.mockRejectedValue(new Error('DB connection lost'))

    await expect(emitEvent('budget_alert', {}, 'tenant-1')).resolves.toBeUndefined()
    expect(drainEventQueue()).toHaveLength(0)
  })
})
