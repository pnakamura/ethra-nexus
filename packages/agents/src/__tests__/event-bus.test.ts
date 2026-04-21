// packages/agents/src/__tests__/event-bus.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@ethra-nexus/db', () => ({
  getDb: vi.fn(),
  agentEventSubscriptions: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
}))

const { matchesFilter } = await import('../lib/scheduler/event-bus')

describe('matchesFilter', () => {
  it('filtro vazio → sempre corresponde', () => {
    expect(matchesFilter({}, { any: 'value' })).toBe(true)
  })

  it('threshold → corresponde quando payload >= filtro', () => {
    expect(matchesFilter({ threshold: 75 }, { threshold: 75 })).toBe(true)
    expect(matchesFilter({ threshold: 75 }, { threshold: 90 })).toBe(true)
  })

  it('threshold → não corresponde quando payload < filtro', () => {
    expect(matchesFilter({ threshold: 75 }, { threshold: 50 })).toBe(false)
  })

  it('skill_id → corresponde quando skill_id é igual', () => {
    expect(matchesFilter({ skill_id: 'monitor:health' }, { skill_id: 'monitor:health' })).toBe(true)
  })

  it('skill_id → não corresponde quando skill_id difere', () => {
    expect(matchesFilter({ skill_id: 'monitor:health' }, { skill_id: 'wiki:query' })).toBe(false)
  })

  it('agent_id → corresponde quando agent_id é igual', () => {
    expect(matchesFilter({ agent_id: 'agent-1' }, { agent_id: 'agent-1' })).toBe(true)
  })

  it('agent_id → não corresponde quando agent_id difere', () => {
    expect(matchesFilter({ agent_id: 'agent-1' }, { agent_id: 'agent-2' })).toBe(false)
  })

  it('filtro combinado → todas as condições devem corresponder (AND)', () => {
    const filter = { skill_id: 'monitor:health', threshold: 90 }
    expect(matchesFilter(filter, { skill_id: 'monitor:health', threshold: 95 })).toBe(true)
    expect(matchesFilter(filter, { skill_id: 'monitor:health', threshold: 80 })).toBe(false)
    expect(matchesFilter(filter, { skill_id: 'wiki:query', threshold: 95 })).toBe(false)
  })
})
