// packages/agents/src/lib/parsers/parser-types.ts

export type ParserFormat = 'xlsx' | 'pdf' | 'docx' | 'csv' | 'txt' | 'md'

/**
 * Neutral, parser-agnostic output shape. Any future parser must conform.
 * Cached as-is in `parsed_files.structured_json` (the ParserStructuredOutput).
 */
export interface ParserResult {
  format: ParserFormat
  structured_json: ParserStructuredOutput
  preview_md: string         // human-readable markdown, target ~2-5KB
  pages_or_sheets: number    // sheets for xlsx, pages for pdf, 1 for everything else
  warnings: string[]         // e.g. "macros ignored", "encrypted"
}

export type ParserStructuredOutput =
  | { type: 'xlsx'; sheets: XlsxSheet[] }
  | { type: 'pdf'; pages: PdfPage[] }
  | { type: 'docx'; paragraphs: DocxParagraph[]; tables: DocxTable[] }
  | { type: 'csv'; rows: string[][]; headers: string[] }
  | { type: 'txt'; content: string; line_count: number }
  | { type: 'md'; content: string; sections: MdSection[] }

export interface XlsxSheet {
  name: string
  rows: unknown[][]
  total_rows: number
  total_cols: number
}

export interface PdfPage {
  page: number
  text: string
}

export interface DocxParagraph {
  style: string  // 'Heading1', 'Heading2', 'Normal', etc.
  text: string
}

export interface DocxTable {
  rows: string[][]
  cols: number
}

export interface MdSection {
  level: number   // 1..6 from `#`..`######`
  title: string
  line: number    // 1-indexed line number where section starts
}

export type Parser = (bytes: Buffer) => Promise<ParserResult>
