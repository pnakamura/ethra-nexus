# Output Worker + HTML Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o user no `/copilot` peça dashboards visuais ("gera dashboard com top 10 vendedores") e receba um link clicável que abre HTML standalone com chart.js. Implementa o agente seed `output-worker` + 2 tools (`system:query_parsed_file`, `system:render_dashboard`) + skill `data:render` + tabela `artifacts` + endpoint `/artifacts/:id/view` com CSP estrita.

**Architecture:** Tool `query_parsed_file` é dispatcher fino server-side (sem LLM, fatia `parsed_files.structured_json` cacheado pela Spec #3). Tool `render_dashboard` é wrapper que delega via `executeTask` pro output-worker. Skill `data:render` é onde Sonnet 4.6 escreve o HTML inline com chart.js — passa por sanitização (escape data) + validação (regex CSP-safe) + storage driver write + INSERT em tabela `artifacts` separada de `files`. Endpoint `/artifacts/:id/view` serve com CSP estrita (`default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'none'`) em nova tab.

**Tech Stack:** TypeScript strict, Node 20, Fastify 5, Drizzle ORM (Postgres), Vitest 1.6, Anthropic SDK Tool Use API, chart.js 4 via jsdelivr CDN, sha256 streaming via `crypto.createHash`. Reusa patterns das Specs #1+#2+#3 (storage driver, executeTask delegation, ToolContext, copilot tool registry).

**Spec:** [docs/superpowers/specs/2026-05-04-output-worker-and-html-dashboard.md](../specs/2026-05-04-output-worker-and-html-dashboard.md)

**Decisões aprovadas:** Q1 LLM-generated artifact · Q2 structured field selectors · Q3 tabela `artifacts` separada · Q4 same-origin + CSP estrita + nova tab · Q5 `data: Record<string, unknown>` arbitrário · Q6 stateless re-render.

---

## File structure (criada por este plano)

```
infra/supabase/migrations/
└── 025_artifacts_and_output_worker.sql            ← Task 1

packages/db/src/schema/
├── artifacts.ts                                   ← Task 2 (criar)
└── index.ts                                       ← Task 2 (modify: export parsing)

packages/agents/src/lib/render/                    ← novo subdir
├── sanitize.ts                                    ← Task 3 (criar)
├── validate.ts                                    ← Task 3 (criar)
├── prompt.ts                                      ← Task 4 (criar)
├── index.ts                                       ← Task 4 (criar barrel)
└── __tests__/
    ├── sanitize.test.ts                           ← Task 3
    └── validate.test.ts                           ← Task 3

packages/agents/src/lib/skills/
└── skill-executor.ts                              ← Task 5 (modify: extend SkillOutput, add executeDataRender)

packages/agents/src/lib/skills/__tests__/
└── data-render.test.ts                            ← Task 6 (criar — 7 cases)

packages/agents/src/lib/copilot/tools/
├── query-parsed-file.ts                           ← Task 7 (criar — 12ª tool)
├── render-dashboard.ts                            ← Task 9 (criar — 13ª tool)
├── index.ts                                       ← Task 11 (modify: register both)
└── __tests__/
    ├── query-parsed-file.test.ts                  ← Task 7
    └── render-dashboard.test.ts                   ← Task 9

packages/agents/src/lib/copilot/
├── tool-registry.ts                               ← Task 8 (modify: add conversation_id to ToolContext)
├── turn-loop.ts                                   ← Task 8 (modify: pass conversation_id when building ctx)
└── system-prompt.ts                               ← Task 11 (modify: §"Geração de dashboards")

packages/agents/src/lib/storage/
└── cleanup-artifacts.ts                           ← Task 11 (criar — daily cron helper, mirror cleanup.ts pattern)

packages/core/src/types/
└── agent.types.ts                                 ← Task 5 (modify: add 'data:render' to BuiltinSkillId)

apps/server/src/routes/
└── artifacts.ts                                   ← Task 10 (criar)

apps/server/src/__tests__/
└── artifacts-routes.test.ts                       ← Task 10

apps/server/src/app.ts                             ← Task 10 (modify: register artifacts routes)
```

---

## Ordering & dependencies

Tasks 1-2 (DB foundation) destravam tudo. Tasks 3-4 (render module) são pure functions, sem deps de DB/storage — podem ir após 2. Task 5-6 (data:render skill) precisa Tasks 1-4 prontas. Task 7 (query_parsed_file) só precisa Tasks 1-2 + Spec #3 schema (já existe). Task 8 (ToolContext) é independente, mas Task 9 (render_dashboard) precisa Task 8 + Tasks 5-6 prontas. Task 10 (artifacts route) precisa Tasks 1-2. Task 11 (system prompt + tool registration + cleanup cron) é último antes do smoke. Task 12 é manual smoke E2E final.

Em modo **subagent-driven**, dispachar uma task por subagent na ordem listada. Tasks paralelizáveis estão notadas mas implementar em série pra evitar conflitos de git.

---

## Task 1: Migration 025 SQL — artifacts table + seed output-worker

**Files:**
- Create: `infra/supabase/migrations/025_artifacts_and_output_worker.sql`

- [ ] **Step 1: Write migration SQL**

Create `infra/supabase/migrations/025_artifacts_and_output_worker.sql` with **exactly** this content:

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

Você NÃO interpreta dados nem responde ao usuário direto. Apenas renderiza.
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

- [ ] **Step 2: Sanity check the file**

Run from repo root:

```bash
wc -l infra/supabase/migrations/025_artifacts_and_output_worker.sql
grep -c "artifacts\|output-worker\|data:render\|copilot_conversations\|parsed_files" infra/supabase/migrations/025_artifacts_and_output_worker.sql
```

Expected: ~80 lines. Grep should find all 5 strings (>= 5 hits).

- [ ] **Step 3: Apply migration to dev DB (if available) and verify**

Skip on Windows/pCloud env (no local Postgres). Production application happens in Task 12 smoke test.

- [ ] **Step 4: Commit**

```bash
git add infra/supabase/migrations/025_artifacts_and_output_worker.sql
git commit -m "feat(db): migration 025 — artifacts table + seed output-worker"
```

---

## Task 2: Drizzle schema — artifacts

**Files:**
- Create: `packages/db/src/schema/artifacts.ts`
- Modify: `packages/db/src/schema/index.ts` (export artifacts)

- [ ] **Step 1: Create `packages/db/src/schema/artifacts.ts`**

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

- [ ] **Step 2: Export from `packages/db/src/schema/index.ts`**

Read `packages/db/src/schema/index.ts` to see existing exports. Add at the end (after the `export * from './parsing'` line that Spec #3 added):

```typescript
export * from './artifacts'
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx turbo run typecheck --filter=@ethra-nexus/db
```

Expected: `Tasks: 1 successful, 1 total` with no errors. The `copilotConversations` import already exists in `core.ts` (Spec #1 schema).

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/artifacts.ts packages/db/src/schema/index.ts
git commit -m "feat(db): drizzle schema for artifacts (Spec #4)"
```

---

## Task 3: Render module — sanitize + validate

**Files:**
- Create: `packages/agents/src/lib/render/sanitize.ts`
- Create: `packages/agents/src/lib/render/validate.ts`
- Test: `packages/agents/src/lib/render/__tests__/sanitize.test.ts`
- Test: `packages/agents/src/lib/render/__tests__/validate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/agents/src/lib/render/__tests__/sanitize.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { sanitizeDataForRenderPrompt } from '../sanitize'

describe('sanitizeDataForRenderPrompt', () => {
  it('escapes HTML special chars in strings', () => {
    expect(sanitizeDataForRenderPrompt('<script>alert("xss")</script>'))
      .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
  })

  it('preserves non-string primitives', () => {
    expect(sanitizeDataForRenderPrompt(42)).toBe(42)
    expect(sanitizeDataForRenderPrompt(true)).toBe(true)
    expect(sanitizeDataForRenderPrompt(null)).toBe(null)
    expect(sanitizeDataForRenderPrompt(undefined)).toBe(undefined)
  })

  it('recurses into arrays', () => {
    expect(sanitizeDataForRenderPrompt(['<a>', 'b&', 'c']))
      .toEqual(['&lt;a&gt;', 'b&amp;', 'c'])
  })

  it('recurses into nested objects', () => {
    expect(sanitizeDataForRenderPrompt({
      name: '<b>Bold</b>',
      meta: { tag: 'a&b', count: 5 },
      list: ['<item>', 42],
    })).toEqual({
      name: '&lt;b&gt;Bold&lt;/b&gt;',
      meta: { tag: 'a&amp;b', count: 5 },
      list: ['&lt;item&gt;', 42],
    })
  })
})
```

Create `packages/agents/src/lib/render/__tests__/validate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { validateArtifactHtml } from '../validate'

describe('validateArtifactHtml', () => {
  it('accepts valid HTML with inline script', () => {
    const html = '<!DOCTYPE html><html><body><script>console.log("hi")</script></body></html>'
    expect(validateArtifactHtml(html)).toEqual({ ok: true })
  })

  it('accepts script src from cdn.jsdelivr.net (https)', () => {
    const html = '<!DOCTYPE html><html><head><script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script></head><body></body></html>'
    expect(validateArtifactHtml(html)).toEqual({ ok: true })
  })

  it('rejects HTML > 50KB', () => {
    const big = 'x'.repeat(51 * 1024)
    const html = `<!DOCTYPE html><html><body>${big}</body></html>`
    const r = validateArtifactHtml(html)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/50KB|exceeds/)
  })

  it('rejects inline event handler (onclick=)', () => {
    const html = '<!DOCTYPE html><html><body><button onclick="x()">go</button></body></html>'
    const r = validateArtifactHtml(html)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/event handler|on\*=/)
  })

  it('rejects inline event handler (onerror=)', () => {
    const html = '<!DOCTYPE html><html><body><img src="x" onerror="x()"></body></html>'
    const r = validateArtifactHtml(html)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/event handler|on\*=/)
  })

  it('rejects javascript: URL', () => {
    const html = '<!DOCTYPE html><html><body><a href="javascript:alert(1)">x</a></body></html>'
    const r = validateArtifactHtml(html)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/javascript:/)
  })

  it('rejects script src http:// (non-https)', () => {
    const html = '<!DOCTYPE html><html><head><script src="http://evil.com/x.js"></script></head></html>'
    const r = validateArtifactHtml(html)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/non-https/)
  })

  it('rejects script src from non-whitelisted host', () => {
    const html = '<!DOCTYPE html><html><head><script src="https://evil.com/x.js"></script></head></html>'
    const r = validateArtifactHtml(html)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/whitelisted|evil/)
  })

  it('rejects iframe with data: URL src', () => {
    const html = '<!DOCTYPE html><html><body><iframe src="data:text/html,<script>x()</script>"></iframe></body></html>'
    const r = validateArtifactHtml(html)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/data: URL in iframe/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test -- src/lib/render/__tests__/
```

Expected: FAIL — modules `../sanitize` and `../validate` don't exist.

- [ ] **Step 3: Implement `sanitize.ts`**

Create `packages/agents/src/lib/render/sanitize.ts`:

```typescript
// Escape HTML special chars in any string found within the structure.
// Used before passing user-controlled data (e.g. xlsx cell values) into
// the render prompt to mitigate prompt-injection that turns into XSS.

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

- [ ] **Step 4: Implement `validate.ts`**

Create `packages/agents/src/lib/render/validate.ts`:

```typescript
// CSP-safe HTML validator for artifact output (Spec #4).
// Runs after Sonnet generates the HTML, before storage write.
// Belt + suspenders with the CSP headers on /artifacts/:id/view.

const MAX_HTML_BYTES = 50 * 1024
const ALLOWED_SCRIPT_HOSTS: ReadonlySet<string> = new Set(['cdn.jsdelivr.net'])

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string }

export function validateArtifactHtml(html: string): ValidationResult {
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    return { ok: false, reason: 'html exceeds 50KB' }
  }

  // Inline event handlers: onclick=, onerror=, onload=, etc.
  if (/<[^>]+\s+on[a-z]+\s*=/i.test(html)) {
    return { ok: false, reason: 'inline event handler detected (on*=)' }
  }

  // javascript: pseudo-URLs in href/src/action
  if (/javascript:/i.test(html)) {
    return { ok: false, reason: 'javascript: URL detected' }
  }

  // data: URLs are dangerous in iframe/object/embed (allowed in img/font for charts)
  if (/<(iframe|object|embed)[^>]+src\s*=\s*["']data:/i.test(html)) {
    return { ok: false, reason: 'data: URL in iframe/object/embed' }
  }

  // External scripts: only HTTPS + whitelisted host
  const scriptSrcs = [...html.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi)]
  for (const m of scriptSrcs) {
    const url = m[1]!
    if (url.startsWith('//') || url.startsWith('http:')) {
      return { ok: false, reason: `non-https script src: ${url}` }
    }
    if (url.startsWith('http')) {
      try {
        const u = new URL(url)
        if (u.protocol !== 'https:') {
          return { ok: false, reason: `non-https script src: ${url}` }
        }
        if (!ALLOWED_SCRIPT_HOSTS.has(u.hostname)) {
          return { ok: false, reason: `script host not whitelisted: ${u.hostname}` }
        }
      } catch {
        return { ok: false, reason: `invalid script src URL: ${url}` }
      }
    }
    // Relative URLs (no protocol) are allowed — same-origin
  }

  return { ok: true }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test -- src/lib/render/__tests__/
```

Expected: PASS — 13 cases (4 sanitize + 9 validate).

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/lib/render/sanitize.ts packages/agents/src/lib/render/validate.ts packages/agents/src/lib/render/__tests__/
git commit -m "feat(render): sanitize + validate primitives for HTML artifacts"
```

---

## Task 4: Render module — prompt template + barrel

**Files:**
- Create: `packages/agents/src/lib/render/prompt.ts`
- Create: `packages/agents/src/lib/render/index.ts`

- [ ] **Step 1: Create `prompt.ts`**

Create `packages/agents/src/lib/render/prompt.ts`:

```typescript
// Render system prompt for the data:render skill.
// Sonnet 4.6 receives this + the user-supplied {title, prompt, data}.
// Output must comply with validateArtifactHtml() rules.

export const RENDER_SYSTEM_PROMPT = `Você é o Output Worker do Ethra Nexus, especialista em gerar dashboards HTML standalone a partir de dados estruturados.

## Regras de output (OBRIGATÓRIAS)

1. Produza UM ÚNICO bloco HTML completo, começando com \`<!DOCTYPE html>\` e terminando com \`</html>\`. Sem texto fora do bloco.
2. Inclua chart.js exatamente assim: \`<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>\`. Nenhuma outra CDN é permitida.
3. ZERO \`fetch()\`, \`XMLHttpRequest\`, \`WebSocket\`, ou qualquer chamada de rede no script — a CSP bloqueia.
4. ZERO event handlers inline (\`onclick=\`, \`onerror=\`, \`onload=\` etc.). Use \`addEventListener\` se precisar.
5. ZERO URLs \`javascript:\`. ZERO \`<iframe>\`, \`<object>\`, \`<embed>\`.
6. Charts em \`<canvas>\` com Chart.js. Dados embutidos como JSON inline:
   \`\`\`html
   <script>
     const data = { /* JSON data inline */ };
     new Chart(document.getElementById('c1'), { type: 'bar', data: { ... } });
   </script>
   \`\`\`
7. Tamanho máximo do HTML final: 50KB. Seja conciso — sem CSS gigantesco, sem múltiplas fontes.
8. Estilo: profissional, mobile-friendly, contraste WCAG AA. Use CSS inline ou \`<style>\` interno.
9. Título da página = título do dashboard (vem em \`title\` no input).

## Anatomia do dashboard

- \`<header>\` com o título e (opcional) subtítulo descrevendo a fonte dos dados.
- 1-3 visualizações principais (bar/line/pizza/horizontal-bar conforme apropriado).
- \`<table>\` com os dados subjacentes se útil (top-N tipicamente).
- Footer pequeno com timestamp \`new Date().toLocaleString('pt-BR')\`.

## O que VOCÊ NÃO faz

- NÃO comente ou explique o output. Só HTML, nada antes ou depois.
- NÃO inclua links externos exceto chart.js da jsdelivr.
- NÃO faça side-channel via window.opener, postMessage, etc. — a CSP bloqueia.
- NÃO assuma que os dados são "limpos" — use exatamente o que vem no input.
`
```

- [ ] **Step 2: Create barrel `index.ts`**

Create `packages/agents/src/lib/render/index.ts`:

```typescript
export { sanitizeDataForRenderPrompt } from './sanitize'
export { validateArtifactHtml, type ValidationResult } from './validate'
export { RENDER_SYSTEM_PROMPT } from './prompt'
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx turbo run typecheck --filter=@ethra-nexus/agents 2>&1 | grep -c "error TS"
```

Expected: same as baseline pre-Spec#4 count (Windows pre-existing workspace symlink issues only).

- [ ] **Step 4: Commit**

```bash
git add packages/agents/src/lib/render/prompt.ts packages/agents/src/lib/render/index.ts
git commit -m "feat(render): system prompt template + barrel exports"
```

---

## Task 5: Extend SkillOutput + add `data:render` skill case

**Files:**
- Modify: `packages/core/src/types/agent.types.ts` (add `'data:render'` to BuiltinSkillId)
- Modify: `packages/agents/src/lib/skills/skill-executor.ts` (extend SkillOutput, add executeDataRender)

The `data:render` skill must be:
1. Recognized as a `BuiltinSkillId` (TypeScript narrowing).
2. Handled by `executeSkill` dispatcher.
3. Produces a `SkillOutput` with new optional fields `artifact_id`, `download_url`, `title`.

- [ ] **Step 1: Add `'data:render'` to `BuiltinSkillId`**

Read `packages/core/src/types/agent.types.ts` to locate the `BuiltinSkillId` union (around line 50-62). Add `'data:render'` after `'data:extract'`:

```typescript
export type BuiltinSkillId =
  | 'wiki:query'
  | 'wiki:ingest'
  | 'wiki:lint'
  | 'channel:respond'
  | 'channel:proactive'
  | 'report:generate'
  | 'monitor:health'
  | 'monitor:alert'
  | 'data:analyze'
  | 'data:extract'
  | 'data:render'        // ← NEW (Spec #4)
  | 'a2a:call'
```

- [ ] **Step 2: Rebuild core**

```bash
npx turbo run build --filter=@ethra-nexus/core
```

Expected: success.

- [ ] **Step 3: Extend `SkillOutput` interface in skill-executor.ts**

Read `packages/agents/src/lib/skills/skill-executor.ts` to locate the `SkillOutput` interface (around line 23-38). Replace with:

```typescript
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
```

- [ ] **Step 4: Add new imports to skill-executor.ts**

At the top of `skill-executor.ts`, add:

```typescript
import { artifacts } from '@ethra-nexus/db'  // ← merge with existing { getDb, files, parsedFiles, externalAgents }
import { randomUUID, createHash } from 'node:crypto'
import {
  sanitizeDataForRenderPrompt,
  validateArtifactHtml,
  RENDER_SYSTEM_PROMPT,
} from '../render'
```

The existing import line for `@ethra-nexus/db` (Spec #3) currently imports `getDb, files, parsedFiles, externalAgents`. Update it to include `artifacts`:

```typescript
import { getDb, files, parsedFiles, externalAgents, artifacts } from '@ethra-nexus/db'
```

- [ ] **Step 5: Add dispatcher case**

In `executeSkill` function (around line 60-100), add after the `data:extract` case:

```typescript
  if (skill_id === 'data:render') {
    return executeDataRender(skill_id, context, input, ts)
  }
```

- [ ] **Step 6: Implement `executeDataRender`**

Add this function near the other `execute*` functions in `skill-executor.ts` (after `executeDataExtract`):

```typescript
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
```

- [ ] **Step 7: Verify typecheck**

```bash
npx turbo run typecheck --filter=@ethra-nexus/agents 2>&1 | grep -c "error TS"
```

Expected: same as baseline pre-task (workspace symlink errors don't change).

- [ ] **Step 8: Run existing agents test suite to ensure no regressions**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test 2>&1 | tail -10
```

Expected: full suite still green (Spec #3 test count or higher; no NEW failures from extending SkillOutput).

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/types/agent.types.ts packages/agents/src/lib/skills/skill-executor.ts
git commit -m "$(cat <<'EOF'
feat(skills): add data:render — Sonnet generates HTML artifact

- Extend BuiltinSkillId with 'data:render'.
- Extend SkillOutput with artifact_id/download_url/title/size_bytes.
- Implement executeDataRender: validate input → sanitize data → Anthropic call →
  extract HTML → validateArtifactHtml → driver.put → INSERT artifacts.
- 7-stage pipeline with rollback on failure (delete orphaned bytes if INSERT fails).
EOF
)"
```

---

## Task 6: data-render.test.ts (full coverage)

**Files:**
- Test: `packages/agents/src/lib/skills/__tests__/data-render.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/agents/src/lib/skills/__tests__/data-render.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const filesSelectMock = vi.fn()
const parsedSelectMock = vi.fn()
const artifactsInsertMock = vi.fn()

const mockDb = {
  select: vi.fn((cols?: unknown) => ({
    from: () => ({
      where: () => ({ limit: () => filesSelectMock() }),
    }),
  })),
  insert: vi.fn(() => ({
    values: (_v: unknown) => artifactsInsertMock(),
  })),
}

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => mockDb,
  files: { _: { name: 'files' } },
  parsedFiles: { _: { name: 'parsed_files' } },
  externalAgents: { _: { name: 'external_agents' } },
  artifacts: { _: { name: 'artifacts' } },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ eq: { c, v } })),
  and: vi.fn((...c) => ({ and: c })),
  sql: vi.fn((parts, ...vals) => ({ sql: { parts, vals } })),
}))

