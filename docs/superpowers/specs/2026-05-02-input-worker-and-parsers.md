# Spec #3 — Input Worker + Parsers

> **Spec #3 de 5** na trilha que termina com "xlsx → HTML dashboard end-to-end".
> Specs anteriores: #1 AIOS Master shell ✅ · #2 File Storage + Alerts ✅
> Specs subsequentes: #4 Output Worker + HTML Dashboard · #5 Integração E2E.

**Data:** 2026-05-02
**Autor:** Paulo Nakamura (com Claude)
**Status:** Approved for implementation
**Depende de:** Spec #1 (turn loop, copilot tools) + Spec #2 (file storage, /files endpoints)

---

## Goal

Permitir que o usuário anexe arquivos (xlsx, PDF, DOCX, csv, txt, md) no chat
do `/copilot`. O AIOS Master delega parsing a um **agente especialista** (Input
Worker, slug `input-worker`) via delegation interna, recebe preview estruturado,
e responde em linguagem natural.

Reusa todos os parsers de `packages/agents/src/lib/parsers/` (escritos
originalmente pra wiki:ingest), refatora-os em interface `ParserResult` neutra
e testável, e adiciona 3 parsers novos (csv, txt, md) que são triviais.

Estabelece o padrão de **delegation between agents** dentro do mesmo
process — boundary lógico via `executeTask`, não HTTP. Pavimenta o caminho
pra Spec #4 (Output Worker) e Spec #5 (master orquestra os 2 workers).

## Acceptance criteria

Critério de aceite final (smoke test E2E na VPS): user logado em `/copilot`
anexa `vendas-q2.xlsx` (3 abas, 1247+89+4 linhas) via paperclip, pergunta
"qual aba tem mais linhas?", AIOS Master chama `system:parse_file`, Input
Worker parseia + cacheia em `parsed_files`, master sintetiza resposta tipo
"A aba **Vendas Brutas** tem 1247 linhas, seguida de Reembolsos com 89 e
Resumo com 4." Custo do turn ~$0.04-0.08. Segunda pergunta sobre o mesmo
arquivo na mesma thread retorna em <100ms (cache hit).

Validações específicas:

- Migration 024 cria tabela `parsed_files`, adiciona `agents.is_system`, marca aios-master como system, semeia 1 input-worker por tenant.
- Backend POST `/messages` aceita `attachments: [{file_id, filename}]` (até 3); validates UUID + tenant; injeta marker no histórico.
- Tool `system:parse_file` registrada no copilot tool registry; chamada via Anthropic Tool Use; delega via `executeTask` pro input-worker.
- Skill `data:extract` refatorada pra receber `file_id`, fazer cache lookup por `(tenant_id, sha256)`, dispatchar pro parser via mime_type, INSERT cache, retornar preview_md + metadata.
- Frontend `/copilot`: paperclip icon + drag-drop area; up to 3 chips com filename/icon/size/spinner; client-side validation (mime, 50MB); reset após submit.
- Banner de erro graceful quando arquivo expira ou parse falha.
- Cobertura ≥80% em arquivos novos (parsers, skill, tool, frontend).
- Smoke test E2E na VPS passa em todos os 10 itens.

## Out of scope (Spec #3)

- ❌ Geração de HTML/dashboard a partir do parsed JSON — **Spec #4**
- ❌ Tool secundária `query_parsed_file` pra deep-dive em structured_json — defer pra Spec #4 (Output Worker vai precisar pra fatiar dados)
- ❌ OCR de PDFs scaneados — defer (parsers atuais usam pdf-parse text-based)
- ❌ xlsx formulas evaluation — usa valores estáticos resolvidos
- ❌ Streaming de parsing pra arquivos >10MB — defer
- ❌ Multi-file aggregation profunda ("compara essas 5 planilhas") — Spec #5 (master orquestra)
- ❌ Validação de mime via magic bytes (assina vs declarado) — defer
- ❌ A2A protocol HTTP loopback pra delegation — usa internal `executeTask` (decisão Q2)
- ❌ Per-attachment TTL custom — todos com 30d default da API /files
- ❌ Drag-drop teclado-only acessibility — fica paperclip pra teclado
- ❌ Preview inline do arquivo (xlsx viewer, PDF viewer) — só chip + filename + size

---

## Decisions log

