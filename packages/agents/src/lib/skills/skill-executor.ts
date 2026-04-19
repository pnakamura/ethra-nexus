import type { SkillId, AgentResult, AgentContext } from '@ethra-nexus/core'
import { embed } from '@ethra-nexus/wiki'
import { createRegistryFromEnv } from '../provider'
import { getDb } from '@ethra-nexus/db'
import { sql } from 'drizzle-orm'

export interface SkillInput {
  question?: string
  message?: string
  system_prompt?: string
  max_tokens?: number
  [key: string]: unknown
}

export interface SkillOutput {
  answer: string
  tokens_in: number
  tokens_out: number
  cost_usd: number
  provider: string
  model: string
  is_fallback: boolean
}

// Dispatcher principal: mapeia SkillId → handler
// Fase 7a: wiki:query e channel:respond implementados (mesmo handler: wiki search + LLM)
// Demais skills retornam SKILL_NOT_FOUND até serem implementadas nas fases seguintes
export async function executeSkill(
  skill_id: SkillId,
  context: AgentContext,
  input: SkillInput,
  agent: { system_prompt: string; model: string },
): Promise<AgentResult<SkillOutput>> {
  const ts = new Date().toISOString()

  if (skill_id === 'wiki:query' || skill_id === 'channel:respond') {
    return executeWikiQuery(skill_id, context, input, agent, ts)
  }

  return {
    ok: false,
    error: {
      code: 'SKILL_NOT_FOUND',
      message: `Skill '${skill_id}' not yet implemented`,
      retryable: false,
    },
    agent_id: context.agent_id,
    skill_id,
    timestamp: ts,
  }
}

async function executeWikiQuery(
  skill_id: SkillId,
  context: AgentContext,
  input: SkillInput,
  agent: { system_prompt: string; model: string },
  ts: string,
): Promise<AgentResult<SkillOutput>> {
  const question = input.question ?? input.message ?? ''
  const db = getDb()

  // Busca semântica na wiki — non-fatal se falhar
  let wikiContext = ''
  try {
    const embedding = await embed(question)
    const vectorStr = `[${embedding.join(',')}]`
    const rows = await db.execute(
      sql`SELECT title, content
          FROM wiki_strategic_pages
          WHERE tenant_id = ${context.tenant_id}
            AND status = 'ativo'
            AND embedding IS NOT NULL
            AND 1 - (embedding <=> ${vectorStr}::vector) > 0.3
          ORDER BY embedding <=> ${vectorStr}::vector
          LIMIT 3`,
    )
    const pages = rows.rows as Array<{ title: string; content: string }>
    if (pages.length > 0) {
      wikiContext = pages.map((p) => `## ${p.title}\n${p.content}`).join('\n\n---\n\n')
    }
  } catch {
    // wiki search failure é non-fatal: responde sem contexto
  }

  const systemPrompt =
    (input.system_prompt ?? (agent.system_prompt || 'Você é um assistente de IA. Responda em português de forma clara e objetiva.')) +
    (wikiContext ? `\n\n## Base de conhecimento:\n${wikiContext}` : '')

  const registry = createRegistryFromEnv()
  const completion = await registry.complete('channel:respond', {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question },
    ],
    max_tokens: typeof input.max_tokens === 'number' ? input.max_tokens : 1000,
    sensitive_data: true,
  })

  const totalTokens = completion.input_tokens + completion.output_tokens
  const costUsd = completion.estimated_cost_usd ?? 0

  return {
    ok: true,
    data: {
      answer: completion.content,
      tokens_in: completion.input_tokens,
      tokens_out: completion.output_tokens,
      cost_usd: costUsd,
      provider: completion.provider,
      model: completion.model,
      is_fallback: completion.is_fallback,
    },
    agent_id: context.agent_id,
    skill_id,
    timestamp: ts,
    tokens_used: totalTokens,
    cost_usd: costUsd,
  }
}
