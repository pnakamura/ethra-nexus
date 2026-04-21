// packages/agents/src/__tests__/skill-executor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentContext } from '@ethra-nexus/core'
import type { ExtractResult } from '@ethra-nexus/wiki'
import { extractPagesFromContent } from '@ethra-nexus/wiki'  // mocked below — hoisting garante que é o mock

const mockComplete = vi.fn()
const mockUpsertStrategicPage = vi.fn()

vi.mock('@ethra-nexus/core', () => ({
  sanitizeForHtml: (content: string) => content, // passthrough para testes
}))

vi.mock('../lib/provider', () => ({
  createRegistryFromEnv: () => ({ complete: mockComplete }),
}))

vi.mock('@ethra-nexus/wiki', () => ({
  embed: vi.fn().mockResolvedValue(Array(1536).fill(0.1)),
  extractPagesFromContent: vi.fn(),
}))

vi.mock('../lib/db', () => ({
  createWikiDb: vi.fn(() => ({
    upsertStrategicPage: mockUpsertStrategicPage,
  })),
}))

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({
    execute: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] }),
  }),
}))

// skill-executor imports sql from drizzle-orm directly
vi.mock('drizzle-orm', () => ({
  sql: vi.fn().mockReturnValue(''),
}))

const mockEmitEvent = vi.fn().mockResolvedValue(undefined)

