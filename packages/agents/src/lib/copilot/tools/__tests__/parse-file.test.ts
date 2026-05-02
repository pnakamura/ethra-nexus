import { describe, it, expect, vi, beforeEach } from 'vitest'

const agentSelectMock = vi.fn()
const mockDb = {
  select: vi.fn(() => ({
    from: () => ({
      where: () => ({ limit: () => agentSelectMock() }),
    }),
  })),
}
vi.mock('@ethra-nexus/db', () => ({
  getDb: () => mockDb,
  agents: { _: { name: 'agents' }, id: 'agents.id', tenant_id: 'agents.tenant_id', slug: 'agents.slug' },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ eq: { c, v } })),
  and: vi.fn((...c) => ({ and: c })),
}))

const executeTaskMock = vi.fn()
vi.mock('../../../aios/aios-master', () => ({
  executeTask: executeTaskMock,
  __esModule: true,
}))

const { parseFileTool } = await import('../parse-file')

const ctx = { tenant_id: 'tenant-1', user_id: 'user-1', user_role: 'admin' as const }
const VALID = '33333333-3333-3333-3333-333333333333'

beforeEach(() => {
  agentSelectMock.mockReset()
  executeTaskMock.mockReset()
})

describe('parse_file tool', () => {
  it('throws PARSE_FILE_INVALID_FILE_ID when file_id is not a UUID', async () => {
    await expect(parseFileTool.handler({ file_id: 'oops' }, ctx)).rejects.toThrow(/PARSE_FILE_INVALID_FILE_ID/)
  })

  it('throws INPUT_WORKER_NOT_SEEDED when no input-worker for tenant', async () => {
    agentSelectMock.mockResolvedValueOnce([])
    await expect(parseFileTool.handler({ file_id: VALID }, ctx)).rejects.toThrow(/INPUT_WORKER_NOT_SEEDED/)
  })

  it('delegates to executeTask with correct args + returns extracted output', async () => {
    agentSelectMock.mockResolvedValueOnce([{ id: 'iw-agent-1' }])
    executeTaskMock.mockResolvedValueOnce({
      ok: true,
      data: {
        answer: '# preview',
        parsed_id: 'parsed-1',
        format: 'xlsx',
        preview_md: '# preview',
        pages_or_sheets: 3,
        warnings: [],
        tokens_in: 0, tokens_out: 0, cost_usd: 0,
        provider: 'local', model: 'parser', is_fallback: false,
      },
    })

    const out = await parseFileTool.handler({ file_id: VALID, hint: 'sheet count' }, ctx)
    expect(out).toEqual({
      parsed_id: 'parsed-1',
      format: 'xlsx',
      preview_md: '# preview',
      pages_or_sheets: 3,
      warnings: [],
    })
    expect(executeTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 'tenant-1',
      agent_id: 'iw-agent-1',
      skill_id: 'data:extract',
      input: { file_id: VALID, hint: 'sheet count' },
      activation_mode: 'on_demand',
      activation_source: 'copilot:parse_file',
      triggered_by: 'user-1',
    }))
  })

  it('throws PARSE_FILE_FAILED with code when executeTask returns ok:false', async () => {
    agentSelectMock.mockResolvedValueOnce([{ id: 'iw-agent-1' }])
    executeTaskMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'FILE_NOT_FOUND', message: 'no row', retryable: false },
    })
    await expect(parseFileTool.handler({ file_id: VALID }, ctx)).rejects.toThrow(/PARSE_FILE_FAILED.*FILE_NOT_FOUND/)
  })
})
