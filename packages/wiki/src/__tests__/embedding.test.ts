// packages/wiki/src/__tests__/embedding.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockEmbeddingsCreate = vi.fn()

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: {
      create: mockEmbeddingsCreate,
    },
  })),
}))

process.env['OPENAI_API_KEY'] = 'test-key'

const { embed } = await import('../embedding')

const MOCK_EMBEDDING = Array(1536).fill(0.1)

describe('embed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna array numérico de 1536 dimensões quando API bem-sucedida', async () => {
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: MOCK_EMBEDDING }],
    })

    const result = await embed('Texto de teste')

    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(1536)
    expect(typeof result[0]).toBe('number')
  })

  it('trunca texto para MAX_INPUT_CHARS antes de enviar para API', async () => {
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: MOCK_EMBEDDING }],
    })

    const longText = 'a'.repeat(35000)
    await embed(longText)

    const call = mockEmbeddingsCreate.mock.calls[0]?.[0] as { input: string }
    expect(call.input.length).toBeLessThanOrEqual(30000)
  })

  it('lança erro quando API retorna data vazio', async () => {
    mockEmbeddingsCreate.mockResolvedValue({ data: [] })

    await expect(embed('texto')).rejects.toThrow('Embedding API returned empty result')
  })

  it('lança erro quando create rejeita (falha de rede ou API)', async () => {
    mockEmbeddingsCreate.mockRejectedValue(new Error('Network error'))

    await expect(embed('texto')).rejects.toThrow('Network error')
  })
})
