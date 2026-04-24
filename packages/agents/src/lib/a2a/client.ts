import { randomUUID } from 'node:crypto'

export class A2AClient {
  constructor(
    private readonly url: string,
    private readonly authToken?: string,
  ) {}

  async sendTask(message: string, contextId?: string): Promise<{ taskId: string }> {
    const body = {
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'tasks/send',
      params: {
        message: { role: 'user', parts: [{ text: message }] },
        ...(contextId !== undefined && { contextId }),
      },
    }
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.authToken !== undefined && { Authorization: `Bearer ${this.authToken}` }),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`A2A request failed: ${res.status}`)
    const data = await res.json() as { result?: { id: string }; error?: { message: string } }
    if (data.error) throw new Error(`A2A error: ${data.error.message}`)
    return { taskId: data.result!.id }
  }

  async getTask(taskId: string): Promise<{ state: string; result?: string }> {
    const body = {
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'tasks/get',
      params: { id: taskId },
    }
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.authToken !== undefined && { Authorization: `Bearer ${this.authToken}` }),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    const data = await res.json() as {
      result?: { status: { state: string }; result?: string }
    }
    return {
      state: data.result?.status.state ?? 'unknown',
      result: data.result?.result,
    }
  }
}