| # | Decisão | Escolha |
|---|---------|---------|
| Q1 | Como `file_id` chega no turn loop | B — campo `attachments[]` separado no POST `/messages`; backend traduz pra content block `[user attached file_id=<uuid>]` no histórico |
| Q2 | Delegation strategy AIOS Master → Input Worker | B — internal in-process via `executeTask`, sem HTTP loopback A2A |
| Q3 | Cache strategy | B — tabela `parsed_files` keyed em `(tenant_id, sha256)`, parser output é "ground truth" neutro |
| Q4 | Output shape | C — híbrido: `structured_json` full no DB + `preview_md` (~3KB) retornado no tool_result; `query_parsed_file` defere |
| Q5 | UX widget | C — paperclip icon + drag-drop, até 3 chips, upload imediato com loading spinner |
| Q6 | Quando master chama `parse_file` | B — system prompt instrui "use quando conteúdo for relevante", master decide; tool call audit-visible |
| Q7 | Formatos no MVP | D — auto-detect via mime_type: xlsx + PDF + DOCX + CSV + TXT + MD |
| Q8 | Visibilidade do Input Worker | C — `agents.is_system=TRUE`, visible read-only no `/agents` page; aplica retroativamente ao aios-master |
| Q9 | Tool secundária `query_parsed_file` | D — sem tool secundária no MVP; preview cobre 90%; defer pra Spec #4 |
| Q10 | Estratégia de tests | D — unit tests pra cache + dispatch + tool handler + frontend chip; smoke E2E forte cobre parsers reais e UI completa |

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│  /copilot UI (Spec #1+#2)                                    │
│   ChatView + MessageInput                                    │
│   ├─ paperclip icon ─ file picker                            │
│   └─ ChatView area  ─ drop target                            │
│                  ↓ POST /files (Spec #2)                     │
│   ┌─ chip "📊 vendas-q2.xlsx (180KB) ✗"                      │
│   └─ até 3 chips empilhados                                  │
│                                                               │
│   POST /messages { content, attachments: [{file_id}] }       │
└──────────────────────────────┬───────────────────────────────┘
                               │
              ┌────────────────┴───────────────────┐
              │  apps/server/routes/copilot.ts      │
              │  (Spec #1 SSE turn loop)             │
              │  injecta history block:              │
              │    [user attached file_id=<uuid>     │
              │     filename=<name> mime=<type>]    │
              └────────────────┬───────────────────┘
                               │
              ┌────────────────┴───────────────────┐
              │  AIOS Master turn loop              │
              │  Sonnet 4.6 + 11 tools registradas  │
              │  ─ vê attachments + pergunta        │
              │  ─ decide chamar system:parse_file  │
              └────────────────┬───────────────────┘
                               │ tool_use
              ┌────────────────┴───────────────────┐
              │  parse_file tool handler            │
              │  packages/agents/lib/copilot/tools/ │
              │  parse-file.ts                       │
              │  ─ valida file_id + tenant         │
              │  ─ resolve input-worker agent_id    │
              │  ─ executeTask({ skill: data:extract│
              │      input: { file_id } })          │
              └────────────────┬───────────────────┘
                               │ delegação interna
              ┌────────────────┴───────────────────┐
              │  AIOS Orchestrator (executeTask)    │
              │  budget pre-check + aios_events log │
              │  ↓                                   │
              │  Input Worker (slug: input-worker)   │
              │  skill: data:extract (refatorado)    │
              └────────────────┬───────────────────┘
                               │
              ┌────────────────┴───────────────────┐
              │  data:extract handler               │
              │  ─ cache lookup parsed_files        │
              │    WHERE tenant_id=$1 AND sha256=$2 │
              │  ─ se HIT: retorna cached           │
              │  ─ se MISS:                         │
              │    ↓ files.storage_key              │
              │    ↓ driver.get(storage_key)        │
              │    ↓ parserFor(mime_type)           │
              │    ↓ INSERT parsed_files (cache)    │
              │  ─ retorna preview_md + metadata    │
              └────────────────┬───────────────────┘
                               │ tool_result
              ┌────────────────┴───────────────────┐
              │  AIOS Master (segunda iteration)    │
              │  ─ contexto: preview_md             │
              │  ─ sintetiza resposta natural       │
              │  ─ retorna SSE text deltas          │
              └─────────────────────────────────────┘
```

**Princípios de boundaries:**
- `parse_file` tool é só dispatcher pro Input Worker. Sem lógica de parsing nele.
- `data:extract` é onde o parsing acontece. Independente do tool, podia ser chamado de outras formas (cron, webhook).
- `parsers/file-parser.ts` é puro função: `(buffer, mime) => ParserResult`. Sem deps de DB/file storage.
- Cache é responsabilidade de `data:extract`, não dos parsers.

---

## Components

### Estrutura de arquivos novos

```
packages/db/src/schema/
└── parsing.ts                                 ← parsedFiles table
    (e modificar core.ts pra adicionar agents.is_system)

infra/supabase/migrations/
└── 024_input_worker_and_parsing.sql           ← schema + seed input-worker

packages/agents/src/lib/parsers/
├── parser-types.ts                            ← novo: ParserResult interface
├── file-parser.ts                             ← refatorado: parseFile + parserFor dispatcher
├── csv-parser.ts                              ← novo
├── txt-parser.ts                              ← novo
├── md-parser.ts                               ← novo
└── __tests__/
    ├── dispatch.test.ts                       ← parserFor(mime) tests
    ├── parser-result.test.ts                  ← integration com fixtures
    └── fixtures/
        ├── tiny.xlsx
        ├── tiny.pdf
        ├── tiny.docx
        ├── tiny.csv
        ├── tiny.txt
        └── tiny.md

packages/agents/src/lib/skills/
└── skill-executor.ts                          ← modificar executeDataExtract

packages/agents/src/lib/skills/__tests__/
└── data-extract.test.ts                       ← cache hit/miss + error paths

packages/agents/src/lib/copilot/tools/
├── parse-file.ts                              ← nova tool
├── index.ts                                   ← adicionar parseFileTool
└── __tests__/
    └── parse-file.test.ts

packages/agents/src/lib/copilot/
└── system-prompt.ts                           ← atualizar pra mencionar attachments

apps/server/src/routes/
└── copilot.ts                                 ← POST /messages aceita attachments

apps/server/src/__tests__/
└── copilot-attachments.test.ts                ← integration tests

apps/web/src/components/copilot/
├── AttachmentChip.tsx                         ← novo
├── MessageInput.tsx                           ← modificado: paperclip + drop zone + chips
└── __tests__/
    ├── AttachmentChip.test.tsx
    └── MessageInput.test.tsx

apps/web/src/hooks/
└── useUploadFile.ts                           ← novo: TanStack mutation pra POST /files
```

### `ParserResult` interface

```typescript
// packages/agents/src/lib/parsers/parser-types.ts

export type ParserFormat = 'xlsx' | 'pdf' | 'docx' | 'csv' | 'txt' | 'md'

export interface ParserResult {
  format: ParserFormat
  structured_json: ParserStructuredOutput   // discriminated union
  preview_md: string                         // markdown human-readable, ~2-5KB
  pages_or_sheets: number
  warnings: string[]                         // ex: "macros ignored"
}

export type ParserStructuredOutput =
  | { type: 'xlsx'; sheets: XlsxSheet[] }
  | { type: 'pdf'; pages: PdfPage[] }
  | { type: 'docx'; paragraphs: DocxParagraph[]; tables: DocxTable[] }
  | { type: 'csv'; rows: string[][]; headers: string[] }
  | { type: 'txt'; content: string; line_count: number }
  | { type: 'md'; content: string; sections: MdSection[] }

export interface XlsxSheet { name: string; rows: unknown[][]; total_rows: number; total_cols: number }
export interface PdfPage { page: number; text: string }
export interface DocxParagraph { style: string; text: string }
export interface DocxTable { rows: string[][]; cols: number }
export interface MdSection { level: number; title: string; line: number }
```

### `parserFor(mime)` dispatcher

```typescript
// packages/agents/src/lib/parsers/file-parser.ts

import type { ParserResult } from './parser-types'
import { xlsxParser } from './xlsx-parser'   // existente, refatorado
import { pdfParser } from './pdf-parser'     // existente, refatorado
import { docxParser } from './docx-parser'   // existente, refatorado
import { csvParser } from './csv-parser'     // novo
import { txtParser } from './txt-parser'     // novo
import { mdParser } from './md-parser'       // novo

export function parserFor(mime: string): (bytes: Buffer) => Promise<ParserResult> {
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    return xlsxParser
  if (mime === 'application/pdf')
    return pdfParser
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    return docxParser
  if (mime === 'text/csv' || mime.startsWith('text/csv'))
    return csvParser
  if (mime === 'text/plain' || mime.startsWith('text/plain'))
    return txtParser
  if (mime === 'text/markdown' || mime.startsWith('text/markdown'))
    return mdParser
  throw new Error(`UNSUPPORTED_MIME: ${mime}`)
}

export async function parseFile(bytes: Buffer, mime: string): Promise<ParserResult> {
  const parser = parserFor(mime)
  return parser(bytes)
}
```

---

## Database schema

### Migration 024 SQL

```sql
-- Migration 024: Input Worker agent + parsed_files cache + agents.is_system flag (Spec #3)
-- Safe: novas tabela + coluna + INSERT idempotente. Sem rewrite.
--
-- Padrão de RLS: enabled mas sem policies (mesmo Spec #1+#2). App conecta como
-- superuser; isolamento via tenant_id em queries Drizzle (CLAUDE.md §4.1).

-- ── 1. agents.is_system flag ──────────────────────────────────
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN agents.is_system IS
  'TRUE = agente do sistema (aios-master, input-worker, output-worker). UI esconde edit/delete; INSERT/UPDATE direto via SQL.';

-- ── 2. Marca aios-master existentes como system (Spec #1 retroativo) ──
UPDATE agents SET is_system = TRUE WHERE slug = 'aios-master';

-- ── 3. parsed_files table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS parsed_files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  sha256          TEXT NOT NULL CHECK (length(sha256) = 64),
  format          TEXT NOT NULL CHECK (format IN ('xlsx','pdf','docx','csv','txt','md')),
  structured_json JSONB NOT NULL,
  preview_md      TEXT NOT NULL,
  pages_or_sheets INTEGER NOT NULL DEFAULT 0,
  warnings        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS parsed_files_tenant_sha_idx
  ON parsed_files(tenant_id, sha256);
CREATE INDEX IF NOT EXISTS parsed_files_tenant_idx
  ON parsed_files(tenant_id);
CREATE INDEX IF NOT EXISTS parsed_files_format_idx
  ON parsed_files(format);

ALTER TABLE parsed_files ENABLE ROW LEVEL SECURITY;

-- ── 4. Seed input-worker agent por tenant ─────────────────────
INSERT INTO agents (
  tenant_id, name, slug, role, model, system_prompt, status,
  budget_monthly, wiki_enabled, wiki_top_k, wiki_min_score, wiki_write_mode,
  a2a_enabled, response_language, tone, is_system
)
SELECT
  t.id, 'Input Worker', 'input-worker', 'specialist:parser',
  'claude-sonnet-4-6',
  $$Você é o Input Worker, agente especialista do Ethra Nexus em parsing de arquivos.
Sua única responsabilidade é executar a skill data:extract — receber file_id de um anexo
do tenant, buscar bytes via driver, dispatchar pro parser correto via mime_type, e
retornar (ou cachear via sha256) o preview_md + structured_json.

Você NÃO interpreta dados nem responde ao usuário direto. Apenas estrutura.
Interpretação é responsabilidade do AIOS Master.$$,
  'active',
  20.00,
  FALSE, 5, 0.72, 'manual',
  FALSE, 'pt-BR', 'professional', TRUE
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM agents a WHERE a.tenant_id = t.id AND a.slug = 'input-worker'
);

-- ── 5. Habilitar skill data:extract pro input-worker ──────────
INSERT INTO agent_skills (agent_id, tenant_id, skill_name, enabled)
SELECT a.id, a.tenant_id, 'data:extract', TRUE
FROM agents a
WHERE a.slug = 'input-worker'
  AND NOT EXISTS (
    SELECT 1 FROM agent_skills s WHERE s.agent_id = a.id AND s.skill_name = 'data:extract'
  );
```

### Drizzle schema (`packages/db/src/schema/parsing.ts`)

```typescript
import { pgTable, uuid, text, timestamp, jsonb, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { tenants } from './core'

export const parsedFiles = pgTable('parsed_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  sha256: text('sha256').notNull(),
  format: text('format').notNull(),
  structured_json: jsonb('structured_json').notNull(),
  preview_md: text('preview_md').notNull(),
  pages_or_sheets: integer('pages_or_sheets').notNull().default(0),
  warnings: jsonb('warnings').notNull().default([]),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  parsedFilesTenantShaIdx: uniqueIndex('parsed_files_tenant_sha_idx').on(table.tenant_id, table.sha256),
  parsedFilesTenantIdx: index('parsed_files_tenant_idx').on(table.tenant_id),
  parsedFilesFormatIdx: index('parsed_files_format_idx').on(table.format),
}))
```

E modificar `core.ts` adicionando `is_system: boolean('is_system').notNull().default(false)` na pgTable de agents (entre flat fields existentes e created_at).

### Cleanup quando tenant é deletado

Adicionar à lista do procedimento manual de delete tenant (transaction script — ver Spec #2):

```sql
DELETE FROM parsed_files WHERE tenant_id = '<TENANT>';
```

### Decisões de schema (YAGNI)

- ❌ **Sem TTL** em `parsed_files`. Cache vive enquanto o tenant existir.
- ❌ **Sem FK pro `files` table.** Cache key é sha256, compartilhado entre files com mesmo conteúdo.
- ❌ **Sem soft delete.** DELETE físico.
- ✅ **`format CHECK constraint`** rejeita valores fora dos 6 suportados.
- ✅ **`is_system` flag** vai pra `agents`. Aplicação imediata: aios-master + input-worker. Output Worker (Spec #4) também usará.

---

## Skill flow + tool spec

### `data:extract` — fluxo completo

Refator de `executeDataExtract` em `packages/agents/src/lib/skills/skill-executor.ts`:

```
1. Input validation
   ├─ assert input.file_id é UUID válido
   └─ se inválido → AgentResult { ok:false, error: { code: 'INVALID_INPUT' } }

2. File lookup + tenant check
   ├─ SELECT files WHERE id=$1 AND tenant_id=$2 LIMIT 1
   └─ se não existe → { ok:false, error: { code: 'FILE_NOT_FOUND' } }

3. Cache lookup
   ├─ SELECT parsed_files WHERE tenant_id=$1 AND sha256=$2 LIMIT 1
   ├─ se HIT: reconstrói output a partir de cached, retorna
   └─ se MISS, continua

4. Driver fetch
   ├─ driver.get(files.storage_key) → ReadableStream | null
   ├─ se null → { ok:false, error: { code: 'STORAGE_ORPHAN' } }
   └─ stream → buffer

5. Parser dispatch
   ├─ try { parseFile(buffer, mime_type) }
   │   catch { return { ok:false, error: { code: 'PARSE_FAILED' } } }
   └─ result: ParserResult

6. Cache write
   ├─ INSERT parsed_files (...) ON CONFLICT (tenant_id, sha256) DO NOTHING
   ├─ se inserted vazio (race), SELECT existing
   └─ row.id → parsed_id

7. Build output
   return {
     ok: true,
     output: {
       parsed_id: row.id,
       format: result.format,
       preview_md: result.preview_md,
       pages_or_sheets: result.pages_or_sheets,
       warnings: result.warnings,
     },
     tokens_used: 0, cost_usd: 0,
     provider: 'local', model: 'parser', is_fallback: false,
   }
```

**Observabilidade (Pino logs):**

- Cache hit: `{ event: 'parser_cache_hit', tenant_id, sha256, parsed_id }`
- Cache miss: `{ event: 'parser_cache_miss', tenant_id, sha256, format, parse_duration_ms, structured_size_bytes }`
- Erros: level=error, com `file_id`, `mime_type`, `code`, `error_message` (sanitizado)

### `parse_file` tool

```typescript
// packages/agents/src/lib/copilot/tools/parse-file.ts

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
  description: `
Parseia um arquivo anexado pelo user na conversa. Use quando a pergunta do user
exigir conhecer o conteúdo de um arquivo anexo. Os file_id válidos aparecem no
histórico em mensagens "[user attached file_id=<uuid> filename=<name>]".

Retorno: preview em markdown (~3KB típico) com estrutura do arquivo + parsed_id.
Cache automático por sha256.

Não chame se a pergunta for trivial — só quando precisar do conteúdo pra responder.
`.trim(),
  input_schema: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: 'UUID do arquivo' },
      hint: { type: 'string', description: 'Opcional. Texto que ajuda interpretation downstream.' },
    },
    required: ['file_id'],
  },
  permission: 'admin_only',
  handler: async (input, ctx) => {
    if (!isValidUuid(input.file_id)) throw new Error('PARSE_FILE_INVALID_FILE_ID')
    const db = getDb()
    const inputWorker = await db.select({ id: agents.id }).from(agents)
      .where(and(eq(agents.tenant_id, ctx.tenant_id), eq(agents.slug, 'input-worker')))
      .limit(1)
    if (!inputWorker[0]) throw new Error('INPUT_WORKER_NOT_SEEDED')

    const result = await executeTask({
      tenant_id: ctx.tenant_id,
      agent_id: inputWorker[0].id,
      skill_id: 'data:extract',
      input: { file_id: input.file_id, hint: input.hint },
      activation_mode: 'on_demand',
      activation_source: 'copilot:parse_file',
      triggered_by: ctx.user_id,
    })

    if (!result.ok) throw new Error(`PARSE_FILE_FAILED: ${result.error.code} - ${result.error.message}`)
    return result.output as Output
  },
}
```

### POST `/messages` — extensão pra attachments

```typescript
// apps/server/src/routes/copilot.ts (modificar handler de POST /messages)

