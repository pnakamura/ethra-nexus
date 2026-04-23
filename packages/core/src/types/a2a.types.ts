export interface AgentCard {
  name: string
  description: string
  url: string
  version: string
  skills: AgentSkillCard[]
  capabilities?: { streaming?: boolean; pushNotifications?: boolean }
  defaultInputModes?: string[]
  defaultOutputModes?: string[]
}

export interface AgentSkillCard {
  id: string
  name: string
  description: string
  tags?: string[]
}

export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'canceled'

export interface A2ATask {
  id: string
  contextId?: string
  status: { state: A2ATaskState; message?: string }
  result?: string
}

// AgentCardSchema (Zod validation) lives in packages/agents/src/lib/a2a/schemas.ts
// packages/core has no zod dependency — only pure TypeScript types here
