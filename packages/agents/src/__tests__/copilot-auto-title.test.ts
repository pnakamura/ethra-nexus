import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
const mockSelect = vi.fn()
const mockUpdate = vi.fn()

vi.mock('../lib/copilot/anthropic-client', () => ({
  getAnthropicClient: () => ({ messages: { create: mockCreate } }),
}))

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({ select: mockSelect, update: mockUpdate }),
  copilotConversations: { id: 'id', title: 'title', updated_at: 'ua' },
  copilotMessages: { conversation_id: 'cid', role: 'role', content: 'content', created_at: 'ca' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ c, v })),
  asc: vi.fn((c) => ({ asc: c })),
}))

const { generateAutoTitle } = await import('../lib/copilot/auto-title')

describe('generateAutoTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdate.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) })
  })

  it('skips when conversation already has title', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'c1', title: 'Already titled' }]),
        }),
      }),
    })
    await generateAutoTitle('c1')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('generates title from first messages', async () => {
    let call = 0
    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() => {
            call++
            if (call === 1) return Promise.resolve([{ id: 'c1', title: null }])
            return Promise.resolve([
              { role: 'user', content: [{ type: 'text', text: 'olá' }] },
              { role: 'assistant', content: [{ type: 'text', text: 'oi' }] },
            ])
          }),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { role: 'user', content: [{ type: 'text', text: 'olá' }] },
              { role: 'assistant', content: [{ type: 'text', text: 'oi' }] },
            ]),
          }),
        }),
      }),
    }))
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Saudação inicial' }] })

    await generateAutoTitle('c1')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-haiku-4-5-20251001',
    }))
    expect(mockUpdate).toHaveBeenCalled()
  })

  it('swallows errors silently (fire-and-forget)', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'c1', title: null }]),
          orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ role: 'user', content: [{ type: 'text', text: 'olá' }] }]) }),
        }),
      }),
    })
    mockCreate.mockRejectedValue(new Error('haiku down'))
    // Should NOT throw
    await expect(generateAutoTitle('c1')).resolves.toBeUndefined()
  })
})
