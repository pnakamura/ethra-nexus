import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { mdParser } from '../md-parser'

const FIXTURE = join(__dirname, 'fixtures', 'tiny.md')

describe('mdParser', () => {
  it('extracts content + section list', async () => {
    const buf = await readFile(FIXTURE)
    const result = await mdParser(buf)
    expect(result.format).toBe('md')
    expect(result.pages_or_sheets).toBe(1)
    if (result.structured_json.type !== 'md') throw new Error('wrong shape')
    expect(result.structured_json.content).toContain('# Project README')
    expect(result.structured_json.sections).toEqual([
      { level: 1, title: 'Project README', line: 1 },
      { level: 2, title: 'Installation', line: 5 },
      { level: 2, title: 'Usage', line: 9 },
      { level: 3, title: 'Basic example', line: 11 },
    ])
  })

  it('preview_md echoes content for small files', async () => {
    const buf = await readFile(FIXTURE)
    const result = await mdParser(buf)
    expect(result.preview_md).toContain('Project README')
    expect(result.preview_md).toContain('Installation')
  })

  it('handles file without any heading', async () => {
    const result = await mdParser(Buffer.from('plain text only\n'))
    if (result.structured_json.type !== 'md') throw new Error('wrong shape')
    expect(result.structured_json.sections).toEqual([])
    expect(result.warnings).toContain('no headings')
  })
})
