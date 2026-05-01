import { describe, it, expect, vi } from 'vitest'
import { parseSSEChunks } from '@/lib/copilot-stream'

describe('parseSSEChunks', () => {
  it('parses single complete event', () => {
    const events: object[] = []
    const buf = parseSSEChunks('data: {"type":"text_delta","delta":"hi"}\n\n', '', e => events.push(e))
    expect(buf).toBe('')
    expect(events).toEqual([{ type: 'text_delta', delta: 'hi' }])
  })

  it('buffers incomplete event', () => {
    const events: object[] = []
    const buf = parseSSEChunks('data: {"type":"text_delta",', '', e => events.push(e))
    expect(buf).toBe('data: {"type":"text_delta",')
    expect(events).toEqual([])
  })

  it('combines buffered + new chunks across boundary', () => {
    const events: object[] = []
    const buf = parseSSEChunks('data: {"type":"text', '', e => events.push(e))
    parseSSEChunks('_delta","delta":"hello"}\n\n', buf, e => events.push(e))
    expect(events).toEqual([{ type: 'text_delta', delta: 'hello' }])
  })

  it('tolerates malformed JSON without crashing', () => {
    const events: object[] = []
    parseSSEChunks('data: {"type":"x",}\n\n', '', e => events.push(e))
    expect(events).toEqual([])  // skipped
  })

  it('parses multiple events in one chunk', () => {
    const events: object[] = []
    parseSSEChunks(
      'data: {"type":"a"}\n\ndata: {"type":"b"}\n\n',
      '',
      e => events.push(e),
    )
    expect(events).toEqual([{ type: 'a' }, { type: 'b' }])
  })
})

describe('streamCopilotMessage', () => {
  it('aborts when AbortSignal fires', async () => {
    const ac = new AbortController()
    const onEvent = vi.fn()
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    vi.stubGlobal('fetch', fetchMock)

    const { streamCopilotMessage } = await import('@/lib/copilot-stream')
    ac.abort()
    await expect(streamCopilotMessage('c1', 'hi', onEvent, ac.signal, () => 'token'))
      .rejects.toThrow()
    vi.unstubAllGlobals()
  })
})
