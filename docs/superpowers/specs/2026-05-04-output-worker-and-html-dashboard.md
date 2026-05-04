# Spec #4 — Output Worker + HTML Dashboard

> **Spec #4 de 5** na trilha que termina com "xlsx → HTML dashboard end-to-end".
> Specs anteriores: #1 AIOS Master shell ✅ · #2 File Storage + Alerts ✅ · #3 Input Worker + Parsers ✅
> Spec subsequente: #5 Integração E2E (master orquestra Input + Output workers automaticamente).

**Data:** 2026-05-04
**Autor:** Paulo Nakamura (com Claude)
**Status:** Approved for implementation
**Depende de:** Spec #2 (storage driver), Spec #3 (parsed_files cache, executeTask delegation)

---

## Goal

Permitir que o user no `/copilot` peça **dashboards visuais** em linguagem natural ("gera um gráfico com top 10 vendedores em SP") e receba um **link clicável** que abre um HTML standalone com gráficos (chart.js).

Implementa:
1. Agente seed `output-worker` (slug fixo, `is_system=TRUE`, 1 por tenant) que gera HTML.
2. Tool `system:query_parsed_file` — fatia server-side de `parsed_files.structured_json` (resolve a limitação atual do preview de 5 linhas/aba).
3. Tool `system:render_dashboard` — delega via `executeTask` pro output-worker.
4. Skill `data:render` — Sonnet 4.6 gera HTML, valida (CSP-safe), salva via storage driver, retorna `artifact_id` + `download_url`.
5. Tabela `artifacts` (separada de `files`) com FK pra `copilot_conversations` e `parsed_files`.
6. Endpoint `GET /api/v1/artifacts/:id/view` com CSP estrita, serve inline pra render no browser.

Pavimenta a Spec #5 (master orquestra Input + Output workers em sequência sem o user precisar pedir explicitamente).

## Acceptance criteria

Critério de aceite final (smoke test E2E na VPS): user logado em `/copilot` anexa `vendas-q2.xlsx`, pergunta **"gera dashboard com top 10 vendedores em SP"**, AIOS Master:

1. Chama `system:parse_file({file_id})` → recebe `parsed_id` + preview.
2. Chama `system:query_parsed_file({parsed_id, sheet, columns:['Vendedor','Vendas Q2'], filter:{Estado:'SP'}, sort:'-Vendas Q2', limit:10})` → recebe 10 rows.
3. Chama `system:render_dashboard({title, prompt, data})` → recebe `{artifact_id, download_url}`.
4. Sintetiza resposta: *"Gerei um dashboard com os top 10 vendedores em SP. [Ver dashboard](url)"*.
5. User clica no link → nova tab abre `https://api.../api/v1/artifacts/<id>/view`. CSP estrita aplica. chart.js renderiza horizontal bar chart.
6. Custo total do turn ~$0.20–$0.30. DB tem 1 row em `artifacts`, 2+ events em `aios_events` (output-worker + master), 1 row em `provider_usage_log` (Anthropic call do render).

Validações específicas:

- Migration 025 cria tabela `artifacts`, semeia 1 output-worker por tenant, habilita skill `data:render`.
- HTML validado **antes** do storage write: ≤50KB, sem inline event handlers (`on*=`), sem `javascript:` URLs, scripts apenas inline ou de `cdn.jsdelivr.net`.
- Endpoint `/artifacts/:id/view` retorna `Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'none'; frame-ancestors 'none'; ...`.
- Tenant isolation: GET /artifacts/<id-de-outro-tenant>/view → 404 (não vaza existência).
- TTL: artifact expira em 7 dias por default; expirado retorna 410.
- Cobertura ≥80% nos arquivos novos (validate, query-parsed-file, render-dashboard, data:render skill).
- Smoke test 10/10 passa.

## Out of scope (Spec #4)

- ❌ **Iframe sandbox embedded in chat** (estilo claude.ai Artifacts) — defer pra Spec posterior. MVP usa link em nova tab.
- ❌ **Versionamento de artifacts** (parent_artifact_id, "v2 badge") — stateless re-render, cada call = novo artifact.
- ❌ **PDF / PNG output** — só HTML no MVP. Schema permite (`mime_type` text); futuro spec amplia.
- ❌ **Aggregation server-side** (GROUP BY, JOIN entre fontes) — master compõe nos próprios tokens. Tools server-side só fazem filter/sort/limit.
- ❌ **Editor inline do dashboard** ("clica no chart pra editar") — só re-render via novo prompt.
- ❌ **Compartilhamento entre conversas / users** — artifact é privado da conversa que gerou.
- ❌ **"Lista meus dashboards" UI** — só link no chat. Schema suporta query, mas sem feature de listagem.
- ❌ **Real-time charts** (websocket / polling) — HTML estático.
- ❌ **Custom CSS / theming via user prompt** ("modo escuro", "cores corporativas") — LLM escolhe; refinamento via re-render.
- ❌ **Diff / comparison de versões** entre 2 artifacts — defer.
- ❌ **Master orquestrando automaticamente** Input → Output em 1 turn sem user pedir explicitamente — **Spec #5 escopo**.

---

## Decisions log

