// packages/agents/src/__tests__/db-agents.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

function dbRows(rows: unknown[]) {
  const p = Promise.resolve(rows)
  Object.assign(p, {
    limit: vi.fn().mockResolvedValue(rows),
  })
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
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'event-uuid' }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  }),
  agents: {},
  budgets: {},
  auditLog: {},
  aiosEvents: {},
  providerUsageLog: {},
  eq: vi.fn(),
  and: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  desc: vi.fn(),
  sql: vi.fn(),
}))

const { createAgentsDb } = await import('../lib/db/db-agents')

describe('canExecute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('permite quando agente existe, está ativo e budget é 0 (sem limite)', async () => {
    mockWhere.mockReturnValue(dbRows([{ status: 'active', budget_monthly: '0' }]))
    const db = createAgentsDb()
    const result = await db.canExecute('agent-1', '2026-04', 0.02)
    expect(result.allowed).toBe(true)
  })

  it('permite quando custo estimado não ultrapassa o budget', async () => {
    mockWhere
      .mockReturnValueOnce(dbRows([{ status: 'active', budget_monthly: '5.00' }]))
      .mockReturnValueOnce(dbRows([{ spent_usd: '0.50' }]))
    const db = createAgentsDb()
    const result = await db.canExecute('agent-1', '2026-04', 0.02)
    expect(result.allowed).toBe(true)
  })

  it('nega quando custo estimado ultrapassaria o budget', async () => {
    mockWhere
      .mockReturnValueOnce(dbRows([{ status: 'active', budget_monthly: '1.00' }]))
      .mockReturnValueOnce(dbRows([{ spent_usd: '0.99' }]))
    const db = createAgentsDb()
    const result = await db.canExecute('agent-1', '2026-04', 0.02)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/Budget exceeded/)
  })

  it('nega quando agente não é encontrado', async () => {
    mockWhere.mockReturnValue(dbRows([]))
    const db = createAgentsDb()
    const result = await db.canExecute('agent-missing', '2026-04', 0.01)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('Agent not found')
  })

  it('nega quando agente não está ativo', async () => {
    mockWhere.mockReturnValue(dbRows([{ status: 'paused', budget_monthly: '5.00' }]))
    const db = createAgentsDb()
    const result = await db.canExecute('agent-1', '2026-04', 0.01)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/paused/)
  })
})

describe('getBudgetAlertsFired', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna thresholds do mês atual, ignora meses diferentes', async () => {
    mockWhere.mockReturnValue(
      dbRows([
        { payload: { month: '2026-04', threshold: 75 } },
        { payload: { month: '2026-03', threshold: 50 } },
        { payload: { month: '2026-04', threshold: 90 } },
      ])
    )
    const db = createAgentsDb()
    const result = await db.getBudgetAlertsFired('agent-1', '2026-04')
    expect(result).toEqual([75, 90])
  })

  it('retorna array vazio se nenhum alerta disparado', async () => {
    mockWhere.mockReturnValue(dbRows([]))
    const db = createAgentsDb()
    const result = await db.getBudgetAlertsFired('agent-1', '2026-04')
    expect(result).toEqual([])
  })
})
