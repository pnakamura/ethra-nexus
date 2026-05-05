import { describe, it, expect, vi, beforeEach } from 'vitest'

const filesSelectMock = vi.fn()
const parsedSelectMock = vi.fn()
const artifactsInsertMock = vi.fn()

const mockDb = {
  select: vi.fn((cols?: unknown) => ({
    from: () => ({
      where: () => ({ limit: () => filesSelectMock() }),
    }),
  })),
  insert: vi.fn(() => ({
    values: (_v: unknown) => artifactsInsertMock(),
  })),
}

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => mockDb,
  files: { _: { name: 'files' } },
  parsedFiles: { _: { name: 'parsed_files' } },
  externalAgents: { _: { name: 'external_agents' } },
  artifacts: { _: { name: 'artifacts' } },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ eq: { c, v } })),
  and: vi.fn((...c) => ({ and: c })),
  sql: vi.fn((parts, ...vals) => ({ sql: { parts, vals } })),
}))

const driverPutMock = vi.fn()
const driverDeleteMock = vi.fn()
vi.mock('../../storage', () => ({
  createStorageDriver: () => ({
    put: driverPutMock,
    delete: driverDeleteMock,
    get: vi.fn(),
    getDownloadUrl: vi.fn(),
  }),
}))

const completionMock = vi.fn()
vi.mock('../../provider', () => ({
  createRegistryFromEnv: () => ({ complete: completionMock }),
}))

// Additional mocks required by skill-executor imports
vi.mock('@ethra-nexus/core', () => ({
  sanitizeForHtml: (content: string) => content,
  sanitizeErrorMessage: (msg: string) => msg,
  validateExternalUrl: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@ethra-nexus/wiki', () => ({
  embed: vi.fn().mockResolvedValue(Array(1536).fill(0.1)),
  extractPagesFromContent: vi.fn(),
}))
vi.mock('../../db', () => ({
  createWikiDb: vi.fn(() => ({ upsertStrategicPage: vi.fn() })),
}))
vi.mock('../../a2a/client', () => ({
  A2AClient: vi.fn().mockImplementation(() => ({
    sendTask: vi.fn(),
    getTask: vi.fn(),
  })),
}))
vi.mock('../../scheduler/event-bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../wiki/wiki-writer', () => ({
  writeLesson: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../parsers', () => ({
  parseFile: vi.fn(),
}))

const { executeSkill } = await import('../skill-executor')

const ctx = {
  tenant_id: '11111111-1111-1111-1111-111111111111',
  agent_id: '22222222-2222-2222-2222-222222222222',
  session_id: 'evt-1',
  wiki_scope: 'agent-output-worker',
  timestamp: '2026-05-04T00:00:00Z',
  budget_remaining_usd: 10,
  tokens_remaining: 1000000,
}
const stubAgent = { system_prompt: '', model: 'claude-sonnet-4-6' }
const VALID_CONV_ID = '33333333-3333-3333-3333-333333333333'

const VALID_HTML = '<!DOCTYPE html><html><body><h1>Title</h1><script>console.log(1)</script></body></html>'
const VALID_RESPONSE = {
  content: VALID_HTML,
  input_tokens: 1000,
  output_tokens: 500,
  estimated_cost_usd: 0.012,
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  is_fallback: false,
}

beforeEach(() => {
  filesSelectMock.mockReset()
  parsedSelectMock.mockReset()
  artifactsInsertMock.mockReset()
  driverPutMock.mockReset()
  driverDeleteMock.mockReset()
  completionMock.mockReset()
})

describe('data:render', () => {
  it('returns INVALID_INPUT when title is missing', async () => {
    const r = await executeSkill('data:render', ctx, {
      title: '', prompt: 'test', data: { x: 1 }, conversation_id: VALID_CONV_ID,
    }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT')
  })

  it('returns INVALID_INPUT when data exceeds 100KB', async () => {
    const big = { rows: 'x'.repeat(101 * 1024) }
    const r = await executeSkill('data:render', ctx, {
      title: 'T', prompt: 'p', data: big, conversation_id: VALID_CONV_ID,
    }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT')
  })

  it('returns INVALID_INPUT when conversation_id is missing', async () => {
    const r = await executeSkill('data:render', ctx, {
      title: 'T', prompt: 'p', data: { x: 1 },
    }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT')
  })

  it('returns AI_ERROR when Anthropic call throws', async () => {
    completionMock.mockRejectedValueOnce(new Error('timeout'))
    const r = await executeSkill('data:render', ctx, {
      title: 'T', prompt: 'p', data: { x: 1 }, conversation_id: VALID_CONV_ID,
    }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('AI_ERROR')
  })

  it('returns RENDER_FAILED when response has no html', async () => {
    completionMock.mockResolvedValueOnce({ ...VALID_RESPONSE, content: 'just plain text, no doctype' })
    const r = await executeSkill('data:render', ctx, {
      title: 'T', prompt: 'p', data: { x: 1 }, conversation_id: VALID_CONV_ID,
    }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('RENDER_FAILED')
      expect(r.error.message).toMatch(/no html/)
    }
  })

  it('returns RENDER_FAILED when validateArtifactHtml rejects (e.g. inline onclick)', async () => {
    const badHtml = '<!DOCTYPE html><html><body><button onclick="x()">go</button></body></html>'
    completionMock.mockResolvedValueOnce({ ...VALID_RESPONSE, content: badHtml })
    const r = await executeSkill('data:render', ctx, {
      title: 'T', prompt: 'p', data: { x: 1 }, conversation_id: VALID_CONV_ID,
    }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('RENDER_FAILED')
      expect(r.error.message).toMatch(/event handler/)
    }
  })

  it('writes via driver + INSERTs artifact + returns artifact_id on success', async () => {
    completionMock.mockResolvedValueOnce(VALID_RESPONSE)
    driverPutMock.mockResolvedValueOnce({
      storage_key: 'tenant-1/artifacts/abc',
      size_bytes: 105,
      sha256: 'a'.repeat(64),
    })
    artifactsInsertMock.mockResolvedValueOnce(undefined)

    const r = await executeSkill('data:render', ctx, {
      title: 'Top 10 Vendedores',
      prompt: 'gera dashboard',
      data: { rows: [{ name: 'a', value: 1 }] },
      conversation_id: VALID_CONV_ID,
    }, stubAgent)

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.artifact_id).toMatch(/^[0-9a-f-]{36}$/)
      expect(r.data.download_url).toMatch(/^\/api\/v1\/artifacts\/[0-9a-f-]{36}\/view$/)
      expect(r.data.title).toBe('Top 10 Vendedores')
      expect(r.data.cost_usd).toBe(0.012)
      expect(r.data.provider).toBe('anthropic')
    }
    expect(driverPutMock).toHaveBeenCalledTimes(1)
    expect(artifactsInsertMock).toHaveBeenCalledTimes(1)
  })
})
