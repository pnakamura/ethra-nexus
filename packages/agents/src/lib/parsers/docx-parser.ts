import type { Parser, ParserResult, DocxParagraph, DocxTable } from './parser-types'

const PREVIEW_MD_MAX_BYTES = 5 * 1024
const STYLE_MAP = [
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
].join('\n')

const TAG_RE = /<(\/?)([a-z0-9]+)([^>]*)>/gi

export const docxParser: Parser = async (bytes: Buffer): Promise<ParserResult> => {
  if (bytes.length === 0) throw new Error('docxParser: empty buffer')

  const mammoth = await import('mammoth')
  const html = (await mammoth.convertToHtml({ buffer: bytes }, { styleMap: STYLE_MAP })).value

  const paragraphs: DocxParagraph[] = []
  const tables: DocxTable[] = []

  let i = 0
  let currentStyle = 'Normal'
  let buffer = ''
  let inTable = false
  let currentTable: string[][] = []
  let currentRow: string[] = []
  let inCell = false

  TAG_RE.lastIndex = 0
  while (i < html.length) {
    const m = TAG_RE.exec(html)
    if (!m) {
      buffer += html.slice(i)
      break
    }
    if (m.index > i) buffer += html.slice(i, m.index)
    const closing = m[1] === '/'
    const tag = (m[2] ?? '').toLowerCase()
    i = m.index + m[0].length

    const flush = () => {
      const text = decodeEntities(buffer).replace(/\s+/g, ' ').trim()
      if (!text) { buffer = ''; return }
      if (inTable && inCell) {
        currentRow.push(text)
      } else if (!inTable) {
        paragraphs.push({ style: currentStyle, text })
      }
      buffer = ''
    }

    if (!closing) {
      if (tag === 'h1') { flush(); currentStyle = 'Heading1' }
      else if (tag === 'h2') { flush(); currentStyle = 'Heading2' }
      else if (tag === 'h3') { flush(); currentStyle = 'Heading3' }
      else if (tag === 'h4') { flush(); currentStyle = 'Heading4' }
      else if (tag === 'p') { flush(); currentStyle = 'Normal' }
      else if (tag === 'table') { flush(); inTable = true; currentTable = [] }
      else if (tag === 'tr') { currentRow = [] }
      else if (tag === 'td' || tag === 'th') { inCell = true; buffer = '' }
    } else {
      if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'p') flush()
      else if (tag === 'td' || tag === 'th') { flush(); inCell = false }
      else if (tag === 'tr') { if (currentRow.length > 0) currentTable.push(currentRow); currentRow = [] }
      else if (tag === 'table') {
        if (currentTable.length > 0) {
          const cols = Math.max(...currentTable.map(r => r.length))
          tables.push({ rows: currentTable, cols })
        }
        inTable = false
        currentTable = []
      }
    }
  }

  if (buffer.trim()) {
    const text = decodeEntities(buffer).replace(/\s+/g, ' ').trim()
    if (text) paragraphs.push({ style: currentStyle, text })
  }

  const warnings: string[] = []
  if (paragraphs.length === 0 && tables.length === 0) warnings.push('empty document')

  const previewParts: string[] = ['# DOCX preview', '']
  for (const p of paragraphs.slice(0, 30)) {
    if (p.style.startsWith('Heading')) {
      const level = parseInt(p.style.replace('Heading', ''), 10) || 1
      previewParts.push('#'.repeat(level + 1) + ' ' + p.text)
    } else {
      previewParts.push(p.text)
    }
  }
  if (paragraphs.length > 30) previewParts.push(`_(+${paragraphs.length - 30} parágrafos omitidos)_`)

  for (const t of tables.slice(0, 3)) {
    previewParts.push('')
    previewParts.push('| ' + (t.rows[0] ?? []).join(' | ') + ' |')
    previewParts.push('|' + (t.rows[0] ?? []).map(() => '---').join('|') + '|')
    for (const row of t.rows.slice(1, 6)) previewParts.push('| ' + row.join(' | ') + ' |')
    if (t.rows.length > 6) previewParts.push(`_(+${t.rows.length - 6} linhas)_`)
  }

  let preview_md = previewParts.join('\n')
  if (Buffer.byteLength(preview_md, 'utf8') > PREVIEW_MD_MAX_BYTES) {
    preview_md = preview_md.slice(0, PREVIEW_MD_MAX_BYTES) + '\n\n_(preview truncado)_'
    warnings.push('preview truncated to 5KB')
  }

  return {
    format: 'docx',
    structured_json: { type: 'docx', paragraphs, tables },
    preview_md,
    pages_or_sheets: 1,
    warnings,
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
