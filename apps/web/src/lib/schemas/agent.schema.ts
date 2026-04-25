import { z } from 'zod'

export const createAgentSchema = z.object({
  name: z.string().min(2, 'Nome mínimo 2 caracteres'),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'Apenas minúsculas, números e hífens'),
  role: z.string().min(2, 'Papel obrigatório'),
  system_prompt: z.string().optional(),
  model: z.string().optional(),
  tone: z.enum(['formal', 'informal', 'tecnico', 'amigavel']).optional(),
  budget_monthly: z.string().optional(),
})

export type CreateAgentInput = z.infer<typeof createAgentSchema>

export interface Agent {
  id: string
  name: string
  slug: string
  role: string
  status: string
  system_prompt: string | null
  model: string | null
  tone: string | null
  budget_monthly: string | null
  created_at: string
  skills: Array<{ id: string; skill_name: string; enabled: boolean }>
  channels: Array<{ id: string; channel_type: string; enabled: boolean }>
}
