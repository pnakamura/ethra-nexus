import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockSelect = vi.fn()

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
  }),
  copilotConversations: { id: 'id', message_count: 'mc', total_tokens: 'tt', total_cost_usd: 'tcu', last_message_at: 'lma', updated_at: 'ua' },
  copilotMessages: { conversation_id: 'cid', tenant_id: 'tid', role: 'role', content: 'content', id: 'mid', created_at: 'ca' },
  copilotToolCalls: {},
  agents: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ c, v })),
  and: vi.fn((...c) => ({ c })),
  asc: vi.fn((c) => ({ asc: c })),
  sql: Object.assign(
    (s: TemplateStringsArray, ...v: unknown[]) => ({ s, v }),
    { raw: (s: string) => ({ raw: s }) },
  ),
}))

const mockStream = vi.fn()
vi.mock('../lib/copilot/anthropic-client', () => ({
  getAnthropicClient: () => ({
    messages: { create: mockStream },
  }),
}))

vi.mock('../lib/copilot/tools', () => ({
  allCopilotTools: [],
  findToolByName: () => undefined,
}))

const mockCanExecute = vi.fn()
const mockLogProviderUsage = vi.fn()
const mockUpsertBudget = vi.fn()
vi.mock('../lib/db/db-agents', () => ({
  createAgentsDb: () => ({
    canExecute: mockCanExecute,
    logProviderUsage: mockLogProviderUsage,
    upsertBudget: mockUpsertBudget,
  }),
}))

const { executeCopilotTurn } = await import('../lib/copilot/turn-loop')

function makeStream(events: Array<unknown>) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e
    },
  }
}

const baseParams = {
  conversation_id: 'c1',
  tenant_id: 't1',
  user_id: 'u1',
  user_role: 'admin' as const,
  aios_master_agent_id: 'aios-1',
  content: 'Olá',
  system_prompt: 'You are helpful',
}

describe('executeCopilotTurn — text-only', () => {
  let sseEvents: Array<{ type: string; [k: string]: unknown }>
  let sse: { write: (e: object) => void }

  beforeEach(() => {
    vi.clearAllMocks()
    sseEvents = []
    sse = { write: (e) => sseEvents.push(e as { type: string }) }

    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'msg-1' }]),
      }),
    })
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    })
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      }),
    })
    mockStream.mockResolvedValue(makeStream([
      { type: 'message_start', message: { id: 'msg_anth' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Olá!' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 10, output_tokens: 5 } },
      { type: 'message_stop' },
    ]))
    mockCanExecute.mockResolvedValue({ allowed: true })
    mockLogProviderUsage.mockResolvedValue(undefined)
    mockUpsertBudget.mockResolvedValue(undefined)
  })

  it('persists user message + assistant message; emits turn_start and turn_complete', async () => {
    await executeCopilotTurn({ ...baseParams, sse, abortSignal: new AbortController().signal })
    const types = sseEvents.map(e => e.type)
    expect(types).toContain('turn_start')
    expect(types).toContain('text_delta')
    expect(types).toContain('assistant_message_complete')
    expect(types).toContain('turn_complete')
    expect(mockInsert).toHaveBeenCalled()
  })

  it('forwards text_delta events with delta string', async () => {
    await executeCopilotTurn({ ...baseParams, sse, abortSignal: new AbortController().signal })
    const deltaEvents = sseEvents.filter(e => e.type === 'text_delta')
    expect(deltaEvents).toHaveLength(1)
    expect(deltaEvents[0]?.['delta']).toBe('Olá!')
  })
})

describe('executeCopilotTurn — budget integration', () => {
  let sseEvents: Array<{ type: string; [k: string]: unknown }>
  let sse: { write: (e: object) => void }

  beforeEach(() => {
    vi.clearAllMocks()
    sseEvents = []
    sse = { write: (e) => sseEvents.push(e as { type: string }) }

    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'msg-1' }]),
      }),
    })
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    })
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      }),
    })
    mockLogProviderUsage.mockResolvedValue(undefined)
    mockUpsertBudget.mockResolvedValue(undefined)
  })

  it('blocks turn when canExecute returns not allowed', async () => {
    mockCanExecute.mockResolvedValue({ allowed: false, reason: 'monthly limit exceeded' })
    await executeCopilotTurn({ ...baseParams, sse, abortSignal: new AbortController().signal })
    const errors = sseEvents.filter(e => e.type === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.['code']).toBe('BUDGET_EXCEEDED')
    expect(mockStream).not.toHaveBeenCalled()
  })

  it('logs provider usage and updates budget after each assistant message', async () => {
    mockCanExecute.mockResolvedValue({ allowed: true })
    mockStream.mockResolvedValue(makeStream([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'oi' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 100, output_tokens: 50 } },
    ]))
    await executeCopilotTurn({ ...baseParams, sse, abortSignal: new AbortController().signal })

    expect(mockLogProviderUsage).toHaveBeenCalledTimes(1)
    expect(mockLogProviderUsage).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 't1',
      agent_id: 'aios-1',
      skill_id: 'copilot:turn',
      provider: 'anthropic',
      tokens_in: 100,
      tokens_out: 50,
      is_sensitive: true,
    }))
    expect(mockUpsertBudget).toHaveBeenCalledTimes(1)
    expect(mockUpsertBudget).toHaveBeenCalledWith('aios-1', 't1', expect.any(String), expect.any(Number), 150)
  })
})

