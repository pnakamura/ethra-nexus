export interface SSEEvent {
  type: string
  [k: string]: unknown
}

export function parseSSEChunks(
  chunk: string,
  prevBuffer: string,
  onEvent: (e: SSEEvent) => void,
): string {
  const buf = prevBuffer + chunk
  const segments = buf.split('\n\n')
  const incomplete = segments.pop() ?? ''
  for (const segment of segments) {
    const trimmed = segment.trim()
    if (!trimmed.startsWith('data: ')) continue
    const json = trimmed.slice(6)
    try {
      const parsed = JSON.parse(json) as SSEEvent
      onEvent(parsed)
    } catch {
      // skip malformed line
    }
  }
  return incomplete
}

export async function streamCopilotMessage(
  conversationId: string,
  content: string,
  onEvent: (e: SSEEvent) => void,
  signal: AbortSignal,
  getToken: () => string | null,
): Promise<void> {
  const token = getToken()
  if (!token) throw new Error('Missing auth token')

  const baseUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1'
  const res = await fetch(`${baseUrl}/copilot/conversations/${conversationId}/messages`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ content }),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${errBody}`)
  }
  if (!res.body) throw new Error('No response body for stream')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    buffer = parseSSEChunks(chunk, buffer, onEvent)
  }
}
