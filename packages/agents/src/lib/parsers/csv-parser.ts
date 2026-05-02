import type { Parser, ParserResult } from './parser-types'

const PREVIEW_ROWS = 10
const PREVIEW_MD_MAX_BYTES = 5 * 1024

export const csvParser: Parser = async (bytes: Buffer): Promise<ParserResult> => {
  if (bytes.length === 0) throw new Error('csvParser: empty buffer')

  const text = bytes.toString('utf8').replace(/^﻿/, '')  // strip BOM

  // Tiny RFC4180 parser. Handles quotes, escaped quotes (""), CRLF/LF, embedded commas.
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ }
        else inQuotes = false
      } else cell += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(cell); cell = '' }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
      else if (c === '\r') { /* swallow, handled by \n next */ }
      else cell += c
    }
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row) }
  // Drop fully-empty trailing row (e.g. trailing newline)
  while (rows.length > 0 && rows[rows.length - 1]!.every(c => c === '')) rows.pop()

  const headers = rows.length > 0 ? rows[0]! : []
  const dataRows = rows.slice(1)
  const warnings: string[] = []
  if (rows.length === 0) warnings.push('empty csv')

  const previewParts: string[] = [
    `# CSV preview (${dataRows.length} linhas, ${headers.length} colunas)`,
    '',
  ]
  if (headers.length > 0) {
    previewParts.push('| ' + headers.join(' | ') + ' |')
    previewParts.push('|' + headers.map(() => '---').join('|') + '|')
    for (const r of dataRows.slice(0, PREVIEW_ROWS)) {
      previewParts.push('| ' + r.join(' | ') + ' |')
    }
    if (dataRows.length > PREVIEW_ROWS) {
      previewParts.push(`_(+${dataRows.length - PREVIEW_ROWS} linhas omitidas)_`)
    }
  }

  let preview_md = previewParts.join('\n')
  if (Buffer.byteLength(preview_md, 'utf8') > PREVIEW_MD_MAX_BYTES) {
    preview_md = preview_md.slice(0, PREVIEW_MD_MAX_BYTES) + '\n\n_(preview truncado)_'
    warnings.push('preview truncated to 5KB')
  }

  return {
    format: 'csv',
    structured_json: { type: 'csv', headers, rows: dataRows },
    preview_md,
    pages_or_sheets: 1,
    warnings,
  }
}
