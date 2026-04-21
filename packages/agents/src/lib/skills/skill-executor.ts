import type { SkillId, AgentResult, AgentContext } from '@ethra-nexus/core'
import { sanitizeForHtml } from '@ethra-nexus/core'
import { embed, extractPagesFromContent } from '@ethra-nexus/wiki'
import { createRegistryFromEnv } from '../provider'
import { createWikiDb } from '../db'
import { getDb } from '@ethra-nexus/db'
import { sql } from 'drizzle-orm'
import { emitEvent } from '../scheduler/event-bus'

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

  if (skill_id === 'wiki:ingest') {
    return executeWikiIngest(skill_id, context, input, ts)
  }

  if (skill_id === 'channel:proactive') {
    return executeChannelProactive(skill_id, context, input, ts)
  }

  if (skill_id === 'report:generate') {
    return executeReportGenerate(skill_id, context, input, ts)
  }

  if (skill_id === 'monitor:health') {
    return executeMonitorHealth(skill_id, context, input, ts)
  }

  if (skill_id === 'monitor:alert') {
    return executeMonitorAlert(skill_id, context, input, ts)
  }

  if (skill_id === 'data:analyze') {
    return executeDataAnalyze(skill_id, context, input, ts)
  }

  if (skill_id === 'data:extract') {
    return executeDataExtract(skill_id, context, input, ts)
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

async function executeWikiIngest(
  skill_id: SkillId,
  context: AgentContext,
  input: SkillInput,
  ts: string,
): Promise<AgentResult<SkillOutput>> {
  const content = typeof input['content'] === 'string' ? input['content'] : ''
  const sourceName = sanitizeForHtml(
    typeof input['source_name'] === 'string' ? input['source_name'] : 'unknown'
  )

  if (!content) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: "Parâmetro 'content' é obrigatório para wiki:ingest",
        retryable: false,
      },
      agent_id: context.agent_id,
      skill_id,
      timestamp: ts,
    }
  }

  const registry = createRegistryFromEnv()
  const extraction = await extractPagesFromContent(content, sourceName, registry)

  const wikiDb = createWikiDb()
  let persisted = 0
  const failedSlugs: string[] = []

  for (const page of extraction.pages) {
    try {
      const row = await wikiDb.upsertStrategicPage({
        tenant_id: context.tenant_id,
        slug: page.slug,
        title: page.title,
        type: page.type,
        content: page.content,
        sources: page.sources,
        tags: page.tags,
        confidence: page.confidence,
        author_type: 'agent',
      })

      // Gerar embedding — non-fatal
      try {
        const vector = await embed(`${page.title}\n${page.content}`)
        const vectorStr = `[${vector.join(',')}]`
        await getDb().execute(
          sql`UPDATE wiki_strategic_pages SET embedding = ${vectorStr}::vector WHERE id = ${row.id}`,
        )
      } catch {
        // embedding failure não aborta a persistência
      }

      persisted++
    } catch {
      failedSlugs.push(page.slug)
    }
  }

  const parts = [
    `Ingestão concluída: ${extraction.pages.length} páginas extraídas, ${persisted} persistidas.`,
    `Fonte: ${sourceName}.`,
  ]
  if (failedSlugs.length > 0) {
    const reported = failedSlugs.slice(0, 10).map(s => sanitizeForHtml(s))
    const extra = failedSlugs.length > 10 ? ` (+${failedSlugs.length - 10} mais)` : ''
    parts.push(`Falhas: ${reported.join(', ')}${extra}.`)
  }
  if (extraction.invalid_reasons.length > 0) {
    parts.push(`Páginas inválidas descartadas: ${extraction.invalid_reasons.length}.`)
  }
  const answer = parts.join(' ')

  // Sinalizar chains multi-agente (ex: wiki:lint automático pós-ingestão)
  try {
    await emitEvent('wiki_ingested', {
      source_name: sourceName,
      pages_extracted: extraction.pages.length,
      pages_persisted: persisted,
      tenant_id: context.tenant_id,
      __call_depth: 0,
    }, context.tenant_id)
  } catch {
    // emission failure não aborta a ingestão
  }

  return {
    ok: true,
    data: {
      answer,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      provider: 'anthropic',
      model: 'wiki:ingest',
      is_fallback: false,
    },
    agent_id: context.agent_id,
    skill_id,
    timestamp: ts,
    tokens_used: 0,
    cost_usd: 0,
  }
}

