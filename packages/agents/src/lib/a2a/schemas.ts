import { z } from 'zod'

export const AgentSkillCardSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  description: z.string().max(2048),
  tags: z.array(z.string()).optional(),
})

export const AgentCardSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(4096),
  url: z.string().url(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  skills: z.array(AgentSkillCardSchema).min(1).max(64),
  capabilities: z
    .object({
      streaming: z.boolean().optional(),
      pushNotifications: z.boolean().optional(),
    })
    .optional(),
})

export type ValidatedAgentCard = z.infer<typeof AgentCardSchema>
