import type { Parser, ParserResult, XlsxSheet } from './parser-types'

const PREVIEW_ROWS_PER_SHEET = 5
const PREVIEW_MD_MAX_BYTES = 5 * 1024  // safety cap

export const xlsxParser: Parser = async (bytes: Buffer): Promise<ParserResult> => {
  if (bytes.length === 0) throw new Error('xlsxParser: empty buffer')

  const XLSX = await import('xlsx')
  const workbook = XLSX.read(bytes, { type: 'buffer', cellDates: true })
  const warnings: string[] = []

  const sheets: XlsxSheet[] = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
    const totalRows = aoa.length
    const totalCols = aoa.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0)
    sheets.push({ name: sheetName, rows: aoa, total_rows: totalRows, total_cols: totalCols })
  }

  if (sheets.length === 0) warnings.push('No readable sheets found')

  const previewParts: string[] = ['# Workbook preview', '']
  for (const s of sheets) {
    previewParts.push(`## Sheet: ${s.name} (${s.total_rows} linhas × ${s.total_cols} colunas)`)
    const sample = s.rows.slice(0, PREVIEW_ROWS_PER_SHEET)
    if (sample.length > 0) {
      previewParts.push('')
      previewParts.push('| ' + (sample[0] as unknown[]).map(v => String(v ?? '')).join(' | ') + ' |')
      previewParts.push('|' + (sample[0] as unknown[]).map(() => '---').join('|') + '|')
      for (const row of sample.slice(1)) {
        previewParts.push('| ' + (row as unknown[]).map(v => String(v ?? '')).join(' | ') + ' |')
      }
      if (s.total_rows > PREVIEW_ROWS_PER_SHEET) {
        previewParts.push(`_(+${s.total_rows - PREVIEW_ROWS_PER_SHEET} linhas omitidas)_`)
      }
    }
    previewParts.push('')
  }

  let preview_md = previewParts.join('\n')
  if (Buffer.byteLength(preview_md, 'utf8') > PREVIEW_MD_MAX_BYTES) {
    preview_md = preview_md.slice(0, PREVIEW_MD_MAX_BYTES) + '\n\n_(preview truncado)_'
    warnings.push('preview truncated to 5KB')
  }

  return {
    format: 'xlsx',
    structured_json: { type: 'xlsx', sheets },
    preview_md,
    pages_or_sheets: sheets.length,
    warnings,
  }
}