async function executeChannelProactive(
  skill_id: SkillId,
  context: AgentContext,
  input: SkillInput,
  ts: string,
): Promise<AgentResult<SkillOutput>> {
  const message = typeof input['message'] === 'string' ? input['message'] : ''

  if (!message) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: "Parâmetro 'message' é obrigatório para channel:proactive",
        retryable: false,
      },
      agent_id: context.agent_id,
      skill_id,
      timestamp: ts,
    }
  }

  const registry = createRegistryFromEnv()
  const completion = await registry.complete('channel:proactive', {
    messages: [
      {
        role: 'system',
        content:
          'Você é um assistente que redige notificações e alertas proativos claros e objetivos em português.',
      },
      { role: 'user', content: message },
    ],
    max_tokens: 500,
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

async function executeReportGenerate(
  skill_id: SkillId,
  context: AgentContext,
  input: SkillInput,
  ts: string,
): Promise<AgentResult<SkillOutput>> {
  const reportType = typeof input['report_type'] === 'string' ? input['report_type'] : ''
  const data = typeof input['data'] === 'string' ? input['data'] : ''

  if (!reportType || !data) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: "Parâmetros 'report_type' e 'data' são obrigatórios para report:generate",
        retryable: false,
      },
      agent_id: context.agent_id,
      skill_id,
      timestamp: ts,
    }
  }

  const registry = createRegistryFromEnv()
  const completion = await registry.complete('report:generate', {
    messages: [
      {
        role: 'system',
        content:
          'Você é um especialista em geração de relatórios. Gere um relatório estruturado e profissional em português com base nos dados fornecidos.',
      },
      { role: 'user', content: `Tipo de relatório: ${reportType}\n\nDados:\n${data}` },
    ],
    max_tokens: 2000,
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

async function executeMonitorHealth(
  skill_id: SkillId,
  context: AgentContext,
  input: SkillInput,
  ts: string,
): Promise<AgentResult<SkillOutput>> {
  const checkConfig = typeof input['check_config'] === 'string' ? input['check_config'] : ''

  if (!checkConfig) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: "Parâmetro 'check_config' é obrigatório para monitor:health",
        retryable: false,
      },
      agent_id: context.agent_id,
      skill_id,
      timestamp: ts,
    }
  }

  const registry = createRegistryFromEnv()
  const completion = await registry.complete('monitor:health', {
    messages: [
      {
        role: 'system',
        content:
          'Você é um monitor de sistemas. Avalie as informações de saúde fornecidas e retorne um diagnóstico claro: SAUDÁVEL, DEGRADADO ou CRÍTICO, com justificativa.',
      },
      { role: 'user', content: checkConfig },
    ],
    max_tokens: 400,
    sensitive_data: false,
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

async function executeMonitorAlert(
  skill_id: SkillId,
  context: AgentContext,
  input: SkillInput,
  ts: string,
): Promise<AgentResult<SkillOutput>> {
  const condition = typeof input['condition'] === 'string' ? input['condition'] : ''

  if (!condition) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: "Parâmetro 'condition' é obrigatório para monitor:alert",
        retryable: false,
      },
      agent_id: context.agent_id,
      skill_id,
      timestamp: ts,
    }
  }

  const threshold = typeof input['threshold'] === 'string' ? input['threshold'] : ''
  const currentValue = typeof input['current_value'] === 'string' ? input['current_value'] : ''

  const userContent = [
    `Condição: ${condition}`,
    threshold ? `Limite: ${threshold}` : '',
    currentValue ? `Valor atual: ${currentValue}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const registry = createRegistryFromEnv()
  const completion = await registry.complete('monitor:alert', {
    messages: [
      {
        role: 'system',
        content:
          'Você é um avaliador de alertas de sistema. Avalie a condição fornecida e determine se deve disparar um alerta: DISPARAR ou NÃO_DISPARAR, com justificativa.',
      },
      { role: 'user', content: userContent },
    ],
    max_tokens: 300,
    sensitive_data: false,
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

async function executeDataAnalyze(
  skill_id: SkillId,
  context: AgentContext,
  input: SkillInput,
  ts: string,
): Promise<AgentResult<SkillOutput>> {
  const data = typeof input['data'] === 'string' ? input['data'] : ''

  if (!data) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: "Parâmetro 'data' é obrigatório para data:analyze",
        retryable: false,
      },
      agent_id: context.agent_id,
      skill_id,
      timestamp: ts,
    }
  }

  const analysisType = typeof input['analysis_type'] === 'string' ? input['analysis_type'] : ''
  const userContent = analysisType ? `Tipo de análise: ${analysisType}\n\nDados:\n${data}` : data

  const registry = createRegistryFromEnv()
  const completion = await registry.complete('data:analyze', {
    messages: [
      {
        role: 'system',
        content:
          'Você é um analista de dados. Analise os dados fornecidos e gere insights relevantes e acionáveis em português.',
      },
      { role: 'user', content: userContent },
    ],
    max_tokens: 1500,
    sensitive_data: false,
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

async function executeDataExtract(
  skill_id: SkillId,
  context: AgentContext,
  input: SkillInput,
  ts: string,
): Promise<AgentResult<SkillOutput>> {
  const content = typeof input['content'] === 'string' ? input['content'] : ''

  if (!content) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: "Parâmetro 'content' é obrigatório para data:extract",
        retryable: false,
      },
      agent_id: context.agent_id,
      skill_id,
      timestamp: ts,
    }
  }

  const extractSchema = typeof input['extract_schema'] === 'string' ? input['extract_schema'] : ''
  const userContent = extractSchema
    ? `Schema de extração:\n${extractSchema}\n\nDocumento:\n${content}`
    : content

  const registry = createRegistryFromEnv()
  const completion = await registry.complete('data:extract', {
    messages: [
      {
        role: 'system',
        content:
          'Você é um extrator de dados estruturados. Extraia as informações relevantes do documento fornecido e retorne em formato estruturado (JSON quando possível).',
      },
      { role: 'user', content: userContent },
    ],
    max_tokens: 1500,
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
