// packages/agents/src/__tests__/output-dispatcher.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentResult } from '@ethra-nexus/core'
import type { SkillOutput } from '../lib/skills/skill-executor'

const mockInsertValues = vi.fn().mockResolvedValue(undefined)

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({
    insert: vi.fn().mockReturnValue({
      values: mockInsertValues,
    }),
  }),
  scheduledResults: {},
}))

global.fetch = vi.fn()

const { dispatchOutput } = await import('../lib/scheduler/output-dispatcher')

const okResult: AgentResult<SkillOutput> = {
  ok: true,
  data: {
    answer: 'Resposta mockada',
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: 0.001,
    provider: 'mock',
    model: 'mock',
    is_fallback: false,
  },
  agent_id: 'agent-1',
  skill_id: 'wiki:lint',
  tokens_used: 150,
  cost_usd: 0.001,
  timestamp: new Date().toISOString(),
}

const baseSource = {
  tenant_id: 'tenant-1',
  agent_id: 'agent-1',
  skill_id: 'wiki:lint',
  schedule_id: 'sched-1',
}

describe('dispatchOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })
  })

  it('canal "api": salva no DB, não chama fetch', async () => {
    await dispatchOutput(okResult, { ...baseSource, output_channel: 'api' })
    expect(mockInsertValues).toHaveBeenCalledOnce()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('canal "whatsapp": chama fetch, não salva no DB', async () => {
    process.env['N8N_WHATSAPP_WEBHOOK_URL'] = 'https://n8n.test/webhook'
    await dispatchOutput(okResult, { ...baseSource, output_channel: 'whatsapp' })
    expect(global.fetch).toHaveBeenCalledOnce()
    expect(mockInsertValues).not.toHaveBeenCalled()
    delete process.env['N8N_WHATSAPP_WEBHOOK_URL']
  })

  it('canal "both": salva no DB E chama fetch', async () => {
    process.env['N8N_WHATSAPP_WEBHOOK_URL'] = 'https://n8n.test/webhook'
    await dispatchOutput(okResult, { ...baseSource, output_channel: 'both' })
    expect(mockInsertValues).toHaveBeenCalledOnce()
    expect(global.fetch).toHaveBeenCalledOnce()
    delete process.env['N8N_WHATSAPP_WEBHOOK_URL']
  })

  it('result.ok=false é no-op (sem DB, sem fetch)', async () => {
    const errorResult: AgentResult<SkillOutput> = {
      ok: false,
      error: { code: 'SKILL_NOT_FOUND', message: 'Not found', retryable: false },
      agent_id: 'agent-1',
      skill_id: 'wiki:lint',
      timestamp: new Date().toISOString(),
    }
    await dispatchOutput(errorResult, { ...baseSource, output_channel: 'both' })
    expect(mockInsertValues).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('falha no fetch do WhatsApp é não-fatal (sem throw)', async () => {
    process.env['N8N_WHATSAPP_WEBHOOK_URL'] = 'https://n8n.test/webhook'
    ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'))
    await expect(
      dispatchOutput(okResult, { ...baseSource, output_channel: 'whatsapp' })
    ).resolves.toBeUndefined()
    delete process.env['N8N_WHATSAPP_WEBHOOK_URL']
  })
})
