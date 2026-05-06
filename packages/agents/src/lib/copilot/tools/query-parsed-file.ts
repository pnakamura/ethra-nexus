import { eq, and } from 'drizzle-orm'
import { getDb, parsedFiles } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Soft caps (master can override): defaults pra pedido sem args.
const DEFAULT_LIMIT = 25
// Hard caps (server enforces — não-overridable): protege custo do master.
// limit hard-capped a 100 (era 500) — 500 rows × 79 cols = 1.3MB → 688K tokens
// no contexto do master → $2/turn. Limitar a 100 reduz pior caso ~5x.
const HARD_MAX_LIMIT = 100
// Auto-projection: se master não passar `columns`, retornamos só as primeiras
// AUTO_COLUMN_LIMIT colunas (com warning). Forces intentional column selection.
const AUTO_COLUMN_LIMIT = 12
// Hard byte cap no response total (rows + meta). Trunca rows se exceder.
const RESPONSE_MAX_BYTES = 50 * 1024  // 50KB

type ParserFormat = 'xlsx' | 'pdf' | 'docx' | 'csv' | 'txt' | 'md'

interface Input {
  parsed_id: string
  sheet?: string
  columns?: string[]
  filter?: Record<string, string | number | boolean>
  sort?: string
  limit?: number
  offset?: number
}

interface Output {
  parsed_id: string
  format: ParserFormat
  sheet?: string
  total_rows_in_source: number
  rows: Array<Record<string, unknown>>
  truncated: boolean
}

