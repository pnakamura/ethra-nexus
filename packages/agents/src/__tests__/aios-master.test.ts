// packages/agents/src/__tests__/aios-master.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentResult } from '@ethra-nexus/core'
import type { SkillOutput } from '../lib/skills/skill-executor'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockExecuteSkill = vi.fn()
const mockEmitEvent = vi.fn().mockResolvedValue(undefined)
const mockCanExecute = vi.fn().mockResolvedValue({ allowed: true })
const mockInsertAiosEvent = vi.fn().mockResolvedValue('event-uuid-1')
const mockUpdateAiosEvent = vi.fn().mockResolvedValue(undefined)
const mockLogProviderUsage = vi.fn().mockResolvedValue(undefined)
const mockUpsertBudget = vi.fn().mockResolvedValue(undefined)
const mockGetBudget = vi.fn().mockResolvedValue({ spent_usd: '5.00' })
const mockGetBudgetAlertsFired = vi.fn().mockResolvedValue([])
const mockInsertAuditEntry = vi.fn().mockResolvedValue(undefined)

const mockAgent = {
  id: 'agent-1',
  tenant_id: 'tenant-1',
  status: 'active',
  budget_monthly: '50.00',
  model: 'claude-sonnet-4-6',
  system_prompt: 'Test prompt.',
  slug: 'test-agent',
}

// Drizzle fluent chain: db.select().from().where().limit()
const mockLimit = vi.fn().mockResolvedValue([mockAgent])
const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
const mockDbSelect = vi.fn().mockReturnValue({ from: mockFrom })

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({ select: mockDbSelect }),
  agents: {},
}))

vi.mock('../lib/db/db-agents', () => ({
  createAgentsDb: () => ({
    canExecute: mockCanExecute,
    insertAiosEvent: mockInsertAiosEvent,
    updateAiosEvent: mockUpdateAiosEvent,
    logProviderUsage: mockLogProviderUsage,
    upsertBudget: mockUpsertBudget,
    getBudget: mockGetBudget,
    getBudgetAlertsFired: mockGetBudgetAlertsFired,
    insertAuditEntry: mockInsertAuditEntry,
  }),
}))

vi.mock('../lib/skills/skill-executor', () => ({
  executeSkill: mockExecuteSkill,
}))

vi.mock('../lib/scheduler/event-bus', () => ({
  emitEvent: mockEmitEvent,
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
}))

const { executeTask } = await import('../lib/aios/aios-master')

// ── Fixture ──────────────────────────────────────────────────────────────────

const mockSkillResult: AgentResult<SkillOutput> = {
  ok: true,
  data: {
    answer: 'Test answer',
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: 0.001,
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    is_fallback: false,
  },
  agent_id: 'agent-1',
  skill_id: 'wiki:query',
  timestamp: '2026-01-01T00:00:00.000Z',
  tokens_used: 150,
  cost_usd: 0.001,
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('executeTask — multi-agent orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanExecute.mockResolvedValue({ allowed: true })
    mockInsertAiosEvent.mockResolvedValue('event-uuid-1')
    mockGetBudget.mockResolvedValue({ spent_usd: '5.00' })
    mockGetBudgetAlertsFired.mockResolvedValue([])
    mockLimit.mockResolvedValue([mockAgent])
    mockEmitEvent.mockResolvedValue(undefined)
  })

  it('call_depth > 3 → MAX_DEPTH_EXCEEDED sem consultar DB nem executar skill', async () => {
    const result = await executeTask({
      tenant_id: 'tenant-1',
      agent_id: 'agent-1',
      skill_id: 'wiki:query',
      input: { question: 'test' },
      call_depth: 4,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('MAX_DEPTH_EXCEEDED')
      expect(result.error.retryable).toBe(false)
    }
    expect(mockDbSelect).not.toHaveBeenCalled()
    expect(mockExecuteSkill).not.toHaveBeenCalled()
    expect(mockEmitEvent).not.toHaveBeenCalled()
  })

  it('call_depth=3 (máximo permitido) → executa normalmente e emite task_completed com __call_depth=4', async () => {
    mockExecuteSkill.mockResolvedValue(mockSkillResult)

    const result = await executeTask({
      tenant_id: 'tenant-1',
      agent_id: 'agent-1',
      skill_id: 'wiki:query',
      input: { question: 'test' },
      call_depth: 3,
    })

    expect(result.ok).toBe(true)
    expect(mockExecuteSkill).toHaveBeenCalledOnce()
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'task_completed',
      expect.objectContaining({ __call_depth: 4 }),
      'tenant-1',
    )
  })

  it('execução sem call_depth → usa depth=0, emite task_completed com __call_depth=1', async () => {
    mockExecuteSkill.mockResolvedValue(mockSkillResult)

    await executeTask({
      tenant_id: 'tenant-1',
      agent_id: 'agent-1',
      skill_id: 'wiki:query',
      input: { question: 'test' },
    })

    expect(mockEmitEvent).toHaveBeenCalledWith(
      'task_completed',
      expect.objectContaining({
        skill_id: 'wiki:query',
        agent_id: 'agent-1',
        __call_depth: 1,
      }),
      'tenant-1',
    )
  })
})
