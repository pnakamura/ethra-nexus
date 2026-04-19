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

  if (skill_id === 'wiki:lint') {
    return executeWikiLint(skill_id, context, ts)
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
  // Combina System Wiki (wiki_strategic_pages) + Agent Wiki (wiki_agent_pages)
  let wikiContext = ''
  try {
    const embedding = await embed(question)
    const vectorStr = `[${embedding.join(',')}]`

    const [systemRows, agentRows] = await Promise.all([
      db.execute(
        sql`SELECT title, content, 1 - (embedding <=> ${vectorStr}::vector) AS similarity
            FROM wiki_strategic_pages
            WHERE tenant_id = ${context.tenant_id}
              AND status = 'ativo'
              AND embedding IS NOT NULL
            ORDER BY embedding <=> ${vectorStr}::vector
            LIMIT 5`,
      ),
      db.execute(
        sql`SELECT title, content, 1 - (embedding <=> ${vectorStr}::vector) AS similarity
            FROM wiki_agent_pages
            WHERE agent_id = ${context.agent_id}
              AND status = 'ativo'
              AND embedding IS NOT NULL
            ORDER BY embedding <=> ${vectorStr}::vector
            LIMIT 5`,
      ),
    ])

    type WikiRow = { title: string; content: string; similarity: number }
    const combined = [
      ...(systemRows.rows as WikiRow[]),
      ...(agentRows.rows as WikiRow[]),
    ]
      .filter((r) => r.similarity > 0.3)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3)

    if (combined.length > 0) {
      wikiContext = combined.map((p) => `## ${p.title}\n${p.content}`).join('\n\n---\n\n')
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

async function executeWikiLint(
  skill_id: SkillId,
  context: AgentContext,
  ts: string,
): Promise<AgentResult<SkillOutput>> {
  const db = getDb()

  const [totalRows, noEmbeddingRows, staleRows, lowConfRows] = await Promise.all([
    db.execute(
      sql`SELECT COUNT(*) AS count FROM wiki_strategic_pages
          WHERE tenant_id = ${context.tenant_id} AND status = 'ativo'`,
    ),
    db.execute(
      sql`SELECT COUNT(*) AS count FROM wiki_strategic_pages
          WHERE tenant_id = ${context.tenant_id} AND status = 'ativo' AND embedding IS NULL`,
    ),
    db.execute(
      sql`SELECT COUNT(*) AS count FROM wiki_strategic_pages
          WHERE tenant_id = ${context.tenant_id} AND status = 'ativo'
            AND valid_until IS NOT NULL AND valid_until < NOW()`,
    ),
    db.execute(
      sql`SELECT COUNT(*) AS count FROM wiki_strategic_pages
          WHERE tenant_id = ${context.tenant_id} AND status = 'ativo'
            AND confidence IN ('pendente', 'baixa')`,
    ),
  ])

  const total = Number((totalRows.rows[0] as { count: string }).count)
  const noEmbedding = Number((noEmbeddingRows.rows[0] as { count: string }).count)
  const stale = Number((staleRows.rows[0] as { count: string }).count)
  const lowConf = Number((lowConfRows.rows[0] as { count: string }).count)

  const issues = noEmbedding + stale + lowConf
  const score = total === 0 ? 100 : Math.max(0, Math.round(100 - (issues / total) * 100))

  const metricsText = `Wiki Health Metrics (tenant):
- Total de páginas ativas: ${total}
- Páginas sem embedding (busca semântica inativa): ${noEmbedding}
- Páginas vencidas (valid_until expirado): ${stale}
- Páginas com baixa confiança (pendente/baixa): ${lowConf}
- Score calculado: ${score}/100`

  const registry = createRegistryFromEnv()
  const completion = await registry.complete('wiki:lint', {
    messages: [
      {
        role: 'system',
        content:
          'Você é um auditor de base de conhecimento. Analise as métricas fornecidas e gere um relatório de saúde conciso em português, com os principais problemas e ações recomendadas.',
      },
      { role: 'user', content: metricsText },
    ],
    max_tokens: 600,
    sensitive_data: false,
  })

  const totalTokens = completion.input_tokens + completion.output_tokens
  const costUsd = completion.estimated_cost_usd ?? 0

  return {
    ok: true,
    data: {
      answer: `${metricsText}\n\n---\n\n${completion.content}`,
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
