import { getDb, scheduledResults } from '@ethra-nexus/db'
import type { AgentResult } from '@ethra-nexus/core'
import type { SkillOutput } from '../skills/skill-executor'

export interface DispatchSource {
  tenant_id: string
  agent_id: string
  skill_id: string
  output_channel: string
  schedule_id?: string | null
}

export async function dispatchOutput(
  result: AgentResult<SkillOutput>,
  source: DispatchSource,
): Promise<void> {
  if (!result.ok) return

  const { answer, tokens_in, tokens_out, cost_usd } = result.data
  const totalTokens = tokens_in + tokens_out

  await Promise.allSettled([
    source.output_channel !== 'whatsapp'
      ? saveResult({ ...source, answer, tokens_used: totalTokens, cost_usd })
      : Promise.resolve(),
    source.output_channel !== 'api'
      ? sendToWhatsApp(answer, source)
      : Promise.resolve(),
  ])
}

async function saveResult(params: {
  tenant_id: string
  agent_id: string
  skill_id: string
  schedule_id?: string | null
  answer: string
  tokens_used: number
  cost_usd: number
}): Promise<void> {
  const db = getDb()
  await db.insert(scheduledResults).values({
    tenant_id: params.tenant_id,
    agent_id: params.agent_id,
    schedule_id: params.schedule_id ?? null,
    skill_id: params.skill_id,
    answer: params.answer,
    tokens_used: params.tokens_used,
    cost_usd: params.cost_usd.toFixed(6),
  })
}

async function sendToWhatsApp(answer: string, source: DispatchSource): Promise<void> {
  const webhookUrl = process.env['N8N_WHATSAPP_WEBHOOK_URL']
  if (!webhookUrl) return
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: source.agent_id,
        answer,
        source_id: source.schedule_id ?? null,
      }),
    })
  } catch {
    // WhatsApp delivery failure is non-fatal
  }
}
