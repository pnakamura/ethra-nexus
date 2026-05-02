import type { Parser, ParserResult } from './parser-types'
import { xlsxParser } from './xlsx-parser'
import { pdfParser } from './pdf-parser'
import { docxParser } from './docx-parser'
import { csvParser } from './csv-parser'
import { txtParser } from './txt-parser'
import { mdParser } from './md-parser'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PDF_MIME  = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

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
