import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { csvParser } from '../csv-parser'

const FIXTURE = join(__dirname, 'fixtures', 'tiny.csv')

describe('csvParser', () => {
  it('parses headers and rows', async () => {
    const buf = await readFile(FIXTURE)
    const result = await csvParser(buf)
    expect(result.format).toBe('csv')
    expect(result.pages_or_sheets).toBe(1)
    if (result.structured_json.type !== 'csv') throw new Error('wrong shape')
    expect(result.structured_json.headers).toEqual(['name', 'qty', 'price'])
    expect(result.structured_json.rows).toHaveLength(3)
    expect(result.structured_json.rows[0]).toEqual(['Apple', '5', '1.20'])
  })

  it('handles quoted cell with comma', async () => {
    const buf = await readFile(FIXTURE)
    const result = await csvParser(buf)
    if (result.structured_json.type !== 'csv') throw new Error('wrong shape')
    expect(result.structured_json.rows[2]?.[0]).toBe('Pão, francês')
  })

  it('preview_md shows table-style preview', async () => {
    const buf = await readFile(FIXTURE)
    const result = await csvParser(buf)
    expect(result.preview_md).toContain('name')
    expect(result.preview_md).toContain('Apple')
    expect(result.preview_md).toMatch(/3 linhas/)
  })

  it('rejects empty buffer', async () => {
    await expect(csvParser(Buffer.alloc(0))).rejects.toThrow()
  })
})