interface PostMessageBody {
  content: string
  attachments?: Array<{ file_id: string; filename: string }>
}

const attachments = body.attachments ?? []
if (attachments.length > 3) {
  return reply.status(400).send({ error: 'TOO_MANY_ATTACHMENTS', message: 'Máximo 3 anexos por mensagem' })
}

for (const att of attachments) {
  if (!isValidUuid(att.file_id)) {
    return reply.status(400).send({ error: 'INVALID_ATTACHMENT', message: 'file_id deve ser UUID válido' })
  }
}

// Build user message content blocks:
const userContent: ContentBlock[] = [{ type: 'text', text: body.content }]
for (const att of attachments) {
  userContent.push({
    type: 'text',
    text: `[user attached file_id=${att.file_id} filename=${att.filename}]`,
  })
}

// Insert na copilot_messages.content como JSONB array (padrão Spec #1).
```

### `system_prompt.ts` — atualização

Adicionar parágrafo ao system prompt do AIOS Master:

```
## Anexos no chat

Quando o user anexar arquivos, eles aparecem no histórico como blocos texto
no formato: "[user attached file_id=<uuid> filename=<name>]"

Use a tool `system:parse_file({ file_id })` quando o **conteúdo** do arquivo
for necessário pra responder. Se a pergunta não envolve o conteúdo, não chame.

