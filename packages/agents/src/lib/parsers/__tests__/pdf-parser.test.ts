import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pdfParser } from '../pdf-parser'

const FIXTURE = join(__dirname, 'fixtures', 'tiny.pdf')

describe('pdfParser', () => {
  it('extracts text from a 2-page pdf', async () => {
    const buf = await readFile(FIXTURE)
    const result = await pdfParser(buf)
    expect(result.format).toBe('pdf')
    expect(result.pages_or_sheets).toBe(2)
    if (result.structured_json.type !== 'pdf') throw new Error('wrong shape')
    expect(result.structured_json.pages).toHaveLength(2)
    expect(result.structured_json.pages[0]?.page).toBe(1)
    expect(result.structured_json.pages[0]?.text).toContain('Hello World')
    expect(result.structured_json.pages[1]?.text).toContain('Segunda')
  })

  it('preview_md includes page text excerpts', async () => {
    const buf = await readFile(FIXTURE)
    const result = await pdfParser(buf)
    expect(result.preview_md).toContain('Hello World')
    expect(result.preview_md).toMatch(/Página\s*1|Page\s*1/)
  })

  it('rejects empty buffer', async () => {
    await expect(pdfParser(Buffer.alloc(0))).rejects.toThrow()
  })
})
