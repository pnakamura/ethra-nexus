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

const { renderDashboardTool } = await import('../render-dashboard')

const ctx = {
  tenant_id: 'tenant-1', user_id: 'user-1', user_role: 'admin' as const,
  conversation_id: 'conv-1',
}

const validInput = {
  title: 'Top 10 Vendedores',
  prompt: 'gera dashboard',
  data: { rows: [{ name: 'a', qty: 1 }] },
}

beforeEach(() => {
  agentSelectMock.mockReset()
  executeTaskMock.mockReset()
})

describe('render_dashboard tool', () => {
  it('throws on data > 100KB', async () => {
    const big = { rows: 'x'.repeat(101 * 1024) }
    await expect(
      renderDashboardTool.handler({ ...validInput, data: big }, ctx)
    ).rejects.toThrow(/DATA_TOO_LARGE|EXCEEDS|100KB/)
  })

  it('throws on empty title', async () => {
    await expect(
      renderDashboardTool.handler({ ...validInput, title: '' }, ctx)
    ).rejects.toThrow(/INVALID_INPUT|title/)
  })

  it('throws OUTPUT_WORKER_NOT_SEEDED when no agent for tenant', async () => {
    agentSelectMock.mockResolvedValueOnce([])
    await expect(
      renderDashboardTool.handler(validInput, ctx)
    ).rejects.toThrow(/OUTPUT_WORKER_NOT_SEEDED/)
  })

  it('delegates to executeTask with correct args + returns artifact_id', async () => {
    agentSelectMock.mockResolvedValueOnce([{ id: 'ow-agent-1' }])
    executeTaskMock.mockResolvedValueOnce({
      ok: true,
      data: {
        answer: 'Dashboard "T" gerado.',
        artifact_id: 'art-1',
        download_url: '/api/v1/artifacts/art-1/view',
        title: 'Top 10 Vendedores',
        size_bytes: 4096,
        tokens_in: 1000, tokens_out: 500, cost_usd: 0.012,
        provider: 'anthropic', model: 'claude-sonnet-4-6', is_fallback: false,
      },
    })

    const out = await renderDashboardTool.handler(validInput, ctx)
    expect(out).toEqual({
      artifact_id: 'art-1',
      download_url: '/api/v1/artifacts/art-1/view',
      size_bytes: 4096,
      title: 'Top 10 Vendedores',
    })
    expect(executeTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 'tenant-1',
      agent_id: 'ow-agent-1',
      skill_id: 'data:render',
      input: expect.objectContaining({
        title: 'Top 10 Vendedores',
        prompt: 'gera dashboard',
        conversation_id: 'conv-1',
      }),
      activation_mode: 'on_demand',
      activation_source: 'copilot:render_dashboard',
      triggered_by: 'user-1',
    }))
  })

  it('throws RENDER_DASHBOARD_FAILED when executeTask returns ok:false', async () => {
    agentSelectMock.mockResolvedValueOnce([{ id: 'ow-agent-1' }])
    executeTaskMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'AI_ERROR', message: 'timeout', retryable: true },
    })
    await expect(
      renderDashboardTool.handler(validInput, ctx)
    ).rejects.toThrow(/RENDER_DASHBOARD_FAILED.*AI_ERROR/)
  })

  it('passes parsed_id when provided', async () => {
    agentSelectMock.mockResolvedValueOnce([{ id: 'ow-agent-1' }])
    executeTaskMock.mockResolvedValueOnce({
      ok: true,
      data: {
        answer: 'ok', artifact_id: 'a', download_url: '/x', title: 'T', size_bytes: 1,
        tokens_in: 0, tokens_out: 0, cost_usd: 0,
        provider: 'anthropic', model: 'claude-sonnet-4-6', is_fallback: false,
      },
    })

    await renderDashboardTool.handler({
      ...validInput,
      parsed_id: '11111111-1111-1111-1111-111111111111',
    }, ctx)

    expect(executeTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        parsed_id: '11111111-1111-1111-1111-111111111111',
      }),
    }))
  })
})
