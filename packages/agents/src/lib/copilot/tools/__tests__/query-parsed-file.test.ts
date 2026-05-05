import { describe, it, expect, vi, beforeEach } from 'vitest'

const parsedSelectMock = vi.fn()

const mockDb = {
  select: vi.fn(() => ({
    from: () => ({
      where: () => ({ limit: () => parsedSelectMock() }),
    }),
  })),
}

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => mockDb,
  parsedFiles: { _: { name: 'parsed_files' } },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ eq: { c, v } })),
  and: vi.fn((...c) => ({ and: c })),
}))

const { queryParsedFileTool } = await import('../query-parsed-file')

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const, conversation_id: 'c1' }
const VALID = '33333333-3333-3333-3333-333333333333'

const xlsxStructured = {
  type: 'xlsx',
  sheets: [
    {
      name: 'Vendas',
      rows: [
        ['Vendedor', 'Estado', 'Vendas Q2'],
        ['Alice',    'SP',     1500],
        ['Bob',      'RJ',     1200],
        ['Carol',    'SP',      900],
        ['Dave',     'SP',     2000],
      ],
      total_rows: 5,
      total_cols: 3,
    },
  ],
}

beforeEach(() => {
  parsedSelectMock.mockReset()
})

describe('query_parsed_file tool', () => {
  it('throws on invalid parsed_id', async () => {
    await expect(queryParsedFileTool.handler({ parsed_id: 'not-uuid' }, ctx))
      .rejects.toThrow(/INVALID_PARSED_ID/)
  })

  it('throws PARSED_FILE_NOT_FOUND when row missing', async () => {
    parsedSelectMock.mockResolvedValueOnce([])
    await expect(queryParsedFileTool.handler({ parsed_id: VALID }, ctx))
      .rejects.toThrow(/PARSED_FILE_NOT_FOUND/)
  })

  it('returns xlsx rows with default first sheet, no projection', async () => {
    parsedSelectMock.mockResolvedValueOnce([{ format: 'xlsx', structured_json: xlsxStructured }])
    const out = await queryParsedFileTool.handler({ parsed_id: VALID }, ctx)
    expect(out.format).toBe('xlsx')
    expect(out.sheet).toBe('Vendas')
    expect(out.total_rows_in_source).toBe(4)  // exclui header
    expect(out.rows).toHaveLength(4)
    expect(out.rows[0]).toEqual({ Vendedor: 'Alice', Estado: 'SP', 'Vendas Q2': 1500 })
  })

  it('applies filter (single-key equality)', async () => {
    parsedSelectMock.mockResolvedValueOnce([{ format: 'xlsx', structured_json: xlsxStructured }])
    const out = await queryParsedFileTool.handler({
      parsed_id: VALID, sheet: 'Vendas', filter: { Estado: 'SP' },
    }, ctx)
    expect(out.rows).toHaveLength(3)  // Alice, Carol, Dave
    expect(out.rows.every((r: Record<string, unknown>) => r.Estado === 'SP')).toBe(true)
  })

  it('applies sort desc and limit', async () => {
    parsedSelectMock.mockResolvedValueOnce([{ format: 'xlsx', structured_json: xlsxStructured }])
    const out = await queryParsedFileTool.handler({
      parsed_id: VALID, sort: '-Vendas Q2', limit: 2,
    }, ctx)
    expect(out.rows).toHaveLength(2)
    expect(out.rows[0]?.Vendedor).toBe('Dave')   // 2000
    expect(out.rows[1]?.Vendedor).toBe('Alice')  // 1500
    expect(out.truncated).toBe(true)
  })

  it('applies columns projection', async () => {
    parsedSelectMock.mockResolvedValueOnce([{ format: 'xlsx', structured_json: xlsxStructured }])
    const out = await queryParsedFileTool.handler({
      parsed_id: VALID, columns: ['Vendedor', 'Vendas Q2'],
    }, ctx)
    expect(Object.keys(out.rows[0] ?? {})).toEqual(['Vendedor', 'Vendas Q2'])
  })

  it('caps limit at 500 max', async () => {
    parsedSelectMock.mockResolvedValueOnce([{ format: 'xlsx', structured_json: xlsxStructured }])
    const out = await queryParsedFileTool.handler({
      parsed_id: VALID, limit: 999,
    }, ctx)
    expect(out.rows.length).toBeLessThanOrEqual(500)
  })

  it('handles csv format with headers + rows', async () => {
    parsedSelectMock.mockResolvedValueOnce([{
      format: 'csv',
      structured_json: {
        type: 'csv',
        headers: ['name', 'qty'],
        rows: [['Apple', '5'], ['Banana', '3']],
      },
    }])
    const out = await queryParsedFileTool.handler({ parsed_id: VALID }, ctx)
    expect(out.format).toBe('csv')
    expect(out.rows).toEqual([
      { name: 'Apple', qty: '5' },
      { name: 'Banana', qty: '3' },
    ])
  })
})
