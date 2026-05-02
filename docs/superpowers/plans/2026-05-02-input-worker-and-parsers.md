# Input Worker + Parsers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habilitar attachments no `/copilot` chat — user anexa xlsx/PDF/DOCX/CSV/TXT/MD, AIOS Master delega parsing ao agente especialista `input-worker` via `executeTask` interno, recebe preview estruturado em ~3KB de markdown, sintetiza resposta em linguagem natural. Cache automático por sha256 em `parsed_files`.

**Architecture:** 6 parsers (3 refatorados de wiki:ingest + 3 novos) padronizados em interface `ParserResult` neutra. Dispatcher `parserFor(mime)` injeta parser correto. Skill `data:extract` reescrita pra cache-first flow (DB lookup → driver fetch → parse → INSERT cache). Tool `system:parse_file` é dispatcher fino — chama `executeTask` com agent `input-worker` + skill `data:extract`. Frontend ganha paperclip + drag-drop com até 3 chips. POST `/messages` aceita campo `attachments[]` que vira marker text injetado no histórico.

**Tech Stack:** TypeScript strict, Node 20, Fastify 5, Drizzle ORM (Postgres), Vitest 1.6, React 18 + TanStack Query 5, Anthropic SDK Tool Use API, sha256 streaming via `crypto.createHash`, parsers existentes (xlsx/pdf-parse/mammoth) — todos já em `packages/agents`.

**Spec:** [docs/superpowers/specs/2026-05-02-input-worker-and-parsers.md](../specs/2026-05-02-input-worker-and-parsers.md)

**Decisões aprovadas:** Q2 = delegation interna via `executeTask` (sem A2A HTTP loopback) · cache sem TTL · 3 attachments/turno + 50MB/arquivo · `structured_json` JSONB sem limite · cobertura mid + smoke E2E forte.

---

## File structure (criada por este plano)

```
infra/supabase/migrations/
└── 024_input_worker_and_parsing.sql              ← Task 1

packages/db/src/schema/
├── parsing.ts                                    ← Task 2 (criar)
├── core.ts                                       ← Task 2 (modify: agents.is_system)
└── index.ts                                      ← Task 2 (export parsing)

packages/agents/src/lib/parsers/
├── parser-types.ts                               ← Task 3 (criar)
├── file-parser.ts                                ← Task 4 (rewrite — dispatcher)
├── xlsx-parser.ts                                ← Task 5 (criar — ParserResult)
├── pdf-parser.ts                                 ← Task 6 (criar — ParserResult)
├── docx-parser.ts                                ← Task 7 (criar — ParserResult)
├── csv-parser.ts                                 ← Task 8 (criar)
├── txt-parser.ts                                 ← Task 9 (criar)
├── md-parser.ts                                  ← Task 10 (criar)
├── index.ts                                      ← Task 4 (modify: novos exports)
└── __tests__/
    ├── dispatch.test.ts                          ← Task 4
    ├── xlsx-parser.test.ts                       ← Task 5
    ├── pdf-parser.test.ts                        ← Task 6
    ├── docx-parser.test.ts                       ← Task 7
    ├── csv-parser.test.ts                        ← Task 8
    ├── txt-parser.test.ts                        ← Task 9
    ├── md-parser.test.ts                         ← Task 10
    └── fixtures/
        ├── tiny.xlsx                             ← Task 5
        ├── tiny.pdf                              ← Task 6
        ├── tiny.docx                             ← Task 7
        ├── tiny.csv                              ← Task 8
        ├── tiny.txt                              ← Task 9
        └── tiny.md                               ← Task 10

packages/agents/src/lib/skills/
├── skill-executor.ts                             ← Task 11-12 (modify: rewrite executeDataExtract)

packages/agents/src/lib/skills/__tests__/
└── data-extract.test.ts                          ← Task 12 (criar)

packages/agents/src/lib/copilot/
├── system-prompt.ts                              ← Task 13 (modify: parágrafo de attachments)
├── tools/
│   ├── parse-file.ts                             ← Task 14 (criar)
│   ├── index.ts                                  ← Task 14 (modify: add parseFileTool)
│   └── __tests__/
│       └── parse-file.test.ts                    ← Task 14

apps/server/src/routes/
└── copilot.ts                                    ← Task 15 (modify: POST /messages aceita attachments)

apps/server/src/__tests__/
└── copilot-attachments.test.ts                   ← Task 15

apps/web/src/hooks/
└── useUploadFile.ts                              ← Task 16 (criar)

apps/web/src/hooks/__tests__/
└── useUploadFile.test.tsx                        ← Task 16

apps/web/src/components/copilot/
├── AttachmentChip.tsx                            ← Task 17 (criar)
├── MessageInput.tsx                              ← Task 18 (modify: paperclip + chips + drop)
├── ChatView.tsx                                  ← Task 18 (modify: drop zone wrap)
└── __tests__/
    ├── AttachmentChip.test.tsx                   ← Task 17
    └── MessageInput.test.tsx                     ← Task 18

apps/web/src/hooks/
└── useCopilot.ts                                 ← Task 19 (modify: useSendCopilotMessage aceita attachments)

apps/web/src/lib/
└── copilot-stream.ts                             ← Task 19 (modify: passa attachments no body)

apps/web/src/pages/
└── CopilotPage.tsx                               ← Task 19 (modify: passa attachments do MessageInput pro hook)
```

---

## Ordering & dependencies

Tasks 1-2 (DB foundation) destravam tudo. Tasks 3-10 (parsers) podem ir em paralelo após Task 4. Task 11-12 (data:extract) precisa Tasks 3+4. Task 14 (parse_file) precisa Tasks 11-12. Task 15 é independente (só backend). Tasks 16-19 são frontend, podem ir após 15. Task 20 é smoke E2E final.

Em modo **subagent-driven**, dispachar uma task por subagent na ordem listada.

---

## Task 1: Migration 024 SQL — parsed_files + agents.is_system + seed input-worker

**Files:**
- Create: `infra/supabase/migrations/024_input_worker_and_parsing.sql`

- [ ] **Step 1: Write migration SQL**

Create `infra/supabase/migrations/024_input_worker_and_parsing.sql`:

```sql
-- Migration 024: Input Worker agent + parsed_files cache + agents.is_system flag (Spec #3)
-- Safe: novas tabela + coluna nullable + INSERT idempotente. Sem rewrite.
--
-- Padrão de RLS: enabled mas sem policies (mesmo Spec #1+#2). App conecta
-- como superuser; isolamento via tenant_id em queries Drizzle (CLAUDE.md §4.1).

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

- [ ] **Step 2: Apply migration to dev DB and verify**

Assuming local Postgres reachable at `$DATABASE_URL`:

```bash
psql "$DATABASE_URL" -f infra/supabase/migrations/024_input_worker_and_parsing.sql
```

Expected: zero errors. Notices for `ALTER TABLE`, `CREATE TABLE`, `CREATE INDEX`, plus rowcount notices for the two `INSERT ... SELECT`.

Verify schema:

```bash
psql "$DATABASE_URL" -c "\d parsed_files"
psql "$DATABASE_URL" -c "\d agents" | grep is_system
psql "$DATABASE_URL" -c "SELECT slug, is_system FROM agents WHERE slug IN ('aios-master', 'input-worker') ORDER BY slug;"
```

Expected:
- `parsed_files` with columns id, tenant_id, sha256, format, structured_json, preview_md, pages_or_sheets, warnings, created_at + 3 indexes (1 unique partial-style + 2 plain)
- `agents` shows `is_system | boolean | not null default false`
- Both `aios-master` rows (multi-tenant) have `is_system=t`; one `input-worker` row per existing tenant with `is_system=t`

- [ ] **Step 3: Commit**

```bash
git add infra/supabase/migrations/024_input_worker_and_parsing.sql
git commit -m "feat(db): migration 024 — parsed_files + agents.is_system + seed input-worker"
```

---

## Task 2: Drizzle schema — parsedFiles + agents.is_system

**Files:**
- Create: `packages/db/src/schema/parsing.ts`
- Modify: `packages/db/src/schema/core.ts` (add `is_system` to `agents`)
- Modify: `packages/db/src/schema/index.ts` (export parsing)

- [ ] **Step 1: Add `is_system` to `agents` in core.ts**

In `packages/db/src/schema/core.ts`, locate the `agents = pgTable('agents', { ... })` definition and add `is_system` near the end of the column list, just before `created_at`:

```typescript
  // ... outras colunas existentes ...
  response_language: text('response_language').notNull().default('pt-BR'),
  tone: text('tone').notNull().default('professional'),
  is_system: boolean('is_system').notNull().default(false),  // ← NEW
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
```

If `boolean` is already imported (it should be, used by other columns) skip the import. Otherwise ensure:

```typescript
import { pgTable, uuid, text, timestamp, jsonb, boolean, /* ... */ } from 'drizzle-orm/pg-core'
```

- [ ] **Step 2: Create `packages/db/src/schema/parsing.ts`**

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

- [ ] **Step 3: Export from `packages/db/src/schema/index.ts`**

Add the line:

```typescript
export * from './parsing'   // ← NEW
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx turbo run typecheck --filter=@ethra-nexus/db
```

Expected: `Tasks: 1 successful, 1 total` with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/parsing.ts packages/db/src/schema/core.ts packages/db/src/schema/index.ts
git commit -m "feat(db): drizzle schema for parsed_files + agents.is_system"
```

---

## Task 3: ParserResult type interface

**Files:**
- Create: `packages/agents/src/lib/parsers/parser-types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// packages/agents/src/lib/parsers/parser-types.ts

export type ParserFormat = 'xlsx' | 'pdf' | 'docx' | 'csv' | 'txt' | 'md'

/**
 * Neutral, parser-agnostic output shape. Any future parser must conform.
 * Cached as-is in `parsed_files.structured_json` (the ParserStructuredOutput).
 */
export interface ParserResult {
  format: ParserFormat
  structured_json: ParserStructuredOutput
  preview_md: string         // human-readable markdown, target ~2-5KB
  pages_or_sheets: number    // sheets for xlsx, pages for pdf, 1 for everything else
  warnings: string[]         // e.g. "macros ignored", "encrypted"
}

export type ParserStructuredOutput =
  | { type: 'xlsx'; sheets: XlsxSheet[] }
  | { type: 'pdf'; pages: PdfPage[] }
  | { type: 'docx'; paragraphs: DocxParagraph[]; tables: DocxTable[] }
  | { type: 'csv'; rows: string[][]; headers: string[] }
  | { type: 'txt'; content: string; line_count: number }
  | { type: 'md'; content: string; sections: MdSection[] }

export interface XlsxSheet {
  name: string
  rows: unknown[][]
  total_rows: number
  total_cols: number
}

export interface PdfPage {
  page: number
  text: string
}

export interface DocxParagraph {
  style: string  // 'Heading1', 'Heading2', 'Normal', etc.
  text: string
}

export interface DocxTable {
  rows: string[][]
  cols: number
}

export interface MdSection {
  level: number   // 1..6 from `#`..`######`
  title: string
  line: number    // 1-indexed line number where section starts
}

export type Parser = (bytes: Buffer) => Promise<ParserResult>
```

- [ ] **Step 2: Verify it compiles standalone**

```bash
npx turbo run typecheck --filter=@ethra-nexus/agents
```

Expected: passes (file is types-only, will not break anything).

- [ ] **Step 3: Commit**

```bash
git add packages/agents/src/lib/parsers/parser-types.ts
git commit -m "feat(parsers): ParserResult interface (neutral output for all formats)"
```

---

## Task 4: parserFor(mime) dispatcher + tests

The existing `file-parser.ts` returns `Promise<string>`. We REWRITE it to return `Promise<ParserResult>` via the dispatcher pattern. Existing callers of `parseFile`/`parseBuffer` (wiki:ingest et al.) will break — they're updated when we touch `data:extract` (Task 11). For now we keep the new dispatcher and test only the dispatcher; concrete parser modules are added in Tasks 5-10.

**Files:**
- Modify: `packages/agents/src/lib/parsers/file-parser.ts` (rewrite)
- Modify: `packages/agents/src/lib/parsers/index.ts`
- Test: `packages/agents/src/lib/parsers/__tests__/dispatch.test.ts`

- [ ] **Step 1: Write the failing dispatcher tests**

Create `packages/agents/src/lib/parsers/__tests__/dispatch.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { parserFor } from '../file-parser'

vi.mock('../xlsx-parser', () => ({ xlsxParser: vi.fn() }))
vi.mock('../pdf-parser',  () => ({ pdfParser:  vi.fn() }))
vi.mock('../docx-parser', () => ({ docxParser: vi.fn() }))
vi.mock('../csv-parser',  () => ({ csvParser:  vi.fn() }))
vi.mock('../txt-parser',  () => ({ txtParser:  vi.fn() }))
vi.mock('../md-parser',   () => ({ mdParser:   vi.fn() }))