const driverPutMock = vi.fn()
const driverDeleteMock = vi.fn()
vi.mock('../../storage', () => ({
  createStorageDriver: () => ({
    put: driverPutMock,
    delete: driverDeleteMock,
    get: vi.fn(),
    getDownloadUrl: vi.fn(),
  }),
}))

const completionMock = vi.fn()
vi.mock('../../provider', () => ({
  createRegistryFromEnv: () => ({ complete: completionMock }),
}))

const { executeSkill } = await import('../skill-executor')

const ctx = {
  tenant_id: '11111111-1111-1111-1111-111111111111',
  agent_id: '22222222-2222-2222-2222-222222222222',
  session_id: 'evt-1',
  wiki_scope: 'agent-output-worker',
  timestamp: '2026-05-04T00:00:00Z',
  budget_remaining_usd: 10,
  tokens_remaining: 1000000,
}
const stubAgent = { system_prompt: '', model: 'claude-sonnet-4-6' }
const VALID_CONV_ID = '33333333-3333-3333-3333-333333333333'

const VALID_HTML = '<!DOCTYPE html><html><body><h1>Title</h1><script>console.log(1)</script></body></html>'
const VALID_RESPONSE = {
  content: VALID_HTML,
  input_tokens: 1000,
  output_tokens: 500,
  estimated_cost_usd: 0.012,
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  is_fallback: false,
}