Quando chamar parse_file, você recebe um `preview_md` (~3KB) com estrutura
do arquivo. Use o preview pra raciocinar e formular resposta.

Múltiplos anexos: chame parse_file uma vez por arquivo. Se a pergunta for
"compara A e B", parseie ambos e sintetize.

Limites: até 3 arquivos por turn. Formatos suportados: xlsx, PDF, DOCX,
CSV, TXT, Markdown.
```

### Tool registry update

```typescript
// packages/agents/src/lib/copilot/tools/index.ts
export const allCopilotTools: CopilotTool[] = [
  // ... 10 tools Spec #1+#2 ...
  parseFileTool,  // ← 11ª
]
```

---

## Frontend UX

### `MessageInput` modificado

**Estado:**
```tsx
interface ChipState {
  temp_id: string                              // local UUID antes do upload
  file_id?: string                              // populado após POST /files OK
  filename: string
  mime_type?: string
  size_bytes?: number
  status: 'uploading' | 'ready' | 'error'
  error_message?: string
}
```

**Layout:**

```
┌─────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────┐ ┌──────────────────────┐   │
│  │ 📊 vendas-q2.xlsx · 180KB ✗│ │ 📄 contrato.pdf ⏳   │   │
│  └─────────────────────────────┘ └──────────────────────┘   │
│                                                               │
│  [📎] Pergunte algo sobre o sistema...              [➤]      │
└─────────────────────────────────────────────────────────────┘
```

**Comportamento:**

| Ação | Resultado |
|---|---|
| Click 📎 | Abre `<input type="file" hidden>` |
| Drop arquivo no ChatView | Mesmo flow do paperclip |
| Upload em progresso | Chip com `⏳`; botão `➤` desabilitado se houver chips em `uploading` |
| Upload completo | Spinner vira `✗`; user pode remover ou enviar |
| Upload falha | Chip vermelho com mensagem; auto-remove após 3s |
| Click `✗` | Remove chip do estado (arquivo expira em 30d por TTL) |
| 4º arquivo | Toast "máximo 3 anexos por mensagem" |
| >50MB | Toast "arquivo excede 50MB" |
| Mime não-suportado | Toast "formato não suportado" |
| Click `➤` | Submit com `attachments`. Reset text + chips após ok. |

### `useUploadFile.ts` hook

```tsx
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useUploadFile() {
  return useMutation<UploadResponse, Error, File>({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      fd.append('expires_at', expiresAt)
      const res = await api.post<UploadResponse>('/files', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return res.data
    },
  })
}
```

### Validação client-side

```tsx
const SUPPORTED_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
  'text/plain',
  'text/markdown',
] as const

