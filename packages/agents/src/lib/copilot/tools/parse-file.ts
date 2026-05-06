import { eq, and } from 'drizzle-orm'
import { getDb, agents } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'
import { executeTask } from '../../aios/aios-master'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Input { file_id: string; hint?: string }
interface Output {
  parsed_id: string
  format: 'xlsx' | 'pdf' | 'docx' | 'csv' | 'txt' | 'md'
  preview_md: string
  pages_or_sheets: number
  warnings: string[]
}

export const parseFileTool: CopilotTool<Input, Output> = {
  name: 'system:parse_file',
  description: [
    'Parseia um arquivo anexado pelo user na conversa. Use quando a pergunta do user',
    'exigir conhecer o conteúdo de um arquivo anexo. Os file_id válidos aparecem no',
    'histórico em mensagens "[user attached file_id=<uuid> filename=<name>]".',
    '',
    'Retorno: preview em markdown (~3KB típico) com estrutura do arquivo + parsed_id.',
    'IMPORTANTE: o preview é só uma AMOSTRA da estrutura — TODAS as abas e linhas',
    'são cacheadas no servidor. Pra acessar dados específicos (qualquer aba, top-N,',
    'filtros), use system:query_parsed_file({parsed_id, sheet?, filter?, sort?, limit?}).',
    'NUNCA peça pro user re-uploadar pra acessar uma aba diferente — todas estão',
    'no cache, basta fatiar via query_parsed_file.',
    '',
    'Não chame se a pergunta for trivial — só quando precisar do conteúdo pra responder.',
  ].join('\n'),
  input_schema: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: 'UUID do arquivo anexado' },
      hint: { type: 'string', description: 'Opcional. Texto que ajuda interpretation downstream.' },
    },
    required: ['file_id'],
  },
  permission: 'admin_only',
  handler: async (input, ctx) => {
    if (!UUID_RE.test(input.file_id)) {
      throw new Error('PARSE_FILE_INVALID_FILE_ID')
    }

    const db = getDb()
    const agentRows = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.tenant_id, ctx.tenant_id), eq(agents.slug, 'input-worker')))
      .limit(1)
    const agent = agentRows[0]
    if (!agent) throw new Error('INPUT_WORKER_NOT_SEEDED')

    const result = await executeTask({
      tenant_id: ctx.tenant_id,
      agent_id: agent.id,
      skill_id: 'data:extract',
      input: { file_id: input.file_id, hint: input.hint } as Record<string, unknown>,
      activation_mode: 'on_demand',
      activation_source: 'copilot:parse_file',
      triggered_by: ctx.user_id,
    })

    if (!result.ok) {
      throw new Error(`PARSE_FILE_FAILED: ${result.error.code} - ${result.error.message}`)
    }
    const d = result.data
    return {
      parsed_id: d.parsed_id ?? '',
      format: (d.format ?? 'txt') as Output['format'],
      preview_md: d.preview_md ?? d.answer,
      pages_or_sheets: d.pages_or_sheets ?? 0,
      warnings: d.warnings ?? [],
    }
  },
}
