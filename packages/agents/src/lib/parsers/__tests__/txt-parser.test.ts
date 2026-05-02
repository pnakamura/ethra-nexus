import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { txtParser } from '../txt-parser'

const FIXTURE = join(__dirname, 'fixtures', 'tiny.txt')

describe('txtParser', () => {
  it('returns content + line_count', async () => {
    const buf = await readFile(FIXTURE)
    const result = await txtParser(buf)
    expect(result.format).toBe('txt')
    expect(result.pages_or_sheets).toBe(1)
    if (result.structured_json.type !== 'txt') throw new Error('wrong shape')
    expect(result.structured_json.line_count).toBe(3)
    expect(result.structured_json.content).toContain('acentuação')
  })

  it('preview_md is the first lines verbatim', async () => {
    const buf = await readFile(FIXTURE)
    const result = await txtParser(buf)
    expect(result.preview_md).toContain('Linha 1')
    expect(result.preview_md).toContain('acentuação')
  })

  it('handles empty file (no lines)', async () => {
    const result = await txtParser(Buffer.from(''))
    if (result.structured_json.type !== 'txt') throw new Error('wrong shape')
    expect(result.structured_json.line_count).toBe(0)
    expect(result.warnings).toContain('empty file')
  })
})
