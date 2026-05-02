import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { xlsxParser } from '../xlsx-parser'

const FIXTURE = join(__dirname, 'fixtures', 'tiny.xlsx')

describe('xlsxParser', () => {
  it('parses 2-sheet workbook with rows + headers', async () => {
    const buf = await readFile(FIXTURE)
    const result = await xlsxParser(buf)
    expect(result.format).toBe('xlsx')
    expect(result.pages_or_sheets).toBe(2)
    if (result.structured_json.type !== 'xlsx') throw new Error('wrong shape')
    expect(result.structured_json.sheets).toHaveLength(2)
    const vendas = result.structured_json.sheets.find(s => s.name === 'Vendas')!
    expect(vendas.total_rows).toBe(3)  // header + 2 data rows
    expect(vendas.total_cols).toBe(2)
    expect(vendas.rows[0]).toEqual(['name', 'qty'])
    expect(vendas.rows[1]).toEqual(['Apple', 5])
  })

  it('preview_md mentions every sheet name and row count', async () => {
    const buf = await readFile(FIXTURE)
    const result = await xlsxParser(buf)
    expect(result.preview_md).toContain('Vendas')
    expect(result.preview_md).toContain('Cidades')
    expect(result.preview_md).toMatch(/3\s+linhas|3\s+rows/)
  })

  it('returns empty warnings for clean file', async () => {
    const buf = await readFile(FIXTURE)
    const result = await xlsxParser(buf)
    expect(result.warnings).toEqual([])
  })

  it('rejects empty buffer with clear error', async () => {
    await expect(xlsxParser(Buffer.alloc(0))).rejects.toThrow()
  })
})
