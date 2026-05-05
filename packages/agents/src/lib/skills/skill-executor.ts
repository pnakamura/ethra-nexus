import { randomUUID, createHash } from 'node:crypto'
import type { SkillId, AgentResult, AgentContext } from '@ethra-nexus/core'
import { sanitizeForHtml, sanitizeErrorMessage, validateExternalUrl } from '@ethra-nexus/core'
import {
  sanitizeDataForRenderPrompt,
  validateArtifactHtml,
  RENDER_SYSTEM_PROMPT,
} from '../render'
import { embed, extractPagesFromContent } from '@ethra-nexus/wiki'
import { createRegistryFromEnv } from '../provider'
import { createWikiDb } from '../db'
import { getDb, externalAgents, files, parsedFiles, artifacts } from '@ethra-nexus/db'
import { sql, eq, and } from 'drizzle-orm'
import { emitEvent } from '../scheduler/event-bus'
import { A2AClient } from '../a2a/client'
import { writeLesson } from '../wiki/wiki-writer'
import { parseFile, type ParserResult, type ParserFormat } from '../parsers'
import { createStorageDriver } from '../storage'
import { logger as skillLogger } from '../logger'

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
  external_task_id?: string  // set by a2a:call
  // ── Spec #3: data:extract over file_id ──
  parsed_id?: string
  format?: 'xlsx' | 'pdf' | 'docx' | 'csv' | 'txt' | 'md'
  preview_md?: string
  pages_or_sheets?: number
  warnings?: string[]
  // ── Spec #4: data:render artifact ──
  artifact_id?: string
  download_url?: string
  title?: string
  size_bytes?: number
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Dispatcher principal: mapeia SkillId → handler
// Fase 7a: wiki:query e channel:respond implementados (mesmo handler: wiki search + LLM)
// Demais skills retornam SKILL_NOT_FOUND até serem implementadas nas fases seguintes
export async function executeSkill(
  skill_id: SkillId,
  context: AgentContext,
  input: SkillInput,
  agent: {
    system_prompt: string
    model: string
    wiki_enabled?: boolean
    wiki_top_k?: number
    wiki_min_score?: number
    wiki_write_mode?: 'manual' | 'supervised' | 'auto'
  },
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

  if (skill_id === 'data:render') {
    return executeDataRender(skill_id, context, input, ts)
  }

  if (skill_id === 'a2a:call') {
    return executeA2ACall(skill_id, context, input, ts)
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
  agent: {
    system_prompt: string
    model: string
    wiki_enabled?: boolean
    wiki_top_k?: number
    wiki_min_score?: number
    wiki_write_mode?: 'manual' | 'supervised' | 'auto'
  },
  ts: string,
): Promise<AgentResult<SkillOutput>> {
  const question = input.question ?? input.message ?? ''
  const db = getDb()

  const wikiEnabled = agent.wiki_enabled ?? true
  const wikiTopK = agent.wiki_top_k ?? 5
  const wikiMinScore = agent.wiki_min_score ?? 0.72
  const wikiWriteMode = agent.wiki_write_mode ?? 'supervised'

  // Busca semântica na wiki — non-fatal se falhar
  // Combina System Wiki (wiki_strategic_pages) + Agent Wiki (wiki_agent_pages)
  let wikiContext = ''
  if (wikiEnabled) {
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
              LIMIT ${wikiTopK}`,
        ),
        db.execute(
          sql`SELECT title, content, 1 - (embedding <=> ${vectorStr}::vector) AS similarity
              FROM wiki_agent_pages
              WHERE agent_id = ${context.agent_id}
                AND status = 'ativo'
                AND embedding IS NOT NULL
              ORDER BY embedding <=> ${vectorStr}::vector
              LIMIT ${wikiTopK}`,
        ),
      ])

      type WikiRow = { title: string; content: string; similarity: number }
      const combined = [
        ...(systemRows.rows as WikiRow[]),
        ...(agentRows.rows as WikiRow[]),
      ]
        .filter((r) => r.similarity > wikiMinScore)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, wikiTopK)

      if (combined.length > 0) {
        wikiContext = combined.map((p) => `## ${p.title}\n${p.content}`).join('\n\n---\n\n')
      }
    } catch {
      // wiki search failure é non-fatal: responde sem contexto
    }
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

  // Fire-and-forget write-back — non-fatal
  void writeLesson({
    agent_id: context.agent_id,
    tenant_id: context.tenant_id,
    aios_event_id: context.session_id,
    question,
    answer: completion.content,
    write_mode: wikiWriteMode,
  }).catch(() => undefined)

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
  const fileId = typeof input['file_id'] === 'string' ? input['file_id'] : ''
  if (!fileId || !UUID_RE.test(fileId)) {
    return {
      ok: false,
      error: { code: 'INVALID_INPUT', message: "Parâmetro 'file_id' (UUID) é obrigatório", retryable: false },
      agent_id: context.agent_id, skill_id, timestamp: ts,
    }
  }

  const db = getDb()

  // 1. File lookup + tenant guard
  const fileRows = await db
    .select({ storage_key: files.storage_key, mime_type: files.mime_type, sha256: files.sha256 })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.tenant_id, context.tenant_id)))
    .limit(1)
  const file = fileRows[0]
  if (!file) {
    return {
      ok: false,
      error: { code: 'FILE_NOT_FOUND', message: 'File not found in tenant', retryable: false },
      agent_id: context.agent_id, skill_id, timestamp: ts,
    }
  }

  // 2. Cache lookup
  const cachedRows = await db
    .select()
    .from(parsedFiles)
    .where(and(eq(parsedFiles.tenant_id, context.tenant_id), eq(parsedFiles.sha256, file.sha256)))
    .limit(1)
  const cached = cachedRows[0]
  if (cached) {
    skillLogger.info({ event: 'parser_cache_hit', tenant_id: context.tenant_id, sha256: file.sha256, parsed_id: cached.id })
    return buildExtractResult(skill_id, context, ts, {
      parsed_id: cached.id,
      format: cached.format as ParserFormat,
      preview_md: cached.preview_md,
      pages_or_sheets: cached.pages_or_sheets,
      warnings: (cached.warnings as string[]) ?? [],
    })
  }

  // 3. Driver fetch
  const driver = createStorageDriver()
  const stream = await driver.get(file.storage_key)
  if (!stream) {
    return {
      ok: false,
      error: { code: 'STORAGE_ORPHAN', message: 'Driver returned null for storage_key', retryable: false },
      agent_id: context.agent_id, skill_id, timestamp: ts,
    }
  }
  const buf = await streamToBuffer(stream)

  // 4. Parse
  let parsed: ParserResult
  const parseStart = Date.now()
  try {
    parsed = await parseFile(buf, file.mime_type)
  } catch (err) {
    skillLogger.error({ event: 'parser_failed', file_id: fileId, mime_type: file.mime_type, error: sanitizeErrorMessage(err instanceof Error ? err.message : 'parser error') })
    return {
      ok: false,
      error: { code: 'PARSE_FAILED', message: sanitizeErrorMessage(err instanceof Error ? err.message : 'parser error'), retryable: false },
      agent_id: context.agent_id, skill_id, timestamp: ts,
    }
  }
  const parseDuration = Date.now() - parseStart

  // 5. Cache write (race-safe)
  let parsedId: string
  try {
    const inserted = await db
      .insert(parsedFiles)
      .values({
        tenant_id: context.tenant_id,
        sha256: file.sha256,
        format: parsed.format,
        structured_json: parsed.structured_json,
        preview_md: parsed.preview_md,
        pages_or_sheets: parsed.pages_or_sheets,
        warnings: parsed.warnings,
      })
      .onConflictDoNothing({ target: [parsedFiles.tenant_id, parsedFiles.sha256] })
      .returning({ id: parsedFiles.id })
    if (inserted[0]) {
      parsedId = inserted[0].id
    } else {
      // Race: another concurrent call won. Fetch existing.
      const existingRows = await db
        .select({ id: parsedFiles.id })
        .from(parsedFiles)
        .where(and(eq(parsedFiles.tenant_id, context.tenant_id), eq(parsedFiles.sha256, file.sha256)))
        .limit(1)
      parsedId = existingRows[0]!.id
    }
  } catch (err) {
    skillLogger.error({ event: 'parser_cache_insert_failed', error: sanitizeErrorMessage(err instanceof Error ? err.message : 'insert error') })
    return {
      ok: false,
      error: { code: 'PARSE_FAILED', message: 'Cache insert failed', retryable: true },
      agent_id: context.agent_id, skill_id, timestamp: ts,
    }
  }

  skillLogger.info({
    event: 'parser_cache_miss',
    tenant_id: context.tenant_id,
    sha256: file.sha256,
    format: parsed.format,
    parse_duration_ms: parseDuration,
    structured_size_bytes: Buffer.byteLength(JSON.stringify(parsed.structured_json), 'utf8'),
  })

  return buildExtractResult(skill_id, context, ts, {
    parsed_id: parsedId,
    format: parsed.format,
    preview_md: parsed.preview_md,
    pages_or_sheets: parsed.pages_or_sheets,
    warnings: parsed.warnings,
  })
}