beforeEach(() => {
  filesSelectMock.mockReset()
  parsedSelectMock.mockReset()
  artifactsInsertMock.mockReset()
  driverPutMock.mockReset()
  driverDeleteMock.mockReset()
  completionMock.mockReset()
})

describe('data:render', () => {
  it('returns INVALID_INPUT when title is missing', async () => {
    const r = await executeSkill('data:render', ctx, {
      title: '', prompt: 'test', data: { x: 1 }, conversation_id: VALID_CONV_ID,
    }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT')
  })

  it('returns INVALID_INPUT when data exceeds 100KB', async () => {
    const big = { rows: 'x'.repeat(101 * 1024) }
    const r = await executeSkill('data:render', ctx, {
      title: 'T', prompt: 'p', data: big, conversation_id: VALID_CONV_ID,
    }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT')
  })

  it('returns INVALID_INPUT when conversation_id is missing', async () => {
    const r = await executeSkill('data:render', ctx, {
      title: 'T', prompt: 'p', data: { x: 1 },
    }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT')
  })

  it('returns AI_ERROR when Anthropic call throws', async () => {
    completionMock.mockRejectedValueOnce(new Error('timeout'))
    const r = await executeSkill('data:render', ctx, {
      title: 'T', prompt: 'p', data: { x: 1 }, conversation_id: VALID_CONV_ID,
    }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('AI_ERROR')
  })

  it('returns RENDER_FAILED when response has no html', async () => {
    completionMock.mockResolvedValueOnce({ ...VALID_RESPONSE, content: 'just plain text, no doctype' })
    const r = await executeSkill('data:render', ctx, {
      title: 'T', prompt: 'p', data: { x: 1 }, conversation_id: VALID_CONV_ID,
    }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('RENDER_FAILED')
      expect(r.error.message).toMatch(/no html/)
    }
  })

  it('returns RENDER_FAILED when validateArtifactHtml rejects (e.g. inline onclick)', async () => {
    const badHtml = '<!DOCTYPE html><html><body><button onclick="x()">go</button></body></html>'
    completionMock.mockResolvedValueOnce({ ...VALID_RESPONSE, content: badHtml })
    const r = await executeSkill('data:render', ctx, {
      title: 'T', prompt: 'p', data: { x: 1 }, conversation_id: VALID_CONV_ID,
    }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('RENDER_FAILED')
      expect(r.error.message).toMatch(/event handler/)
    }
  })

  it('writes via driver + INSERTs artifact + returns artifact_id on success', async () => {
    completionMock.mockResolvedValueOnce(VALID_RESPONSE)
    driverPutMock.mockResolvedValueOnce({
      storage_key: 'tenant-1/artifacts/abc',
      size_bytes: 105,
      sha256: 'a'.repeat(64),
    })
    artifactsInsertMock.mockResolvedValueOnce(undefined)

    const r = await executeSkill('data:render', ctx, {
      title: 'Top 10 Vendedores',
      prompt: 'gera dashboard',
      data: { rows: [{ name: 'a', value: 1 }] },
      conversation_id: VALID_CONV_ID,
    }, stubAgent)

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.artifact_id).toMatch(/^[0-9a-f-]{36}$/)
      expect(r.data.download_url).toMatch(/^\/api\/v1\/artifacts\/[0-9a-f-]{36}\/view$/)
      expect(r.data.title).toBe('Top 10 Vendedores')
      expect(r.data.cost_usd).toBe(0.012)
      expect(r.data.provider).toBe('anthropic')
    }
    expect(driverPutMock).toHaveBeenCalledTimes(1)
    expect(artifactsInsertMock).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test -- src/lib/skills/__tests__/data-render.test.ts 2>&1 | tail -10
```

Expected: PASS — 7 cases.

- [ ] **Step 3: Run full agents suite**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test 2>&1 | tail -5
```

Expected: full suite green.

- [ ] **Step 4: Commit**

```bash
git add packages/agents/src/lib/skills/__tests__/data-render.test.ts
git commit -m "test(skills): cover data:render success + 6 error paths (7 cases)"
```

---

## Task 7: `system:query_parsed_file` tool

**Files:**
- Create: `packages/agents/src/lib/copilot/tools/query-parsed-file.ts`
- Test: `packages/agents/src/lib/copilot/tools/__tests__/query-parsed-file.test.ts`

The tool reads `parsed_files.structured_json` (from Spec #3) and applies field selectors server-side. No LLM call.

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/lib/copilot/tools/__tests__/query-parsed-file.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const parsedSelectMock = vi.fn()

const mockDb = {
  select: vi.fn(() => ({
    from: () => ({
      where: () => ({ limit: () => parsedSelectMock() }),
    }),
  })),
}

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => mockDb,
  parsedFiles: { _: { name: 'parsed_files' } },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ eq: { c, v } })),
  and: vi.fn((...c) => ({ and: c })),
}))

const { queryParsedFileTool } = await import('../query-parsed-file')

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const, conversation_id: 'c1' }
const VALID = '33333333-3333-3333-3333-333333333333'