export const queryParsedFileTool: CopilotTool<Input, Output> = {
  name: 'system:query_parsed_file',
  description: [
    'Acessa dados de um arquivo já parseado (parsed_id de system:parse_file).',
    'É a ÚNICA maneira de obter dados reais — o preview de parse_file é só amostra.',
    'Use sempre que o user pedir conteúdo específico, incluindo abas diferentes da',
    'primeira (xlsx tem múltiplas abas — todas estão cacheadas).',
    'Sem LLM call, é rápido e barato — chame múltiplas vezes se precisar.',
    '',
    'CAPS DE CUSTO (server enforces — não pode escapar):',
    '- limit hard-capped em 100 (default 25). Pedir 500 retorna 100.',
    '- Sem `columns`, server projeta SÓ as primeiras 12 colunas (e devolve warning).',
    '- Response total cappado em 50KB — rows truncadas se exceder.',
    'SEMPRE passe `columns` com SÓ as 3-8 colunas que vai usar — é a otimização',
    'mais importante. Sem isso o turno fica caro mesmo com tudo cappado.',
    '',
    'Args:',
    '- parsed_id (UUID, obrigatório): id retornado por parse_file',
    '- sheet (opcional, xlsx): nome EXATO da aba (ex: "BID", "Resumo"). Default = primeira.',
    '  Os nomes aparecem no preview do parse_file como "## Sheet: <nome>".',
    '- columns (opcional): array de nomes de coluna pra projeção',
    '- filter (opcional): objeto com 1 chave = valor pra equality match',
    '- sort (opcional): nome da coluna; prefixe "-" pra desc',
    '- limit (opcional): default 100, máx 500',
    '- offset (opcional): default 0',
    '',
    'Retorna rows como array-of-objects + total_rows_in_source.',
  ].join('\n'),
  input_schema: {
    type: 'object',
    properties: {
      parsed_id: { type: 'string', description: 'UUID retornado por system:parse_file' },
      sheet: { type: 'string' },
      columns: { type: 'array', items: { type: 'string' } },
      filter: { type: 'object' },
      sort: { type: 'string' },
      limit: { type: 'number', minimum: 1, maximum: 100, description: 'Default 25, max 100. Server hard-caps even if you pass higher.' },
      offset: { type: 'number', minimum: 0 },
    },
    required: ['parsed_id'],
  },
  permission: 'admin_only',
  handler: async (input, ctx) => {
    if (!UUID_RE.test(input.parsed_id)) {
      throw new Error('INVALID_PARSED_ID')
    }

    const db = getDb()
    const rows = await db
      .select({ format: parsedFiles.format, structured_json: parsedFiles.structured_json })
      .from(parsedFiles)
      .where(and(eq(parsedFiles.id, input.parsed_id), eq(parsedFiles.tenant_id, ctx.tenant_id)))
      .limit(1)
    const row = rows[0]
    if (!row) throw new Error('PARSED_FILE_NOT_FOUND')

    const format = row.format as ParserFormat
    const structured = row.structured_json as Record<string, unknown>

    // Convert format-specific shapes to a uniform array-of-objects
    let allRows: Array<Record<string, unknown>> = []
    let sheetName: string | undefined
    if (format === 'xlsx') {
      const sheets = structured['sheets'] as Array<{
        name: string
        rows: unknown[][]
        total_rows: number
        total_cols: number
      }>
      const targetSheet = input.sheet
        ? sheets.find(s => s.name === input.sheet)
        : sheets[0]
      if (!targetSheet) throw new Error('SHEET_NOT_FOUND')
      sheetName = targetSheet.name
      const [header, ...dataRows] = targetSheet.rows
      const headers = (header as string[]) ?? []
      allRows = dataRows.map(r => {
        const obj: Record<string, unknown> = {}
        const arr = r as unknown[]
        headers.forEach((h, i) => { obj[h] = arr[i] })
        return obj
      })
    } else if (format === 'csv') {
      const headers = (structured['headers'] as string[]) ?? []
      const dataRows = (structured['rows'] as string[][]) ?? []
      allRows = dataRows.map(r => {
        const obj: Record<string, unknown> = {}
        headers.forEach((h, i) => { obj[h] = r[i] })
        return obj
      })
    } else if (format === 'txt') {
      allRows = [{ content: structured['content'], line_count: structured['line_count'] }]
    } else if (format === 'md') {
      const sections = (structured['sections'] as Array<Record<string, unknown>>) ?? []
      allRows = sections
    } else if (format === 'pdf') {
      const pages = (structured['pages'] as Array<Record<string, unknown>>) ?? []
      allRows = pages
    } else if (format === 'docx') {
      const paragraphs = (structured['paragraphs'] as Array<Record<string, unknown>>) ?? []
      allRows = paragraphs
    }

    // Apply filter (single-key equality)
    let filtered = allRows
    if (input.filter && Object.keys(input.filter).length > 0) {
      const [filterKey, filterVal] = Object.entries(input.filter)[0]!
      filtered = filtered.filter(r => r[filterKey] === filterVal)
    }

    // Apply sort
    if (input.sort) {
      const desc = input.sort.startsWith('-')
      const sortKey = desc ? input.sort.slice(1) : input.sort
      filtered = [...filtered].sort((a, b) => {
        const av = a[sortKey]
        const bv = b[sortKey]
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        if (typeof av === 'number' && typeof bv === 'number') return desc ? bv - av : av - bv
        return desc ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv))
      })
    }

    const totalAfterFilter = filtered.length
    const offset = Math.max(0, input.offset ?? 0)
    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, HARD_MAX_LIMIT)
    let sliced = filtered.slice(offset, offset + limit)

    // Column projection — defesa em profundidade contra contexto inflado.
    // Master DEVE passar `columns`. Se não passar, projetamos só as primeiras
    // AUTO_COLUMN_LIMIT pra evitar payload de 79 cols × 25 rows = ~50KB.
    const warnings: string[] = []
    let projectedColumns: string[] | undefined
    if (input.columns && input.columns.length > 0) {
      projectedColumns = input.columns
    } else if (sliced.length > 0) {
      // Auto-project pegando todas as keys da primeira row, capando em AUTO_COLUMN_LIMIT
      const allKeys = Object.keys(sliced[0]!)
      if (allKeys.length > AUTO_COLUMN_LIMIT) {
        projectedColumns = allKeys.slice(0, AUTO_COLUMN_LIMIT)
        warnings.push(
          `auto-projected first ${AUTO_COLUMN_LIMIT} of ${allKeys.length} columns ` +
          `(pass \`columns\` arg to choose specific ones)`,
        )
      }
    }
    if (projectedColumns) {
      const cols = projectedColumns
      sliced = sliced.map(r => {
        const proj: Record<string, unknown> = {}
        for (const c of cols) proj[c] = r[c]
        return proj
      })
    }

    // Hard byte cap — trunca rows se response > RESPONSE_MAX_BYTES.
    // Sem isso, master pode pedir limit=100 com cells longas e estourar.
    const measureBytes = (rows: typeof sliced) => Buffer.byteLength(JSON.stringify(rows), 'utf8')
    if (measureBytes(sliced) > RESPONSE_MAX_BYTES) {
      let lo = 0
      let hi = sliced.length
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (measureBytes(sliced.slice(0, mid)) <= RESPONSE_MAX_BYTES) lo = mid
        else hi = mid - 1
      }
      const original = sliced.length
      sliced = sliced.slice(0, lo)
      warnings.push(
        `response truncated to ${lo} of ${original} rows (50KB byte cap reached); ` +
        `use \`columns\` to pick fewer fields or \`offset\` for next page`,
      )
    }

    return {
      parsed_id: input.parsed_id,
      format,
      ...(sheetName ? { sheet: sheetName } : {}),
      total_rows_in_source: totalAfterFilter,
      rows: sliced,
      truncated: offset + sliced.length < totalAfterFilter,
      ...(warnings.length > 0 ? { warnings } : {}),
    }
  },
}
