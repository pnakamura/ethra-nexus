import { describe, it, expect, vi } from 'vitest'
import { parserFor } from '../file-parser'

vi.mock('../xlsx-parser', () => ({ xlsxParser: vi.fn() }))
vi.mock('../pdf-parser',  () => ({ pdfParser:  vi.fn() }))
vi.mock('../docx-parser', () => ({ docxParser: vi.fn() }))
vi.mock('../csv-parser',  () => ({ csvParser:  vi.fn() }))
vi.mock('../txt-parser',  () => ({ txtParser:  vi.fn() }))
vi.mock('../md-parser',   () => ({ mdParser:   vi.fn() }))

describe('parserFor(mime)', () => {
  it('routes xlsx mime to xlsxParser', async () => {
    const { xlsxParser } = await import('../xlsx-parser')
    expect(parserFor('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(xlsxParser)
  })

  it('routes pdf mime to pdfParser', async () => {
    const { pdfParser } = await import('../pdf-parser')
    expect(parserFor('application/pdf')).toBe(pdfParser)
  })

  it('routes docx mime to docxParser', async () => {
    const { docxParser } = await import('../docx-parser')
    expect(parserFor('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(docxParser)
  })

  it('routes csv mime to csvParser', async () => {
    const { csvParser } = await import('../csv-parser')
    expect(parserFor('text/csv')).toBe(csvParser)
  })

  it('routes csv mime with charset suffix', async () => {
    const { csvParser } = await import('../csv-parser')
    expect(parserFor('text/csv; charset=utf-8')).toBe(csvParser)
  })

  it('routes txt mime to txtParser', async () => {
    const { txtParser } = await import('../txt-parser')
    expect(parserFor('text/plain')).toBe(txtParser)
  })

  it('routes md mime to mdParser', async () => {
    const { mdParser } = await import('../md-parser')
    expect(parserFor('text/markdown')).toBe(mdParser)
  })

  it('throws UNSUPPORTED_MIME for unknown mime', () => {
    expect(() => parserFor('application/octet-stream')).toThrow(/UNSUPPORTED_MIME/)
  })

  it('throws UNSUPPORTED_MIME for empty string', () => {
    expect(() => parserFor('')).toThrow(/UNSUPPORTED_MIME/)
  })
})
