import { describe, it, expect, vi, beforeEach } from 'vitest'

// We mock the @ethra-nexus/db module + the storage factory + the parsers module.
const filesSelectMock = vi.fn()
const parsedSelectMock = vi.fn()
const parsedInsertMock = vi.fn()

const mockDb = {
  select: vi.fn((cols?: unknown) => ({
    from: (table: { _: { name?: string } } | unknown) => {
      const tableName = (table as { _?: { name?: string } } | { name?: string })?._
        ? (table as { _: { name?: string } })._.name
        : (table as { name?: string }).name
      return {
        where: (_w: unknown) => ({
          limit: (_n: number) => {
            if (tableName === 'files') return filesSelectMock()
            return parsedSelectMock()
          },
        }),
      }
    },
  })),
  insert: vi.fn(() => ({
    values: () => ({
      onConflictDoNothing: (_opts?: unknown) => ({
        returning: () => parsedInsertMock(),
      }),
    }),
  })),
}

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => mockDb,
  files: { _: { name: 'files' }, id: 'files.id', tenant_id: 'files.tenant_id', storage_key: 'files.storage_key', mime_type: 'files.mime_type', sha256: 'files.sha256' },
  parsedFiles: { _: { name: 'parsed_files' }, id: 'parsed_files.id', tenant_id: 'parsed_files.tenant_id', sha256: 'parsed_files.sha256' },
  externalAgents: { _: { name: 'external_agents' } },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ eq: { c, v } })),
  and: vi.fn((...c) => ({ and: c })),
  sql: vi.fn((parts, ...vals) => ({ sql: { parts, vals } })),
}))

const driverGetMock = vi.fn()
vi.mock('../../storage', () => ({
  createStorageDriver: () => ({
    get: driverGetMock,
    put: vi.fn(),
    delete: vi.fn(),
    getDownloadUrl: vi.fn(),
  }),
}))

const parseFileMock = vi.fn()
vi.mock('../../parsers', () => ({
  parseFile: parseFileMock,
}))

