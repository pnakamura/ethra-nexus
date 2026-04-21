// apps/server/src/routes/agents.types.ts

export const VALID_SKILL_IDS = [
  'wiki:query',
  'wiki:ingest',
  'wiki:lint',
  'channel:respond',
  'channel:proactive',
  'report:generate',
  'monitor:health',
  'monitor:alert',
  'data:analyze',
  'data:extract',
] as const

export const VALID_CHANNEL_TYPES = [
  'whatsapp',
  'webchat',
  'email',
  'webhook',
  'slack',
  'api',
] as const

export const VALID_TONES = [
  'formal',
  'professional',
  'friendly',
  'technical',
  'custom',
] as const

export type ValidChannelType = (typeof VALID_CHANNEL_TYPES)[number]
export type ValidTone = (typeof VALID_TONES)[number]

export function isValidSkillId(id: string): boolean {
  return (VALID_SKILL_IDS as readonly string[]).includes(id) ||
    /^custom:[a-z0-9][a-z0-9-]*$/.test(id)
}

export function isValidChannelType(type: string): type is ValidChannelType {
  return (VALID_CHANNEL_TYPES as readonly string[]).includes(type)
}

export function isValidTone(tone: string): tone is ValidTone {
  return (VALID_TONES as readonly string[]).includes(tone)
}

export interface SkillInput {
  skill_id: string
  enabled?: boolean
  provider_override?: { provider: string; model: string }
  max_tokens_per_call?: number
  max_calls_per_hour?: number
  timeout_ms?: number
}

export interface ChannelInput {
  channel_type: string
  enabled?: boolean
  config: Record<string, unknown>
}

// Valida campos mínimos obrigatórios por tipo de canal
export function validateChannelConfig(
  channel_type: string,
  config: Record<string, unknown>,
): string | null {
  switch (channel_type) {
    case 'whatsapp':
      if (!config['evolution_instance'] || typeof config['evolution_instance'] !== 'string') {
        return 'whatsapp channel requires config.evolution_instance (string)'
      }
      break
    case 'webhook':
      if (!config['endpoint_url'] || typeof config['endpoint_url'] !== 'string') {
        return 'webhook channel requires config.endpoint_url (string)'
      }
      if (!(config['endpoint_url'] as string).startsWith('https://')) {
        return 'webhook config.endpoint_url must start with https://'
      }
      break
    case 'email':
      if (!config['address'] || typeof config['address'] !== 'string') {
        return 'email channel requires config.address (string)'
      }
      if (!(config['address'] as string).includes('@')) {
        return 'email config.address must be a valid email'
      }
      break
    case 'slack':
      if (!config['bot_token'] || typeof config['bot_token'] !== 'string') {
        return 'slack channel requires config.bot_token (string)'
      }
      break
    // webchat e api: sem campos obrigatórios
  }
  return null
}
