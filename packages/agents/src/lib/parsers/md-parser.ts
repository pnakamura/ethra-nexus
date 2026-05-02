import type { Parser, ParserResult, MdSection } from './parser-types'

const PREVIEW_MD_MAX_BYTES = 5 * 1024

export const mdParser: Parser = async (bytes: Buffer): Promise<ParserResult> => {
  const content = bytes.toString('utf8').replace(/^﻿/, '')
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const sections: MdSection[] = []
  let inFence = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^```/.test(line)) inFence = !inFence
    if (inFence) continue
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (m) {
      sections.push({ level: m[1]!.length, title: m[2]!, line: i + 1 })
    }
  }

  const warnings: string[] = []
  if (sections.length === 0) warnings.push('no headings')

  let preview_md: string
  if (Buffer.byteLength(content, 'utf8') <= PREVIEW_MD_MAX_BYTES) {
    preview_md = content
  } else {
    const summary: string[] = ['# Markdown preview', '']
    summary.push(`File has ${lines.length} lines, ${sections.length} headings.`)
    summary.push('', '## Headings')
    for (const s of sections.slice(0, 30)) {
      summary.push('  '.repeat(s.level - 1) + '- ' + s.title)
    }
    if (sections.length > 30) summary.push(`_(+${sections.length - 30} headings)_`)
    preview_md = summary.join('\n')
    warnings.push('content truncated; only headings shown')
  }

  return {
    format: 'md',
    structured_json: { type: 'md', content, sections },
    preview_md,
    pages_or_sheets: 1,
    warnings,
  }
}