const xlsxStructured = {
  type: 'xlsx',
  sheets: [
    {
      name: 'Vendas',
      rows: [
        ['Vendedor', 'Estado', 'Vendas Q2'],
        ['Alice',    'SP',     1500],
        ['Bob',      'RJ',     1200],
        ['Carol',    'SP',      900],
        ['Dave',     'SP',     2000],
      ],
      total_rows: 5,
      total_cols: 3,
    },
  ],
}

beforeEach(() => {
  parsedSelectMock.mockReset()
})

describe('query_parsed_file tool', () => {
  it('throws on invalid parsed_id', async () => {
    await expect(queryParsedFileTool.handler({ parsed_id: 'not-uuid' }, ctx))
      .rejects.toThrow(/INVALID_PARSED_ID/)
  })

  it('throws PARSED_FILE_NOT_FOUND when row missing', async () => {
    parsedSelectMock.mockResolvedValueOnce([])
    await expect(queryParsedFileTool.handler({ parsed_id: VALID }, ctx))
      .rejects.toThrow(/PARSED_FILE_NOT_FOUND/)
  })

  it('returns xlsx rows with default first sheet, no projection', async () => {
    parsedSelectMock.mockResolvedValueOnce([{ format: 'xlsx', structured_json: xlsxStructured }])
    const out = await queryParsedFileTool.handler({ parsed_id: VALID }, ctx)
    expect(out.format).toBe('xlsx')
    expect(out.sheet).toBe('Vendas')
    expect(out.total_rows_in_source).toBe(4)  // exclui header
    expect(out.rows).toHaveLength(4)
    expect(out.rows[0]).toEqual({ Vendedor: 'Alice', Estado: 'SP', 'Vendas Q2': 1500 })
  })

  it('applies filter (single-key equality)', async () => {
    parsedSelectMock.mockResolvedValueOnce([{ format: 'xlsx', structured_json: xlsxStructured }])
    const out = await queryParsedFileTool.handler({
      parsed_id: VALID, sheet: 'Vendas', filter: { Estado: 'SP' },
    }, ctx)
    expect(out.rows).toHaveLength(3)  // Alice, Carol, Dave
    expect(out.rows.every((r: Record<string, unknown>) => r.Estado === 'SP')).toBe(true)
  })

  it('applies sort desc and limit', async () => {
    parsedSelectMock.mockResolvedValueOnce([{ format: 'xlsx', structured_json: xlsxStructured }])
    const out = await queryParsedFileTool.handler({
      parsed_id: VALID, sort: '-Vendas Q2', limit: 2,
    }, ctx)
    expect(out.rows).toHaveLength(2)
    expect(out.rows[0]?.Vendedor).toBe('Dave')   // 2000
    expect(out.rows[1]?.Vendedor).toBe('Alice')  // 1500
    expect(out.truncated).toBe(true)
  })

  it('applies columns projection', async () => {
    parsedSelectMock.mockResolvedValueOnce([{ format: 'xlsx', structured_json: xlsxStructured }])
    const out = await queryParsedFileTool.handler({
      parsed_id: VALID, columns: ['Vendedor', 'Vendas Q2'],
    }, ctx)
    expect(Object.keys(out.rows[0] ?? {})).toEqual(['Vendedor', 'Vendas Q2'])
  })

  it('caps limit at 500 max', async () => {
    parsedSelectMock.mockResolvedValueOnce([{ format: 'xlsx', structured_json: xlsxStructured }])
    const out = await queryParsedFileTool.handler({
      parsed_id: VALID, limit: 999,
    }, ctx)
    expect(out.rows.length).toBeLessThanOrEqual(500)
  })

  it('handles csv format with headers + rows', async () => {
    parsedSelectMock.mockResolvedValueOnce([{
      format: 'csv',
      structured_json: {
        type: 'csv',
        headers: ['name', 'qty'],
        rows: [['Apple', '5'], ['Banana', '3']],
      },
    }])
    const out = await queryParsedFileTool.handler({ parsed_id: VALID }, ctx)
    expect(out.format).toBe('csv')
    expect(out.rows).toEqual([
      { name: 'Apple', qty: '5' },
      { name: 'Banana', qty: '3' },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test -- src/lib/copilot/tools/__tests__/query-parsed-file.test.ts
```

Expected: FAIL — module `../query-parsed-file` doesn't exist.

- [ ] **Step 3: Implement `query-parsed-file.ts`**

Create `packages/agents/src/lib/copilot/tools/query-parsed-file.ts`:

```typescript
import { eq, and } from 'drizzle-orm'
import { getDb, parsedFiles } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HARD_MAX_LIMIT = 500
const DEFAULT_LIMIT = 100

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
    'Fatia dados de um arquivo já parseado (parsed_id de system:parse_file).',
    'Use quando precisar de subset específico — ex: "top 10 por vendas",',
    '"linhas onde estado=SP". Sem LLM call, é rápido e barato.',
    '',
    'Args:',
    '- parsed_id (UUID, obrigatório): id retornado por parse_file',
    '- sheet (opcional, xlsx): nome da aba; default = primeira',
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
      limit: { type: 'number', minimum: 1, maximum: 500 },
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

    // Apply column projection
    if (input.columns && input.columns.length > 0) {
      const cols = input.columns
      sliced = sliced.map(r => {
        const proj: Record<string, unknown> = {}
        for (const c of cols) proj[c] = r[c]
        return proj
      })
    }

    return {
      parsed_id: input.parsed_id,
      format,
      ...(sheetName ? { sheet: sheetName } : {}),
      total_rows_in_source: totalAfterFilter,
      rows: sliced,
      truncated: offset + sliced.length < totalAfterFilter,
    }
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test -- src/lib/copilot/tools/__tests__/query-parsed-file.test.ts
```

Expected: PASS — 8 cases.

- [ ] **Step 5: Run full agents suite**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test 2>&1 | tail -5
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/lib/copilot/tools/query-parsed-file.ts packages/agents/src/lib/copilot/tools/__tests__/query-parsed-file.test.ts
git commit -m "feat(copilot): system:query_parsed_file tool with field selectors"
```

---

## Task 8: ToolContext extension — add `conversation_id`

**Files:**
- Modify: `packages/agents/src/lib/copilot/tool-registry.ts`
- Modify: `packages/agents/src/lib/copilot/turn-loop.ts`

`render_dashboard` tool (Task 9) needs `conversation_id` in its handler context. The turn-loop already has `p.conversation_id`; we just need to add it to `ToolContext` interface and pass it when constructing the context.

- [ ] **Step 1: Modify `tool-registry.ts`**

Read `packages/agents/src/lib/copilot/tool-registry.ts`. Locate the `ToolContext` interface (around line 4-8). Add `conversation_id`:

```typescript
export interface ToolContext {
  tenant_id: string
  user_id: string
  user_role: 'admin' | 'member'
  conversation_id: string  // ← NEW (Spec #4) — needed by render_dashboard
}
```

- [ ] **Step 2: Modify `turn-loop.ts`**

Read `packages/agents/src/lib/copilot/turn-loop.ts`. Locate the line that constructs `ctx: ToolContext` (around line 131):

```typescript
const ctx: ToolContext = { tenant_id: p.tenant_id, user_id: p.user_id, user_role: p.user_role }
```

Replace with:

```typescript
const ctx: ToolContext = {
  tenant_id: p.tenant_id,
  user_id: p.user_id,
  user_role: p.user_role,
  conversation_id: p.conversation_id,
}
```

(`p.conversation_id` already exists on the `ExecuteCopilotTurnParams` interface at line 31.)

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx turbo run typecheck --filter=@ethra-nexus/agents 2>&1 | grep -c "error TS"
```

Expected: same baseline count (no NEW errors).

- [ ] **Step 4: Run agents test suite**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test 2>&1 | tail -5
```

Expected: full suite green. Existing tools (10 from Spec #1+#2+#3) don't read `conversation_id` so they're unaffected.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/lib/copilot/tool-registry.ts packages/agents/src/lib/copilot/turn-loop.ts
git commit -m "feat(copilot): add conversation_id to ToolContext (prep for render_dashboard)"
```

---

## Task 9: `system:render_dashboard` tool

**Files:**
- Create: `packages/agents/src/lib/copilot/tools/render-dashboard.ts`
- Test: `packages/agents/src/lib/copilot/tools/__tests__/render-dashboard.test.ts`

Tool is wrapper that delegates via `executeTask` to the output-worker agent's `data:render` skill.

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/lib/copilot/tools/__tests__/render-dashboard.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const agentSelectMock = vi.fn()
const mockDb = {
  select: vi.fn(() => ({
    from: () => ({
      where: () => ({ limit: () => agentSelectMock() }),
    }),
  })),
}
vi.mock('@ethra-nexus/db', () => ({
  getDb: () => mockDb,
  agents: { _: { name: 'agents' }, id: 'agents.id', tenant_id: 'agents.tenant_id', slug: 'agents.slug' },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ eq: { c, v } })),
  and: vi.fn((...c) => ({ and: c })),
}))

const executeTaskMock = vi.fn()
vi.mock('../../../aios/aios-master', () => ({
  executeTask: executeTaskMock,
  __esModule: true,
}))

const { renderDashboardTool } = await import('../render-dashboard')

const ctx = {
  tenant_id: 'tenant-1', user_id: 'user-1', user_role: 'admin' as const,
  conversation_id: 'conv-1',
}

const validInput = {
  title: 'Top 10 Vendedores',
  prompt: 'gera dashboard',
  data: { rows: [{ name: 'a', qty: 1 }] },
}

beforeEach(() => {
  agentSelectMock.mockReset()
  executeTaskMock.mockReset()
})

describe('render_dashboard tool', () => {
  it('throws on data > 100KB', async () => {
    const big = { rows: 'x'.repeat(101 * 1024) }
    await expect(
      renderDashboardTool.handler({ ...validInput, data: big }, ctx)
    ).rejects.toThrow(/DATA_TOO_LARGE|EXCEEDS|100KB/)
  })

  it('throws on empty title', async () => {
    await expect(
      renderDashboardTool.handler({ ...validInput, title: '' }, ctx)
    ).rejects.toThrow(/INVALID_INPUT|title/)
  })

  it('throws OUTPUT_WORKER_NOT_SEEDED when no agent for tenant', async () => {
    agentSelectMock.mockResolvedValueOnce([])
    await expect(
      renderDashboardTool.handler(validInput, ctx)
    ).rejects.toThrow(/OUTPUT_WORKER_NOT_SEEDED/)
  })

  it('delegates to executeTask with correct args + returns artifact_id', async () => {
    agentSelectMock.mockResolvedValueOnce([{ id: 'ow-agent-1' }])
    executeTaskMock.mockResolvedValueOnce({
      ok: true,
      data: {
        answer: 'Dashboard "T" gerado.',
        artifact_id: 'art-1',
        download_url: '/api/v1/artifacts/art-1/view',
        title: 'Top 10 Vendedores',
        size_bytes: 4096,
        tokens_in: 1000, tokens_out: 500, cost_usd: 0.012,
        provider: 'anthropic', model: 'claude-sonnet-4-6', is_fallback: false,
      },
    })

    const out = await renderDashboardTool.handler(validInput, ctx)
    expect(out).toEqual({
      artifact_id: 'art-1',
      download_url: '/api/v1/artifacts/art-1/view',
      size_bytes: 4096,
      title: 'Top 10 Vendedores',
    })
    expect(executeTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 'tenant-1',
      agent_id: 'ow-agent-1',
      skill_id: 'data:render',
      input: expect.objectContaining({
        title: 'Top 10 Vendedores',
        prompt: 'gera dashboard',
        conversation_id: 'conv-1',
      }),
      activation_mode: 'on_demand',
      activation_source: 'copilot:render_dashboard',
      triggered_by: 'user-1',
    }))
  })

  it('throws RENDER_DASHBOARD_FAILED when executeTask returns ok:false', async () => {
    agentSelectMock.mockResolvedValueOnce([{ id: 'ow-agent-1' }])
    executeTaskMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'AI_ERROR', message: 'timeout', retryable: true },
    })
    await expect(
      renderDashboardTool.handler(validInput, ctx)
    ).rejects.toThrow(/RENDER_DASHBOARD_FAILED.*AI_ERROR/)
  })

  it('passes parsed_id when provided', async () => {
    agentSelectMock.mockResolvedValueOnce([{ id: 'ow-agent-1' }])
    executeTaskMock.mockResolvedValueOnce({
      ok: true,
      data: {
        answer: 'ok', artifact_id: 'a', download_url: '/x', title: 'T', size_bytes: 1,
        tokens_in: 0, tokens_out: 0, cost_usd: 0,
        provider: 'anthropic', model: 'claude-sonnet-4-6', is_fallback: false,
      },
    })

    await renderDashboardTool.handler({
      ...validInput,
      parsed_id: '11111111-1111-1111-1111-111111111111',
    }, ctx)

    expect(executeTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        parsed_id: '11111111-1111-1111-1111-111111111111',
      }),
    }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test -- src/lib/copilot/tools/__tests__/render-dashboard.test.ts
```

Expected: FAIL — module `../render-dashboard` doesn't exist.

- [ ] **Step 3: Implement `render-dashboard.ts`**

Create `packages/agents/src/lib/copilot/tools/render-dashboard.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test -- src/lib/copilot/tools/__tests__/render-dashboard.test.ts
```

Expected: PASS — 6 cases.

- [ ] **Step 5: Run full agents suite**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test 2>&1 | tail -5
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/lib/copilot/tools/render-dashboard.ts packages/agents/src/lib/copilot/tools/__tests__/render-dashboard.test.ts
git commit -m "feat(copilot): system:render_dashboard tool delegating to output-worker"
```

---

## Task 10: Backend `/api/v1/artifacts/:id/view` route

**Files:**
- Create: `apps/server/src/routes/artifacts.ts`
- Modify: `apps/server/src/app.ts` (register routes)
- Test: `apps/server/src/__tests__/artifacts-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/__tests__/artifacts-routes.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'

const dbSelectMock = vi.fn()
const driverGetMock = vi.fn()

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({ limit: () => dbSelectMock() }),
      }),
    })),
  }),
  artifacts: {
    _: { name: 'artifacts' },
    id: 'artifacts.id',
    tenant_id: 'artifacts.tenant_id',
    storage_key: 'artifacts.storage_key',
    mime_type: 'artifacts.mime_type',
    title: 'artifacts.title',
    expires_at: 'artifacts.expires_at',
  },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ eq: { c, v } })),
  and: vi.fn((...c) => ({ and: c })),
}))
vi.mock('@ethra-nexus/agents', async () => {
  const actual = await vi.importActual<typeof import('@ethra-nexus/agents')>('@ethra-nexus/agents')
  return {
    ...actual,
    createStorageDriver: () => ({
      get: driverGetMock,
      put: vi.fn(),
      delete: vi.fn(),
      getDownloadUrl: vi.fn(),
    }),
  }
})

