import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { docxParser } from '../docx-parser'

const FIXTURE = join(__dirname, 'fixtures', 'tiny.docx')

describe('docxParser', () => {
  it('extracts paragraphs and tables', async () => {
    const buf = await readFile(FIXTURE)
    const result = await docxParser(buf)
    expect(result.format).toBe('docx')
    expect(result.pages_or_sheets).toBe(1)
    if (result.structured_json.type !== 'docx') throw new Error('wrong shape')
    expect(result.structured_json.paragraphs.length).toBeGreaterThan(0)
    const heading = result.structured_json.paragraphs.find(p => /Heading/i.test(p.style))
    expect(heading?.text).toContain('Título')
    expect(result.structured_json.tables.length).toBeGreaterThan(0)
    expect(result.structured_json.tables[0]?.rows[0]).toEqual(['item', 'valor'])
  })

  it('preview_md mentions heading and table', async () => {
    const buf = await readFile(FIXTURE)
    const result = await docxParser(buf)
    expect(result.preview_md).toContain('Título')
    expect(result.preview_md).toMatch(/item|valor/)
  })

  it('rejects empty buffer', async () => {
    await expect(docxParser(Buffer.alloc(0))).rejects.toThrow()
  })
})