describe('executeCopilotTurn — with tools', () => {
  let sseEvents: Array<{ type: string; [k: string]: unknown }>
  let sse: { write: (e: object) => void }

  beforeEach(() => {
    vi.clearAllMocks()
    sseEvents = []
    sse = { write: (e) => sseEvents.push(e as { type: string }) }

    let insertCount = 0
    mockInsert.mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockImplementation(() => {
          insertCount++
          return Promise.resolve([{ id: `msg-${insertCount}` }])
        }),
      }),
    }))

    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    })

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([
            { role: 'user', content: [{ type: 'text', text: 'Olá' }] },
          ]),
        }),
      }),
    })

    mockCanExecute.mockResolvedValue({ allowed: true })
    mockLogProviderUsage.mockResolvedValue(undefined)
    mockUpsertBudget.mockResolvedValue(undefined)
  })

  it('runs tool, emits tool_use_start/complete, recurses to final response', async () => {
    // First Anthropic call: returns tool_use
    mockStream
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'test:noop', input: {} } }
          yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }
          yield { type: 'content_block_stop', index: 0 }
          yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 10, output_tokens: 5 } }
        },
      })
      // Second call: text response
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
          yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } }
          yield { type: 'content_block_stop', index: 0 }
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 12, output_tokens: 3 } }
        },
      })

    // Spy on tools module to inject a noop tool
    const toolsModule = await import('../lib/copilot/tools')
    const noopTool = {
      name: 'test:noop',
      description: 'noop',
      input_schema: { type: 'object', properties: {} },
      permission: 'all_members' as const,
      handler: async () => ({ ok: true }),
    }
    vi.spyOn(toolsModule, 'allCopilotTools', 'get').mockReturnValue([noopTool] as never)
    vi.spyOn(toolsModule, 'findToolByName').mockReturnValue(noopTool as never)

    await executeCopilotTurn({ ...baseParams, sse, abortSignal: new AbortController().signal })

    const types = sseEvents.map(e => e.type)
    expect(types).toContain('tool_use_start')
    expect(types).toContain('tool_use_complete')
    expect(mockStream).toHaveBeenCalledTimes(2)  // one round-trip due to tool

    // Budget logged for BOTH steps (per-step, not per-turn)
    expect(mockLogProviderUsage).toHaveBeenCalledTimes(2)
    expect(mockUpsertBudget).toHaveBeenCalledTimes(2)
  })
})

describe('executeCopilotTurn — caps', () => {
  let sseEvents: Array<{ type: string; [k: string]: unknown }>
  let sse: { write: (e: object) => void }

  beforeEach(() => {
    vi.clearAllMocks()
    sseEvents = []
    sse = { write: (e) => sseEvents.push(e as { type: string }) }
    let n = 0
    mockInsert.mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockImplementation(() => Promise.resolve([{ id: `m-${++n}` }])),
      }),
    }))
    mockUpdate.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) })
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([]) }),
      }),
    })
    // Budget allows — caps test what happens after that
    mockCanExecute.mockResolvedValue({ allowed: true })
    mockLogProviderUsage.mockResolvedValue(undefined)
    mockUpsertBudget.mockResolvedValue(undefined)
  })

  it('TURN_TOOLS_EXCEEDED when more than MAX_TOOLS tool_use in single message', async () => {
    process.env['COPILOT_MAX_TOOLS_PER_TURN'] = '2'
    mockStream.mockResolvedValueOnce({
      [Symbol.asyncIterator]: async function* () {
        for (let i = 0; i < 3; i++) {
          yield { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: `t${i}`, name: 'test:noop', input: {} } }
          yield { type: 'content_block_stop', index: i }
        }
        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 1, output_tokens: 1 } }
      },
    })
    const toolsModule = await import('../lib/copilot/tools')
    vi.spyOn(toolsModule, 'findToolByName').mockReturnValue({
      name: 'test:noop', description: '', input_schema: { type: 'object' },
      permission: 'all_members', handler: async () => ({}),
    } as never)

    await executeCopilotTurn({ ...baseParams, sse, abortSignal: new AbortController().signal })

    const errors = sseEvents.filter(e => e.type === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.['code']).toBe('TURN_TOOLS_EXCEEDED')
    delete process.env['COPILOT_MAX_TOOLS_PER_TURN']
  })

  it('TURN_COST_EXCEEDED when accumulated cost passes cap', async () => {
    process.env['COPILOT_MAX_COST_PER_TURN_USD'] = '0.0001'  // tiny
    mockStream.mockResolvedValueOnce({
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'big' } }
        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 10000, output_tokens: 10000 } }
      },
    })

    await executeCopilotTurn({ ...baseParams, sse, abortSignal: new AbortController().signal })

    const errors = sseEvents.filter(e => e.type === 'error')
    expect(errors.some(e => e['code'] === 'TURN_COST_EXCEEDED')).toBe(true)
    delete process.env['COPILOT_MAX_COST_PER_TURN_USD']
  })
})