import { artifactsRoutes } from '../routes/artifacts'

beforeEach(() => {
  dbSelectMock.mockReset()
  driverGetMock.mockReset()
})

async function buildApp() {
  const app = Fastify()
  app.decorateRequest('tenantId', null as unknown as string)
  app.addHook('onRequest', async (req) => {
    ;(req as unknown as { tenantId: string }).tenantId = 't1'
  })
  await artifactsRoutes(app)
  return app
}

function makeReadable(buf: Buffer): NodeJS.ReadableStream {
  const { Readable } = require('node:stream') as typeof import('node:stream')
  return Readable.from([buf])
}

describe('GET /artifacts/:id/view', () => {
  it('returns 200 + html content + CSP header on valid request', async () => {
    const future = new Date(Date.now() + 24 * 3600 * 1000)
    dbSelectMock.mockResolvedValueOnce([{
      storage_key: 't1/artifacts/a1', mime_type: 'text/html',
      title: 'Dashboard', expires_at: future,
    }])
    driverGetMock.mockResolvedValueOnce(makeReadable(Buffer.from('<!DOCTYPE html><html></html>')))

    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/artifacts/00000000-0000-0000-0000-000000000001/view',
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/)
    expect(res.headers['content-security-policy']).toMatch(/connect-src 'none'/)
    expect(res.headers['content-disposition']).toMatch(/inline/)
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.body).toContain('<!DOCTYPE html>')
  })

  it('returns 404 ARTIFACT_NOT_FOUND when row missing', async () => {
    dbSelectMock.mockResolvedValueOnce([])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/artifacts/00000000-0000-0000-0000-000000000099/view',
    })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'ARTIFACT_NOT_FOUND' })
  })

  it('returns 410 ARTIFACT_EXPIRED when expires_at is past', async () => {
    const past = new Date(Date.now() - 24 * 3600 * 1000)
    dbSelectMock.mockResolvedValueOnce([{
      storage_key: 't1/artifacts/a1', mime_type: 'text/html',
      title: 'Old', expires_at: past,
    }])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/artifacts/00000000-0000-0000-0000-000000000001/view',
    })
    expect(res.statusCode).toBe(410)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'ARTIFACT_EXPIRED' })
  })

  it('returns 500 STORAGE_ORPHAN when driver.get returns null', async () => {
    const future = new Date(Date.now() + 24 * 3600 * 1000)
    dbSelectMock.mockResolvedValueOnce([{
      storage_key: 't1/artifacts/a1', mime_type: 'text/html',
      title: 'X', expires_at: future,
    }])
    driverGetMock.mockResolvedValueOnce(null)
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/artifacts/00000000-0000-0000-0000-000000000001/view',
    })
    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'STORAGE_ORPHAN' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/server test -- src/__tests__/artifacts-routes.test.ts
