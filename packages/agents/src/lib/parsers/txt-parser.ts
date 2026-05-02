import type { Parser, ParserResult } from './parser-types'

const PREVIEW_LINES = 30
const PREVIEW_MD_MAX_BYTES = 5 * 1024

export const txtParser: Parser = async (bytes: Buffer): Promise<ParserResult> => {
  const content = bytes.toString('utf8').replace(/^﻿/, '')
  const warnings: string[] = []
  const lines = content === '' ? [] : content.replace(/\r\n/g, '\n').split('\n')
  // Drop trailing empty line caused by terminal newline
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0) warnings.push('empty file')

  const previewLines = lines.slice(0, PREVIEW_LINES)
  let preview_md = '# TXT preview\n\n```\n' + previewLines.join('\n') + '\n```'
  if (lines.length > PREVIEW_LINES) {
    preview_md += `\n\n_(+${lines.length - PREVIEW_LINES} linhas omitidas)_`
  }
  if (Buffer.byteLength(preview_md, 'utf8') > PREVIEW_MD_MAX_BYTES) {
    preview_md = preview_md.slice(0, PREVIEW_MD_MAX_BYTES) + '\n\n_(preview truncado)_'
    warnings.push('preview truncated to 5KB')
  }

  return {
    format: 'txt',
    structured_json: { type: 'txt', content, line_count: lines.length },
    preview_md,
    pages_or_sheets: 1,
    warnings,
  }
}
