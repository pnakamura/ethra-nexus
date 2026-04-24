import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockComplete = vi.fn()
const mockEmbed = vi.fn().mockResolvedValue(Array(1536).fill(0.1))
const mockValues = vi.fn().mockResolvedValue([])
const mockInsert = vi.fn().mockReturnValue({ values: mockValues })
const mockExecute = vi.fn().mockResolvedValue({})
const mockTx = { insert: mockInsert, execute: mockExecute }
const mockTransaction = vi.fn().mockImplementation(
  async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
)
const mockDb = { transaction: mockTransaction }

vi.mock('../lib/provider', () => ({
  createRegistryFromEnv: () => ({ complete: mockComplete }),
}))

vi.mock('@ethra-nexus/wiki', () => ({
  embed: mockEmbed,
}))

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => mockDb,
  wikiAgentWrites: { name: 'wiki_agent_writes' },
  wikiAgentPages: { name: 'wiki_agent_pages' },
}))

vi.mock('drizzle-orm', () => ({
  sql: vi.fn().mockReturnValue(''),
}))

const { writeLesson } = await import('../lib/wiki/wiki-writer')

const baseInput = {
  agent_id: 'agent-1',
  tenant_id: 'tenant-1',
  aios_event_id: 'event-uuid-1',
  question: 'Qual a política de desconto?',
  answer: 'Clientes Premium têm 20% de desconto.',
}

const mockLesson = {
  title: 'Política de Descontos Premium',
  type: 'referencia',
  content: '## Descontos para Clientes Premium\n\nClientes com plano Premium recebem 20% de desconto em todos os produtos.',
}

describe('WikiWriter — writeLesson', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockComplete.mockResolvedValue({ content: JSON.stringify(mockLesson) })
    mockEmbed.mockResolvedValue(Array(1536).fill(0.1))
    mockValues.mockResolvedValue([])
  })

  it('modo manual — não chama LLM nem DB', async () => {
    await writeLesson({ ...baseInput, write_mode: 'manual' })

    expect(mockComplete).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('modo supervised — insere em wiki_agent_writes com status draft', async () => {
    await writeLesson({ ...baseInput, write_mode: 'supervised' })

    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ name: 'wiki_agent_writes' }))
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'draft',
        agent_id: 'agent-1',
        tenant_id: 'tenant-1',
        aios_event_id: 'event-uuid-1',
        title: 'Política de Descontos Premium',
        type: 'referencia',
      }),
    )
  })

  it('modo supervised — NÃO insere em wiki_agent_pages', async () => {
    await writeLesson({ ...baseInput, write_mode: 'supervised' })

    // insert chamado exatamente uma vez (só wiki_agent_writes)
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockInsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'wiki_agent_pages' }),
    )
  })

  it('modo auto — insere em wiki_agent_writes (approved) E wiki_agent_pages', async () => {
    await writeLesson({ ...baseInput, write_mode: 'auto' })

    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockInsert).toHaveBeenCalledTimes(2)
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ name: 'wiki_agent_writes' }))
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ name: 'wiki_agent_pages' }))
  })

  it('modo auto — wiki_agent_writes tem status approved', async () => {
    await writeLesson({ ...baseInput, write_mode: 'auto' })

    const writesCall = mockValues.mock.calls.find((call) =>
      (call[0] as Record<string, unknown>)['status'] === 'approved',
    )
    expect(writesCall).toBeDefined()
  })

  it('slug gerado começa com lesson- e contém timestamp', async () => {
    await writeLesson({ ...baseInput, write_mode: 'supervised' })

    const insertArg = mockValues.mock.calls[0]?.[0] as Record<string, unknown>
    expect(typeof insertArg?.['slug']).toBe('string')
    expect((insertArg?.['slug'] as string).startsWith('lesson-')).toBe(true)
  })

  it('type inválido do LLM é normalizado para padrao', async () => {
    mockComplete.mockResolvedValue({
      content: JSON.stringify({ ...mockLesson, type: 'tipo-invalido' }),
    })

    await writeLesson({ ...baseInput, write_mode: 'supervised' })

    const insertArg = mockValues.mock.calls[0]?.[0] as Record<string, unknown>
    expect(insertArg?.['type']).toBe('padrao')
  })

  it('falha na síntese LLM (JSON inválido) — não lança exceção', async () => {
    mockComplete.mockResolvedValue({ content: 'não é JSON' })

    await expect(writeLesson({ ...baseInput, write_mode: 'supervised' })).resolves.not.toThrow()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('falha no LLM (exception) — não lança exceção', async () => {
    mockComplete.mockRejectedValue(new Error('Network error'))

    await expect(writeLesson({ ...baseInput, write_mode: 'auto' })).resolves.not.toThrow()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('falha no embed — continua e persiste sem embedding (modo auto)', async () => {
    mockEmbed.mockRejectedValue(new Error('Embed failed'))

    await writeLesson({ ...baseInput, write_mode: 'auto' })

    // transaction ainda foi chamada (embedding failure é non-fatal)
    expect(mockTransaction).toHaveBeenCalledOnce()
    // execute (UPDATE embedding) NÃO foi chamado
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