```

Expected: FAIL — module `../routes/artifacts` doesn't exist.

(May fail with `Cannot find module 'vitest/config'` on Windows/pCloud — that's the env-blocked case from prior tasks. CI Linux will run.)

- [ ] **Step 3: Implement `apps/server/src/routes/artifacts.ts`**

Create `apps/server/src/routes/artifacts.ts`:

```typescript
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
  app.get<{ Params: { id: string } }>('/artifacts/:id/view', async (request, reply) => {
    const db = getDb()
    const driver = createStorageDriver()

    const rows = await db
      .select({
        storage_key: artifacts.storage_key,
        mime_type: artifacts.mime_type,
        title: artifacts.title,
        expires_at: artifacts.expires_at,
      })
      .from(artifacts)
      .where(and(
        eq(artifacts.id, request.params.id),
        eq(artifacts.tenant_id, request.tenantId),
      ))
      .limit(1)

    const row = rows[0]
    if (!row) return reply.status(404).send({ error: 'ARTIFACT_NOT_FOUND' })
    if (row.expires_at < new Date()) {
      return reply.status(410).send({ error: 'ARTIFACT_EXPIRED', message: 'Artifact has expired' })
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

- [ ] **Step 4: Register routes in `apps/server/src/app.ts`**

Read `apps/server/src/app.ts`. Find the section where routes are registered (look for `app.register(filesRoutes` or similar, around the file's setup phase). Add:

```typescript
import { artifactsRoutes } from './routes/artifacts'
// ...
await app.register(artifactsRoutes, { prefix: '/api/v1' })
```

The artifacts route should be registered AFTER the global JWT/tenant hook (it needs `request.tenantId`) and AFTER the rate-limit plugin.

- [ ] **Step 5: Run test to verify it passes**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/server test -- src/__tests__/artifacts-routes.test.ts 2>&1 | tail -15
```

Expected: PASS — 4 cases. If env-blocked (Windows/pCloud vitest issue), document and proceed. CI Linux validates.

- [ ] **Step 6: Run full server test suite**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/server test 2>&1 | tail -10
```

Expected: full suite green (or env-blocked).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/routes/artifacts.ts apps/server/src/__tests__/artifacts-routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): GET /artifacts/:id/view with strict CSP + tenant guard"
```

---

## Task 11: System prompt + tool registration + cleanup cron

**Files:**
- Modify: `packages/agents/src/lib/copilot/system-prompt.ts`
- Modify: `packages/agents/src/lib/copilot/tools/index.ts`
- Create: `packages/agents/src/lib/storage/cleanup-artifacts.ts`
- Modify: `packages/agents/src/lib/storage/index.ts` (export cleanup-artifacts)

- [ ] **Step 1: Update system prompt**

Read `packages/agents/src/lib/copilot/system-prompt.ts`. Locate the closing backtick of `AIOS_MASTER_SYSTEM_PROMPT`. Replace the closing line with:

```
- Sem perguntas pessoais ou fora do escopo da plataforma.

## Anexos no chat

[... existing §"Anexos no chat" section from Spec #3 ...]

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
com prompt atualizado, reutilize os mesmos data se já estão no histórico.`
```

(The `\`` at the very end closes the template literal — make sure it's NOT escaped. Reuse the exact pattern from Spec #3's edit.)

Use the Edit tool: find the exact existing closing pattern and replace with the extended version.

- [ ] **Step 2: Register the 2 new tools in `tools/index.ts`**

Read `packages/agents/src/lib/copilot/tools/index.ts`. Add the imports + registrations:

```typescript
import { queryParsedFileTool } from './query-parsed-file'
import { renderDashboardTool } from './render-dashboard'

export const allCopilotTools: CopilotTool[] = [
  // ... 11 existing tools ...
  parseFileTool,            // 11ª (Spec #3)
  queryParsedFileTool,      // 12ª (Spec #4)
  renderDashboardTool,      // 13ª (Spec #4)
] as CopilotTool[]
```

- [ ] **Step 3: Implement `cleanup-artifacts.ts`**

Create `packages/agents/src/lib/storage/cleanup-artifacts.ts`:

```typescript
import { getDb, artifacts } from '@ethra-nexus/db'
import { lt, inArray } from 'drizzle-orm'
import type { FileStorageDriver } from './driver'

const CLEANUP_BATCH_SIZE = 100

/**
 * Delete expired artifacts (expires_at < NOW) and their bytes from storage.
 * Idempotent. Designed to be called daily by scheduler-loop.
 *
 * Returns count of deleted artifacts.
 */
export async function cleanupExpiredArtifacts(driver: FileStorageDriver): Promise<number> {
  const db = getDb()
  const now = new Date()

  // Fetch a batch of expired artifacts
  const expired = await db
    .select({ id: artifacts.id, storage_key: artifacts.storage_key })
    .from(artifacts)
    .where(lt(artifacts.expires_at, now))
    .limit(CLEANUP_BATCH_SIZE)

  if (expired.length === 0) return 0

  // Delete bytes via driver (best-effort; idempotent)
  for (const row of expired) {
    try {
      await driver.delete(row.storage_key)
    } catch {
      // log but continue; best-effort cleanup
    }
  }

  // Delete DB rows
  const ids = expired.map(r => r.id)
  await db.delete(artifacts).where(inArray(artifacts.id, ids))

  return expired.length
}
```

- [ ] **Step 4: Update `packages/agents/src/lib/storage/index.ts`**

Read the file and add:

```typescript
export { cleanupExpiredArtifacts } from './cleanup-artifacts'
```

- [ ] **Step 5: Verify TypeScript + tests**

```bash
npx turbo run typecheck --filter=@ethra-nexus/agents 2>&1 | grep -c "error TS"
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test 2>&1 | tail -10
```

Expected: same baseline error count + full suite green.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/lib/copilot/system-prompt.ts \
        packages/agents/src/lib/copilot/tools/index.ts \
        packages/agents/src/lib/storage/cleanup-artifacts.ts \
        packages/agents/src/lib/storage/index.ts
git commit -m "$(cat <<'EOF'
feat(copilot): register query_parsed_file + render_dashboard + cleanup cron

- system_prompt §"Geração de dashboards" guides master on when to call which tool.
- allCopilotTools array now has 13 tools (was 11).
- cleanupExpiredArtifacts() helper for daily TTL cleanup; mirrors Spec #2
  cleanup.ts pattern. Wiring to scheduler-loop deferred to follow-up — manual
  cleanup on demand is sufficient for MVP.
EOF
)"
```

---

## Task 12: Smoke test E2E on VPS

**Files:** none (manual verification)

This is the final gate. Execute on the VPS after CI auto-deploys the merged main.

- [ ] **Step 1: Apply Migration 025 on VPS**

SSH to VPS, then:

```bash
rm -rf /tmp/ethra-fresh
git clone --depth 1 https://github.com/pnakamura/ethra-nexus.git /tmp/ethra-fresh

CONTAINER=$(docker ps --filter name=ethra-nexus-api -q)
docker cp /tmp/ethra-fresh/infra/supabase/migrations/025_artifacts_and_output_worker.sql \
  $CONTAINER:/tmp/025.sql

docker exec $CONTAINER node -e "
const{Pool}=require('pg');
const fs=require('fs');
const p=new Pool({connectionString:process.env.DATABASE_URL});
const sql=fs.readFileSync('/tmp/025.sql','utf8');
p.query(sql).then(()=>{console.log('OK');p.end()}).catch(e=>{console.error(e.message);p.end();process.exit(1)});
"
```

Expected: `OK`.

- [ ] **Step 2: Verify seed**

```bash
docker exec $CONTAINER node -e "
const{Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL});
Promise.all([
  p.query(\"SELECT a.slug, a.is_system, t.slug AS tenant FROM agents a JOIN tenants t ON t.id=a.tenant_id WHERE a.slug='output-worker' ORDER BY t.slug;\"),
  p.query(\"SELECT a.slug AS agent, t.slug AS tenant, s.skill_name FROM agent_skills s JOIN agents a ON a.id=s.agent_id JOIN tenants t ON t.id=s.tenant_id WHERE a.slug='output-worker' ORDER BY t.slug;\"),
]).then(([agents, skills])=>{
  console.log('AGENTS:', JSON.stringify(agents.rows,null,2));
  console.log('SKILLS:', JSON.stringify(skills.rows,null,2));
  p.end();
});
"
```

Expected: 1 row per tenant in agents (`output-worker`, `is_system: true`); 1 row per tenant in skills (`data:render`).

- [ ] **Step 3: Verify deployed image has the new tools compiled**

```bash
docker exec $CONTAINER grep -c "system:query_parsed_file" /app/packages/agents/dist/lib/copilot/tools/query-parsed-file.js
docker exec $CONTAINER grep -c "system:render_dashboard" /app/packages/agents/dist/lib/copilot/tools/render-dashboard.js
docker exec $CONTAINER grep -c "data:render" /app/packages/agents/dist/lib/skills/skill-executor.js
docker exec $CONTAINER ls /app/packages/agents/dist/lib/render/
docker exec $CONTAINER ls /app/apps/server/dist/routes/ | grep artifacts
```

Expected: `1`, `1`, `>=1`, render dir lists `sanitize.js, validate.js, prompt.js, index.js` + .d.ts files, `artifacts.js` exists in routes.

- [ ] **Step 4: Smoke browser test — basic dashboard**

Open `https://ethra-nexus-web.vercel.app/copilot` logged as tenant `atitude45`.

Action: anexar `vendas-q2.xlsx` (from Spec #3 fixtures), pergunta: **"gera dashboard com top 10 vendedores em vendas Q2"**

Validate in chat:
- Tool calls appear in audit log (3 tool_use blocks): `system_parse_file` → `system_query_parsed_file` → `system_render_dashboard`
- Final assistant message has natural-language synthesis ending with `[Ver dashboard](https://...)`
- Cost shown ~$0.10–$0.30 total

- [ ] **Step 5: Click the dashboard link**

Click → new tab opens. DevTools Network tab → response headers should show:
- `Content-Type: text/html`
- `Content-Disposition: inline; filename="..."`
- `Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; ...`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`

Page should render with chart.js bar chart (or similar). Console should be clean (no CSP violations for chart.js loading from jsdelivr).

- [ ] **Step 6: DB validation**

```bash
docker exec $CONTAINER node -e "
const{Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL});
Promise.all([
  p.query(\"SELECT id, title, size_bytes, mime_type, expires_at, parsed_id FROM artifacts ORDER BY created_at DESC LIMIT 3;\"),
  p.query(\"SELECT a.slug, e.skill_id, e.status, e.cost_usd, e.activation_source FROM aios_events e JOIN agents a ON a.id=e.agent_id WHERE a.slug IN ('aios-master','input-worker','output-worker') ORDER BY e.triggered_at DESC LIMIT 10;\"),
]).then(([arts, events])=>{
  console.log('ARTIFACTS:', JSON.stringify(arts.rows,null,2));
  console.log('EVENTS:', JSON.stringify(events.rows,null,2));
  p.end();
});
"
```

Expected: 1+ row in artifacts (mime='text/html', size_bytes ~5-15KB, expires_at ~7 days from now); aios_events has data:extract (input-worker) + data:render (output-worker, cost > 0).

- [ ] **Step 7: Smoke browser test — pizza chart refinement**

In the same conversation: **"refaz em pizza chart"**

Expected: new tool call sequence with new artifact_id, new download_url. Old link still works (TTL not expired).

- [ ] **Step 8: Smoke browser test — multi-source comparison**

Anexar segundo arquivo `vendas-q1.xlsx` (criar fixture local), pergunta: **"compara Q1 vs Q2 num dashboard"**.

Expected: master makes 2x parse_file + 2x query_parsed_file + 1x render_dashboard. Single artifact with 2 charts.

- [ ] **Step 9: Smoke security — cross-tenant + expired**

a) Copy a `download_url` from atitude45 conversation. Logout, login as `minha-org`, paste URL in browser → 404 ARTIFACT_NOT_FOUND.

b) Set an artifact's expires_at to past:
```bash
docker exec $CONTAINER node -e "
const{Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL});
p.query(\"UPDATE artifacts SET expires_at = NOW() - INTERVAL '1 day' ORDER BY created_at DESC LIMIT 1 RETURNING id;\")
  .then(r=>{console.log('expired:', r.rows[0]?.id);p.end()});
"
```
Visit URL → 410 ARTIFACT_EXPIRED.

- [ ] **Step 10: Smoke negative — trivial query no render**

Pergunta: **"quantas abas tem o vendas-q2?"**

Expected: master responds in text, NO render_dashboard call (system prompt rule "NÃO renderize se trivial").

- [ ] **Step 11: Update CLAUDE.md tables list**

Add to §6 in `CLAUDE.md`:

```markdown
| `artifacts` | Cache de dashboards HTML gerados pelo output-worker — FK pra conversation + parsed_files. TTL 7 dias. Spec #4 |
```

And to §5.1 skills table:

```markdown
| `data:render` | Sonnet escreve HTML standalone com chart.js inline. Provider Anthropic (sensitive_data: true). Cost ~$0.20/render. Spec #4 |
```

And mention in §5.1 below the `data:extract` Spec #3 note:

```markdown
**Adicional (Spec #4):** `system:query_parsed_file` + `system:render_dashboard` —
copilot tools. Master orquestra parse_file → query_parsed_file → render_dashboard
para responder pedidos de dashboard. Output-worker (slug fixo, is_system=TRUE)
executa data:render via executeTask delegation.
```

- [ ] **Step 12: Commit docs + push final**

```bash
git add CLAUDE.md
git commit -m "docs(CLAUDE): register artifacts table + data:render skill + Spec #4 tools"
git push
```

If smoke is fully green (10/10), Spec #4 is shipped. Tag:

```bash
git tag -a spec4-shipped -m "Spec #4 (Output Worker + HTML Dashboard) verified live on VPS"
git push --tags
```

---

## Plan self-review

### Spec coverage

| Spec section | Covered by |
|---|---|
| §Goal — output-worker + 2 tools + skill + table + endpoint | Tasks 1, 2, 5, 7, 9, 10 |
| §Acceptance — migration, table, validation, isolation, TTL | Tasks 1-2, 3, 5, 10, 12 |
| §Decisions Q1 (LLM-generated artifact) | Task 5 (executeDataRender uses Sonnet) |
| §Decisions Q2 (structured field selectors) | Task 7 (query-parsed-file impl) |
| §Decisions Q3 (artifacts table separate) | Tasks 1-2 (migration + Drizzle) |
| §Decisions Q4 (same-origin + CSP + new tab) | Task 10 (route with CSP headers) |
| §Decisions Q5 (data: arbitrary Record) | Task 9 (render-dashboard takes Record) |
| §Decisions Q6 (stateless re-render) | Task 5 (no parent_artifact_id; each call = new artifact) |
| §Architecture diagram | Tasks 5, 7, 9, 10 (skill flow + tool dispatch + endpoint serving) |
| §Components — file structure | All Tasks 1-12 |
| §Schema migration 025 + Drizzle | Tasks 1, 2 |
| §Skill flow data:render | Task 5 (8-stage pipeline) |
| §query_parsed_file tool spec | Task 7 |
| §render_dashboard tool spec | Task 9 |
| §ToolContext.conversation_id | Task 8 |
| §Endpoint /artifacts/:id/view + CSP | Task 10 |
| §Sanitize + validate (3 layers) | Tasks 3, 5, 10 (sanitize in skill, validate before storage, CSP at serve) |
| §Audit trail | Implicit — executeTask logs aios_events; provider_usage_log |
| §Error codes | Tasks 5, 7, 9, 10 (all return typed error codes) |
| §Testing strategy | Tasks 3, 6, 7, 9, 10 (unit + integration tests per phase) |
| §Smoke test 10 items | Task 12 |
| §Cleanup cron | Task 11 (helper created; scheduler wiring deferred) |

No gaps. Cleanup cron wiring to scheduler-loop is intentionally deferred — TTL cleanup is non-critical for MVP (manual `DELETE WHERE expires_at < NOW()` works).

### Type-consistency spot checks

- `ToolContext.conversation_id` introduced Task 8, consumed Task 9 — match.
- `SkillOutput.artifact_id/download_url/title/size_bytes` introduced Task 5, consumed Task 9 — match.
- `validateArtifactHtml` returns `ValidationResult` discriminated union — used in Task 5 with `result.ok` narrowing — match.
- `BuiltinSkillId` extension `'data:render'` introduced Task 5; used in Task 9 in `executeTask({skill_id: 'data:render'})` — match.
- `artifacts` Drizzle export from Task 2; imported in Task 5 (skill-executor) and Task 10 (route) — match.

### Placeholder scan

No "TBD", "TODO", "implement later", "similar to Task N", "add appropriate" patterns. All code blocks are complete.

The TODO patterns I deliberately kept:
- "[... existing §"Anexos no chat" section from Spec #3 ...]" in Task 11 — references existing prompt content; engineer reads system-prompt.ts to find where to splice.

That's documentation, not a placeholder. Engineer has clear instructions.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-04-output-worker-and-html-dashboard.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review (spec compliance + code quality) between tasks, fast iteration. Same loop used to ship Specs #1, #2, #3.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**
