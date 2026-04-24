import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const { A2AClient } = await import('../lib/a2a/client')

const makeResponse = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
})

describe('A2AClient.sendTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns taskId on success', async () => {
    mockFetch.mockResolvedValue(makeResponse({ result: { id: 'task-123' } }))
    const client = new A2AClient('https://agent.example.com/a2a')
    const { taskId } = await client.sendTask('Analyze Q1 data')
    expect(taskId).toBe('task-123')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://agent.example.com/a2a',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('includes Authorization header when authToken provided', async () => {
    mockFetch.mockResolvedValue(makeResponse({ result: { id: 'task-456' } }))
    const client = new A2AClient('https://agent.example.com/a2a', 'token-xyz')
    await client.sendTask('Hello')
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer token-xyz')
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, false, 500))
    const client = new A2AClient('https://agent.example.com/a2a')
    await expect(client.sendTask('test')).rejects.toThrow('A2A request failed: 500')
  })

  it('throws on JSON-RPC error in body', async () => {
    mockFetch.mockResolvedValue(makeResponse({ error: { message: 'skill not found' } }))
    const client = new A2AClient('https://agent.example.com/a2a')
    await expect(client.sendTask('test')).rejects.toThrow('A2A error: skill not found')
  })

  it('sends contextId when provided', async () => {
    mockFetch.mockResolvedValue(makeResponse({ result: { id: 'task-789' } }))
    const client = new A2AClient('https://agent.example.com/a2a')
    await client.sendTask('Hello', 'ctx-abc')
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string) as { params: { contextId?: string } }
    expect(body.params.contextId).toBe('ctx-abc')
  })
})

describe('A2AClient.getTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns state and result', async () => {
    mockFetch.mockResolvedValue(
      makeResponse({ result: { status: { state: 'completed' }, result: 'Done!' } }),
    )
    const client = new A2AClient('https://agent.example.com/a2a')
    const task = await client.getTask('task-123')
    expect(task.state).toBe('completed')
    expect(task.result).toBe('Done!')
  })

  it('returns unknown state when result missing', async () => {
    mockFetch.mockResolvedValue(makeResponse({}))
    const client = new A2AClient('https://agent.example.com/a2a')
    const task = await client.getTask('task-xyz')
    expect(task.state).toBe('unknown')
  })
})