const RENDER_DATA_MAX_BYTES = 100 * 1024  // 100KB serialized
const RENDER_TITLE_MAX = 200
const RENDER_PROMPT_MAX = 2000

async function executeDataRender(
  skill_id: SkillId,
  context: AgentContext,
  input: SkillInput,
  ts: string,
): Promise<AgentResult<SkillOutput>> {
  // 1. Input validation
  const title = typeof input['title'] === 'string' ? input['title'] : ''
  const prompt = typeof input['prompt'] === 'string' ? input['prompt'] : ''
  const data = input['data']
  const conversationId = typeof input['conversation_id'] === 'string' ? input['conversation_id'] : ''
  const parsedId = typeof input['parsed_id'] === 'string' ? input['parsed_id'] : undefined

  if (!title || title.length > RENDER_TITLE_MAX) {
    return {
      ok: false,
      error: { code: 'INVALID_INPUT', message: `title required, ≤${RENDER_TITLE_MAX} chars`, retryable: false },
      agent_id: context.agent_id, skill_id, timestamp: ts,
    }
  }
  if (!prompt || prompt.length > RENDER_PROMPT_MAX) {
    return {
      ok: false,
      error: { code: 'INVALID_INPUT', message: `prompt required, ≤${RENDER_PROMPT_MAX} chars`, retryable: false },
      agent_id: context.agent_id, skill_id, timestamp: ts,
    }
  }
  if (!data || typeof data !== 'object') {
    return {
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'data must be an object', retryable: false },
      agent_id: context.agent_id, skill_id, timestamp: ts,
    }
  }
  const dataJson = JSON.stringify(data)
  if (Buffer.byteLength(dataJson, 'utf8') > RENDER_DATA_MAX_BYTES) {
    return {
      ok: false,
      error: { code: 'INVALID_INPUT', message: `data payload exceeds ${RENDER_DATA_MAX_BYTES} bytes`, retryable: false },
      agent_id: context.agent_id, skill_id, timestamp: ts,
    }
  }
  if (!conversationId || !UUID_RE.test(conversationId)) {
    return {
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'conversation_id (UUID) is required', retryable: false },
      agent_id: context.agent_id, skill_id, timestamp: ts,
    }
  }
  if (parsedId !== undefined && !UUID_RE.test(parsedId)) {
    return {
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'parsed_id must be a UUID when provided', retryable: false },
      agent_id: context.agent_id, skill_id, timestamp: ts,
    }
  }

  // 2. Sanitize data
  const sanitized = sanitizeDataForRenderPrompt(data)

  // 3. Compose render prompt + Anthropic call
  const userMessage = `Gere um dashboard HTML com o título: ${title}

Pergunta original do user: ${prompt}

Dados (sanitizados):
${JSON.stringify(sanitized, null, 2)}`

  const registry = createRegistryFromEnv()
  let completion
  try {
    completion = await registry.complete('data:render', {
      messages: [
        { role: 'system', content: RENDER_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 8000,
      sensitive_data: true,
    })
  } catch (err) {
    skillLogger.error({ event: 'render_anthropic_error', error: sanitizeErrorMessage(err instanceof Error ? err.message : 'unknown') })
    return {
      ok: false,
      error: { code: 'AI_ERROR', message: sanitizeErrorMessage(err instanceof Error ? err.message : 'anthropic call failed'), retryable: true },
      agent_id: context.agent_id, skill_id, timestamp: ts,
    }
  }

  // 4. Extract HTML from response
  let html = completion.content.trim()
  const fenceMatch = /```(?:html)?\s*([\s\S]+?)\s*```/.exec(html)
  if (fenceMatch && fenceMatch[1]) html = fenceMatch[1].trim()
  if (!/<!DOCTYPE html>|<html[\s>]/i.test(html)) {
    skillLogger.error({ event: 'render_no_html', preview: html.slice(0, 200) })
    return {
      ok: false,
      error: { code: 'RENDER_FAILED', message: 'no html in response', retryable: false },
      agent_id: context.agent_id, skill_id, timestamp: ts,
    }
  }

  // 5. Validate HTML
  const validation = validateArtifactHtml(html)
  if (!validation.ok) {
    skillLogger.error({ event: 'render_validation_failed', reason: validation.reason })
    return {
      ok: false,
      error: { code: 'RENDER_FAILED', message: `validation: ${validation.reason}`, retryable: false },
      agent_id: context.agent_id, skill_id, timestamp: ts,
    }
  }

  // 6. Compute sha256 + write to driver
  const htmlBuf = Buffer.from(html, 'utf8')
  const sha256 = createHash('sha256').update(htmlBuf).digest('hex')
  const artifactId = randomUUID()

  const driver = createStorageDriver()
  let putResult
  try {
    putResult = await driver.put({
      tenant_id: context.tenant_id,
      file_id: artifactId,
      bytes: htmlBuf,
      mime_type: 'text/html',
    })
  } catch (err) {
    skillLogger.error({ event: 'render_storage_failed', error: sanitizeErrorMessage(err instanceof Error ? err.message : 'storage error') })
    return {
      ok: false,
      error: { code: 'DB_ERROR', message: 'storage write failed', retryable: true },
      agent_id: context.agent_id, skill_id, timestamp: ts,
    }
  }

  // 7. INSERT artifacts row
  const db = getDb()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  try {
    await db.insert(artifacts).values({
      id: artifactId,
      tenant_id: context.tenant_id,
      conversation_id: conversationId,
      parsed_id: parsedId ?? null,
      storage_key: putResult.storage_key,
      sha256,
      size_bytes: putResult.size_bytes,
      mime_type: 'text/html',
      title,
      prompt,
      generated_by_agent_id: context.agent_id,
      expires_at: expiresAt,
    })
  } catch (err) {
    skillLogger.error({ event: 'render_insert_failed', error: sanitizeErrorMessage(err instanceof Error ? err.message : 'insert error') })
    // Best-effort cleanup of orphaned bytes
    void driver.delete(putResult.storage_key).catch(() => undefined)
    return {
      ok: false,
      error: { code: 'DB_ERROR', message: 'INSERT artifacts failed', retryable: false },
      agent_id: context.agent_id, skill_id, timestamp: ts,
    }
  }

  skillLogger.info({
    event: 'render_succeeded',
    tenant_id: context.tenant_id,
    artifact_id: artifactId,
    size_bytes: putResult.size_bytes,
    cost_usd: completion.estimated_cost_usd,
  })

  // 8. Build output
  const totalTokens = completion.input_tokens + completion.output_tokens
  const costUsd = completion.estimated_cost_usd ?? 0
  return {
    ok: true,
    data: {
      answer: `Dashboard "${title}" gerado.`,
      tokens_in: completion.input_tokens,
      tokens_out: completion.output_tokens,
      cost_usd: costUsd,
      provider: completion.provider,
      model: completion.model,
      is_fallback: completion.is_fallback,
      artifact_id: artifactId,
      download_url: `/api/v1/artifacts/${artifactId}/view`,
      title,
      size_bytes: putResult.size_bytes,
    },
    agent_id: context.agent_id, skill_id, timestamp: ts,
    tokens_used: totalTokens,
    cost_usd: costUsd,
  }
}

async function executeA2ACall(
  skill_id: SkillId,
  context: AgentContext,
  input: SkillInput,
  ts: string,
): Promise<AgentResult<SkillOutput>> {
  const externalAgentId = typeof input['external_agent_id'] === 'string' ? input['external_agent_id'] : ''
  const message = typeof input['message'] === 'string' ? input['message'] : ''
  const waitForResult = input['wait_for_result'] !== false  // default true — undefined !== false → true

  if (!externalAgentId || !message) {
    return {
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'external_agent_id and message are required', retryable: false },
      agent_id: context.agent_id,
      skill_id,
      timestamp: ts,
    }
  }

  const db = getDb()
  const rows = await db
    .select()
    .from(externalAgents)
    .where(and(eq(externalAgents.id, externalAgentId), eq(externalAgents.tenant_id, context.tenant_id)))
    .limit(1)

  const extAgent = rows[0]
  if (!extAgent) {
    return {
      ok: false,
      error: { code: 'EXTERNAL_AGENT_ERROR', message: 'External agent not found', retryable: false },
      agent_id: context.agent_id,
      skill_id,
      timestamp: ts,
    }
  }

  if (extAgent.status !== 'active') {
    return {
      ok: false,
      error: { code: 'EXTERNAL_AGENT_ERROR', message: `External agent is ${extAgent.status}`, retryable: false },
      agent_id: context.agent_id,
      skill_id,
      timestamp: ts,
    }
  }

  try {
    await validateExternalUrl(extAgent.url)
    const client = new A2AClient(extAgent.url, extAgent.auth_token ?? undefined)
    const { taskId } = await client.sendTask(message, context.session_id)

    if (!waitForResult) {
      return {
        ok: true,
        data: {
          answer: `Task submitted to external agent. Task ID: ${taskId}`,
          tokens_in: 0,
          tokens_out: 0,
          cost_usd: 0,
          provider: 'external',
          model: extAgent.name,
          is_fallback: false,
          external_task_id: taskId,
        },
        agent_id: context.agent_id,
        skill_id,
        timestamp: ts,
        tokens_used: 0,
        cost_usd: 0,
      }
    }

    // Poll until terminal state, max 30 iterations (60s)
    const MAX_POLLS = 30
    const POLL_INTERVAL_MS = 2000
    let pollCompleted = false
    let lastResult: string | undefined

    for (let i = 0; i < MAX_POLLS; i++) {
      const task = await client.getTask(taskId)
      if (task.state === 'completed' || task.state === 'failed' || task.state === 'canceled') {
        if (task.state !== 'completed') {
          return {
            ok: false,
            error: { code: 'EXTERNAL_AGENT_ERROR', message: `External task ${task.state}`, retryable: task.state !== 'canceled' },
            agent_id: context.agent_id,
            skill_id,
            timestamp: ts,
          }
        }
        pollCompleted = true
        lastResult = task.result
        break
      }
      if (i < MAX_POLLS - 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      }
    }

    if (!pollCompleted) {
      return {
        ok: false,
        error: { code: 'TIMEOUT', message: 'External agent task timed out after 60s', retryable: true },
        agent_id: context.agent_id,
        skill_id,
        timestamp: ts,
      }
    }

    return {
      ok: true,
      data: {
        answer: lastResult ?? '',
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: 0,
        provider: 'external',
        model: extAgent.name,
        is_fallback: false,
        external_task_id: taskId,
      },
      agent_id: context.agent_id,
      skill_id,
      timestamp: ts,
      tokens_used: 0,
      cost_usd: 0,
    }
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'EXTERNAL_AGENT_ERROR',
        message: sanitizeErrorMessage(err instanceof Error ? err.message : 'External agent error'),
        retryable: true,
      },
      agent_id: context.agent_id,
      skill_id,
      timestamp: ts,
    }
  }
}

function buildExtractResult(
  skill_id: SkillId,
  context: AgentContext,
  ts: string,
  fields: { parsed_id: string; format: ParserFormat; preview_md: string; pages_or_sheets: number; warnings: string[] },
): AgentResult<SkillOutput> {
  return {
    ok: true,
    data: {
      answer: fields.preview_md,
      tokens_in: 0, tokens_out: 0, cost_usd: 0,
      provider: 'local', model: 'parser', is_fallback: false,
      parsed_id: fields.parsed_id,
      format: fields.format,
      preview_md: fields.preview_md,
      pages_or_sheets: fields.pages_or_sheets,
      warnings: fields.warnings,
    },
    agent_id: context.agent_id, skill_id, timestamp: ts,
    tokens_used: 0, cost_usd: 0,
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk as Buffer)
  }
  return Buffer.concat(chunks)
}
