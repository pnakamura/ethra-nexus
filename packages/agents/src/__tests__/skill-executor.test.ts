// packages/agents/src/__tests__/skill-executor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentContext } from '@ethra-nexus/core'

const mockComplete = vi.fn()

vi.mock('../lib/provider', () => ({
  createRegistryFromEnv: () => ({ complete: mockComplete }),
}))

vi.mock('@ethra-nexus/wiki', () => ({
  embed: vi.fn().mockResolvedValue(Array(1536).fill(0.1)),
}))

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({
    // wiki:lint and wiki:query both use db.execute() only
    execute: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] }),
  }),
}))

// skill-executor imports sql from drizzle-orm directly
vi.mock('drizzle-orm', () => ({
  sql: vi.fn().mockReturnValue(''),
}))

const { executeSkill } = await import('../lib/skills/skill-executor')

const context: AgentContext = {
  tenant_id: 'tenant-1',
  agent_id: 'agent-1',
}

const agent = {
  system_prompt: 'Você é um assistente de teste.',
  model: 'claude-sonnet-4-6',
}

const mockResponse = {
  content: 'Resposta do LLM mockado',
  input_tokens: 100,
  output_tokens: 50,
  estimated_cost_usd: 0.001,
  provider: 'mock',
  model: 'mock',
  is_fallback: false,
}

describe('executeSkill — dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockComplete.mockResolvedValue(mockResponse)
  })

  it('wiki:query → executa executeWikiQuery e retorna ok:true', async () => {
    const result = await executeSkill('wiki:query', context, { question: 'O que é X?' }, agent)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.answer).toBe('Resposta do LLM mockado')
      expect(result.data.tokens_in).toBe(100)
      expect(result.data.tokens_out).toBe(50)
    }
  })

  it('channel:respond → usa o mesmo handler que wiki:query', async () => {
    const result = await executeSkill('channel:respond', context, { message: 'Olá' }, agent)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(typeof result.data.answer).toBe('string')
    }
  })

  it('wiki:lint → executa executeWikiLint e retorna ok:true com métricas', async () => {
    const result = await executeSkill('wiki:lint', context, {}, agent)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.answer).toContain('Wiki Health Metrics')
      expect(typeof result.data.answer).toBe('string')
    }
  })

  it('skill desconhecida → retorna ok:false com SKILL_NOT_FOUND', async () => {
    // @ts-expect-error testando skill inválida intencionalmente
    const result = await executeSkill('nonexistent:skill', context, {}, agent)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('SKILL_NOT_FOUND')
    }
  })
})
