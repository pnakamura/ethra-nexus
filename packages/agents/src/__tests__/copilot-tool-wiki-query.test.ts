import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockComplete = vi.fn()
const mockExecute = vi.fn()

// Mock modules BEFORE importing the tool
vi.mock('@ethra-nexus/wiki', () => ({
  embed: vi.fn().mockResolvedValue([0, 0, 0]),
}))

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({ execute: mockExecute }),
}))

vi.mock('drizzle-orm', () => ({
  sql: (s: TemplateStringsArray, ...v: unknown[]) => ({ s, v }),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(),
}))

vi.mock('../lib/provider', () => ({
  createRegistryFromEnv: () => ({ complete: mockComplete }),
  AnthropicProvider: vi.fn(),
  OpenRouterProvider: vi.fn(),
}))

const { wikiQueryTool } = await import('../lib/copilot/tools/wiki-query')

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const }

describe('system:wiki_query', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecute.mockResolvedValue({ rows: [] })
    mockComplete.mockResolvedValue({
      content: 'Respostas baseadas na wiki...',
      input_tokens: 100,
      output_tokens: 50,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      is_fallback: false,
      estimated_cost_usd: 0.001,
    })
  })

  it('returns answer plus sources', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ title: 'Política X', slug: 'pol-x', similarity: 0.85, content: 'conteúdo x' }] })
      .mockResolvedValueOnce({ rows: [] })
    const r = await wikiQueryTool.handler({ question: 'O que diz a política?' }, ctx)
    expect(r.answer).toContain('wiki')
    expect(r.sources).toHaveLength(1)
    expect(r.sources[0]).toMatchObject({ title: 'Política X', scope: 'strategic' })
  })

  it('rejects question shorter than 3 chars', async () => {
    await expect(wikiQueryTool.handler({ question: 'oi' }, ctx))
      .rejects.toThrow('question must be at least 3 chars')
  })

  it('has all_members permission', () => {
    expect(wikiQueryTool.permission).toBe('all_members')
  })
})
