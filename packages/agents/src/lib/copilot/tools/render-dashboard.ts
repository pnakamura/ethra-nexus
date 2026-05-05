import { eq, and } from 'drizzle-orm'
import { getDb, agents } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'
import { executeTask } from '../../aios/aios-master'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATA_MAX_BYTES = 100 * 1024
const TITLE_MAX = 200
const PROMPT_MAX = 2000

interface Input {
  title: string
  prompt: string
  data: Record<string, unknown>
  parsed_id?: string
}

interface Output {
  artifact_id: string
  download_url: string
  size_bytes: number
  title: string
}

export const renderDashboardTool: CopilotTool<Input, Output> = {
  name: 'system:render_dashboard',
  description: [
    'Gera um dashboard HTML standalone com gráficos chart.js a partir de dados estruturados.',
    'Use quando o user pedir explicitamente "dashboard", "gráfico", "visualização", ou quando',
    'os dados forem densos demais pra resposta em texto (>20 linhas tabuladas).',
    '',
    'Args:',
    '- title (string ≤200): título descritivo do dashboard',
    '- prompt (string ≤2000): pergunta original do user, ajuda o LLM a compor o layout',
    '- data (object ≤100KB serialized): dados pra renderizar; use system:query_parsed_file primeiro',
    '- parsed_id (UUID, opcional): hint pra audit, se vier de um arquivo parseado',
    '',
    'Retorna { artifact_id, download_url } — formate a resposta com [Ver dashboard](download_url).',
    'Cada call gera novo artifact (sem versionamento). Custo ~$0.20 por render.',
  ].join('\n'),
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: TITLE_MAX },
      prompt: { type: 'string', minLength: 1, maxLength: PROMPT_MAX },
      data: { type: 'object' },
      parsed_id: { type: 'string', description: 'UUID opcional do parsed_file source' },
    },
    required: ['title', 'prompt', 'data'],
  },
  permission: 'admin_only',
  handler: async (input, ctx) => {
    if (!input.title || input.title.length > TITLE_MAX) {
      throw new Error(`INVALID_INPUT: title must be 1-${TITLE_MAX} chars`)
    }
    if (!input.prompt || input.prompt.length > PROMPT_MAX) {
      throw new Error(`INVALID_INPUT: prompt must be 1-${PROMPT_MAX} chars`)
    }
    if (!input.data || typeof input.data !== 'object') {
      throw new Error('INVALID_INPUT: data must be an object')
    }
    const dataJson = JSON.stringify(input.data)
    if (Buffer.byteLength(dataJson, 'utf8') > DATA_MAX_BYTES) {
      throw new Error(`DATA_TOO_LARGE: payload exceeds ${DATA_MAX_BYTES} bytes (100KB)`)
    }
    if (input.parsed_id !== undefined && !UUID_RE.test(input.parsed_id)) {
      throw new Error('INVALID_INPUT: parsed_id must be a UUID')
    }

    const db = getDb()
    const agentRows = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.tenant_id, ctx.tenant_id), eq(agents.slug, 'output-worker')))
      .limit(1)
    const agent = agentRows[0]
    if (!agent) throw new Error('OUTPUT_WORKER_NOT_SEEDED')

    const result = await executeTask({
      tenant_id: ctx.tenant_id,
      agent_id: agent.id,
      skill_id: 'data:render',
      input: {
        title: input.title,
        prompt: input.prompt,
        data: input.data,
        parsed_id: input.parsed_id,
        conversation_id: ctx.conversation_id,
      } as Record<string, unknown>,
      activation_mode: 'on_demand',
      activation_source: 'copilot:render_dashboard',
      triggered_by: ctx.user_id,
    })

    if (!result.ok) {
      throw new Error(`RENDER_DASHBOARD_FAILED: ${result.error.code} - ${result.error.message}`)
    }
    const d = result.data
    return {
      artifact_id: d.artifact_id ?? '',
      download_url: d.download_url ?? '',
      size_bytes: d.size_bytes ?? 0,
      title: d.title ?? input.title,
    }
  },
}