vi.mock('../lib/scheduler/event-bus', () => ({
  emitEvent: mockEmitEvent,
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

  it('wiki:ingest → extrai páginas e retorna ok:true com contagem', async () => {
    const mockResult: ExtractResult = {
      pages: [
        {
          slug: 'conceito-teste',
          title: 'Conceito Teste',
          type: 'conceito',
          content: 'Conteúdo do conceito teste.',
          confidence: 'alta',
          sources: ['doc.pdf'],
          tags: ['teste'],
        },
        {
          slug: 'entidade-teste',
          title: 'Entidade Teste',
          type: 'entidade',
          content: 'Descrição da entidade.',
          confidence: 'media',
          sources: ['doc.pdf'],
          tags: [],
        },
      ],
      invalid_reasons: [],
      log_entry: 'Extraídas 2 páginas de doc.pdf',
    }
    vi.mocked(extractPagesFromContent).mockResolvedValue(mockResult)
    mockUpsertStrategicPage.mockResolvedValue({ id: 'page-uuid-1' })

    const result = await executeSkill(
      'wiki:ingest',
      context,
      { content: 'Texto do documento a ser ingerido.', source_name: 'doc.pdf' },
      agent,
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.answer).toContain('2 páginas extraídas')
      expect(result.data.answer).toContain('2 persistidas')
      expect(result.data.answer).toContain('doc.pdf')
    }
    expect(mockUpsertStrategicPage).toHaveBeenCalledTimes(2)
    expect(mockUpsertStrategicPage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        slug: 'conceito-teste',
        author_type: 'agent',
      }),
    )
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'wiki_ingested',
      expect.objectContaining({
        source_name: 'doc.pdf',
        pages_extracted: 2,
        pages_persisted: 2,
        tenant_id: 'tenant-1',
      }),
      'tenant-1',
    )
  })

  it('wiki:ingest → retorna INVALID_INPUT quando content está ausente', async () => {
    const result = await executeSkill('wiki:ingest', context, { source_name: 'doc.pdf' }, agent)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT')
    }
    expect(mockUpsertStrategicPage).not.toHaveBeenCalled()
    expect(mockEmitEvent).not.toHaveBeenCalled()
  })

  // ── channel:proactive ─────────────────────────────────────────────────
  it('channel:proactive → chama LLM e retorna ok:true', async () => {
    const result = await executeSkill(
      'channel:proactive',
      context,
      { message: 'Lembrete: reunião às 15h.' },
      agent,
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.answer).toBe('Resposta do LLM mockado')
      expect(result.data.tokens_in).toBe(100)
      expect(result.data.tokens_out).toBe(50)
    }
    expect(mockComplete).toHaveBeenCalledWith(
      'channel:proactive',
      expect.objectContaining({ sensitive_data: true }),
    )
  })

  it('channel:proactive → retorna INVALID_INPUT quando message está ausente', async () => {
    const result = await executeSkill('channel:proactive', context, {}, agent)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT')
    }
    expect(mockComplete).not.toHaveBeenCalled()
  })

  // ── report:generate ───────────────────────────────────────────────────
  it('report:generate → chama LLM e retorna ok:true', async () => {
    const result = await executeSkill(
      'report:generate',
      context,
      { report_type: 'mensal', data: 'Vendas: R$10.000' },
      agent,
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.answer).toBe('Resposta do LLM mockado')
      expect(result.data.tokens_in).toBe(100)
      expect(result.data.tokens_out).toBe(50)
    }
    expect(mockComplete).toHaveBeenCalledWith(
      'report:generate',
      expect.objectContaining({ sensitive_data: true }),
    )
  })

  it('report:generate → retorna INVALID_INPUT quando data está ausente', async () => {
    const result = await executeSkill(
      'report:generate',
      context,
      { report_type: 'mensal' },
      agent,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT')
    }
    expect(mockComplete).not.toHaveBeenCalled()
  })

  // ── monitor:health ────────────────────────────────────────────────────
  it('monitor:health → chama LLM e retorna ok:true', async () => {
    const result = await executeSkill(
      'monitor:health',
      context,
      { check_config: 'CPU: 45%, RAM: 60%, Disk: 70%' },
      agent,
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.answer).toBe('Resposta do LLM mockado')
      expect(result.data.tokens_in).toBe(100)
      expect(result.data.tokens_out).toBe(50)
    }
    expect(mockComplete).toHaveBeenCalledWith(
      'monitor:health',
      expect.objectContaining({ sensitive_data: false }),
    )
  })

  it('monitor:health → retorna INVALID_INPUT quando check_config está ausente', async () => {
    const result = await executeSkill('monitor:health', context, {}, agent)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT')
    }
    expect(mockComplete).not.toHaveBeenCalled()
  })

  // ── monitor:alert ─────────────────────────────────────────────────────
  it('monitor:alert → chama LLM e retorna ok:true', async () => {
    const result = await executeSkill(
      'monitor:alert',
      context,
      { condition: 'CPU > 90%', threshold: '90', current_value: '95' },
      agent,
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.answer).toBe('Resposta do LLM mockado')
      expect(result.data.tokens_in).toBe(100)
      expect(result.data.tokens_out).toBe(50)
    }
    expect(mockComplete).toHaveBeenCalledWith(
      'monitor:alert',
      expect.objectContaining({ sensitive_data: false }),
    )
  })

  it('monitor:alert → retorna INVALID_INPUT quando condition está ausente', async () => {
    const result = await executeSkill('monitor:alert', context, {}, agent)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT')
    }
    expect(mockComplete).not.toHaveBeenCalled()
  })

  // ── data:analyze ──────────────────────────────────────────────────────
  it('data:analyze → chama LLM e retorna ok:true', async () => {
    const result = await executeSkill(
      'data:analyze',
      context,
      { data: 'Jan: 100, Fev: 120, Mar: 90', analysis_type: 'tendência' },
      agent,
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.answer).toBe('Resposta do LLM mockado')
      expect(result.data.tokens_in).toBe(100)
      expect(result.data.tokens_out).toBe(50)
    }
    expect(mockComplete).toHaveBeenCalledWith(
      'data:analyze',
      expect.objectContaining({ sensitive_data: false }),
    )
  })

  it('data:analyze → retorna INVALID_INPUT quando data está ausente', async () => {
    const result = await executeSkill('data:analyze', context, {}, agent)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT')
    }
    expect(mockComplete).not.toHaveBeenCalled()
  })

  // ── data:extract ──────────────────────────────────────────────────────
  it('data:extract → chama LLM e retorna ok:true', async () => {
    const result = await executeSkill(
      'data:extract',
      context,
      { content: 'Nome: João, CPF: 123.456.789-00', extract_schema: 'nome, cpf' },
      agent,
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.answer).toBe('Resposta do LLM mockado')
      expect(result.data.tokens_in).toBe(100)
      expect(result.data.tokens_out).toBe(50)
    }
    expect(mockComplete).toHaveBeenCalledWith(
      'data:extract',
      expect.objectContaining({ sensitive_data: true }),
    )
  })

  it('data:extract → retorna INVALID_INPUT quando content está ausente', async () => {
    const result = await executeSkill('data:extract', context, {}, agent)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT')
    }
    expect(mockComplete).not.toHaveBeenCalled()
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
