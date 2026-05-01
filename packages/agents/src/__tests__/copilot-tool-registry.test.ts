import { describe, it, expect, vi } from 'vitest'

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({}),
}))

import { executeToolCall, type CopilotTool, type ToolContext } from '../lib/copilot/tool-registry'

const ctxAdmin: ToolContext = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' }
const ctxMember: ToolContext = { tenant_id: 't1', user_id: 'u2', user_role: 'member' }

const allMembersTool: CopilotTool<{ x: number }, number> = {
  name: 'test:double',
  description: 'doubles a number',
  input_schema: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
  permission: 'all_members',
  handler: async (input) => input.x * 2,
}

const adminOnlyTool: CopilotTool<Record<string, never>, string> = {
  name: 'test:secret',
  description: 'admin secret',
  input_schema: { type: 'object', properties: {} },
  permission: 'admin_only',
  handler: async () => 'classified',
}

describe('executeToolCall', () => {
  it('runs handler and returns result with duration', async () => {
    const r = await executeToolCall(allMembersTool, { x: 21 }, ctxAdmin)
    expect(r.result).toBe(42)
    expect(r.error).toBeUndefined()
    expect(r.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('returns PERMISSION_DENIED when admin_only tool called by member', async () => {
    const r = await executeToolCall(adminOnlyTool, {}, ctxMember)
    expect(r.error).toBe('PERMISSION_DENIED')
    expect(r.result).toBeNull()
  })

  it('admin_only tool succeeds for admin', async () => {
    const r = await executeToolCall(adminOnlyTool, {}, ctxAdmin)
    expect(r.result).toBe('classified')
    expect(r.error).toBeUndefined()
  })

  it('captures handler exceptions as error string', async () => {
    const failing: CopilotTool<Record<string, never>, never> = {
      name: 'test:fail',
      description: 'fails',
      input_schema: { type: 'object', properties: {} },
      permission: 'all_members',
      handler: async () => { throw new Error('boom') },
    }
    const r = await executeToolCall(failing, {}, ctxAdmin)
    expect(r.error).toBe('boom')
    expect(r.result).toBeNull()
  })
})