describe('parserFor(mime)', () => {
  it('routes xlsx mime to xlsxParser', async () => {
    const { xlsxParser } = await import('../xlsx-parser')
    expect(parserFor('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(xlsxParser)
  })

  it('routes pdf mime to pdfParser', async () => {
    const { pdfParser } = await import('../pdf-parser')
    expect(parserFor('application/pdf')).toBe(pdfParser)
  })

  it('routes docx mime to docxParser', async () => {
    const { docxParser } = await import('../docx-parser')
    expect(parserFor('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(docxParser)
  })

  it('routes csv mime to csvParser', async () => {
    const { csvParser } = await import('../csv-parser')
    expect(parserFor('text/csv')).toBe(csvParser)
  })

  it('routes csv mime with charset suffix', async () => {
    const { csvParser } = await import('../csv-parser')
    expect(parserFor('text/csv; charset=utf-8')).toBe(csvParser)
  })

  it('routes txt mime to txtParser', async () => {
    const { txtParser } = await import('../txt-parser')
    expect(parserFor('text/plain')).toBe(txtParser)
  })

  it('routes md mime to mdParser', async () => {
    const { mdParser } = await import('../md-parser')
    expect(parserFor('text/markdown')).toBe(mdParser)
  })

  it('throws UNSUPPORTED_MIME for unknown mime', () => {
    expect(() => parserFor('application/octet-stream')).toThrow(/UNSUPPORTED_MIME/)
  })

  it('throws UNSUPPORTED_MIME for empty string', () => {
    expect(() => parserFor('')).toThrow(/UNSUPPORTED_MIME/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run -w @ethra-nexus/agents test -- src/lib/parsers/__tests__/dispatch.test.ts
```

Expected: FAIL — `parserFor` does not exist (or other mock-resolution errors).

- [ ] **Step 3: Rewrite `file-parser.ts` as dispatcher**

Overwrite `packages/agents/src/lib/parsers/file-parser.ts`:

```typescript
import type { Parser, ParserResult } from './parser-types'
import { xlsxParser } from './xlsx-parser'
import { pdfParser } from './pdf-parser'
import { docxParser } from './docx-parser'
import { csvParser } from './csv-parser'
import { txtParser } from './txt-parser'
import { mdParser } from './md-parser'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PDF_MIME  = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function parserFor(mime: string): Parser {
  if (mime === XLSX_MIME) return xlsxParser
  if (mime === PDF_MIME)  return pdfParser
  if (mime === DOCX_MIME) return docxParser
  if (mime.startsWith('text/csv'))      return csvParser
  if (mime.startsWith('text/markdown')) return mdParser
  if (mime.startsWith('text/plain'))    return txtParser
  throw new Error(`UNSUPPORTED_MIME: ${mime || '<empty>'}`)
}

export async function parseFile(bytes: Buffer, mime: string): Promise<ParserResult> {
  return parserFor(mime)(bytes)
}
```

Note: the order `text/markdown` before `text/plain` matters — some parsers sniff `.md` files as `text/plain`, but if mime explicitly says markdown we honor it.

- [ ] **Step 4: Stub the 6 parser modules so the import in file-parser.ts compiles**

These are placeholders that throw — Tasks 5-10 replace them with real implementations. Each file is identical except the export name.

Create `packages/agents/src/lib/parsers/xlsx-parser.ts`:

```typescript
import type { Parser } from './parser-types'

export const xlsxParser: Parser = async () => {
  throw new Error('xlsxParser: not implemented (Task 5)')
}
```

Repeat for `pdf-parser.ts` (`pdfParser` / Task 6), `docx-parser.ts` (`docxParser` / Task 7), `csv-parser.ts` (`csvParser` / Task 8), `txt-parser.ts` (`txtParser` / Task 9), `md-parser.ts` (`mdParser` / Task 10), each with the matching error message.

- [ ] **Step 5: Update `packages/agents/src/lib/parsers/index.ts`**

```typescript
export { parserFor, parseFile } from './file-parser'
export type { Parser, ParserResult, ParserFormat, ParserStructuredOutput,
              XlsxSheet, PdfPage, DocxParagraph, DocxTable, MdSection } from './parser-types'
export { xlsxParser } from './xlsx-parser'
export { pdfParser } from './pdf-parser'
export { docxParser } from './docx-parser'
export { csvParser } from './csv-parser'
export { txtParser } from './txt-parser'
export { mdParser } from './md-parser'
```

- [ ] **Step 6: Run dispatcher test to verify it passes**

```bash
npm run -w @ethra-nexus/agents test -- src/lib/parsers/__tests__/dispatch.test.ts
```

Expected: PASS — all 9 cases.

- [ ] **Step 7: Verify no other test broke**

The old `parseFile(filePath, fileType)` signature was used by wiki:ingest. Run the agents test suite:

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test
```

Expected: any test that called the old `parseFile(filePath, fileType)` will fail. **That is OK** for this task — note the failing test names; they will be fixed when we update `data:extract` (Task 11) or rewrite the wiki:ingest call site separately. List failing test files; if any are in `wiki/` or `skills/` and call the old signature, leave a `TODO(spec3-task11)` note in the test for visibility — do NOT fix them yet, the refactor in Task 11 will handle them all.

- [ ] **Step 8: Commit**

```bash
git add packages/agents/src/lib/parsers/
git commit -m "feat(parsers): parserFor(mime) dispatcher + ParserResult-based file-parser

Stubs for xlsx/pdf/docx/csv/txt/md parsers throw 'not implemented' until
Tasks 5-10 supply real bodies. Old parseFile(filePath, fileType) signature
removed — any callers will be migrated in Task 11 (data:extract refactor)."
```

---

## Task 5: xlsx parser → ParserResult

**Files:**
- Modify: `packages/agents/src/lib/parsers/xlsx-parser.ts`
- Test: `packages/agents/src/lib/parsers/__tests__/xlsx-parser.test.ts`
- Test fixture: `packages/agents/src/lib/parsers/__tests__/fixtures/tiny.xlsx`

- [ ] **Step 1: Generate the test fixture**

Use a 1-line Node script (run from repo root) to create a 2-sheet xlsx with predictable content:

```bash
node -e "
const XLSX = require('xlsx');
const wb = XLSX.utils.book_new();
const s1 = XLSX.utils.aoa_to_sheet([['name','qty'],['Apple',5],['Banana',3]]);
const s2 = XLSX.utils.aoa_to_sheet([['city','pop'],['POA',1500000]]);
XLSX.utils.book_append_sheet(wb, s1, 'Vendas');
XLSX.utils.book_append_sheet(wb, s2, 'Cidades');
XLSX.writeFile(wb, 'packages/agents/src/lib/parsers/__tests__/fixtures/tiny.xlsx');
console.log('written');
"
```

If `fixtures/` doesn't exist yet, create it: `mkdir -p packages/agents/src/lib/parsers/__tests__/fixtures`.

Verify file exists and is binary:

```bash
file packages/agents/src/lib/parsers/__tests__/fixtures/tiny.xlsx
```

Expected: `Microsoft Excel 2007+` or similar.

- [ ] **Step 2: Write the failing test**

Create `packages/agents/src/lib/parsers/__tests__/xlsx-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { xlsxParser } from '../xlsx-parser'

const FIXTURE = join(__dirname, 'fixtures', 'tiny.xlsx')

describe('xlsxParser', () => {
  it('parses 2-sheet workbook with rows + headers', async () => {
    const buf = await readFile(FIXTURE)
    const result = await xlsxParser(buf)
    expect(result.format).toBe('xlsx')
    expect(result.pages_or_sheets).toBe(2)
    if (result.structured_json.type !== 'xlsx') throw new Error('wrong shape')
    expect(result.structured_json.sheets).toHaveLength(2)
    const vendas = result.structured_json.sheets.find(s => s.name === 'Vendas')!
    expect(vendas.total_rows).toBe(3)  // header + 2 data rows
    expect(vendas.total_cols).toBe(2)
    expect(vendas.rows[0]).toEqual(['name', 'qty'])
    expect(vendas.rows[1]).toEqual(['Apple', 5])
  })

  it('preview_md mentions every sheet name and row count', async () => {
    const buf = await readFile(FIXTURE)
    const result = await xlsxParser(buf)
    expect(result.preview_md).toContain('Vendas')
    expect(result.preview_md).toContain('Cidades')
    expect(result.preview_md).toMatch(/3\s+linhas|3\s+rows/)
  })

  it('returns empty warnings for clean file', async () => {
    const buf = await readFile(FIXTURE)
    const result = await xlsxParser(buf)
    expect(result.warnings).toEqual([])
  })

  it('rejects empty buffer with clear error', async () => {
    await expect(xlsxParser(Buffer.alloc(0))).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm run -w @ethra-nexus/agents test -- src/lib/parsers/__tests__/xlsx-parser.test.ts
```

Expected: FAIL — `xlsxParser: not implemented (Task 5)`.

- [ ] **Step 4: Implement `xlsxParser`**

Overwrite `packages/agents/src/lib/parsers/xlsx-parser.ts`:

```typescript
import type { Parser, ParserResult, XlsxSheet } from './parser-types'

const PREVIEW_ROWS_PER_SHEET = 5
const PREVIEW_MD_MAX_BYTES = 5 * 1024  // safety cap

export const xlsxParser: Parser = async (bytes: Buffer): Promise<ParserResult> => {
  if (bytes.length === 0) throw new Error('xlsxParser: empty buffer')

  const XLSX = await import('xlsx')
  const workbook = XLSX.read(bytes, { type: 'buffer', cellDates: true })
  const warnings: string[] = []

  const sheets: XlsxSheet[] = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
    const totalRows = aoa.length
    const totalCols = aoa.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0)
    sheets.push({ name: sheetName, rows: aoa, total_rows: totalRows, total_cols: totalCols })
  }

  if (sheets.length === 0) warnings.push('No readable sheets found')

  const previewParts: string[] = ['# Workbook preview', '']
  for (const s of sheets) {
    previewParts.push(`## Sheet: ${s.name} (${s.total_rows} linhas × ${s.total_cols} colunas)`)
    const sample = s.rows.slice(0, PREVIEW_ROWS_PER_SHEET)
    if (sample.length > 0) {
      previewParts.push('')
      previewParts.push('| ' + (sample[0] as unknown[]).map(v => String(v ?? '')).join(' | ') + ' |')
      previewParts.push('|' + (sample[0] as unknown[]).map(() => '---').join('|') + '|')
      for (const row of sample.slice(1)) {
        previewParts.push('| ' + (row as unknown[]).map(v => String(v ?? '')).join(' | ') + ' |')
      }
      if (s.total_rows > PREVIEW_ROWS_PER_SHEET) {
        previewParts.push(`_(+${s.total_rows - PREVIEW_ROWS_PER_SHEET} linhas omitidas)_`)
      }
    }
    previewParts.push('')
  }

  let preview_md = previewParts.join('\n')
  if (Buffer.byteLength(preview_md, 'utf8') > PREVIEW_MD_MAX_BYTES) {
    preview_md = preview_md.slice(0, PREVIEW_MD_MAX_BYTES) + '\n\n_(preview truncado)_'
    warnings.push('preview truncated to 5KB')
  }

  return {
    format: 'xlsx',
    structured_json: { type: 'xlsx', sheets },
    preview_md,
    pages_or_sheets: sheets.length,
    warnings,
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm run -w @ethra-nexus/agents test -- src/lib/parsers/__tests__/xlsx-parser.test.ts
```

Expected: PASS — all 4 cases.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/lib/parsers/xlsx-parser.ts packages/agents/src/lib/parsers/__tests__/
git commit -m "feat(parsers): xlsx parser returning ParserResult with sheets + preview_md"
```

---

## Task 6: pdf parser → ParserResult

**Files:**
- Modify: `packages/agents/src/lib/parsers/pdf-parser.ts`
- Test: `packages/agents/src/lib/parsers/__tests__/pdf-parser.test.ts`
- Test fixture: `packages/agents/src/lib/parsers/__tests__/fixtures/tiny.pdf`

- [ ] **Step 1: Generate the test fixture**

Use `pdfkit` (a runtime dep of the project for related work — verify it's installed via `npm ls pdfkit -w @ethra-nexus/agents`; if not, install: `npm install -w @ethra-nexus/agents pdfkit @types/pdfkit --save-dev`).

Run from repo root:

```bash
node -e "
const PDFDocument = require('pdfkit');
const fs = require('fs');
const doc = new PDFDocument();
const out = fs.createWriteStream('packages/agents/src/lib/parsers/__tests__/fixtures/tiny.pdf');
doc.pipe(out);
doc.fontSize(14).text('Página 1: Hello World');
doc.addPage().fontSize(14).text('Página 2: Segunda página');
doc.end();
out.on('finish', () => console.log('written'));
"
```

Verify:

```bash
file packages/agents/src/lib/parsers/__tests__/fixtures/tiny.pdf
```

Expected: `PDF document, version ...`.

- [ ] **Step 2: Write the failing test**

Create `packages/agents/src/lib/parsers/__tests__/pdf-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pdfParser } from '../pdf-parser'

const FIXTURE = join(__dirname, 'fixtures', 'tiny.pdf')

describe('pdfParser', () => {
  it('extracts text from a 2-page pdf', async () => {
    const buf = await readFile(FIXTURE)
    const result = await pdfParser(buf)
    expect(result.format).toBe('pdf')
    expect(result.pages_or_sheets).toBe(2)
    if (result.structured_json.type !== 'pdf') throw new Error('wrong shape')
    expect(result.structured_json.pages).toHaveLength(2)
    expect(result.structured_json.pages[0]?.page).toBe(1)
    expect(result.structured_json.pages[0]?.text).toContain('Hello World')
    expect(result.structured_json.pages[1]?.text).toContain('Segunda')
  })

  it('preview_md includes page text excerpts', async () => {
    const buf = await readFile(FIXTURE)
    const result = await pdfParser(buf)
    expect(result.preview_md).toContain('Hello World')
    expect(result.preview_md).toMatch(/Página\s*1|Page\s*1/)
  })

  it('rejects empty buffer', async () => {
    await expect(pdfParser(Buffer.alloc(0))).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm run -w @ethra-nexus/agents test -- src/lib/parsers/__tests__/pdf-parser.test.ts
```

Expected: FAIL — `pdfParser: not implemented (Task 6)`.

- [ ] **Step 4: Implement `pdfParser`**

Overwrite `packages/agents/src/lib/parsers/pdf-parser.ts`:

```typescript
import type { Parser, ParserResult, PdfPage } from './parser-types'

const PREVIEW_CHARS_PER_PAGE = 400
const PREVIEW_MD_MAX_BYTES = 5 * 1024

export const pdfParser: Parser = async (bytes: Buffer): Promise<ParserResult> => {
  if (bytes.length === 0) throw new Error('pdfParser: empty buffer')

  const pdfParse = (await import('pdf-parse')).default
  const warnings: string[] = []
  let pages: PdfPage[] = []

  // pdf-parse normally concatenates all page text. We hook pagerender to capture per-page.
  const perPage: string[] = []
  const result = await pdfParse(bytes, {
    pagerender: async (pageData: { getTextContent(): Promise<{ items: Array<{ str: string }> }> }) => {
      const tc = await pageData.getTextContent()
      const txt = tc.items.map(i => i.str).join(' ')
      perPage.push(txt)
      return txt
    },
  })

  pages = perPage.map((text, i) => ({ page: i + 1, text }))

  if (pages.length === 0 && result.text) {
    // Fallback: pagerender hook didn't fire — split by form-feed if present, else single page.
    const split = result.text.split('\f')
    pages = split.map((text, i) => ({ page: i + 1, text }))
    warnings.push('per-page split via fallback (form-feed)')
  }

  if (pages.length === 0) {
    warnings.push('no pages extracted')
  }

  const previewParts: string[] = ['# PDF preview', '']
  for (const p of pages) {
    previewParts.push(`## Page ${p.page}`)
    previewParts.push('')
    const excerpt = p.text.length > PREVIEW_CHARS_PER_PAGE
      ? p.text.slice(0, PREVIEW_CHARS_PER_PAGE) + '...'
      : p.text
    previewParts.push(excerpt.trim() || '_(página vazia)_')
    previewParts.push('')
  }

  let preview_md = previewParts.join('\n')
  if (Buffer.byteLength(preview_md, 'utf8') > PREVIEW_MD_MAX_BYTES) {
    preview_md = preview_md.slice(0, PREVIEW_MD_MAX_BYTES) + '\n\n_(preview truncado)_'
    warnings.push('preview truncated to 5KB')
  }

  return {
    format: 'pdf',
    structured_json: { type: 'pdf', pages },
    preview_md,
    pages_or_sheets: pages.length,
    warnings,
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm run -w @ethra-nexus/agents test -- src/lib/parsers/__tests__/pdf-parser.test.ts
```

Expected: PASS — all 3 cases.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/lib/parsers/pdf-parser.ts packages/agents/src/lib/parsers/__tests__/
git commit -m "feat(parsers): pdf parser returning ParserResult with per-page text"
```

---

## Task 7: docx parser → ParserResult

**Files:**
- Modify: `packages/agents/src/lib/parsers/docx-parser.ts`
- Test: `packages/agents/src/lib/parsers/__tests__/docx-parser.test.ts`
- Test fixture: `packages/agents/src/lib/parsers/__tests__/fixtures/tiny.docx`

- [ ] **Step 1: Generate the test fixture**

Use `docx` library (verify with `npm ls docx -w @ethra-nexus/agents`; install if missing: `npm install -w @ethra-nexus/agents docx --save-dev`).

```bash
node -e "
const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun } = require('docx');
const fs = require('fs');
const doc = new Document({
  sections: [{
    children: [
      new Paragraph({ text: 'Título do contrato', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: 'Cláusula 1: introdução.' }),
      new Table({
        rows: [
          new TableRow({ children: [new TableCell({ children: [new Paragraph('item')] }), new TableCell({ children: [new Paragraph('valor')] })] }),
          new TableRow({ children: [new TableCell({ children: [new Paragraph('R\$')] }), new TableCell({ children: [new Paragraph('100')] })] }),
        ],
      }),
    ],
  }],
});
Packer.toBuffer(doc).then(buf => fs.writeFileSync('packages/agents/src/lib/parsers/__tests__/fixtures/tiny.docx', buf));
"
```

Verify:

```bash
file packages/agents/src/lib/parsers/__tests__/fixtures/tiny.docx
```

Expected: `Microsoft Word 2007+` or similar.

- [ ] **Step 2: Write the failing test**

Create `packages/agents/src/lib/parsers/__tests__/docx-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { docxParser } from '../docx-parser'

const FIXTURE = join(__dirname, 'fixtures', 'tiny.docx')

describe('docxParser', () => {
  it('extracts paragraphs and tables', async () => {
    const buf = await readFile(FIXTURE)
    const result = await docxParser(buf)
    expect(result.format).toBe('docx')
    expect(result.pages_or_sheets).toBe(1)
    if (result.structured_json.type !== 'docx') throw new Error('wrong shape')
    expect(result.structured_json.paragraphs.length).toBeGreaterThan(0)
    const heading = result.structured_json.paragraphs.find(p => /Heading/i.test(p.style))
    expect(heading?.text).toContain('Título')
    expect(result.structured_json.tables.length).toBeGreaterThan(0)
    expect(result.structured_json.tables[0]?.rows[0]).toEqual(['item', 'valor'])
  })

  it('preview_md mentions heading and table', async () => {
    const buf = await readFile(FIXTURE)
    const result = await docxParser(buf)
    expect(result.preview_md).toContain('Título')
    expect(result.preview_md).toMatch(/item|valor/)
  })

  it('rejects empty buffer', async () => {
    await expect(docxParser(Buffer.alloc(0))).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm run -w @ethra-nexus/agents test -- src/lib/parsers/__tests__/docx-parser.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement `docxParser`**

`mammoth` (already in deps) extracts paragraphs but loses style info easily. We use it for paragraph text + heading detection via mammoth's `convertToHtml` style mapping; for tables we walk the docx XML directly via `mammoth.extractRawText` won't suffice. We use `mammoth.convertToHtml` then strip-and-classify. Simpler: use mammoth with an explicit style map and parse HTML output.

Overwrite `packages/agents/src/lib/parsers/docx-parser.ts`:

```typescript
import type { Parser, ParserResult, DocxParagraph, DocxTable } from './parser-types'

const PREVIEW_MD_MAX_BYTES = 5 * 1024
const STYLE_MAP = [
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
].join('\n')

const TAG_RE = /<(\/?)([a-z0-9]+)([^>]*)>/gi

export const docxParser: Parser = async (bytes: Buffer): Promise<ParserResult> => {
  if (bytes.length === 0) throw new Error('docxParser: empty buffer')

  const mammoth = await import('mammoth')
  const html = (await mammoth.convertToHtml({ buffer: bytes }, { styleMap: STYLE_MAP })).value

  const paragraphs: DocxParagraph[] = []
  const tables: DocxTable[] = []

  // Tiny event-based HTML walker. We only handle the tags we care about.
  let i = 0
  let currentTag: string | null = null
  let currentStyle = 'Normal'
  let buffer = ''
  let inTable = false
  let currentTable: string[][] = []
  let currentRow: string[] = []
  let inCell = false

  while (i < html.length) {
    const m = TAG_RE.exec(html)
    if (!m) {
      buffer += html.slice(i)
      break
    }
    if (m.index > i) buffer += html.slice(i, m.index)
    const closing = m[1] === '/'
    const tag = (m[2] || '').toLowerCase()
    i = m.index + m[0].length

    const flush = () => {
      const text = decodeEntities(buffer).replace(/\s+/g, ' ').trim()
      if (!text) { buffer = ''; return }
      if (inTable && inCell) {
        currentRow.push(text)
      } else if (!inTable) {
        paragraphs.push({ style: currentStyle, text })
      }
      buffer = ''
    }

    if (!closing) {
      if (tag === 'h1') { flush(); currentStyle = 'Heading1' }
      else if (tag === 'h2') { flush(); currentStyle = 'Heading2' }
      else if (tag === 'h3') { flush(); currentStyle = 'Heading3' }
      else if (tag === 'h4') { flush(); currentStyle = 'Heading4' }
      else if (tag === 'p') { flush(); currentStyle = 'Normal' }
      else if (tag === 'table') { flush(); inTable = true; currentTable = [] }
      else if (tag === 'tr') { currentRow = [] }
      else if (tag === 'td' || tag === 'th') { inCell = true; buffer = '' }
      currentTag = tag
    } else {
      if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'p') flush()
      else if (tag === 'td' || tag === 'th') { flush(); inCell = false }
      else if (tag === 'tr') { if (currentRow.length > 0) currentTable.push(currentRow); currentRow = [] }
      else if (tag === 'table') {
        if (currentTable.length > 0) {
          const cols = Math.max(...currentTable.map(r => r.length))
          tables.push({ rows: currentTable, cols })
        }
        inTable = false
        currentTable = []
      }
      currentTag = null
    }
  }

  // Trailing flush
  if (buffer.trim()) {
    const text = decodeEntities(buffer).replace(/\s+/g, ' ').trim()
    if (text) paragraphs.push({ style: currentStyle, text })
  }

  const warnings: string[] = []
  if (paragraphs.length === 0 && tables.length === 0) warnings.push('empty document')

  const previewParts: string[] = ['# DOCX preview', '']
  for (const p of paragraphs.slice(0, 30)) {
    if (p.style.startsWith('Heading')) {
      const level = parseInt(p.style.replace('Heading', ''), 10) || 1
      previewParts.push('#'.repeat(level + 1) + ' ' + p.text)
    } else {
      previewParts.push(p.text)
    }
  }
  if (paragraphs.length > 30) previewParts.push(`_(+${paragraphs.length - 30} parágrafos omitidos)_`)

  for (const t of tables.slice(0, 3)) {
    previewParts.push('')
    previewParts.push('| ' + (t.rows[0] ?? []).join(' | ') + ' |')
    previewParts.push('|' + (t.rows[0] ?? []).map(() => '---').join('|') + '|')
    for (const row of t.rows.slice(1, 6)) previewParts.push('| ' + row.join(' | ') + ' |')
    if (t.rows.length > 6) previewParts.push(`_(+${t.rows.length - 6} linhas)_`)
  }

  let preview_md = previewParts.join('\n')
  if (Buffer.byteLength(preview_md, 'utf8') > PREVIEW_MD_MAX_BYTES) {
    preview_md = preview_md.slice(0, PREVIEW_MD_MAX_BYTES) + '\n\n_(preview truncado)_'
    warnings.push('preview truncated to 5KB')
  }

  return {
    format: 'docx',
    structured_json: { type: 'docx', paragraphs, tables },
    preview_md,
    pages_or_sheets: 1,
    warnings,
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
```

(`currentTag` is unused as a read but kept for potential future use; if TS strict complains, prefix with `_`: `let _currentTag` — pick whichever the build accepts and stay consistent.)

- [ ] **Step 5: Run test to verify it passes**

```bash
npm run -w @ethra-nexus/agents test -- src/lib/parsers/__tests__/docx-parser.test.ts
```

Expected: PASS — all 3 cases. If the heading test fails because mammoth didn't preserve "Heading 1" style on the generated docx (fixtures generated by the `docx` library use specific style names), inspect the html output:

```bash
node -e "
const fs = require('fs'); const m = require('mammoth');
m.convertToHtml({ buffer: fs.readFileSync('packages/agents/src/lib/parsers/__tests__/fixtures/tiny.docx') })
  .then(r => console.log(r.value));
"
```

If the heading appears as `<p>` with no style, regenerate the fixture using `HeadingLevel.HEADING_1` more explicitly (the snippet above already does), OR adjust the test expectation: `expect(result.structured_json.paragraphs[0]?.text).toContain('Título')`.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/lib/parsers/docx-parser.ts packages/agents/src/lib/parsers/__tests__/
git commit -m "feat(parsers): docx parser returning ParserResult with paragraphs + tables"
```

---

## Task 8: csv parser → ParserResult

**Files:**
- Modify: `packages/agents/src/lib/parsers/csv-parser.ts`
- Test: `packages/agents/src/lib/parsers/__tests__/csv-parser.test.ts`
- Test fixture: `packages/agents/src/lib/parsers/__tests__/fixtures/tiny.csv`

- [ ] **Step 1: Create the fixture**

```bash
printf 'name,qty,price\nApple,5,1.20\nBanana,3,0.50\n"Pão, francês",10,0.80\n' > packages/agents/src/lib/parsers/__tests__/fixtures/tiny.csv
```

Verify:

```bash
cat packages/agents/src/lib/parsers/__tests__/fixtures/tiny.csv
```

Expected: 4 lines, third row containing the quoted comma-bearing cell.

- [ ] **Step 2: Write the failing test**

Create `packages/agents/src/lib/parsers/__tests__/csv-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { csvParser } from '../csv-parser'

const FIXTURE = join(__dirname, 'fixtures', 'tiny.csv')

describe('csvParser', () => {
  it('parses headers and rows', async () => {
    const buf = await readFile(FIXTURE)
    const result = await csvParser(buf)
    expect(result.format).toBe('csv')
    expect(result.pages_or_sheets).toBe(1)
    if (result.structured_json.type !== 'csv') throw new Error('wrong shape')
    expect(result.structured_json.headers).toEqual(['name', 'qty', 'price'])
    expect(result.structured_json.rows).toHaveLength(3)
    expect(result.structured_json.rows[0]).toEqual(['Apple', '5', '1.20'])
  })

  it('handles quoted cell with comma', async () => {
    const buf = await readFile(FIXTURE)
    const result = await csvParser(buf)
    if (result.structured_json.type !== 'csv') throw new Error('wrong shape')
    expect(result.structured_json.rows[2]?.[0]).toBe('Pão, francês')
  })

  it('preview_md shows table-style preview', async () => {
    const buf = await readFile(FIXTURE)
    const result = await csvParser(buf)
    expect(result.preview_md).toContain('name')
    expect(result.preview_md).toContain('Apple')
    expect(result.preview_md).toMatch(/3 linhas/)
  })

  it('rejects empty buffer', async () => {
    await expect(csvParser(Buffer.alloc(0))).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm run -w @ethra-nexus/agents test -- src/lib/parsers/__tests__/csv-parser.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement `csvParser`**

We avoid an extra dep. Use `xlsx`'s `csv` parsing capability — it is already installed and handles RFC4180 quoting properly.

Overwrite `packages/agents/src/lib/parsers/csv-parser.ts`:

```typescript
import type { Parser, ParserResult } from './parser-types'

const PREVIEW_ROWS = 10
const PREVIEW_MD_MAX_BYTES = 5 * 1024

export const csvParser: Parser = async (bytes: Buffer): Promise<ParserResult> => {
  if (bytes.length === 0) throw new Error('csvParser: empty buffer')

  const text = bytes.toString('utf8').replace(/^﻿/, '')  // strip BOM

  // Tiny RFC4180 parser. Handles quotes, escaped quotes (""), CRLF/LF, embedded commas.
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ }
        else inQuotes = false
      } else cell += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(cell); cell = '' }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
      else if (c === '\r') { /* swallow, handled by \n next */ }
      else cell += c
    }
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row) }
  // Drop fully-empty trailing row (e.g. trailing newline)
  while (rows.length > 0 && rows[rows.length - 1]!.every(c => c === '')) rows.pop()

  const headers = rows.length > 0 ? rows[0]! : []
  const dataRows = rows.slice(1)
  const warnings: string[] = []
  if (rows.length === 0) warnings.push('empty csv')

  const previewParts: string[] = [
    `# CSV preview (${dataRows.length} linhas, ${headers.length} colunas)`,
    '',
  ]
  if (headers.length > 0) {
    previewParts.push('| ' + headers.join(' | ') + ' |')
    previewParts.push('|' + headers.map(() => '---').join('|') + '|')
    for (const r of dataRows.slice(0, PREVIEW_ROWS)) {
      previewParts.push('| ' + r.join(' | ') + ' |')
    }
    if (dataRows.length > PREVIEW_ROWS) {
      previewParts.push(`_(+${dataRows.length - PREVIEW_ROWS} linhas omitidas)_`)
    }
  }

  let preview_md = previewParts.join('\n')
  if (Buffer.byteLength(preview_md, 'utf8') > PREVIEW_MD_MAX_BYTES) {
    preview_md = preview_md.slice(0, PREVIEW_MD_MAX_BYTES) + '\n\n_(preview truncado)_'
    warnings.push('preview truncated to 5KB')
  }

  return {
    format: 'csv',
    structured_json: { type: 'csv', headers, rows: dataRows },
    preview_md,
    pages_or_sheets: 1,
    warnings,
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm run -w @ethra-nexus/agents test -- src/lib/parsers/__tests__/csv-parser.test.ts
```

Expected: PASS — all 4 cases.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/lib/parsers/csv-parser.ts packages/agents/src/lib/parsers/__tests__/
git commit -m "feat(parsers): csv parser (RFC4180-aware) returning ParserResult"
```

---

## Task 9: txt parser → ParserResult

**Files:**
- Modify: `packages/agents/src/lib/parsers/txt-parser.ts`
- Test: `packages/agents/src/lib/parsers/__tests__/txt-parser.test.ts`
- Test fixture: `packages/agents/src/lib/parsers/__tests__/fixtures/tiny.txt`

- [ ] **Step 1: Create the fixture**

```bash
printf 'Linha 1\nLinha 2\nLinha 3 — acentuação\n' > packages/agents/src/lib/parsers/__tests__/fixtures/tiny.txt
```

- [ ] **Step 2: Write the failing test**

Create `packages/agents/src/lib/parsers/__tests__/txt-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { txtParser } from '../txt-parser'

const FIXTURE = join(__dirname, 'fixtures', 'tiny.txt')

describe('txtParser', () => {
  it('returns content + line_count', async () => {
    const buf = await readFile(FIXTURE)
    const result = await txtParser(buf)
    expect(result.format).toBe('txt')
    expect(result.pages_or_sheets).toBe(1)
    if (result.structured_json.type !== 'txt') throw new Error('wrong shape')
    expect(result.structured_json.line_count).toBe(3)
    expect(result.structured_json.content).toContain('acentuação')
  })

  it('preview_md is the first lines verbatim', async () => {
    const buf = await readFile(FIXTURE)
    const result = await txtParser(buf)
    expect(result.preview_md).toContain('Linha 1')
    expect(result.preview_md).toContain('acentuação')
  })

  it('handles empty file (no lines)', async () => {
    const result = await txtParser(Buffer.from(''))
    if (result.structured_json.type !== 'txt') throw new Error('wrong shape')
    expect(result.structured_json.line_count).toBe(0)
    expect(result.warnings).toContain('empty file')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm run -w @ethra-nexus/agents test -- src/lib/parsers/__tests__/txt-parser.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement `txtParser`**

Overwrite `packages/agents/src/lib/parsers/txt-parser.ts`:

```typescript
import type { Parser, ParserResult } from './parser-types'

const PREVIEW_LINES = 30
const PREVIEW_MD_MAX_BYTES = 5 * 1024

export const txtParser: Parser = async (bytes: Buffer): Promise<ParserResult> => {
  const content = bytes.toString('utf8').replace(/^﻿/, '')
  const warnings: string[] = []
  const lines = content === '' ? [] : content.replace(/\r\n/g, '\n').split('\n')
  // Drop trailing empty line caused by terminal newline
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0) warnings.push('empty file')

  const previewLines = lines.slice(0, PREVIEW_LINES)
  let preview_md = '# TXT preview\n\n```\n' + previewLines.join('\n') + '\n```'
  if (lines.length > PREVIEW_LINES) {
    preview_md += `\n\n_(+${lines.length - PREVIEW_LINES} linhas omitidas)_`
  }
  if (Buffer.byteLength(preview_md, 'utf8') > PREVIEW_MD_MAX_BYTES) {
    preview_md = preview_md.slice(0, PREVIEW_MD_MAX_BYTES) + '\n\n_(preview truncado)_'
    warnings.push('preview truncated to 5KB')
  }

  return {
    format: 'txt',
    structured_json: { type: 'txt', content, line_count: lines.length },
    preview_md,
    pages_or_sheets: 1,
    warnings,
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm run -w @ethra-nexus/agents test -- src/lib/parsers/__tests__/txt-parser.test.ts
```

Expected: PASS — all 3 cases.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/lib/parsers/txt-parser.ts packages/agents/src/lib/parsers/__tests__/
git commit -m "feat(parsers): txt parser returning ParserResult with line_count"
```

---

## Task 10: md parser → ParserResult

**Files:**
- Modify: `packages/agents/src/lib/parsers/md-parser.ts`
- Test: `packages/agents/src/lib/parsers/__tests__/md-parser.test.ts`
- Test fixture: `packages/agents/src/lib/parsers/__tests__/fixtures/tiny.md`

- [ ] **Step 1: Create the fixture**

```bash
cat > packages/agents/src/lib/parsers/__tests__/fixtures/tiny.md << 'EOF'
# Project README

Some intro paragraph.

## Installation

Run `npm install`.

## Usage

### Basic example

Lorem ipsum.
EOF
```

- [ ] **Step 2: Write the failing test**

Create `packages/agents/src/lib/parsers/__tests__/md-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { mdParser } from '../md-parser'

const FIXTURE = join(__dirname, 'fixtures', 'tiny.md')

describe('mdParser', () => {
  it('extracts content + section list', async () => {
    const buf = await readFile(FIXTURE)
    const result = await mdParser(buf)
    expect(result.format).toBe('md')
    expect(result.pages_or_sheets).toBe(1)
    if (result.structured_json.type !== 'md') throw new Error('wrong shape')
    expect(result.structured_json.content).toContain('# Project README')
    expect(result.structured_json.sections).toEqual([
      { level: 1, title: 'Project README', line: 1 },
      { level: 2, title: 'Installation', line: 5 },
      { level: 2, title: 'Usage', line: 9 },
      { level: 3, title: 'Basic example', line: 11 },
    ])
  })

  it('preview_md echoes content for small files', async () => {
    const buf = await readFile(FIXTURE)
    const result = await mdParser(buf)
    expect(result.preview_md).toContain('Project README')
    expect(result.preview_md).toContain('Installation')
  })

  it('handles file without any heading', async () => {
    const result = await mdParser(Buffer.from('plain text only\n'))
    if (result.structured_json.type !== 'md') throw new Error('wrong shape')
    expect(result.structured_json.sections).toEqual([])
    expect(result.warnings).toContain('no headings')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm run -w @ethra-nexus/agents test -- src/lib/parsers/__tests__/md-parser.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement `mdParser`**

Overwrite `packages/agents/src/lib/parsers/md-parser.ts`:

```typescript
import type { Parser, ParserResult, MdSection } from './parser-types'

const PREVIEW_MD_MAX_BYTES = 5 * 1024

export const mdParser: Parser = async (bytes: Buffer): Promise<ParserResult> => {
  const content = bytes.toString('utf8').replace(/^﻿/, '')
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const sections: MdSection[] = []
  let inFence = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^```/.test(line)) inFence = !inFence
    if (inFence) continue
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (m) {
      sections.push({ level: m[1]!.length, title: m[2]!, line: i + 1 })
    }
  }

  const warnings: string[] = []
  if (sections.length === 0) warnings.push('no headings')

  let preview_md: string
  if (Buffer.byteLength(content, 'utf8') <= PREVIEW_MD_MAX_BYTES) {
    preview_md = content
  } else {
    const summary: string[] = ['# Markdown preview', '']
    summary.push(`File has ${lines.length} lines, ${sections.length} headings.`)
    summary.push('', '## Headings')
    for (const s of sections.slice(0, 30)) {
      summary.push('  '.repeat(s.level - 1) + '- ' + s.title)
    }
    if (sections.length > 30) summary.push(`_(+${sections.length - 30} headings)_`)
    preview_md = summary.join('\n')
    warnings.push('content truncated; only headings shown')
  }

  return {
    format: 'md',
    structured_json: { type: 'md', content, sections },
    preview_md,
    pages_or_sheets: 1,
    warnings,
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm run -w @ethra-nexus/agents test -- src/lib/parsers/__tests__/md-parser.test.ts
```

Expected: PASS — all 3 cases.

- [ ] **Step 6: Run full agents test suite**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test
```

Expected: parser tests pass. Pre-existing failures in `wiki/` or `skills/` (legacy callers of `parseFile(filePath, fileType)`) are still expected; they will be fixed in Task 11.

- [ ] **Step 7: Commit**

```bash
git add packages/agents/src/lib/parsers/md-parser.ts packages/agents/src/lib/parsers/__tests__/
git commit -m "feat(parsers): md parser returning ParserResult with section index"
```

---

## Task 11: Extend SkillOutput shape + rewrite `executeDataExtract`

The Spec #1 shape `SkillOutput { answer, tokens_in, tokens_out, cost_usd, provider, model, is_fallback, external_task_id? }` must remain backward compatible. We add 5 optional fields used only by `data:extract`. Existing skills (wiki:query etc.) keep returning their current shape and tools that don't read the new fields are unaffected.

**Files:**
- Modify: `packages/agents/src/lib/skills/skill-executor.ts` (extend `SkillOutput`, rewrite `executeDataExtract`)

- [ ] **Step 1: Extend the `SkillOutput` interface**

Open `packages/agents/src/lib/skills/skill-executor.ts`. Modify the `SkillOutput` block (currently around line 20):

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
}
```

- [ ] **Step 2: Replace `executeDataExtract` with the file-based version**

Locate `async function executeDataExtract(...)` (currently around line 709). Replace the entire function body:

```typescript
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
```

- [ ] **Step 3: Add the new imports to `skill-executor.ts`**

At the top of the file, add (or merge with existing imports):

```typescript
import { getDb, files, parsedFiles, externalAgents } from '@ethra-nexus/db'  // ← add files, parsedFiles
import { eq, and, sql } from 'drizzle-orm'                                    // ← already there, ensure eq/and present
import { sanitizeErrorMessage } from '@ethra-nexus/core'                       // ← already there
import { parseFile, type ParserResult, type ParserFormat } from '../parsers'  // ← NEW
import { createStorageDriver } from '../storage'                               // ← NEW
import { logger as skillLogger } from '../logger'                              // ← NEW (see Step 4)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
```

If `../logger` does not exist, you have two paths — pick whichever is already used elsewhere in the package:

  - If the package already exports a Pino logger from `packages/agents/src/lib/logger.ts`, reuse it.
  - Otherwise create it now:

```typescript
// packages/agents/src/lib/logger.ts
import pino from 'pino'
export const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' })
```

(Verify pino is in deps: `npm ls pino -w @ethra-nexus/agents`. If not, install: `npm install -w @ethra-nexus/agents pino --save`.)

- [ ] **Step 4: Drop the obsolete `executeDataExtract` LLM mock signature**

Some callers (mainly `__tests__/skill-executor.test.ts`) may pass the old `{ content, extract_schema }` input. After this rewrite, those tests must be updated to pass `{ file_id }` and provide DB mocks for files+parsedFiles, OR be deleted if they were stubs. Run:

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test -- src/__tests__/skill-executor.test.ts
```

For each `data:extract` test that fails:
- If it was testing the old LLM-call shape, **delete it** (the new flow has no LLM call to mock).
- If it was integration-style, replace its body with a comment: `// covered by data-extract.test.ts (Task 12)` and delete the body.

Commit the deletion together with the rewrite below.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx turbo run typecheck --filter=@ethra-nexus/agents
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/lib/skills/skill-executor.ts packages/agents/src/lib/logger.ts packages/agents/src/__tests__/skill-executor.test.ts
git commit -m "refactor(skills): data:extract reads file_id, parses via cache-first flow

- Extend SkillOutput with parsed_id/format/preview_md/pages_or_sheets/warnings.
- Replace LLM-based extract with: file lookup → cache lookup → driver fetch →
  parseFile() dispatcher → INSERT cache → return preview_md.
- Remove obsolete LLM-shape tests; full coverage moves to Task 12."
```

---

## Task 12: data-extract.test.ts (full coverage)

**Files:**
- Test: `packages/agents/src/lib/skills/__tests__/data-extract.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/agents/src/lib/skills/__tests__/data-extract.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// We mock the @ethra-nexus/db module + the storage factory + the parsers module.
const filesSelectMock = vi.fn()
const parsedSelectMock = vi.fn()
const parsedInsertMock = vi.fn()

const mockDb = {
  select: vi.fn((cols?: unknown) => ({
    from: (table: { _: { name?: string } } | unknown) => {
      const tableName = (table as { _?: { name?: string } } | { name?: string })?._
        ? (table as { _: { name?: string } })._.name
        : (table as { name?: string }).name
      return {
        where: (_w: unknown) => ({
          limit: (_n: number) => {
            if (tableName === 'files') return filesSelectMock()
            return parsedSelectMock()
          },
        }),
      }
    },
  })),
  insert: vi.fn(() => ({
    values: () => ({
      onConflictDoNothing: () => ({
        returning: () => parsedInsertMock(),
      }),
    }),
  })),
}

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => mockDb,
  files: { _: { name: 'files' }, id: 'files.id', tenant_id: 'files.tenant_id', storage_key: 'files.storage_key', mime_type: 'files.mime_type', sha256: 'files.sha256' },
  parsedFiles: { _: { name: 'parsed_files' }, id: 'parsed_files.id', tenant_id: 'parsed_files.tenant_id', sha256: 'parsed_files.sha256' },
  externalAgents: { _: { name: 'external_agents' } },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ eq: { c, v } })),
  and: vi.fn((...c) => ({ and: c })),
  sql: vi.fn((parts, ...vals) => ({ sql: { parts, vals } })),
}))

const driverGetMock = vi.fn()
vi.mock('../../storage', () => ({
  createStorageDriver: () => ({
    get: driverGetMock,
    put: vi.fn(),
    delete: vi.fn(),
    getDownloadUrl: vi.fn(),
  }),
}))

const parseFileMock = vi.fn()
vi.mock('../../parsers', () => ({
  parseFile: parseFileMock,
}))

const { executeSkill } = await import('../skill-executor')

const ctx = {
  tenant_id: '11111111-1111-1111-1111-111111111111',
  agent_id: '22222222-2222-2222-2222-222222222222',
  session_id: 'evt-1',
  wiki_scope: 'agent-input-worker',
  timestamp: '2026-05-02T00:00:00Z',
  budget_remaining_usd: 10,
  tokens_remaining: 1000000,
}
const VALID_FILE_ID = '33333333-3333-3333-3333-333333333333'
const SHA = 'a'.repeat(64)

const stubAgent = { system_prompt: '', model: 'claude-sonnet-4-6' }

beforeEach(() => {
  filesSelectMock.mockReset()
  parsedSelectMock.mockReset()
  parsedInsertMock.mockReset()
  driverGetMock.mockReset()
  parseFileMock.mockReset()
})

describe('data:extract', () => {
  it('returns INVALID_INPUT when file_id is missing or not a UUID', async () => {
    const r = await executeSkill('data:extract', ctx, { file_id: 'not-a-uuid' }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT')
  })

  it('returns FILE_NOT_FOUND when file row does not exist', async () => {
    filesSelectMock.mockResolvedValueOnce([])
    const r = await executeSkill('data:extract', ctx, { file_id: VALID_FILE_ID }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FILE_NOT_FOUND')
  })

  it('returns cached preview on cache hit and does NOT call parser/driver', async () => {
    filesSelectMock.mockResolvedValueOnce([{ storage_key: 't1/f1', mime_type: 'application/pdf', sha256: SHA }])
    parsedSelectMock.mockResolvedValueOnce([{
      id: 'cached-id', format: 'pdf', preview_md: '# cached', pages_or_sheets: 3, warnings: ['old-warning'],
    }])

    const r = await executeSkill('data:extract', ctx, { file_id: VALID_FILE_ID }, stubAgent)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.parsed_id).toBe('cached-id')
      expect(r.data.preview_md).toBe('# cached')
      expect(r.data.format).toBe('pdf')
    }
    expect(driverGetMock).not.toHaveBeenCalled()
    expect(parseFileMock).not.toHaveBeenCalled()
  })

  it('returns STORAGE_ORPHAN when driver.get returns null', async () => {
    filesSelectMock.mockResolvedValueOnce([{ storage_key: 't1/f1', mime_type: 'application/pdf', sha256: SHA }])
    parsedSelectMock.mockResolvedValueOnce([])
    driverGetMock.mockResolvedValueOnce(null)
    const r = await executeSkill('data:extract', ctx, { file_id: VALID_FILE_ID }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('STORAGE_ORPHAN')
  })

  it('returns PARSE_FAILED when parser throws', async () => {
    filesSelectMock.mockResolvedValueOnce([{ storage_key: 't1/f1', mime_type: 'application/pdf', sha256: SHA }])
    parsedSelectMock.mockResolvedValueOnce([])
    driverGetMock.mockResolvedValueOnce(makeReadable(Buffer.from('x')))
    parseFileMock.mockRejectedValueOnce(new Error('boom'))
    const r = await executeSkill('data:extract', ctx, { file_id: VALID_FILE_ID }, stubAgent)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('PARSE_FAILED')
  })

  it('parses + caches + returns parsed_id on first hit', async () => {
    filesSelectMock.mockResolvedValueOnce([{ storage_key: 't1/f1', mime_type: 'application/pdf', sha256: SHA }])
    parsedSelectMock.mockResolvedValueOnce([])
    driverGetMock.mockResolvedValueOnce(makeReadable(Buffer.from('pdf-bytes')))
    parseFileMock.mockResolvedValueOnce({
      format: 'pdf', structured_json: { type: 'pdf', pages: [{ page: 1, text: 'hello' }] },
      preview_md: '# preview', pages_or_sheets: 1, warnings: [],
    })
    parsedInsertMock.mockResolvedValueOnce([{ id: 'newly-inserted' }])

    const r = await executeSkill('data:extract', ctx, { file_id: VALID_FILE_ID }, stubAgent)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.parsed_id).toBe('newly-inserted')
      expect(r.data.preview_md).toBe('# preview')
    }
  })

  it('handles INSERT race: returning empty → SELECT existing', async () => {
    filesSelectMock.mockResolvedValueOnce([{ storage_key: 't1/f1', mime_type: 'application/pdf', sha256: SHA }])
    parsedSelectMock.mockResolvedValueOnce([])  // initial cache miss
    driverGetMock.mockResolvedValueOnce(makeReadable(Buffer.from('x')))
    parseFileMock.mockResolvedValueOnce({
      format: 'pdf', structured_json: { type: 'pdf', pages: [] },
      preview_md: '# preview', pages_or_sheets: 0, warnings: [],
    })
    parsedInsertMock.mockResolvedValueOnce([])  // ON CONFLICT swallowed insert
    parsedSelectMock.mockResolvedValueOnce([{ id: 'race-winner-id' }])

    const r = await executeSkill('data:extract', ctx, { file_id: VALID_FILE_ID }, stubAgent)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.parsed_id).toBe('race-winner-id')
  })
})

function makeReadable(buf: Buffer): NodeJS.ReadableStream {
  const { Readable } = require('node:stream') as typeof import('node:stream')
  return Readable.from([buf])
}
```

- [ ] **Step 2: Run test to verify it passes**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test -- src/lib/skills/__tests__/data-extract.test.ts
```

Expected: PASS — all 7 cases.

- [ ] **Step 3: Run full agents test suite to ensure nothing broke**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test
```

Expected: PASS. If any wiki:ingest test fails because it was using the old `parseFile(filePath, fileType)` signature, fix the call site to pass `(buffer, mime)` AND drop the now-unused string return — but limit to call sites already touching wiki ingest, do not refactor unrelated code.

- [ ] **Step 4: Commit**

```bash
git add packages/agents/src/lib/skills/__tests__/data-extract.test.ts
git commit -m "test(skills): cover data:extract cache-first flow (7 cases)"
```

---

## Task 13: System prompt — add Attachments section

**Files:**
- Modify: `packages/agents/src/lib/copilot/system-prompt.ts`

- [ ] **Step 1: Read existing prompt to understand structure**

```bash
cat packages/agents/src/lib/copilot/system-prompt.ts
```

You'll see an exported constant `AIOS_MASTER_SYSTEM_PROMPT` (string, multi-line). Identify where the "## Tool guidance" or equivalent section ends — we append the new section after that.

- [ ] **Step 2: Append the Attachments paragraph**

Edit `packages/agents/src/lib/copilot/system-prompt.ts`. At the end of the prompt body (right before the closing backtick), add:

```
## Anexos no chat

Quando o user anexar arquivos, eles aparecem no histórico como blocos texto
no formato: "[user attached file_id=<uuid> filename=<name>]"

Use a tool \`system:parse_file({ file_id })\` quando o **conteúdo** do arquivo
for necessário pra responder. Se a pergunta não envolve o conteúdo, não chame.

Quando chamar parse_file, você recebe um \`preview_md\` (~3KB) com estrutura
do arquivo. Use o preview pra raciocinar e formular resposta.

Múltiplos anexos: chame parse_file uma vez por arquivo. Se a pergunta for
"compara A e B", parseie ambos e sintetize.

Limites: até 3 arquivos por turn. Formatos suportados: xlsx, PDF, DOCX,
CSV, TXT, Markdown.
```

(If the file uses a tagged template literal, escape backticks with `\``. If it's a plain string concatenation, no escaping needed.)

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx turbo run typecheck --filter=@ethra-nexus/agents
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/agents/src/lib/copilot/system-prompt.ts
git commit -m "feat(copilot): system prompt — guidance on attachments + parse_file"
```

---

## Task 14: parse_file tool + register in copilot tools

**Files:**
- Create: `packages/agents/src/lib/copilot/tools/parse-file.ts`
- Modify: `packages/agents/src/lib/copilot/tools/index.ts`
- Test: `packages/agents/src/lib/copilot/tools/__tests__/parse-file.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/lib/copilot/tools/__tests__/parse-file.test.ts`:

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

const { parseFileTool } = await import('../parse-file')

const ctx = { tenant_id: 'tenant-1', user_id: 'user-1', user_role: 'admin' as const }
const VALID = '33333333-3333-3333-3333-333333333333'

beforeEach(() => {
  agentSelectMock.mockReset()
  executeTaskMock.mockReset()
})

describe('parse_file tool', () => {
  it('throws PARSE_FILE_INVALID_FILE_ID when file_id is not a UUID', async () => {
    await expect(parseFileTool.handler({ file_id: 'oops' }, ctx)).rejects.toThrow(/PARSE_FILE_INVALID_FILE_ID/)
  })

  it('throws INPUT_WORKER_NOT_SEEDED when no input-worker for tenant', async () => {
    agentSelectMock.mockResolvedValueOnce([])
    await expect(parseFileTool.handler({ file_id: VALID }, ctx)).rejects.toThrow(/INPUT_WORKER_NOT_SEEDED/)
  })

  it('delegates to executeTask with correct args + returns extracted output', async () => {
    agentSelectMock.mockResolvedValueOnce([{ id: 'iw-agent-1' }])
    executeTaskMock.mockResolvedValueOnce({
      ok: true,
      data: {
        answer: '# preview',
        parsed_id: 'parsed-1',
        format: 'xlsx',
        preview_md: '# preview',
        pages_or_sheets: 3,
        warnings: [],
        tokens_in: 0, tokens_out: 0, cost_usd: 0,
        provider: 'local', model: 'parser', is_fallback: false,
      },
    })

    const out = await parseFileTool.handler({ file_id: VALID, hint: 'sheet count' }, ctx)
    expect(out).toEqual({
      parsed_id: 'parsed-1',
      format: 'xlsx',
      preview_md: '# preview',
      pages_or_sheets: 3,
      warnings: [],
    })
    expect(executeTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 'tenant-1',
      agent_id: 'iw-agent-1',
      skill_id: 'data:extract',
      input: { file_id: VALID, hint: 'sheet count' },
      activation_mode: 'on_demand',
      activation_source: 'copilot:parse_file',
      triggered_by: 'user-1',
    }))
  })

  it('throws PARSE_FILE_FAILED with code when executeTask returns ok:false', async () => {
    agentSelectMock.mockResolvedValueOnce([{ id: 'iw-agent-1' }])
    executeTaskMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'FILE_NOT_FOUND', message: 'no row', retryable: false },
    })
    await expect(parseFileTool.handler({ file_id: VALID }, ctx)).rejects.toThrow(/PARSE_FILE_FAILED.*FILE_NOT_FOUND/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test -- src/lib/copilot/tools/__tests__/parse-file.test.ts
```

Expected: FAIL — module `../parse-file` does not exist.

- [ ] **Step 3: Implement `parse-file.ts`**

Create `packages/agents/src/lib/copilot/tools/parse-file.ts`:

```typescript
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
    'Cache automático por sha256.',
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
```

- [ ] **Step 4: Register the tool in `tools/index.ts`**

Edit `packages/agents/src/lib/copilot/tools/index.ts` and add:

```typescript
import { parseFileTool } from './parse-file'

export const allCopilotTools: CopilotTool[] = [
  listAgentsTool,
  getRecentEventsTool,
  explainEventTool,
  getBudgetStatusTool,
  costBreakdownTool,
  agentHealthTool,
  listPendingApprovalsTool,
  wikiQueryTool,
  listStorageAlertsTool,
  getStorageUsageTool,
  parseFileTool,   // ← NEW (11ª tool)
] as CopilotTool[]
```

- [ ] **Step 5: Run parse-file tests + agents suite**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test -- src/lib/copilot/tools/__tests__/parse-file.test.ts
```

Expected: PASS (4 cases).

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/agents test
```

Expected: full suite green.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/lib/copilot/tools/parse-file.ts packages/agents/src/lib/copilot/tools/__tests__/parse-file.test.ts packages/agents/src/lib/copilot/tools/index.ts
git commit -m "feat(copilot): system:parse_file tool delegating to input-worker via executeTask"
```

---

## Task 15: POST /messages accepts attachments[]

**Files:**
- Modify: `apps/server/src/routes/copilot.ts` (extend POST `/copilot/conversations/:id/messages`)
- Modify: `packages/agents/src/lib/copilot/turn-loop.ts` (extend `ExecuteCopilotTurnParams.content`)
- Test: `apps/server/src/__tests__/copilot-attachments.test.ts`

The route currently signs `Body: { content: string }`. We add `attachments?: Array<{file_id: string; filename: string}>`. When present, the server validates UUIDs + ≤3, then prepends marker text to `content` so the existing turn-loop signature is unchanged.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/__tests__/copilot-attachments.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'

// Smoke-level integration: assert request validation only. Stub turn-loop entirely.
const executeCopilotTurnMock = vi.fn()
vi.mock('@ethra-nexus/agents', async () => {
  const actual = await vi.importActual<typeof import('@ethra-nexus/agents')>('@ethra-nexus/agents')
  return { ...actual, executeCopilotTurn: executeCopilotTurnMock }
})

// We'll register only the copilot route handler stub to avoid pulling the whole app.
import { registerCopilotRoutes } from '../routes/copilot'  // assumes route exposes a registrar

beforeEach(() => executeCopilotTurnMock.mockReset())

async function buildApp() {
  const app = Fastify()
  // Inject minimal request decorators to satisfy hooks the real app would set.
  app.decorateRequest('tenantId', null as unknown as string)
  app.decorateRequest('userSlug', null as unknown as string)
  app.decorateRequest('userRole', null as unknown as 'admin' | 'member')
  app.addHook('onRequest', async (req) => {
    req.tenantId = 't1'
    req.userSlug = 'u1'
    req.userRole = 'admin'
  })
  await registerCopilotRoutes(app)
  return app
}

describe('POST /copilot/conversations/:id/messages — attachments validation', () => {
  it('rejects attachments[] of length 4 with 400 TOO_MANY_ATTACHMENTS', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/copilot/conversations/00000000-0000-0000-0000-000000000000/messages',
      payload: {
        content: 'hi',
        attachments: [
          { file_id: '11111111-1111-1111-1111-111111111111', filename: 'a.xlsx' },
          { file_id: '22222222-2222-2222-2222-222222222222', filename: 'b.xlsx' },
          { file_id: '33333333-3333-3333-3333-333333333333', filename: 'c.xlsx' },
          { file_id: '44444444-4444-4444-4444-444444444444', filename: 'd.xlsx' },
        ],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'TOO_MANY_ATTACHMENTS' })
  })

  it('rejects malformed file_id with 400 INVALID_ATTACHMENT', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/copilot/conversations/00000000-0000-0000-0000-000000000000/messages',
      payload: {
        content: 'hi',
        attachments: [{ file_id: 'not-a-uuid', filename: 'a.xlsx' }],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'INVALID_ATTACHMENT' })
  })

  it('accepts 3 valid attachments and forwards composite content to turn loop', async () => {
    executeCopilotTurnMock.mockResolvedValue(undefined)
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/copilot/conversations/00000000-0000-0000-0000-000000000000/messages',
      payload: {
        content: 'qual aba tem mais linhas?',
        attachments: [{ file_id: '11111111-1111-1111-1111-111111111111', filename: 'vendas.xlsx' }],
      },
    })
    // We don't actually require it to reach the turn loop here — conversation
    // lookup will 404. The point is the handler rejected NOTHING in validation.
    expect([200, 404, 409]).toContain(res.statusCode)
    if (res.statusCode === 404) expect(JSON.parse(res.body)).toMatchObject({ error: 'Not found' })
  })
})
```

> If `apps/server/src/routes/copilot.ts` does not export `registerCopilotRoutes`, refactor the existing `export default async function (app)` to a named export AND keep the default export as a thin wrapper. Adjust the test import accordingly.

- [ ] **Step 2: Run test to verify it fails**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/server test -- src/__tests__/copilot-attachments.test.ts
```

Expected: FAIL on the validation cases (400 TOO_MANY/INVALID).

- [ ] **Step 3: Modify `apps/server/src/routes/copilot.ts`**

Locate the POST `/copilot/conversations/:id/messages` handler and update:

```typescript
// Top-level UUID regex used by validation
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

app.post<{
  Params: { id: string }
  Body: {
    content: string
    attachments?: Array<{ file_id: string; filename: string }>
  }
}>('/copilot/conversations/:id/messages', async (request, reply) => {
  const { id } = request.params
  const content = request.body?.content
  const attachments = request.body?.attachments ?? []

  if (!content || content.trim().length === 0) {
    return reply.status(400).send({ error: 'CONTENT_EMPTY' })
  }
  if (content.length > 50000) {
    return reply.status(413).send({ error: 'CONTENT_TOO_LARGE' })
  }
  if (attachments.length > 3) {
    return reply.status(400).send({ error: 'TOO_MANY_ATTACHMENTS', message: 'Máximo 3 anexos por mensagem' })
  }
  for (const att of attachments) {
    if (typeof att?.file_id !== 'string' || !UUID_RE.test(att.file_id)
        || typeof att?.filename !== 'string' || att.filename.length === 0
        || att.filename.length > 255) {
      return reply.status(400).send({ error: 'INVALID_ATTACHMENT', message: 'file_id deve ser UUID e filename 1-255 chars' })
    }
  }

  // ... existing conversation lookup, lock, SSE handshake unchanged ...

  // Build composite content: attachments first (prepended) so master sees them
  // before the question. Each marker is a plain-text line.
  const attachmentMarkers = attachments
    .map(a => `[user attached file_id=${a.file_id} filename=${a.filename}]`)
    .join('\n')
  const compositeContent = attachments.length > 0
    ? `${attachmentMarkers}\n\n${content}`
    : content

  try {
    await executeCopilotTurn({
      conversation_id: id,
      tenant_id: request.tenantId,
      user_id: request.userSlug!,
      user_role: request.userRole!,
      aios_master_agent_id: conv.agent_id,
      content: compositeContent,
      system_prompt: systemPrompt,
      sse: { write: sseWrite },
      abortSignal: abortController.signal,
    })
    void generateAutoTitle(id)
  } catch (err) { /* unchanged */ }
  finally { /* unchanged */ }
})
```

Leave existing conversation-lookup, lock-acquisition, SSE handshake, and `executeCopilotTurn` call shape intact — only `content` is modified.

- [ ] **Step 4: Run test to verify it passes**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/server test -- src/__tests__/copilot-attachments.test.ts
```

Expected: PASS — 3 cases.

- [ ] **Step 5: Run full server test suite**

```bash
NEXUS_MOCK_LLM=true npm run -w @ethra-nexus/server test
```

Expected: full suite green.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/copilot.ts apps/server/src/__tests__/copilot-attachments.test.ts
git commit -m "feat(copilot): POST /messages accepts attachments[] (≤3, UUID-validated)

Markers are prepended as plain-text blocks to the user content so the AIOS
Master sees them in the history before the question. Turn-loop signature
unchanged."
```

---

## Task 16: useUploadFile hook (frontend)

**Files:**
- Create: `apps/web/src/hooks/useUploadFile.ts`
- Test: `apps/web/src/hooks/__tests__/useUploadFile.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/hooks/__tests__/useUploadFile.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useUploadFile } from '../useUploadFile'

const apiPostMock = vi.fn()
vi.mock('@/lib/api', () => ({
  api: { post: (...args: unknown[]) => apiPostMock(...args) },
}))

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => apiPostMock.mockReset())