// Also mock the other deps that skill-executor imports so they don't error on import
vi.mock('@ethra-nexus/core', () => ({
  sanitizeForHtml: (content: string) => content,
  sanitizeErrorMessage: (msg: string) => msg,
  validateExternalUrl: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@ethra-nexus/wiki', () => ({
  embed: vi.fn().mockResolvedValue(Array(1536).fill(0.1)),
  extractPagesFromContent: vi.fn(),
}))
vi.mock('../../provider', () => ({
  createRegistryFromEnv: () => ({ complete: vi.fn() }),
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

const { executeSkill } = await import('../skill-executor')

const ctx = {
  tenant_id: '11111111-1111-1111-1111-111111111111',
  agent_id: '22222222-2222-2222-2222-222222222222',
  session_id: 'evt-1',
  wiki_scope: 'agent-input-worker',
  timestamp: '2026-05-02T00:00:00Z',
  budget_remaining_usd: 10,
  tokens_remaining: 1000000,
}
const VALID_FILE_ID = '33333333-3333-3333-3333-333333333333'
const SHA = 'a'.repeat(64)

const stubAgent = { system_prompt: '', model: 'claude-sonnet-4-6' }

beforeEach(() => {
  filesSelectMock.mockReset()
  parsedSelectMock.mockReset()
  parsedInsertMock.mockReset()
  driverGetMock.mockReset()
  parseFileMock.mockReset()
})

describe('data:extract', () => {
  it('returns INVALID_INPUT when file_id is missing or not a UUID', async () => {
    const r = await executeSkill('data:extract', ctx, { file_id: 'not-a-uuid' }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT')
  })

  it('returns FILE_NOT_FOUND when file row does not exist', async () => {
    filesSelectMock.mockResolvedValueOnce([])
    const r = await executeSkill('data:extract', ctx, { file_id: VALID_FILE_ID }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FILE_NOT_FOUND')
  })

  it('returns cached preview on cache hit and does NOT call parser/driver', async () => {
    filesSelectMock.mockResolvedValueOnce([{ storage_key: 't1/f1', mime_type: 'application/pdf', sha256: SHA }])
    parsedSelectMock.mockResolvedValueOnce([{
      id: 'cached-id', format: 'pdf', preview_md: '# cached', pages_or_sheets: 3, warnings: ['old-warning'],
    }])

    const r = await executeSkill('data:extract', ctx, { file_id: VALID_FILE_ID }, stubAgent)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.parsed_id).toBe('cached-id')
      expect(r.data.preview_md).toBe('# cached')
      expect(r.data.format).toBe('pdf')
    }
    expect(driverGetMock).not.toHaveBeenCalled()
    expect(parseFileMock).not.toHaveBeenCalled()
  })

  it('returns STORAGE_ORPHAN when driver.get returns null', async () => {
    filesSelectMock.mockResolvedValueOnce([{ storage_key: 't1/f1', mime_type: 'application/pdf', sha256: SHA }])
    parsedSelectMock.mockResolvedValueOnce([])
    driverGetMock.mockResolvedValueOnce(null)
    const r = await executeSkill('data:extract', ctx, { file_id: VALID_FILE_ID }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('STORAGE_ORPHAN')
  })

  it('returns PARSE_FAILED when parser throws', async () => {
    filesSelectMock.mockResolvedValueOnce([{ storage_key: 't1/f1', mime_type: 'application/pdf', sha256: SHA }])
    parsedSelectMock.mockResolvedValueOnce([])
    driverGetMock.mockResolvedValueOnce(makeReadable(Buffer.from('x')))
    parseFileMock.mockRejectedValueOnce(new Error('boom'))
    const r = await executeSkill('data:extract', ctx, { file_id: VALID_FILE_ID }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('PARSE_FAILED')
  })

  it('parses + caches + returns parsed_id on first hit', async () => {
    filesSelectMock.mockResolvedValueOnce([{ storage_key: 't1/f1', mime_type: 'application/pdf', sha256: SHA }])
    parsedSelectMock.mockResolvedValueOnce([])
    driverGetMock.mockResolvedValueOnce(makeReadable(Buffer.from('pdf-bytes')))
    parseFileMock.mockResolvedValueOnce({
      format: 'pdf', structured_json: { type: 'pdf', pages: [{ page: 1, text: 'hello' }] },
      preview_md: '# preview', pages_or_sheets: 1, warnings: [],
    })
    parsedInsertMock.mockResolvedValueOnce([{ id: 'newly-inserted' }])

    const r = await executeSkill('data:extract', ctx, { file_id: VALID_FILE_ID }, stubAgent)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.parsed_id).toBe('newly-inserted')
      expect(r.data.preview_md).toBe('# preview')
    }
  })

  it('handles INSERT race: returning empty → SELECT existing', async () => {
    filesSelectMock.mockResolvedValueOnce([{ storage_key: 't1/f1', mime_type: 'application/pdf', sha256: SHA }])
    parsedSelectMock.mockResolvedValueOnce([])  // initial cache miss
    driverGetMock.mockResolvedValueOnce(makeReadable(Buffer.from('x')))
    parseFileMock.mockResolvedValueOnce({
      format: 'pdf', structured_json: { type: 'pdf', pages: [] },
      preview_md: '# preview', pages_or_sheets: 0, warnings: [],
    })
    parsedInsertMock.mockResolvedValueOnce([])  // ON CONFLICT swallowed insert
    parsedSelectMock.mockResolvedValueOnce([{ id: 'race-winner-id' }])

    const r = await executeSkill('data:extract', ctx, { file_id: VALID_FILE_ID }, stubAgent)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.parsed_id).toBe('race-winner-id')
  })
})

function makeReadable(buf: Buffer): NodeJS.ReadableStream {
  const { Readable } = require('node:stream') as typeof import('node:stream')
  return Readable.from([buf])
}
