import type { Parser, ParserResult } from './parser-types'
import type { WikiRawSource } from '@ethra-nexus/core'
import { xlsxParser } from './xlsx-parser'
import { pdfParser } from './pdf-parser'
import { docxParser } from './docx-parser'
import { csvParser } from './csv-parser'
import { txtParser } from './txt-parser'
import { mdParser } from './md-parser'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PDF_MIME  = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// New mime-based dispatcher (Spec #3)
export function parserFor(mime: string): Parser {
  if (mime === XLSX_MIME) return xlsxParser
  if (mime === PDF_MIME)  return pdfParser
  if (mime === DOCX_MIME) return docxParser
  if (mime.startsWith('text/csv'))      return csvParser
  if (mime.startsWith('text/markdown')) return mdParser
  if (mime.startsWith('text/plain'))    return txtParser
  throw new Error(`UNSUPPORTED_MIME: ${mime || '<empty>'}`)
}

export async function parseFile(bytes: Buffer, mime: string): Promise<ParserResult> {
  return parserFor(mime)(bytes)
}

// ── Legacy shim (deprecated) ──────────────────────────────────
// Backward-compatible parseBuffer used by wiki:ingest (apps/server/src/routes/wiki.ts).
// Will be removed in Task 11 (data:extract refactor) once wiki:ingest migrates to
// parseFile(bytes, mime) + ParserResult.
export type FileType = WikiRawSource['file_type']

export async function parseBuffer(
  buffer: Buffer,
  fileType: FileType,
): Promise<string> {
  switch (fileType) {
    case 'md':
    case 'txt':
      return buffer.toString('utf8')
    case 'pdf':
      return parseLegacyPdf(buffer)
    case 'docx':
      return parseLegacyDocx(buffer)
    case 'xlsx':
      return parseLegacyXlsx(buffer)
    case 'url':
      return parseLegacyUrl(buffer.toString('utf8').trim())
    default: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw new Error(`Unsupported file type: ${String(fileType as unknown as string)}`)
    }
  }
}

async function parseLegacyPdf(buffer: Buffer): Promise<string> {
  const pdfParse = await import('pdf-parse')
  const result = await pdfParse.default(buffer)
  return result.text
}

async function parseLegacyDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

async function parseLegacyXlsx(buffer: Buffer): Promise<string> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const lines: string[] = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    lines.push(`## Sheet: ${sheetName}\n`)
    const csv = XLSX.utils.sheet_to_csv(sheet)
    lines.push(csv)
    lines.push('')
  }
  return lines.join('\n')
}

async function parseLegacyUrl(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'EthraNexus/1.0 (+https://ethranexus.com)' },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) {
    throw new Error(`URL fetch failed: ${response.status} ${response.statusText}`)
  }
  const html = await response.text()
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
  return `Source URL: ${url}\n\n${text}`
}
