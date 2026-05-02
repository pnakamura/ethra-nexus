import type { Parser, ParserResult, PdfPage } from './parser-types'

const PREVIEW_CHARS_PER_PAGE = 400
const PREVIEW_MD_MAX_BYTES = 5 * 1024

export const pdfParser: Parser = async (bytes: Buffer): Promise<ParserResult> => {
  if (bytes.length === 0) throw new Error('pdfParser: empty buffer')

  // pdf-parse v1 uses bytes.buffer (underlying ArrayBuffer) internally via makeSubStream.
  // Node.js Buffers from readFile may share a pool with byteOffset != 0, which causes
  // makeSubStream to read from the wrong pool offset. Copying to a standalone Uint8Array
  // ensures byteOffset === 0 and the correct bytes are addressed.
  const safeBytes = new Uint8Array(bytes.byteLength)
  safeBytes.set(bytes)

  // Import from the internal lib path to avoid pdf-parse's index.js debug-mode side effect,
  // which tries to read a test file when module.parent is undefined (ESM / vitest context).
  const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default
  const warnings: string[] = []
  let pages: PdfPage[] = []

  // pdf-parse allows a pagerender hook to capture per-page text.
  const perPage: string[] = []
  const result = await pdfParse(safeBytes, {
    pagerender: async (pageData: { getTextContent(): Promise<{ items: Array<{ str: string }> }> }) => {
      const tc = await pageData.getTextContent()
      const txt = tc.items.map(i => i.str).join(' ')
      perPage.push(txt)
      return txt
    },
  })

  pages = perPage.map((text, i) => ({ page: i + 1, text }))

  if (pages.length === 0 && result.text) {
    // Fallback: pagerender hook didn't fire — split by form-feed if present, else single page.
    const split = result.text.split('\f')
    pages = split.map((text, i) => ({ page: i + 1, text }))
    warnings.push('per-page split via fallback (form-feed)')
  }

  if (pages.length === 0) {
    warnings.push('no pages extracted')
  }

  const previewParts: string[] = ['# PDF preview', '']
  for (const p of pages) {
    previewParts.push(`## Page ${p.page}`)
    previewParts.push('')
    const excerpt = p.text.length > PREVIEW_CHARS_PER_PAGE
      ? p.text.slice(0, PREVIEW_CHARS_PER_PAGE) + '...'
      : p.text
    previewParts.push(excerpt.trim() || '_(página vazia)_')
    previewParts.push('')
  }

  let preview_md = previewParts.join('\n')
  if (Buffer.byteLength(preview_md, 'utf8') > PREVIEW_MD_MAX_BYTES) {
    preview_md = preview_md.slice(0, PREVIEW_MD_MAX_BYTES) + '\n\n_(preview truncado)_'
    warnings.push('preview truncated to 5KB')
  }

  return {
    format: 'pdf',
    structured_json: { type: 'pdf', pages },
    preview_md,
    pages_or_sheets: pages.length,
    warnings,
  }
}