| # | Decisão | Escolha |
|---|---------|---------|
| Q1 | Quem escreve o HTML | **B** — LLM-generated artifact (Sonnet 4.6 escreve HTML inline com chart.js) |
| Q2 | Shape do `query_parsed_file` | **A** — structured field selectors (`{parsed_id, sheet?, columns?, filter?, sort?, limit?, offset?}`) |
| Q3 | Storage do artifact | **C** — nova tabela `artifacts` (separada de `files`) com FK pra `copilot_conversations` + opcional `parsed_files` |
| Q4 | Serving + isolamento | **A** — same-origin (API host) + CSP estrita + abre em nova tab via `download_url`, sem subdomain dedicado |
| Q5 | Multi-source render | **A** — `render_dashboard({title, prompt, data: Record<string, unknown>})`, master orquestra N queries e empacota em `data` |
| Q6 | Refinement / iteração | **A** — stateless re-render (cada call de render_dashboard = artifact novo, sem versionamento) |

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│  /copilot UI (Spec #1+#2+#3)                                 │
│   ChatView + MessageInput + Attachments                      │
│   ─ user anexa vendas-q2.xlsx                                │
│   ─ digita "gera dashboard com top 10 vendedores em SP"      │
│   POST /messages { content, attachments: [{file_id}] }       │
└──────────────────────────────┬───────────────────────────────┘
                               │
              ┌────────────────┴───────────────────┐
              │  apps/server/routes/copilot.ts      │
              │  (Spec #1 SSE turn loop)             │
              │  injecta marker no histórico         │
              └────────────────┬───────────────────┘
                               │
              ┌────────────────┴───────────────────┐
              │  AIOS Master (Sonnet 4.6)           │
              │  13 tools registradas                │
              │  ─ vê attachment + pergunta          │
              │  ─ decide sequência:                 │
              │    1. parse_file                     │
              │    2. query_parsed_file              │
              │    3. render_dashboard               │
              └────────────────┬───────────────────┘
                               │
              ┌────────────────┼─────────────────────────────────┐
              │                │                                 │
       ┌──────┴───────┐  ┌─────┴──────┐  ┌──────────────────────┴──────┐
       │ parse_file   │  │ query_     │  │ render_dashboard tool        │
       │ (Spec #3)    │  │ parsed_    │  │ packages/agents/lib/copilot/ │
       │              │  │ file       │  │ tools/render-dashboard.ts    │
       │ → input-     │  │ (NEW)      │  │  ─ valida data ≤100KB         │
       │   worker     │  │            │  │  ─ resolve output-worker      │
       │   data:      │  │ server-    │  │  ─ executeTask({              │
       │   extract    │  │ side       │  │      skill: data:render,      │
       │              │  │ slice no   │  │      input: {title, prompt,   │
       │              │  │ JSONB.     │  │       data, parsed_id,        │
       │              │  │ Sem LLM.   │  │       conversation_id}})       │
       └──────┬───────┘  └────────────┘  └──────────────────────┬──────┘
              │                                                 │
              ▼                                                 ▼
        parsed_files                              ┌─────────────────────────┐
        (Spec #3 cache)                           │ Output Worker            │
                                                  │ (slug: output-worker)    │
                                                  │ skill: data:render        │
                                                  └────────────┬────────────┘
                                                               │
                                          ┌────────────────────┴────────────────┐
                                          │  data:render handler                │
                                          │  ─ sanitize data → escape HTML chars │
                                          │  ─ build render prompt              │
                                          │  ─ Anthropic Sonnet 4.6 call         │
                                          │    (sensitive_data: true)            │
                                          │  ─ extract HTML from response        │
                                          │  ─ validate.ts:                      │
                                          │      ≤50KB ✓                         │
                                          │      no on*= handlers ✓              │
                                          │      no javascript: URLs ✓           │
                                          │      script src ∈ {inline, jsdelivr} │
                                          │  ─ sha256 = hash(html)               │
                                          │  ─ driver.put(html_bytes)            │
                                          │  ─ INSERT artifacts row              │
                                          │  ─ retorna {artifact_id, url}        │
                                          └────────────────────┬────────────────┘
                                                               │
                                                  artifacts table (NEW)
                                                  + storage_driver bytes
                                                               │
                                                  ▼
                                          response: SSE text deltas
                                          → Master sintetiza:
                                          "Gerei dashboard. [Ver dashboard](url)"

┌──────────────────────────────────────────────────────────────────────────┐
│  USER CLICA NO LINK (nova tab)                                            │
│  → GET https://api.../api/v1/artifacts/<id>/view                          │
│    ┌─────────────────────────────────────────────────────────────────┐   │
│    │ apps/server/routes/artifacts.ts                                  │   │
│    │  ─ tenant guard (lookup com tenant_id)                          │   │
│    │  ─ TTL check (expires_at > NOW)                                 │   │
│    │  ─ driver.get(storage_key) → stream                             │   │
│    │  ─ headers:                                                     │   │
│    │    Content-Type: text/html                                      │   │
│    │    Content-Disposition: inline; filename="..."                  │   │
│    │    Content-Security-Policy: default-src 'none'; ...             │   │
│    │    X-Frame-Options: DENY                                        │   │
│    │    X-Content-Type-Options: nosniff                              │   │
│    │    Referrer-Policy: no-referrer                                 │   │
│    │  ─ reply.send(stream)                                           │   │
│    └─────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  Browser executa HTML em new-tab origin (API host).                       │
│  chart.js carrega de cdn.jsdelivr.net (whitelisted).                       │
│  CSP `connect-src 'none'` bloqueia QUALQUER fetch externo.                 │
│  Origin diferente do app frontend (Vercel) → JWT/localStorage não vazam.  │
└──────────────────────────────────────────────────────────────────────────┘
```

**Princípios de boundary:**
- `query_parsed_file` é **dispatcher fino server-side**, sem LLM call. Apenas lê `parsed_files.structured_json` e fatia.
- `render_dashboard` é **wrapper do output-worker** — chama `executeTask`, não faz LLM call diretamente.
- `data:render` é **onde o token money é gasto** — Sonnet escreve HTML.
- `validate.ts` é **pura função `(html: string) => Result`** — testável sem deps.
- `/artifacts/:id/view` é **read-only endpoint** — sem POST/DELETE públicos no MVP.

---

## Components

### Estrutura de arquivos novos

```
infra/supabase/migrations/
└── 025_artifacts_and_output_worker.sql       ← novo

packages/db/src/schema/
├── artifacts.ts                              ← novo
└── index.ts                                  ← modify (export * from './artifacts')

packages/agents/src/lib/render/
├── prompt.ts                                 ← novo: system prompt template pra Sonnet
├── validate.ts                               ← novo: HTML validation
├── sanitize.ts                               ← novo: escape data antes do prompt
├── index.ts                                  ← novo: barrel
└── __tests__/
    ├── validate.test.ts                      ← novo
    └── sanitize.test.ts                      ← novo

packages/agents/src/lib/skills/
└── skill-executor.ts                         ← modify: add 'data:render' case

packages/agents/src/lib/skills/__tests__/
└── data-render.test.ts                       ← novo

packages/agents/src/lib/copilot/tools/
├── query-parsed-file.ts                      ← novo (12ª tool)
├── render-dashboard.ts                       ← novo (13ª tool)
├── index.ts                                  ← modify
└── __tests__/
    ├── query-parsed-file.test.ts             ← novo
    └── render-dashboard.test.ts              ← novo

packages/agents/src/lib/copilot/
└── system-prompt.ts                          ← modify: §"Geração de dashboards"

packages/agents/src/lib/copilot/
└── tool-registry.ts                          ← modify: add `conversation_id` em ToolContext

apps/server/src/routes/
├── artifacts.ts                              ← novo
└── (files.ts inalterado)

apps/server/src/__tests__/
└── artifacts-routes.test.ts                  ← novo

apps/server/src/app.ts                        ← modify: register artifacts routes
```

### `ToolContext` extension

Em [`packages/agents/src/lib/copilot/tool-registry.ts`](../../packages/agents/src/lib/copilot/tool-registry.ts):

```typescript
export interface ToolContext {
  tenant_id: string
  user_id: string
  user_role: 'admin' | 'member'
  conversation_id: string  // ← NEW (Spec #4)
}
```

E em [`packages/agents/src/lib/copilot/turn-loop.ts`](../../packages/agents/src/lib/copilot/turn-loop.ts), pass `conversation_id: params.conversation_id` quando construir o `ToolContext` pra `executeToolCall`. Mudança trivial.

---

## Database schema

### Migration 025 SQL

```sql
-- Migration 025: Output Worker agent + artifacts table (Spec #4)
-- Safe: nova tabela + INSERT idempotente. Sem rewrite, sem ALTER.
--
-- Padrão de RLS: enabled mas sem policies (mesmo Spec #1+#2+#3). App conecta
-- como superuser; isolamento via tenant_id em queries Drizzle (CLAUDE.md §4.1).

-- ── 1. artifacts table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artifacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  conversation_id UUID NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
  parsed_id       UUID REFERENCES parsed_files(id) ON DELETE SET NULL,
  storage_key     TEXT NOT NULL,
  sha256          TEXT NOT NULL CHECK (length(sha256) = 64),
  size_bytes      INTEGER NOT NULL CHECK (size_bytes >= 0),
  mime_type       TEXT NOT NULL DEFAULT 'text/html',
  title           TEXT NOT NULL,
  prompt          TEXT NOT NULL,
  generated_by_agent_id UUID NOT NULL REFERENCES agents(id),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS artifacts_tenant_idx       ON artifacts(tenant_id);
CREATE INDEX IF NOT EXISTS artifacts_conversation_idx ON artifacts(conversation_id);
CREATE INDEX IF NOT EXISTS artifacts_expires_idx      ON artifacts(expires_at);

ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;

-- ── 2. Seed output-worker agent por tenant ──────────────────────
INSERT INTO agents (
  tenant_id, name, slug, role, model, system_prompt, status,
  budget_monthly, wiki_enabled, wiki_top_k, wiki_min_score, wiki_write_mode,
  a2a_enabled, response_language, tone, is_system
)
SELECT
  t.id, 'Output Worker', 'output-worker', 'specialist:renderer',
  'claude-sonnet-4-6',
  $$Você é o Output Worker, agente especialista do Ethra Nexus em renderização de dashboards.
Sua única responsabilidade é executar a skill data:render — receber dados já queried + um prompt
de renderização, gerar HTML standalone com gráficos via chart.js (CDN jsdelivr), validar e salvar
como artifact.

Você NÃO interpreta dados nem responde ao user direto. Apenas renderiza.
Síntese e interpretação são do AIOS Master.

REGRAS DE OUTPUT:
- HTML standalone com <!DOCTYPE html>
- chart.js de https://cdn.jsdelivr.net/npm/chart.js@4 somente
- ZERO fetch() ou XHR no script (CSP bloqueará)
- Charts renderizam em <canvas>, dados embutidos como JSON inline
- Estilo profissional, mobile-friendly, contraste WCAG AA
- Tamanho máximo: 50KB do HTML final$$,
  'active',
  100.00,
  FALSE, 5, 0.72, 'manual',
  FALSE, 'pt-BR', 'professional', TRUE
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM agents a WHERE a.tenant_id = t.id AND a.slug = 'output-worker'
);

-- ── 3. Habilitar skill data:render pro output-worker ──────────
INSERT INTO agent_skills (agent_id, tenant_id, skill_name, enabled)
SELECT a.id, a.tenant_id, 'data:render', TRUE
FROM agents a
WHERE a.slug = 'output-worker'
  AND NOT EXISTS (
    SELECT 1 FROM agent_skills s WHERE s.agent_id = a.id AND s.skill_name = 'data:render'
  );
```

### Drizzle schema (`packages/db/src/schema/artifacts.ts`)

```typescript
import { pgTable, uuid, text, timestamp, integer, index } from 'drizzle-orm/pg-core'
import { tenants, agents, copilotConversations } from './core'
import { parsedFiles } from './parsing'

export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  conversation_id: uuid('conversation_id').notNull()
    .references(() => copilotConversations.id, { onDelete: 'cascade' }),
  parsed_id: uuid('parsed_id').references(() => parsedFiles.id, { onDelete: 'set null' }),
  storage_key: text('storage_key').notNull(),
  sha256: text('sha256').notNull(),
  size_bytes: integer('size_bytes').notNull(),
  mime_type: text('mime_type').notNull().default('text/html'),
  title: text('title').notNull(),
  prompt: text('prompt').notNull(),
  generated_by_agent_id: uuid('generated_by_agent_id').notNull().references(() => agents.id),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  artifactsTenantIdx: index('artifacts_tenant_idx').on(table.tenant_id),
  artifactsConversationIdx: index('artifacts_conversation_idx').on(table.conversation_id),
  artifactsExpiresIdx: index('artifacts_expires_idx').on(table.expires_at),
}))
```

### Decisões de schema (YAGNI)

- ❌ **Sem `parent_artifact_id`** — Q6=A, stateless re-render.
- ❌ **Sem `version`** — same.
- ❌ **Sem `metadata jsonb`** — columns explícitos cobrem MVP.
- ❌ **Sem soft delete** — DELETE físico via cleanup cron.
- ✅ **`mime_type` default 'text/html'** mas é `text` — schema permite outros formatos no futuro sem migration.
- ✅ **`expires_at NOT NULL` com default 7 days** — TTL automatic + index pra cleanup.
- ✅ **`conversation_id ON DELETE CASCADE`** — artifacts somem com a conversa.
- ✅ **`parsed_id ON DELETE SET NULL`** — parsed_file pode ser deletado por TTL/cleanup mas artifact sobrevive (apenas perde lineage).
- ✅ **`generated_by_agent_id NOT NULL`** — sempre output-worker, redundante mas explícito.

### Cleanup automático

Cron diário (extensão do scheduler-loop existente):

```sql
DELETE FROM artifacts WHERE expires_at < NOW();
```

E via storage_driver: para cada row deletada, `driver.delete(storage_key)`. Implementado seguindo o pattern de [`packages/agents/src/lib/storage/cleanup.ts`](../../packages/agents/src/lib/storage/cleanup.ts) (Spec #2). Adicionar arquivo `cleanup-artifacts.ts` análogo, registrado em scheduler-loop pra rodar diariamente às 3h.

---

## Skill flow + tool spec

### `data:render` — fluxo completo

Refator/extensão de `executeSkill` em [`packages/agents/src/lib/skills/skill-executor.ts`](../../packages/agents/src/lib/skills/skill-executor.ts):

```
1. Input validation
   ├─ assert input.title é string non-empty (≤200 chars)
   ├─ assert input.prompt é string non-empty (≤2000 chars)
   ├─ assert input.data é object
   ├─ assert JSON.stringify(input.data).length ≤ 100KB
   ├─ assert input.conversation_id é UUID válido
   ├─ assert input.parsed_id é UUID válido OU undefined
   └─ se inválido → AgentResult { ok:false, error:'INVALID_INPUT' }

2. Sanitize data
   └─ aplica escape recursivo em todos strings de input.data
      (& → &amp; etc.) — defesa contra prompt injection via cell content

3. Compose render prompt
   ├─ system: RENDER_SYSTEM_PROMPT (de lib/render/prompt.ts)
   │   Inclui regras: HTML standalone, chart.js jsdelivr only, no fetch, ≤50KB
   └─ user:
      "Gere um dashboard HTML com o título: {title}
       Pergunta original do user: {prompt}
       Dados (sanitizados):
       {JSON.stringify(sanitized_data, null, 2)}"

4. Anthropic call
   ├─ registry.complete('data:render', {
   │     messages: [{role:'system', ...}, {role:'user', ...}],
   │     max_tokens: 8000,
   │     sensitive_data: true,        // força Anthropic, sem fallback
   │   })
   └─ catch → AgentResult { ok:false, error:'AI_ERROR' }

5. Extract HTML from response
   ├─ Sonnet retorna response com bloco "```html ... ```" OU raw HTML
   ├─ regex /```html\s*([\s\S]+?)\s*```/ pra extrair block, fallback raw text
   ├─ trim, normalize newlines
   └─ se não achou DOCTYPE/<html → AgentResult { ok:false, error:'RENDER_FAILED', message:'no html in response' }

6. Validate HTML
   ├─ result = validateArtifactHtml(html)  // de lib/render/validate.ts
   ├─ se !result.ok → AgentResult { ok:false, error:'RENDER_FAILED', message: result.reason }

7. Compute sha256 + write to driver
   ├─ sha256 = createHash('sha256').update(html).digest('hex')
   ├─ artifact_id = randomUUID()
   ├─ driver.put({
   │     tenant_id: context.tenant_id,
   │     file_id: artifact_id,
   │     bytes: Buffer.from(html, 'utf8'),
   │     mime_type: 'text/html',
   │   })
   └─ catch → AgentResult { ok:false, error:'DB_ERROR', retryable:true }

8. INSERT artifacts row
   ├─ INSERT INTO artifacts (id, tenant_id, conversation_id, parsed_id,
   │     storage_key, sha256, size_bytes, mime_type, title, prompt,
   │     generated_by_agent_id, expires_at)
   │   VALUES (artifact_id, ..., context.agent_id, default 7d)
   └─ catch FK violation → AgentResult { ok:false, error:'DB_ERROR', retryable:false }

9. Build output
   return {
     ok: true,
     data: {
       answer: `Dashboard "${title}" gerado.`,
       tokens_in, tokens_out, cost_usd,
       provider: 'anthropic', model: 'claude-sonnet-4-6', is_fallback: false,
       artifact_id,
       download_url: `/api/v1/artifacts/${artifact_id}/view`,
       size_bytes: html.length,
       title,
     },
     tokens_used: tokens_in + tokens_out,
     cost_usd,
   }
```

**Logs Pino:** `render_started`, `render_anthropic_call`, `render_validation_failed`, `render_succeeded`, `render_storage_failed`. Mesmo padrão Spec #3.

**`SkillOutput` interface extension** (em skill-executor.ts) — adicionar 4 fields opcionais ao tipo já estendido pela Spec #3:

```typescript
export interface SkillOutput {
  // ... Spec #1+#3 fields (answer, tokens_in, ..., parsed_id?, format?, preview_md?, ...) ...
  // ── Spec #4: data:render ──
  artifact_id?: string
  download_url?: string
  // size_bytes? já existe pelo storage shape geral
  title?: string
}
```

### `query_parsed_file` tool

```typescript
// packages/agents/src/lib/copilot/tools/query-parsed-file.ts

interface Input {
  parsed_id: string
  sheet?: string                // só pra xlsx; default = primeira aba
  columns?: string[]            // projeção; default = all (header row)
  filter?: Record<string, string | number | boolean>  // single-key equality
  sort?: string                 // 'col' asc | '-col' desc
  limit?: number                // default 100, max 500
  offset?: number               // default 0
}
interface Output {
  parsed_id: string
  format: 'xlsx' | 'pdf' | 'docx' | 'csv' | 'txt' | 'md'
  sheet?: string                // se xlsx
  total_rows_in_source: number
  rows: Array<Record<string, unknown>>
  truncated: boolean
}

// Permission: admin_only
// Handler:
//   1. Validate parsed_id UUID
//   2. SELECT structured_json FROM parsed_files WHERE id=$1 AND tenant_id=$2
//      → 404 se não existir
//   3. Switch por format:
//      'xlsx': pega aba (input.sheet ?? primeira). Converte rows array-of-arrays
//              em array-of-objects (header[i] → row[i]). total = rows.length.
//      'csv':  rows + headers → array-of-objects.
//      'txt'/'md': retorna { content, line_count/sections } — sem filter/sort.
//      'pdf'/'docx': retorna pages/paragraphs como rows.
//   4. Apply filter (single-key equality, lowercase comparison opcional)
//   5. Apply sort (numeric vs string detection automática)
//   6. Apply offset + limit (default 100, hard max 500)
//   7. Apply column projection (subset)
//   8. truncated = (offset + rows_returned < total_filtered)
//   9. Return Output
```

### `render_dashboard` tool

```typescript
// packages/agents/src/lib/copilot/tools/render-dashboard.ts

interface Input {
  title: string                 // ≤200 chars
  prompt: string                // ≤2000 chars
  data: Record<string, unknown> // JSON.stringify ≤100KB
  parsed_id?: string            // optional hint pra audit
}
interface Output {
  artifact_id: string
  download_url: string
  size_bytes: number
  title: string
}

// Permission: admin_only
// Handler:
//   1. Validate fields:
//      - title.length ∈ [1, 200]
//      - prompt.length ∈ [1, 2000]
//      - JSON.stringify(data).length ≤ 100*1024
//      - parsed_id ∈ UUID-format or undefined
//   2. Resolve output-worker agent_id pra ctx.tenant_id
//      → if !found: throw 'OUTPUT_WORKER_NOT_SEEDED'
//   3. executeTask({
//        tenant_id: ctx.tenant_id,
//        agent_id: outputWorker.id,
//        skill_id: 'data:render',
//        input: {
//          title, prompt, data,
//          parsed_id: input.parsed_id,
//          conversation_id: ctx.conversation_id,
//        },
//        activation_mode: 'on_demand',
//        activation_source: 'copilot:render_dashboard',
//        triggered_by: ctx.user_id,
//      })
//   4. if !result.ok: throw `RENDER_DASHBOARD_FAILED: ${result.error.code}`
//   5. return {
//        artifact_id: result.data.artifact_id,
//        download_url: result.data.download_url,
//        size_bytes: result.data.size_bytes,
//        title: result.data.title,
//      }
```

### Tool registry update

```typescript
// packages/agents/src/lib/copilot/tools/index.ts
export const allCopilotTools: CopilotTool[] = [
  // ... 11 tools Spec #1+#2+#3 ...
  queryParsedFileTool,    // ← 12ª
  renderDashboardTool,    // ← 13ª
]
```

### `system_prompt.ts` update

Adicionar parágrafo após o §"Anexos no chat" (Spec #3):

```
## Geração de dashboards

Quando o user pedir explicitamente "dashboard", "gráfico", "visualização",
"report", "relatório visual", ou implicitamente quando os dados forem densos
demais pra resposta em texto (>20 linhas tabuladas):

1. Use system:query_parsed_file pra fatiar os dados — typical limit 50 rows.
2. Chame system:render_dashboard com título descritivo, o prompt original do user,
   e o data dos query results.
3. Sintetize 1-2 frases descrevendo o que foi gerado, terminando com o link clicável
   no formato: [Ver dashboard](download_url)

NÃO renderize dashboard se a pergunta for trivial ("quantas linhas?", "qual aba?") —
responda em texto direto.

Limites: até 50KB por dashboard, custo ~$0.20 por render. Use com critério.
Cada call de render produz NOVO artifact (sem versionamento).
Pra "muda pra pizza chart" ou refinamentos: chame render_dashboard de novo
com prompt atualizado, reutilize os mesmos data se já estão no histórico.
```

---

## Endpoint `/api/v1/artifacts/:id/view`

```typescript
// apps/server/src/routes/artifacts.ts

import type { FastifyInstance } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { getDb, artifacts } from '@ethra-nexus/db'
import { createStorageDriver } from '@ethra-nexus/agents'

const CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' https://cdn.jsdelivr.net",
  "connect-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

export async function artifactsRoutes(app: FastifyInstance) {
  // Mesma preHandler que /files (requireCopilotAccess) — admin_only ainda aplicável.
  // Nota: artifacts são acessíveis pelo user que criou (na conversa dele).

  app.get<{ Params: { id: string } }>('/artifacts/:id/view', async (request, reply) => {
    const db = getDb()
    const driver = createStorageDriver()

    const rows = await db.select({
      storage_key: artifacts.storage_key,
      mime_type: artifacts.mime_type,
      title: artifacts.title,
      expires_at: artifacts.expires_at,
    }).from(artifacts)
      .where(and(
        eq(artifacts.id, request.params.id),
        eq(artifacts.tenant_id, request.tenantId),
      ))
      .limit(1)

    const row = rows[0]
    if (!row) return reply.status(404).send({ error: 'ARTIFACT_NOT_FOUND' })
    if (row.expires_at < new Date()) {
      return reply.status(410).send({
        error: 'ARTIFACT_EXPIRED',
        message: 'Artifact has expired',
      })
    }

    const stream = await driver.get(row.storage_key)
    if (!stream) {
      request.log.error({ storage_key: row.storage_key }, 'artifact storage_orphan')
      return reply.status(500).send({ error: 'STORAGE_ORPHAN' })
    }

    const safeFilename = row.title.replace(/[^\w\s-]/g, '_').slice(0, 100)
    reply.header('Content-Type', row.mime_type)
    reply.header('Content-Disposition', `inline; filename="${safeFilename}.html"`)
    reply.header('Content-Security-Policy', CSP)
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('Cache-Control', 'private, max-age=300')

    return reply.send(stream)
  })
}
```

Registrar em `apps/server/src/app.ts`:

```typescript
import { artifactsRoutes } from './routes/artifacts'
await app.register(artifactsRoutes, { prefix: '/api/v1' })
```

---

## Error handling & security

### Códigos de erro

| Origem | Código | Detalhe |
|---|---|---|
| `query_parsed_file` tool | `PARSE_FILE_INVALID_FILE_ID` | UUID inválido |
| `query_parsed_file` tool | `PARSED_FILE_NOT_FOUND` | row não existe ou tenant divergente |
| `query_parsed_file` tool | `INVALID_INPUT` | sheet/columns/filter inválidos |
| `render_dashboard` tool | `OUTPUT_WORKER_NOT_SEEDED` | tenant sem output-worker (raro — migration cuida) |
| `render_dashboard` tool | `RENDER_DASHBOARD_FAILED: <code>` | wrapper sobre executeTask error |
| `data:render` skill | `INVALID_INPUT` | title/prompt/data shape inválidos |
| `data:render` skill | `AI_ERROR` | Anthropic falhou (timeout, 5xx) |
| `data:render` skill | `RENDER_FAILED` | HTML não extraído ou validation falhou |
| `data:render` skill | `DB_ERROR` | storage put OR INSERT falhou |
| GET /artifacts/:id/view | `ARTIFACT_NOT_FOUND` | row não existe ou tenant divergente |
| GET /artifacts/:id/view | `ARTIFACT_EXPIRED` | expires_at < NOW |
| GET /artifacts/:id/view | `STORAGE_ORPHAN` | row OK mas driver.get retorna null |

Todos passam por `sanitizeErrorMessage()` antes de retornar (regra CLAUDE.md §7.2.4).

### Security layers

**Layer 1: Sanitização de dados antes do prompt** (`lib/render/sanitize.ts`)

```typescript
export function sanitizeDataForRenderPrompt(data: unknown): unknown {
  if (typeof data === 'string') {
    return data
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
  if (Array.isArray(data)) return data.map(sanitizeDataForRenderPrompt)
  if (data && typeof data === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) out[k] = sanitizeDataForRenderPrompt(v)
    return out
  }
  return data
}
```

**Por que importa**: cell de xlsx pode ter `<script>...</script>` malicioso. Se chega cru no prompt do LLM, LLM pode ecoar. Escape garante que o LLM vê `&lt;script&gt;` e ecoa entidade — browser renderiza como texto.

**Layer 2: HTML validation antes do storage** (`lib/render/validate.ts`)

Já especificado na Seção 5.3 do design. Tabela:

| Check | Bloqueia |
|---|---|
| Length ≤ 50KB | HTML excessivo / DoS |
| Sem `<[tag] on*=` | Inline event handlers (onerror, onclick, etc.) |
| Sem `javascript:` URL | href/action javascript injection |
| Sem `<iframe/object/embed src="data:` | Embedded blob exec |
| Script src ∈ {inline, https://cdn.jsdelivr.net} | External script load |

**Layer 3: CSP + HTTP headers no serving**

Já especificado na Seção 5.2 do design. Tabela:

| Header | Defesa |
|---|---|
| `default-src 'none'` | Block tudo por default |
| `script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net` | Whitelist scripts |
| `connect-src 'none'` | **Bloqueia data exfil** |
| `frame-ancestors 'none'` | Anti-clickjacking |
| `X-Frame-Options: DENY` | CSP backup pra browsers antigos |
| `X-Content-Type-Options: nosniff` | Anti MIME-confusion |
| `Referrer-Policy: no-referrer` | Privacy on navigation |

**Layer 4: Tenant isolation**

- `/artifacts/:id/view` query: `WHERE id=$1 AND tenant_id=$2` (do JWT). 404 silencioso se tenant divergente — não vaza existência.
- `data:render` skill grava com `tenant_id = context.tenant_id` (do executeTask).
- Cleanup cron escopa por tenant_id implicitamente (todos os tenants, mas cada artifact tem seu tenant_id).

### Audit trail

- `executeTask` registra `aios_events` com `agent_id=output-worker`, `skill_id=data:render`, status, tokens, cost.
- `provider_usage_log` registra a Anthropic call do render (cost ~$0.20).
- `aios_events.payload` contém o request inteiro do render (title, prompt, data) — full audit.

### Rate limiting

- `@fastify/rate-limit` global (100/min) já cobre.
- Adicional pra `data:render`: budget mensal `100.00 USD` no output-worker (~500 renders/mês). Master decide se vale; ao bater limit, executeTask retorna `BUDGET_EXCEEDED` → master responde "limite atingido".

---

## Testing strategy

### Unit (`packages/agents/src/lib/render/__tests__/`)

**`validate.test.ts`** (9 cases):
- HTML válido com chart.js inline → ok
- HTML com inline `<script>` (sem src) → ok
- HTML com script src jsdelivr (https) → ok
- Bloqueia inline `onclick=` em `<button>`
- Bloqueia `javascript:` URL em `<a href>`
- Bloqueia script src http:// (não HTTPS)
- Bloqueia script src de host fora whitelist
- Bloqueia HTML >50KB
- Bloqueia `<iframe src="data:..."`

**`sanitize.test.ts`** (4 cases):
- String com `<script>` vira `&lt;script&gt;`
- Array com strings sanitizado recursivamente
- Object aninhado sanitizado
- Numbers/booleans/null preservados

### Unit (`packages/agents/src/lib/skills/__tests__/`)

**`data-render.test.ts`** (7 cases):
- INVALID_INPUT: title vazio
- INVALID_INPUT: data >100KB
- AI_ERROR: anthropic mock timeout → graceful
- RENDER_FAILED: response sem HTML → erro
- RENDER_FAILED: HTML excede 50KB → erro
- RENDER_FAILED: HTML com script malicioso → erro
- Success: validate passa + storage put + INSERT artifacts → returns artifact_id + download_url

### Unit (`packages/agents/src/lib/copilot/tools/__tests__/`)

**`query-parsed-file.test.ts`** (8 cases):
- INVALID_INPUT: parsed_id não-UUID
- PARSED_FILE_NOT_FOUND: row inexistente ou tenant errado
- xlsx: aba específica + columns projection + filter por estado + sort desc + limit
- xlsx: default to primeira aba quando sheet não passado
- csv: rows + headers → array-of-objects, filter+sort+limit
- txt: content + line_count, sem filter/sort possible
- limit cap: input.limit=501 → applied=500
- truncated flag: total>limit → truncated=true

**`render-dashboard.test.ts`** (6 cases):
- INVALID_INPUT: data >100KB
- INVALID_INPUT: prompt vazio
- OUTPUT_WORKER_NOT_SEEDED: nenhum agent com slug 'output-worker' pra tenant
- Success: delegates to executeTask com args certos; retorna artifact_id+download_url
- RENDER_DASHBOARD_FAILED: executeTask retorna ok:false → throw com code
- conversation_id propagation: extracted from ctx, passed to executeTask.input

### Integration (`apps/server/src/__tests__/`)

**`artifacts-routes.test.ts`** (5 cases):
- GET /artifacts/:id/view 200 — retorna stream + Content-Type text/html + CSP header
- GET /artifacts/:id/view 404 — id não existe
- GET /artifacts/:id/view 410 — expires_at no passado (ARTIFACT_EXPIRED)
- GET /artifacts/:id/view 404 — tenant errado (tenant_a tenta acessar artifact de tenant_b)
- GET /artifacts/:id/view 500 — STORAGE_ORPHAN (row exists, driver retorna null)

---

## Smoke test (manual, na VPS pós-deploy)

Executar após:
1. CI verde + auto-deploy concluído
2. Migration 025 aplicada via `docker exec ... node -e "...readFileSync('/tmp/025.sql')..."`
3. Verificar seed: `SELECT slug, is_system FROM agents WHERE slug='output-worker'` — 1 row por tenant.

**Fixtures necessários no desktop**: `vendas-q2.xlsx` (3 abas, ~1000 linhas) — mesma da Spec #3.

### Casos:

1. **Dashboard simples** — Login `/copilot` (tenant atitude45). Anexar `vendas-q2.xlsx`. Pergunta: **"gera dashboard com top 10 vendedores em vendas Q2"**.
   - **Esperado**: 3 tool calls visíveis no chat: `system_parse_file` → `system_query_parsed_file` → `system_render_dashboard`.
   - Resposta: texto curto + `[Ver dashboard](url)`.
   - Custo total ~$0.20-0.40.

2. **Click no link** — abre nova tab. DevTools Network: response headers contain `Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; ...`. Page renderiza com bar chart usando chart.js da CDN.

3. **DB validation**:
   ```sql
   SELECT id, title, size_bytes, mime_type, expires_at, parsed_id FROM artifacts ORDER BY created_at DESC LIMIT 1;
   SELECT a.slug, e.skill_id, e.status, e.cost_usd FROM aios_events e JOIN agents a ON a.id=e.agent_id WHERE a.slug IN ('aios-master','input-worker','output-worker') ORDER BY e.triggered_at DESC LIMIT 5;
   ```
   - 1 row em `artifacts`: mime='text/html', size_bytes ~5-15KB, expires_at ~ NOW+7d, parsed_id setado.
   - 3+ events em `aios_events`: data:extract (input-worker, ok), data:render (output-worker, ok, cost>0).

4. **Filter complexo** — pergunta: **"top 5 vendedores em SP, em pizza chart"**.
   - Esperado: novo artifact (dif id), pizza chart no HTML.
   - Master pode reutilizar dados em cache da query anterior se aplicável.

5. **Iteração** — pergunta na mesma conversa: **"refaz com mais 3 vendedores"** ou **"muda pra horizontal bar"**.
   - Esperado: novo artifact, novo link no chat. Antigo artifact ainda acessível (TTL 7d).

6. **Multi-source** — anexar `vendas-q1.xlsx` (criar fixture), perguntar: **"compara Q1 vs Q2"**.
   - Esperado: master chama parse_file 2x + query 2x + render 1x. 1 artifact com 2 charts.

7. **Edge case — pergunta trivial** — pergunta: **"quantas abas tem o vendas-q2?"**.
   - Esperado: master responde em texto direto SEM chamar render_dashboard. Sistema prompt "NÃO renderize se trivial" funciona.

8. **Security — same tenant scope** — abrir DevTools, copiar `download_url`, modificar UUID pra um random. Acessar via fetch:
   ```bash
   curl -H "Authorization: Bearer <jwt>" https://api.../api/v1/artifacts/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/view
   ```
   - Esperado: 404 ARTIFACT_NOT_FOUND.

9. **Security — cross-tenant isolation** — login como `minha-org`, tentar acessar URL de artifact criado em `atitude45`.
   - Esperado: 404. Não vaza existência.

10. **TTL & expiration** — manualmente atualizar:
    ```sql
    UPDATE artifacts SET expires_at = NOW() - INTERVAL '1 day' WHERE id = '<artifact-id>';
    ```
    Acessar URL → 410 ARTIFACT_EXPIRED.

**Critério de pass:** todos os 10 itens verdes. Bugs encontrados viram tasks de fix antes do merge. Padrão Spec #3.

---

## Estimativa de esforço

| Fase | Entrega | Tasks | Tempo |
|---|---|---|---|
| **Phase 1** — DB foundation | Migration 025 + Drizzle artifacts schema + cleanup-artifacts.ts (cron) | 3 | 0.5d |
| **Phase 2** — Render module | validate.ts + sanitize.ts + prompt.ts + tests | 2 | 1d |
| **Phase 3** — Skill `data:render` | skill-executor.ts case + SkillOutput extension + tests (Anthropic mock) | 2 | 1d |
| **Phase 4** — Tool `system:query_parsed_file` | Tool + 8 tests (xlsx/csv/txt + filter/sort/limit) | 1 | 1.5d |
| **Phase 5** — Tool `system:render_dashboard` | Tool + ToolContext.conversation_id propagation + tests | 1 | 1d |
| **Phase 6** — Backend `/artifacts/:id/view` | Route + CSP headers + tests integration | 1 | 1d |
| **Phase 7** — System prompt + tool registration | system-prompt.ts §"Geração de dashboards" + index.ts add 2 tools | 1 | 0.25d |
| **Phase 8** — Smoke E2E na VPS | Manual checklist 10 cases | 1 | 0.5d |
| **Total** | | **12** | **~6.75d subagent-driven** |

Mais enxuto que Spec #3 (9.5d) — boa parte do código novo segue patterns já estabelecidos. Maior risco: **render prompt engineering** (Sonnet pode produzir HTML inconsistente). Mitigação: validate.ts rigoroso + budget pra iteração.

---

## Riscos previstos

1. **Sonnet HTML quality variance** — LLM pode produzir HTML com chart errado, dados misformatted, layout quebrado. Mitigação: render prompt detalhado + few-shot examples opcional + user pode pedir refinamento.

2. **chart.js CDN downtime** — jsdelivr é confiável mas não 100%. Mitigação: aceitar como risco; se vira problema, switch pra inline bundling (~150KB extra por artifact).

3. **Custo do render** — $0.20/render × 50 renders/dia × 30 dias = ~$300/mês por tenant ativo. Aceitar ou ajustar `budget_monthly` do output-worker.

4. **`data` payload >100KB** — user pede "renderiza tudo da planilha de 1000 linhas". Tool retorna INVALID_INPUT. Master deve fatiar mais antes; system prompt já orienta "limit ~50 rows típico".

5. **Race condition no cleanup** — cron deleta artifact enquanto user clica no link → 404. Aceitamos. TTL de 7d dá margem.

6. **Anthropic rate limit / outage** — render falha durante outage. Master responde "tente novamente" via `AI_ERROR`. Reuso do error handling Spec #1.

7. **HTML que não passa validation** — Sonnet emite onclick handler ou script externo. validate.ts rejeita → master retorna RENDER_FAILED. Master pode tentar uma vez (retry) mas não infinito (budget).

---

## Apêndice: dependências entre Spec #4 e #5

Spec #5 (Integração E2E) consome diretamente o que esta spec entrega:

- AIOS Master, ao detectar attachment xlsx + pergunta com intent de visualização, **automaticamente** orquestra parse_file → query_parsed_file → render_dashboard sem o user precisar pedir explicitamente "gera dashboard". Refinamento do system prompt + heurística de intent detection.
- Possível tool `system:summarize_artifact` que abre o HTML standalone, extrai data, devolve sumário em texto pra master falar sobre o conteúdo (cobertura conversational do artifact).
- "Lista meus dashboards desta conversa" via tool `system:list_artifacts({conversation_id})`.

Esta spec NÃO precisa antecipar essas integrações. Os contratos definidos aqui (artifacts table + 2 tools + data:render skill + /artifacts/:id/view endpoint) são suficientes pra Spec #5 plug-in.