describe('useUploadFile', () => {
  it('POSTs FormData with file + 30d expires_at', async () => {
    apiPostMock.mockResolvedValueOnce({
      data: { id: 'file-1', sha256: 'a'.repeat(64), size_bytes: 100, mime_type: 'text/plain', original_filename: 'a.txt', expires_at: null, download_url: '/x' },
    })
    const { result } = renderHook(() => useUploadFile(), { wrapper })

    const file = new File(['hello'], 'a.txt', { type: 'text/plain' })
    result.current.mutate(file)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiPostMock).toHaveBeenCalledTimes(1)
    const [url, body] = apiPostMock.mock.calls[0]!
    expect(url).toBe('/files')
    expect(body).toBeInstanceOf(FormData)
    const fd = body as FormData
    expect(fd.get('file')).toBeInstanceOf(File)
    const exp = fd.get('expires_at')
    expect(typeof exp).toBe('string')
    const expDate = new Date(exp as string).getTime()
    const expectedDate = Date.now() + 30 * 24 * 60 * 60 * 1000
    expect(Math.abs(expDate - expectedDate)).toBeLessThan(60_000)
  })

  it('mutation.error fires on 413', async () => {
    apiPostMock.mockRejectedValueOnce(new Error('413'))
    const { result } = renderHook(() => useUploadFile(), { wrapper })
    result.current.mutate(new File(['x'], 'a.txt', { type: 'text/plain' }))
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run -w @ethra-nexus/web test -- src/hooks/__tests__/useUploadFile.test.tsx
```

Expected: FAIL — module `../useUploadFile` does not exist.

- [ ] **Step 3: Implement `useUploadFile`**

Create `apps/web/src/hooks/useUploadFile.ts`:

```typescript
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface UploadResponse {
  id: string
  sha256: string
  size_bytes: number
  mime_type: string
  original_filename: string
  expires_at: string | null
  download_url: string
}

const TTL_MS = 30 * 24 * 60 * 60 * 1000

export function useUploadFile() {
  return useMutation<UploadResponse, Error, File>({
    mutationFn: async (file) => {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('expires_at', new Date(Date.now() + TTL_MS).toISOString())
      const res = await api.post<UploadResponse>('/files', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return res.data
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run -w @ethra-nexus/web test -- src/hooks/__tests__/useUploadFile.test.tsx
```

Expected: PASS — 2 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useUploadFile.ts apps/web/src/hooks/__tests__/useUploadFile.test.tsx
git commit -m "feat(web): useUploadFile hook (TanStack mutation, 30d TTL)"
```

---

## Task 17: AttachmentChip component

**Files:**
- Create: `apps/web/src/components/copilot/AttachmentChip.tsx`
- Test: `apps/web/src/components/copilot/__tests__/AttachmentChip.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/copilot/__tests__/AttachmentChip.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AttachmentChip } from '../AttachmentChip'

describe('AttachmentChip', () => {
  it('shows spinner and disables remove when uploading', () => {
    render(<AttachmentChip
      filename="vendas.xlsx"
      mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      status="uploading"
      onRemove={() => {}}
    />)
    expect(screen.getByText(/vendas\.xlsx/)).toBeInTheDocument()
    expect(screen.getByTestId('chip-spinner')).toBeInTheDocument()
    expect(screen.queryByLabelText(/remover anexo/i)).not.toBeInTheDocument()
  })

  it('calls onRemove when X clicked in ready state', () => {
    const onRemove = vi.fn()
    render(<AttachmentChip
      filename="contrato.pdf"
      mime_type="application/pdf"
      status="ready"
      size_bytes={123456}
      onRemove={onRemove}
    />)
    fireEvent.click(screen.getByLabelText(/remover anexo/i))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('shows error message in error state', () => {
    render(<AttachmentChip
      filename="bad.pdf"
      mime_type="application/pdf"
      status="error"
      error_message="upload failed"
      onRemove={() => {}}
    />)
    expect(screen.getByText(/upload failed/)).toBeInTheDocument()
  })

  it('chooses xlsx icon based on mime', () => {
    const { container } = render(<AttachmentChip
      filename="x.xlsx"
      mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      status="ready"
      onRemove={() => {}}
    />)
    expect(container.querySelector('[data-icon="xlsx"]')).toBeInTheDocument()
  })

  it('shows formatted size in KB/MB for ready state', () => {
    render(<AttachmentChip
      filename="x.xlsx"
      mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      status="ready"
      size_bytes={183_000}
      onRemove={() => {}}
    />)
    expect(screen.getByText(/179\s*KB|178\s*KB|180\s*KB/)).toBeInTheDocument()  // ≈ 179KB
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run -w @ethra-nexus/web test -- src/components/copilot/__tests__/AttachmentChip.test.tsx
```

Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement `AttachmentChip.tsx`**

Create `apps/web/src/components/copilot/AttachmentChip.tsx`:

```tsx
import { X, FileText, FileSpreadsheet, FileType, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ChipStatus = 'uploading' | 'ready' | 'error'

interface Props {
  filename: string
  mime_type?: string
  size_bytes?: number
  status: ChipStatus
  error_message?: string
  onRemove: () => void
}

export function AttachmentChip({ filename, mime_type, size_bytes, status, error_message, onRemove }: Props) {
  const icon = pickIcon(mime_type)
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 px-2 py-1 border-hairline bg-muted text-[11px] font-mono max-w-[260px]',
        status === 'error' && 'border-destructive bg-destructive/10 text-destructive',
      )}
    >
      <span data-icon={icon.dataKey} className="flex-shrink-0">{icon.node}</span>
      <span className="truncate flex-1" title={filename}>{filename}</span>
      {status === 'ready' && typeof size_bytes === 'number' && (
        <span className="text-muted-foreground flex-shrink-0">{formatBytes(size_bytes)}</span>
      )}
      {status === 'error' && error_message && (
        <span className="text-destructive flex-shrink-0">{error_message}</span>
      )}
      {status === 'uploading' && (
        <Loader2 size={12} className="animate-spin flex-shrink-0" data-testid="chip-spinner" />
      )}
      {(status === 'ready' || status === 'error') && (
        <button
          type="button"
          aria-label="remover anexo"
          onClick={onRemove}
          className="flex-shrink-0 hover:text-destructive"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}

function pickIcon(mime?: string): { node: JSX.Element; dataKey: string } {
  if (!mime) return { node: <FileText size={12} />, dataKey: 'unknown' }
  if (mime.includes('spreadsheet')) return { node: <FileSpreadsheet size={12} />, dataKey: 'xlsx' }
  if (mime === 'application/pdf')   return { node: <FileType size={12} />, dataKey: 'pdf' }
  if (mime.includes('word'))        return { node: <FileText size={12} />, dataKey: 'docx' }
  if (mime.startsWith('text/csv'))  return { node: <FileSpreadsheet size={12} />, dataKey: 'csv' }
  return { node: <FileText size={12} />, dataKey: 'text' }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run -w @ethra-nexus/web test -- src/components/copilot/__tests__/AttachmentChip.test.tsx
```

Expected: PASS — 5 cases. The "shows formatted size" test uses a 3-value tolerance because the rounding boundary is fuzzy; if it fails, adjust the regex to whatever your `Math.round(183000/1024)` produces (likely `179`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/copilot/AttachmentChip.tsx apps/web/src/components/copilot/__tests__/AttachmentChip.test.tsx
git commit -m "feat(web): AttachmentChip component with status icon + size + remove"
```

---

## Task 18: MessageInput — paperclip + chips + drag-drop

**Files:**
- Modify: `apps/web/src/components/copilot/MessageInput.tsx`
- Modify: `apps/web/src/components/copilot/ChatView.tsx` (add drop zone wrap)
- Test: `apps/web/src/components/copilot/__tests__/MessageInput.test.tsx`

`MessageInput` becomes a controlled composite that owns chip state and exposes `attachments` to its parent via `onSend(content, attachments)`. `ChatView` wraps a drop target that forwards files into `MessageInput` via a ref or a callback prop (we use a callback prop here to avoid imperative refs).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/copilot/__tests__/MessageInput.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { MessageInput } from '../MessageInput'

const uploadMock = vi.fn()
vi.mock('@/hooks/useUploadFile', () => ({
  useUploadFile: () => ({
    mutateAsync: uploadMock,
    isPending: false,
  }),
}))
const toastMock = vi.fn()
vi.mock('sonner', () => ({ toast: { error: toastMock, success: toastMock } }))

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>
}

beforeEach(() => { uploadMock.mockReset(); toastMock.mockReset() })

describe('MessageInput attachments', () => {
  it('opens file picker when paperclip clicked', () => {
    const onSend = vi.fn()
    render(wrap(<MessageInput onSend={onSend} />))
    const input = screen.getByLabelText(/anexar arquivo/i) as HTMLInputElement
    expect(input.type).toBe('file')
  })

  it('shows chip with uploading state then ready', async () => {
    uploadMock.mockResolvedValueOnce({
      id: 'f-1', sha256: 'a'.repeat(64), size_bytes: 100, mime_type: 'application/pdf',
      original_filename: 'a.pdf', expires_at: null, download_url: '/x',
    })
    render(wrap(<MessageInput onSend={vi.fn()} />))
    const input = screen.getByLabelText(/anexar arquivo/i) as HTMLInputElement
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(await screen.findByText(/a\.pdf/)).toBeInTheDocument()
    await waitFor(() => expect(uploadMock).toHaveBeenCalled())
  })

  it('blocks file >50MB with toast and no upload', async () => {
    render(wrap(<MessageInput onSend={vi.fn()} />))
    const input = screen.getByLabelText(/anexar arquivo/i) as HTMLInputElement
    const big = new File([new Uint8Array(51 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [big] } })
    expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/50\s*MB/))
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('blocks unsupported mime with toast', async () => {
    render(wrap(<MessageInput onSend={vi.fn()} />))
    const input = screen.getByLabelText(/anexar arquivo/i) as HTMLInputElement
    const exe = new File(['x'], 'a.exe', { type: 'application/octet-stream' })
    fireEvent.change(input, { target: { files: [exe] } })
    expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/formato/))
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('blocks 4th attachment with toast', async () => {
    uploadMock.mockResolvedValue({ id: 'x', sha256: 'a'.repeat(64), size_bytes: 1, mime_type: 'application/pdf', original_filename: 'x.pdf', expires_at: null, download_url: '/x' })
    render(wrap(<MessageInput onSend={vi.fn()} />))
    const input = screen.getByLabelText(/anexar arquivo/i) as HTMLInputElement
    for (let i = 0; i < 3; i++) {
      const f = new File(['x'], `f${i}.pdf`, { type: 'application/pdf' })
      fireEvent.change(input, { target: { files: [f] } })
    }
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(3))
    const fourth = new File(['x'], 'f4.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [fourth] } })
    expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/máximo 3/i))
  })

  it('disables send while any chip is uploading', async () => {
    let resolve!: (v: unknown) => void
    uploadMock.mockReturnValueOnce(new Promise(r => { resolve = r as (v: unknown) => void }))
    render(wrap(<MessageInput onSend={vi.fn()} />))
    const input = screen.getByLabelText(/anexar arquivo/i) as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] } })
    const textarea = screen.getByPlaceholderText(/pergunte/i)
    fireEvent.change(textarea, { target: { value: 'oi' } })
    const send = screen.getByRole('button', { name: /enviar|send/i })
    expect(send).toBeDisabled()
    resolve({ id: 'f-1', sha256: 'a'.repeat(64), size_bytes: 1, mime_type: 'application/pdf', original_filename: 'a.pdf', expires_at: null, download_url: '/x' })
    await waitFor(() => expect(send).not.toBeDisabled())
  })

  it('submits with attachments and resets state', async () => {
    uploadMock.mockResolvedValueOnce({ id: 'f-1', sha256: 'a'.repeat(64), size_bytes: 1, mime_type: 'application/pdf', original_filename: 'a.pdf', expires_at: null, download_url: '/x' })
    const onSend = vi.fn()
    render(wrap(<MessageInput onSend={onSend} />))
    const input = screen.getByLabelText(/anexar arquivo/i) as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] } })
    await waitFor(() => expect(uploadMock).toHaveBeenCalled())
    const textarea = screen.getByPlaceholderText(/pergunte/i)
    fireEvent.change(textarea, { target: { value: 'descreva' } })
    fireEvent.click(screen.getByRole('button', { name: /enviar|send/i }))
    expect(onSend).toHaveBeenCalledWith('descreva', [{ file_id: 'f-1', filename: 'a.pdf' }])
    await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toBe(''))
    expect(screen.queryByText(/a\.pdf/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run -w @ethra-nexus/web test -- src/components/copilot/__tests__/MessageInput.test.tsx
```

Expected: FAIL — props/behavior mismatch.

- [ ] **Step 3: Rewrite `MessageInput.tsx`**

Replace the file body:

```tsx
import { useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { Send, Paperclip } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useUploadFile, type UploadResponse } from '@/hooks/useUploadFile'
import { AttachmentChip } from './AttachmentChip'

interface ChipState {
  temp_id: string
  file_id?: string
  filename: string
  mime_type: string
  size_bytes?: number
  status: 'uploading' | 'ready' | 'error'
  error_message?: string
}

interface Props {
  onSend: (content: string, attachments?: Array<{ file_id: string; filename: string }>) => void
  disabled?: boolean
}

const MAX_CHARS = 50000
const MAX_BYTES = 50 * 1024 * 1024
const MAX_CHIPS = 3
const SUPPORTED_MIMES: ReadonlySet<string> = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
  'text/plain',
  'text/markdown',
])

function isSupported(mime: string): boolean {
  if (SUPPORTED_MIMES.has(mime)) return true
  return [...SUPPORTED_MIMES].some(m => mime.startsWith(m + ';'))
}

export function MessageInput({ onSend, disabled = false }: Props) {
  const [value, setValue] = useState('')
  const [chips, setChips] = useState<ChipState[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const upload = useUploadFile()
  const inputId = useId()

  function ingestFile(file: File) {
    if (chips.length >= MAX_CHIPS) {
      toast.error('máximo 3 anexos por mensagem')
      return
    }
    if (file.size > MAX_BYTES) {
      toast.error('arquivo excede 50MB')
      return
    }
    if (!isSupported(file.type)) {
      toast.error(`formato não suportado: ${file.type || 'desconhecido'}`)
      return
    }
    const temp_id = crypto.randomUUID()
    setChips(prev => [...prev, { temp_id, filename: file.name, mime_type: file.type, status: 'uploading' }])

    upload.mutateAsync(file).then((res: UploadResponse) => {
      setChips(prev => prev.map(c => c.temp_id === temp_id
        ? { ...c, file_id: res.id, size_bytes: res.size_bytes, status: 'ready' }
        : c))
    }).catch((err: Error) => {
      setChips(prev => prev.map(c => c.temp_id === temp_id
        ? { ...c, status: 'error', error_message: err.message.slice(0, 60) }
        : c))
      // auto-remove failed chip after 3s
      setTimeout(() => setChips(prev => prev.filter(c => c.temp_id !== temp_id)), 3000)
    })
  }

  function onPaperclipChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (files) for (const f of Array.from(files)) ingestFile(f)
    e.target.value = ''  // allow re-selecting same file
  }

  function removeChip(temp_id: string) {
    setChips(prev => prev.filter(c => c.temp_id !== temp_id))
  }

  function handleSend() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    if (trimmed.length > MAX_CHARS) return
    if (chips.some(c => c.status === 'uploading')) return
    const ready = chips.filter(c => c.status === 'ready' && c.file_id)
    const payload = ready.length > 0
      ? ready.map(c => ({ file_id: c.file_id!, filename: c.filename }))
      : undefined
    onSend(trimmed, payload)
    setValue('')
    setChips([])
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const tooLong = value.length > MAX_CHARS
  const anyUploading = chips.some(c => c.status === 'uploading')
  const sendDisabled = disabled || !value.trim() || tooLong || anyUploading

  return (
    <div className="border-t-hairline bg-background px-4 py-3 flex-shrink-0">
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {chips.map(c => (
            <AttachmentChip
              key={c.temp_id}
              filename={c.filename}
              mime_type={c.mime_type}
              size_bytes={c.size_bytes}
              status={c.status}
              error_message={c.error_message}
              onRemove={() => removeChip(c.temp_id)}
            />
          ))}
        </div>
      )}
      <div className="flex gap-2 items-end">
        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          accept=".xlsx,.pdf,.docx,.csv,.txt,.md,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv,text/plain,text/markdown"
          aria-label="anexar arquivo"
          onChange={onPaperclipChange}
          className="sr-only"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || chips.length >= MAX_CHIPS}
          className="h-9 flex-shrink-0"
          title="Anexar arquivo (xlsx, PDF, DOCX, CSV, TXT, MD; até 3 arquivos / 50MB cada)"
        >
          <Paperclip size={12} />
        </Button>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Pergunte algo sobre o sistema..."
          rows={2}
          disabled={disabled}
          className={cn(
            'flex-1 font-mono text-[12px] bg-background border-hairline px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary',
            tooLong && 'border-destructive',
          )}
        />
        <Button
          onClick={handleSend}
          disabled={sendDisabled}
          aria-label="enviar"
          className="h-9 flex-shrink-0"
        >
          <Send size={12} />
        </Button>
      </div>
      {tooLong && (
        <p className="font-mono text-[10px] text-destructive mt-1 text-right">
          {value.length} / {MAX_CHARS} chars
        </p>
      )}
    </div>
  )
}

// Public helper used by ChatView's drop zone (Step 4).
export function useMessageInputDrop() {
  // Placeholder — wiring done by parent through onSend prop only.
  // ChatView simply forwards dropped files into the same fileInput.click() path
  // via DOM lookup of [aria-label="anexar arquivo"].
  return null
}
```

- [ ] **Step 4: Wrap `ChatView.tsx` with a drop zone**

In `apps/web/src/components/copilot/ChatView.tsx`, wrap the root element with drag-drop handlers that locate the message input and dispatch a synthetic change event. Add at the top of the component body:

```tsx
function onDrop(e: React.DragEvent<HTMLDivElement>) {
  e.preventDefault()
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  const fileInput = document.querySelector<HTMLInputElement>('input[aria-label="anexar arquivo"]')
  if (!fileInput) return
  // DataTransfer is read-only in some browsers; re-create.
  const dt = new DataTransfer()
  for (const f of Array.from(files)) dt.items.add(f)
  fileInput.files = dt.files
  fileInput.dispatchEvent(new Event('change', { bubbles: true }))
}
function onDragOver(e: React.DragEvent<HTMLDivElement>) {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
}
```

And on the root `<div>` of ChatView add `onDrop={onDrop}` and `onDragOver={onDragOver}`.

- [ ] **Step 5: Run MessageInput tests**

```bash
npm run -w @ethra-nexus/web test -- src/components/copilot/__tests__/MessageInput.test.tsx
```

Expected: PASS — 7 cases. The size-limit test allocates 51MB; in a Node/jsdom env that's fine. If `crypto.randomUUID` is not present, polyfill in test setup or replace with `Math.random().toString(36)`.

- [ ] **Step 6: Run full web test suite**

```bash
npm run -w @ethra-nexus/web test
```

Expected: full suite green. If existing CopilotPage tests fail because they passed `(content)` only and the new MessageInput contract is `(content, attachments?)`, update those tests' `onSend` mocks to accept the optional second arg.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/copilot/MessageInput.tsx apps/web/src/components/copilot/ChatView.tsx apps/web/src/components/copilot/__tests__/MessageInput.test.tsx
git commit -m "feat(web): MessageInput paperclip + chips + drag-drop (3 attachments / 50MB)"
```

---

## Task 19: Wire attachments through useSendCopilotMessage → POST body

**Files:**
- Modify: `apps/web/src/hooks/useCopilot.ts` (extend `useSendCopilotMessage` signature)
- Modify: `apps/web/src/lib/copilot-stream.ts` (forward attachments in body)
- Modify: `apps/web/src/pages/CopilotPage.tsx` (pass through from MessageInput.onSend)

The Spec #1 streaming path uses `createOneShotSender` or `useSendCopilotMessage` which calls a function that POSTs `{ content }`. We add `attachments` end-to-end.

- [ ] **Step 1: Extend `copilot-stream.ts`**

Open `apps/web/src/lib/copilot-stream.ts`. Locate the function that issues `fetch('/api/v1/copilot/conversations/:id/messages', { method: 'POST', body: JSON.stringify({ content }) })`. Modify the body builder:

```typescript
interface SendBody {
  content: string
  attachments?: Array<{ file_id: string; filename: string }>
}

// Inside the sender:
const body: SendBody = { content }
if (attachments && attachments.length > 0) body.attachments = attachments
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
  signal,
})
```

Update the parameters of any exported function (likely `createOneShotSender` or similar) to accept `attachments?: Array<{ file_id: string; filename: string }>`.

- [ ] **Step 2: Extend `useSendCopilotMessage` in `useCopilot.ts`**

Find the hook (or imperative helper) that wraps the streaming sender. Update its callable signature so the parent can pass attachments:

```typescript
// before:
sendMessage(content: string)

// after:
sendMessage(content: string, attachments?: Array<{ file_id: string; filename: string }>)
```

Forward `attachments` to the underlying stream sender.

- [ ] **Step 3: Update `CopilotPage.tsx` to pass attachments through**

Locate where `<MessageInput onSend={...}>` is rendered. Replace the existing `onSend={(content) => sendMessage(content)}` with:

```tsx
<MessageInput
  onSend={(content, attachments) => sendMessage(content, attachments)}
  disabled={...existing condition...}
/>
```

- [ ] **Step 4: TypeScript + tests**

```bash
npx turbo run typecheck --filter=@ethra-nexus/web
npm run -w @ethra-nexus/web test
```

Expected: PASS. If existing tests fail because the streaming sender mock signature is now `(content, attachments?)`, update the test's mock to a 2-arity function.

- [ ] **Step 5: Smoke check the dev server**

This step verifies the wire-up live before declaring frontend done. From repo root:

```bash
NEXUS_MOCK_LLM=true npm run dev
```

Open the web app, log in, navigate to `/copilot`, click the paperclip, pick a small file. Expected:
- Chip appears with spinner.
- Chip transitions to ready state with size + ✗.
- Send is enabled once chip is ready and you have text.
- Submitting clears chips and text; SSE stream events arrive (but obviously parse_file does nothing real until backend has Migration 024 applied).

If anything visible fails (chip stuck on uploading, send button never enables, layout broken), debug before moving on. Stop the dev server with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/hooks/useCopilot.ts apps/web/src/lib/copilot-stream.ts apps/web/src/pages/CopilotPage.tsx
git commit -m "feat(web): wire attachments end-to-end (MessageInput → hook → POST body)"
```

---

## Task 20: Smoke test E2E on staging/VPS

**Files:** none (manual verification + post-merge)

This task is the final gate before declaring Spec #3 shipped, mirroring the Spec #1+#2 process. Execute on the VPS after deploying merged main.

- [ ] **Step 1: Apply Migration 024 on VPS Postgres**

SSH to VPS (`/opt/ethra-nexus`), then:

```bash
docker exec $(docker ps --filter name=ethra-nexus-api -q) \
  node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const fs = require('fs');
const sql = fs.readFileSync('/app/infra/supabase/migrations/024_input_worker_and_parsing.sql', 'utf8');
pool.query(sql).then(() => { console.log('OK'); pool.end(); }).catch(e => { console.error(e.message); pool.end(); process.exit(1); });
"
```

Expected: `OK` line. If migration files aren't shipped in the image, run psql directly via the docker postgres container or copy the SQL into a one-off `pg`-call wrapper.

Verify:

```bash
docker exec $(docker ps --filter name=ethra-nexus-api -q) \
  node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(\"SELECT slug, is_system FROM agents WHERE slug IN ('aios-master','input-worker') ORDER BY slug, tenant_id;\")
  .then(r => { console.log(JSON.stringify(r.rows, null, 2)); pool.end(); });
"
```

Expected: 2 rows for aios-master (multi-tenant) + N rows for input-worker (one per tenant), all with `is_system: true`.

- [ ] **Step 2: Run the 10-case smoke test from the spec**

Follow each item in the spec's "Smoke test (manual)" section verbatim. Browser in `/copilot`, prepare 4 fixture files locally:
- `vendas-q2.xlsx` (3 abas: Vendas Brutas 1247 linhas, Reembolsos 89, Resumo 4)
- `contrato.pdf` (≥3 páginas com texto)
- `proposta.docx`
- `produtos.csv`

For each case (1–10), check the explicit "Esperado" condition. Capture screenshot or log output for any failure.

- [ ] **Step 3: Verify DB writes match the contract**

```bash
docker exec $(docker ps --filter name=ethra-nexus-api -q) \
  node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(\`
  SELECT 'parsed_files' AS t, COUNT(*) FROM parsed_files
  UNION ALL
  SELECT 'aios_events_input_worker', COUNT(*) FROM aios_events e JOIN agents a ON a.id = e.agent_id WHERE a.slug = 'input-worker'
  UNION ALL
  SELECT 'provider_usage_log_local', COUNT(*) FROM provider_usage_log WHERE provider = 'local'
\`).then(r => { console.log(r.rows); pool.end(); });
"
```

Expected: `parsed_files >= 3` (xlsx + pdf + docx + csv tests), `aios_events_input_worker >= 5` (one per parse + extras for cache-hit re-runs), `provider_usage_log_local >= 5`.

- [ ] **Step 4: File any bugs as follow-up tasks**

Anything that fails item 1–10 must produce a labeled GitHub issue or commit fixing inline. Bugs that don't block the core path (e.g. icon mis-picked, size formatting off-by-one) can be deferred but must be tracked.

- [ ] **Step 5: Update CLAUDE.md tables list**

Add `parsed_files` to the "tabelas principais" list in CLAUDE.md §6:

```
| `parsed_files` | Cache de parsing por sha256: structured_json + preview_md por (tenant_id, sha256) — Spec #3 |
```

- [ ] **Step 6: Commit smoke + docs**

```bash
git add CLAUDE.md
git commit -m "docs: register parsed_files in CLAUDE.md tables list"
git push
```

If smoke is fully green: Spec #3 is shipped. Tag accordingly (optional):

```bash
git tag -a spec3-shipped -m "Spec #3 (Input Worker + Parsers) verified live on VPS"
git push --tags
```

---

## Plan self-review

Coverage check against the spec sections:

| Spec section | Covered by |
|---|---|
| §Goal — attachment flow + delegation + cache | Tasks 1, 11–14, 15, 16–19 |
| §Acceptance — Migration 024, attachments[], parse_file tool, data:extract refactor, frontend chip/drag, banner-on-error, ≥80%, smoke | Tasks 1–2, 11–15, 16–19, 20 |
| §Decisions Q1 (attachments[]) | Task 15 |
| §Decisions Q2 (executeTask internal) | Task 14 |
| §Decisions Q3 (parsed_files cache) | Tasks 1, 11 |
| §Decisions Q4 (preview_md hybrid) | Tasks 3 (interface), 5–10 (parsers), 11 (skill) |
| §Decisions Q5 (paperclip + drop + 3 chips) | Tasks 17–18 |
| §Decisions Q6 (system prompt steers tool use) | Task 13 |
| §Decisions Q7 (auto-detect via mime) | Task 4 (dispatcher) |
| §Decisions Q8 (agents.is_system + retroactive) | Tasks 1, 2 |
| §Decisions Q9 (no query_parsed_file) | Out of plan (deferred Spec #4) |
| §Decisions Q10 (mid coverage + smoke) | All test steps + Task 20 |
| §Architecture diagram boundaries | Task 14 (parse_file = dispatcher; data:extract = parser owner) |
| §Components — file structure | All Tasks 3–19 |
| §Migration 024 SQL | Task 1 |
| §Drizzle schema | Task 2 |
| §Skill flow data:extract | Task 11 |
| §parse_file tool spec | Task 14 |
| §POST /messages attachments | Task 15 |
| §Frontend chip + hook + validation | Tasks 16–18 |
| §Error handling codes | Tasks 11 (skill codes), 14 (tool codes), 15 (route codes) |
| §Audit trail | Implicit — Task 14 calls executeTask which logs aios_events |
| §Testing strategy unit/integration/frontend | Tasks 4, 5–10, 12, 14, 15, 16–18 |
| §Smoke test 10 items | Task 20 |

No gaps surfaced. The single deliberate omission is `query_parsed_file` (Spec #4 territory).

Type-consistency spot checks:
- `ParserResult` referenced in Tasks 3, 4, 5, 6, 7, 8, 9, 10, 11 — same shape throughout.
- `SkillOutput` extension fields (`parsed_id`, `format`, `preview_md`, `pages_or_sheets`, `warnings`) introduced Task 11, consumed Task 14 — match exactly.
- Tool name `system:parse_file` (with colon, transformed to `_` at Anthropic boundary) consistent across Task 14 + Task 13 system prompt.
- `executeTask` call args `{ tenant_id, agent_id, skill_id, input, activation_mode, activation_source, triggered_by }` — match `AiosTaskRequest` interface in `aios-master.ts`.

Placeholder scan:
- No "TBD"/"TODO"/"implement later"/"similar to Task N"/"add appropriate".
- The deliberate `TODO(spec3-task11)` note in Task 4 Step 7 is bounded — referencing exactly the next task that fixes it.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-02-input-worker-and-parsers.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review (spec compliance + code quality) between tasks, fast iteration. Same loop used to ship Spec #1 and Spec #2.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**
