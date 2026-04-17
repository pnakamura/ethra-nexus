import type { WikiRawSource } from '@ethra-nexus/core'
import { readFile } from 'fs/promises'

// ============================================================
// File Parser — converte arquivos brutos em texto plano
//
// Cada tipo de arquivo tem um parser específico.
// O dispatcher roteia automaticamente por file_type.
// ============================================================

export type FileType = WikiRawSource['file_type']

export async function parseFile(
  filePath: string,
  fileType: FileType,
): Promise<string> {
  const content = await readFile(filePath)
  return parseBuffer(content, fileType)
}

export async function parseBuffer(
  buffer: Buffer,
  fileType: FileType,
): Promise<string> {
  switch (fileType) {
    case 'md':
    case 'txt':
      return buffer.toString('utf8')

    case 'pdf':
      return parsePdf(buffer)

    case 'docx':
      return parseDocx(buffer)

    case 'xlsx':
      return parseXlsx(buffer)

    case 'url':
      // O "arquivo" contém a URL a ser buscada
      return parseUrl(buffer.toString('utf8').trim())

    default: {
      const _exhaustive: never = fileType
      throw new Error(`Unsupported file type: ${String(_exhaustive)}`)
    }
  }
}

async function parsePdf(buffer: Buffer): Promise<string> {
  const pdfParse = await import('pdf-parse')
  const result = await pdfParse.default(buffer)
  return result.text
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

async function parseXlsx(buffer: Buffer): Promise<string> {
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

async function parseUrl(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'EthraNexus/1.0 (+https://ethranexus.com)' },
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    throw new Error(`URL fetch failed: ${response.status} ${response.statusText}`)
  }

  const html = await response.text()

  // Extrai texto visível do HTML (strip tags simples)
  // Para produção, considerar cheerio para parsing mais robusto
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