const MAX_BYTES = 50 * 1024 * 1024

function validateFile(file: File): string | null {
  if (file.size > MAX_BYTES) return 'arquivo excede 50MB'
  if (!SUPPORTED_MIMES.includes(file.type as typeof SUPPORTED_MIMES[number])) {
    return `formato não suportado: ${file.type || 'desconhecido'}`
  }
  return null
}
```

### `useSendCopilotMessage` extension

```tsx
interface SendParams {
  content: string
  attachments?: Array<{ file_id: string; filename: string }>
}
```

E `copilot-stream.ts` aceita attachments e passa no body do POST.

---

## Error handling & security

### Códigos de erro

| Origem | Código | Onde |
|---|---|---|
| `parse_file` tool | `PARSE_FILE_INVALID_FILE_ID` | UUID inválido |
| `parse_file` tool | `INPUT_WORKER_NOT_SEEDED` | Tenant sem input-worker (raro — migration 024 cuida) |
| `parse_file` tool | `PARSE_FILE_FAILED: <code>` | Wrapper sobre error de `executeTask` |
| `data:extract` skill | `INVALID_INPUT` | file_id ausente |
| `data:extract` skill | `FILE_NOT_FOUND` | file row não existe ou tenant divergente |
| `data:extract` skill | `STORAGE_ORPHAN` | file row OK, driver.get retorna null |
| `data:extract` skill | `PARSE_FAILED` | Parser throw |
| POST `/messages` | `TOO_MANY_ATTACHMENTS` | >3 attachments |
| POST `/messages` | `INVALID_ATTACHMENT` | file_id não-UUID |

Todos passam por `sanitizeErrorMessage()` antes de retornar (regra CLAUDE.md §7.2.4).

### Validações

- `validateUuid` em todos os file_id de entrada (existente em core/security)
- `validateMimeType` no upload via `/files` (Spec #2 já valida)
- Frontend valida mime + size antes de chamar `/files`

### Audit trail

- `executeTask` já registra `aios_events` com `agent_id=input-worker`, `skill_id=data:extract`, status, tokens, cost
- POST `/messages` insere user message com content blocks (incluindo marker de attachment) — auditável em `copilot_messages.content`

### Defesa in-depth

- **Path traversal**: impossível — driver path é construído via tenant_id + file_id (UUIDs validados). Filename original nunca entra no path.
- **Mime sniffing**: parser dispatch valida mime contra allowlist; mime fora dos 6 → throw `UNSUPPORTED_MIME`. Frontend valida antes; backend valida de novo no upload (Spec #2).
- **DoS via parsing**: parsers operam em memory pra arquivos ≤50MB (Spec #2 limit). Aceita risco; spec #4+ pode adicionar streaming.
- **Cache poisoning**: cache key é `(tenant_id, sha256)`. Tenant A não pode poisar cache do tenant B.
- **Storage orphan**: detectado em runtime (`driver.get` retorna null), retornado como `STORAGE_ORPHAN` ao master, master responde graciosamente ("não consegui acessar o arquivo").

### Rate limiting

`@fastify/rate-limit` global (100/min) já cobre. Nada específico pra Spec #3.

---

## Testing strategy

### Unit (`packages/agents/src/lib/parsers/__tests__/`)

**`dispatch.test.ts`:**
- 6 mime types corretos retornam parser correto
- `application/octet-stream` throw `UNSUPPORTED_MIME`
- `text/csv; charset=utf-8` (variações com charset) → csvParser
- String vazia throw

**`parser-result.test.ts`** (com fixtures pequenos):
- xlsx: valida format, sheets[].total_rows, preview_md não-vazio
- pdf: valida format, pages, text extraído
- docx: paragraphs + tables
- csv: rows + headers
- txt/md: content

### Unit (`packages/agents/src/lib/skills/__tests__/`)

**`data-extract.test.ts`:**
- Cache hit: file existe + sha256 match → retorna cached, parser não chamado
- Cache miss: parseia, INSERT, retorna result
- File not found: tenant divergente → `FILE_NOT_FOUND`
- Storage orphan: driver retorna null → `STORAGE_ORPHAN`
- Parse fail: parser throw → `PARSE_FAILED`
- Race ON CONFLICT: 2 calls concorrentes resolvem sem erro

### Unit (`packages/agents/src/lib/copilot/tools/__tests__/`)

**`parse-file.test.ts`:**
- Resolve `input-worker` agent_id corretamente
- Throw `INPUT_WORKER_NOT_SEEDED` se não houver row
- Invalid UUID em `file_id` throw `PARSE_FILE_INVALID_FILE_ID`
- Successful flow: chama `executeTask` com args certos, retorna output

### Integration (`apps/server/src/__tests__/`)

**`copilot-attachments.test.ts`:**
- POST `/messages` sem `attachments` → behavior igual Spec #1
- Com 1 attachment → user message tem 2 content blocks
- Com 4 → 400 `TOO_MANY_ATTACHMENTS`
- Com `file_id` inválido → 400 `INVALID_ATTACHMENT`

### Frontend unit (`apps/web/src/components/copilot/__tests__/`)

**`AttachmentChip.test.tsx`:**
- Render `uploading` mostra spinner, sem X
- Render `ready` mostra X; click chama `onRemove`
- Render `error` mostra mensagem vermelha
- Icon escolhido por `mime_type`

**`MessageInput.test.tsx`:**
- Click paperclip dispara file input
- File válido → chip em uploading
- File >50MB → toast, sem chip
- Mime não-suportado → toast
- 4ª file → toast "máximo 3"
- Click X remove chip
- Submit com chip em uploading → button disabled
- Submit ok → reset + callback recebe attachments

**`useUploadFile.test.ts`:**
- Success retorna `{id, sha256, ...}`
- 413 → mutation error
- FormData inclui `expires_at` 30d

---

## Smoke test (manual)

Executar na VPS após deploy do Spec #3. Cada item deve passar antes de declarar
spec entregue. Reaproveita o padrão dos smoke tests Specs #1+#2.

**Setup:**
- Login `/copilot` como tenant atitude45 (ou outro tenant ativo).
- Ter 4 fixtures locais: `vendas-q2.xlsx` (3 abas: Vendas Brutas 1247 linhas, Reembolsos 89, Resumo 4), `contrato.pdf` (texto, ≥3 páginas), `proposta.docx`, `produtos.csv`.

**Casos:**

1. **Upload xlsx + pergunta sobre estrutura**
   - Anexar `vendas-q2.xlsx` via paperclip → chip aparece com spinner → vira `✗`.
   - Pergunta: "qual aba tem mais linhas?"
   - **Esperado:** AIOS Master chama `system:parse_file` (visível no SSE/audit), recebe preview, responde algo como "A aba **Vendas Brutas** tem 1247 linhas, seguida de Reembolsos com 89 e Resumo com 4."
   - Custo do turn: ~$0.04–$0.08.

2. **Validação no DB**
   - `SELECT * FROM parsed_files WHERE tenant_id = '<TENANT>' ORDER BY created_at DESC LIMIT 1;` → 1 row, format='xlsx', `structured_json->'sheets'` com 3 itens.
   - `SELECT * FROM aios_events WHERE agent_id = (SELECT id FROM agents WHERE slug='input-worker') ORDER BY created_at DESC LIMIT 1;` → 1 row status='success', skill_id='data:extract'.
   - `SELECT * FROM provider_usage_log WHERE agent_id = ... ORDER BY created_at DESC LIMIT 1;` → row do master + (opcionalmente) row do worker (cost=0 se parse local).

3. **Cache hit (mesma thread)**
   - Sem novo upload, perguntar "e na aba Vendas Brutas, quantas colunas?"
   - **Esperado:** master chama `parse_file` de novo com mesmo `file_id`; skill faz cache lookup, retorna em <100ms (log Pino: `parser_cache_hit`).
   - `SELECT count(*) FROM parsed_files WHERE tenant_id=...` permanece igual (não inseriu de novo).

4. **PDF**
   - Anexar `contrato.pdf`, pergunta "resuma a cláusula 3".
   - **Esperado:** parse_file dispara, `format='pdf'`, preview_md contém texto extraído, master responde com referência à cláusula.

5. **DOCX**
   - Anexar `proposta.docx`, pergunta "qual o valor total proposto?"
   - **Esperado:** format='docx', preview_md tem paragraphs+tables.

6. **CSV**
   - Anexar `produtos.csv`, pergunta "quantas linhas tem?"
   - **Esperado:** format='csv', preview com headers + total_rows.

7. **Multi-file (2 xlsx)**
   - Anexar `vendas-q2.xlsx` + `vendas-q1.xlsx`, pergunta "qual trimestre teve mais vendas?"
   - **Esperado:** master chama `parse_file` 2x (uma por arquivo), sintetiza comparação. Audit mostra 2 events.

8. **Validações client-side**
   - Tentar anexar `.exe` → toast "formato não suportado", não cria chip.
   - Tentar anexar arquivo 51MB → toast "arquivo excede 50MB".
   - Anexar 3 arquivos válidos, tentar 4º → toast "máximo 3 anexos por mensagem".

9. **Validação server-side (bypass via curl)**
   - `curl POST /messages` com 4 attachments válidos → 400 `TOO_MANY_ATTACHMENTS`.
   - Com `file_id` malformado → 400 `INVALID_ATTACHMENT`.

10. **Error path: file deletado**
    - Anexar arquivo, depois `DELETE FROM files WHERE id='<FILE>';` no DB.
    - Pergunta sobre o arquivo no chat.
    - **Esperado:** parse_file retorna `PARSE_FILE_FAILED: FILE_NOT_FOUND`; master responde gracefully ("não consegui acessar o arquivo, pode ter sido removido"), sem 500 ao usuário.

**Critério de pass:** todos os 10 itens verdes. Bugs encontrados viram tasks de
fix antes do merge. Se algum passa só "parcialmente", documentar e decidir
explicitamente go/no-go (mesmo padrão Specs #1+#2).

---

## Estimativa de esforço

| Fase | Entrega | Tempo |
|---|---|---|
| **Phase 1** — DB foundation | Migration 024 + Drizzle schema parsedFiles + agents.is_system + retroativo aios-master + seed input-worker | 0.5 dia |
| **Phase 2** — Parsers refactor | parseFile() dispatcher + ParserResult types + 3 parsers novos (csv/txt/md) + tests dispatch | 1.5 dias |
| **Phase 3** — Existing parsers migration | Adaptar xlsx/pdf/docx pra ParserResult shape (atualmente retornam só texto) + fixtures + tests parser-result | 1.5 dias |
| **Phase 4** — `data:extract` skill refactor | executeDataExtract pra cache-first flow + storage driver integration + tests data-extract | 1.5 dias |
| **Phase 5** — `parse_file` tool + system prompt | Tool registration + delegation via executeTask + system prompt update + tests parse-file | 1 dia |
| **Phase 6** — Backend `/messages` extension | POST /messages aceita attachments[] + content block injection + tests copilot-attachments | 1 dia |
| **Phase 7** — Frontend attachment widget | AttachmentChip + MessageInput modify + useUploadFile hook + tests | 2 dias |
| **Phase 8** — Smoke test E2E | Manual checklist + bug fixes pós-validação | 0.5 dia |
| **Total** | | **~9.5 dias subagent-driven** |

---

## Riscos previstos

1. **xlsx parser hoje retorna texto cru** (escrito pra wiki:ingest). Refactor pra `ParserResult.structured_json` é nontrivial — preserve sheets+rows+cols sem perder dados.

2. **PDF parser (`pdf-parse`) deprecation warnings** — biblioteca legada; talvez precise upgrade ou fallback.

3. **Multipart upload no fastify** já validado na Spec #2; mas mime detection do browser pode divergir da assinatura real (ex: xlsx renomeado pra .pdf). Validar via magic bytes seria nice-to-have, **defer**.

4. **`structured_json` grande** (>1MB) pode degradar query speed em parsed_files. Não é problema imediato (índices só em tenant_id+sha256), mas monitorar.

5. **Race condition no INSERT cache** — 2 turns concorrentes do mesmo arquivo. Resolvido com `ON CONFLICT DO NOTHING` + retry SELECT, mas precisa testar.

6. **Frontend chip state perdido em navegação** — se user clica conversa diferente após anexar, chip some. Aceitamos; mensagem com anexo deve ser enviada na thread atual.

---

## Apêndice: dependências entre Spec #3 e #4

Spec #4 (Output Worker + HTML Dashboard) consome diretamente o que esta spec entrega:

- `parsed_files.structured_json` é a fonte de dados pra geração de HTML pelo Output Worker
- Tool `query_parsed_file` (Spec #4) lê via `parsed_id` e fatia o JSON
- Spec #5 conecta tudo: AIOS Master delega upload → Input Worker parseia → Output Worker gera artifact → AIOS Master responde com `download_url` clicável

Esta spec NÃO precisa antecipar nenhuma dessas integrações. Os contratos
definidos aqui (ParserResult interface + parsed_files schema + parse_file tool)
são suficientes.
