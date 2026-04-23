# Fase 22A — Wiki Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar a wiki configurável por agente (top_k, min_score, write_mode) e adicionar write-back automático de lições após execuções bem-sucedidas via WikiWriter com síntese LLM barata.

**Architecture:** Quatro novas colunas em `agents` definem o comportamento da wiki por agente. `executeWikiQuery` usa esses valores em vez de constantes hardcoded. Após cada execução, `WikiWriter` sintetiza a interação num modelo barato (Groq via OpenRouter) e persiste a lição em `wiki_agent_writes` + opcionalmente `wiki_agent_pages` dependendo do `wiki_write_mode`.

**Tech Stack:** Drizzle ORM + PostgreSQL + pgvector, Fastify 5, Vitest, @ethra-nexus/agents, @ethra-nexus/db, @ethra-nexus/wiki (embed)

---

## Estrutura de arquivos

| Arquivo | Operação | Responsabilidade |
|---|---|---|
| `infra/supabase/migrations/013_wiki_runtime.sql` | Criar | Migration SQL para 5 novas colunas |
| `packages/db/src/schema/core.ts` | Modificar | Adicionar 4 colunas wiki a `agents` |
| `packages/db/src/schema/wiki.ts` | Modificar | Adicionar `aios_event_id` a `wiki_agent_writes` |
| `packages/agents/src/lib/wiki/wiki-writer.ts` | Criar (novo diretório) | Módulo WikiWriter — síntese + persistência de lições |
| `packages/agents/src/__tests__/wiki-writer.test.ts` | Criar | Testes unitários do WikiWriter |
| `packages/agents/src/lib/skills/skill-executor.ts` | Modificar | Usar wiki config por agente + chamar WikiWriter |
| `packages/agents/src/__tests__/skill-executor.test.ts` | Modificar | Atualizar fixtures + adicionar testes wiki |
| `packages/agents/src/lib/aios/aios-master.ts` | Modificar | Passar wiki config do agente ao executeSkill |
| `packages/agents/src/__tests__/aios-master.test.ts` | Modificar | Adicionar wiki fields ao mockAgent |
| `apps/server/src/routes/agents.ts` | Modificar | 4 campos wiki no PATCH body + validação |
| `apps/server/src/__tests__/e2e/agents.test.ts` | Modificar | E2E tests dos novos campos |

---

## Task 1: Migration SQL + Drizzle Schema

**Files:**
- Create: `infra/supabase/migrations/013_wiki_runtime.sql`
- Modify: `packages/db/src/schema/core.ts:41-64`
- Modify: `packages/db/src/schema/wiki.ts:130-151`

- [ ] **Step 1: Criar migration SQL**

Crie `infra/supabase/migrations/013_wiki_runtime.sql` com o conteúdo:

```sql
-- Migration 013: wiki runtime — config por agente + link de write-back
-- Safe: apenas ADD COLUMN com DEFAULT, sem rewrite de dados existentes

ALTER TABLE agents ADD COLUMN wiki_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE agents ADD COLUMN wiki_top_k INTEGER NOT NULL DEFAULT 5;
ALTER TABLE agents ADD COLUMN wiki_min_score NUMERIC(4,2) NOT NULL DEFAULT 0.72;
ALTER TABLE agents ADD COLUMN wiki_write_mode TEXT NOT NULL DEFAULT 'supervised';

ALTER TABLE wiki_agent_writes ADD COLUMN aios_event_id UUID REFERENCES aios_events(id);
```

- [ ] **Step 2: Atualizar schema Drizzle — `agents`**

Em `packages/db/src/schema/core.ts`, adicione as 4 colunas após `budget_monthly` (linha ~50):

```typescript
  budget_monthly: numeric('budget_monthly', { precision: 10, scale: 2 }).notNull().default('50.00'),
  // Wiki runtime config (migration 013)
  wiki_enabled: boolean('wiki_enabled').notNull().default(true),
  wiki_top_k: integer('wiki_top_k').notNull().default(5),
  wiki_min_score: numeric('wiki_min_score', { precision: 4, scale: 2 }).notNull().default('0.72'),
  wiki_write_mode: text('wiki_write_mode').notNull().default('supervised'),
  // Identidade expandida (migration 012)
  description: text('description'),
```

- [ ] **Step 3: Atualizar schema Drizzle — `wiki_agent_writes`**

Em `packages/db/src/schema/wiki.ts`, adicione `aios_event_id` após `origin_ticket_id` (linha ~143):

```typescript
  origin_ticket_id: uuid('origin_ticket_id').references(() => tickets.id),
  aios_event_id: uuid('aios_event_id'),
  metadata: jsonb('metadata').default({}),
```

- [ ] **Step 4: Verificar typecheck**

```bash
cd packages/db && npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 5: Commit**

```bash
git add infra/supabase/migrations/013_wiki_runtime.sql packages/db/src/schema/core.ts packages/db/src/schema/wiki.ts
git commit -m "feat(db): migration 013 — wiki runtime config + aios_event_id em wiki_agent_writes"
```

---

## Task 2: WikiWriter module (TDD)

**Files:**
- Create: `packages/agents/src/__tests__/wiki-writer.test.ts`
- Create: `packages/agents/src/lib/wiki/wiki-writer.ts`

- [ ] **Step 1: Criar arquivo de teste**

Crie `packages/agents/src/__tests__/wiki-writer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockComplete = vi.fn()
const mockEmbed = vi.fn().mockResolvedValue(Array(1536).fill(0.1))
const mockValues = vi.fn().mockResolvedValue([])
const mockInsert = vi.fn().mockReturnValue({ values: mockValues })
const mockExecute = vi.fn().mockResolvedValue({})
const mockTx = { insert: mockInsert, execute: mockExecute }
const mockTransaction = vi.fn().mockImplementation(
  async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
)
const mockDb = { transaction: mockTransaction }

vi.mock('../lib/provider', () => ({
  createRegistryFromEnv: () => ({ complete: mockComplete }),
}))

vi.mock('@ethra-nexus/wiki', () => ({
  embed: mockEmbed,
}))

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => mockDb,
  wikiAgentWrites: { name: 'wiki_agent_writes' },
  wikiAgentPages: { name: 'wiki_agent_pages' },
}))

vi.mock('drizzle-orm', () => ({
  sql: vi.fn().mockReturnValue(''),
}))

const { writeLesson } = await import('../lib/wiki/wiki-writer')

const baseInput = {
  agent_id: 'agent-1',
  tenant_id: 'tenant-1',
  aios_event_id: 'event-uuid-1',
  question: 'Qual a política de desconto?',
  answer: 'Clientes Premium têm 20% de desconto.',
}

const mockLesson = {
  title: 'Política de Descontos Premium',
  type: 'referencia',
  content: '## Descontos para Clientes Premium\n\nClientes com plano Premium recebem 20% de desconto em todos os produtos.',
}

describe('WikiWriter — writeLesson', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockComplete.mockResolvedValue({ content: JSON.stringify(mockLesson) })
    mockEmbed.mockResolvedValue(Array(1536).fill(0.1))
    mockValues.mockResolvedValue([])
  })

  it('modo manual — não chama LLM nem DB', async () => {
    await writeLesson({ ...baseInput, write_mode: 'manual' })

    expect(mockComplete).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('modo supervised — insere em wiki_agent_writes com status draft', async () => {
    await writeLesson({ ...baseInput, write_mode: 'supervised' })

    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ name: 'wiki_agent_writes' }))
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'draft',
        agent_id: 'agent-1',
        tenant_id: 'tenant-1',
        aios_event_id: 'event-uuid-1',
        title: 'Política de Descontos Premium',
        type: 'referencia',
      }),
    )
  })

  it('modo supervised — NÃO insere em wiki_agent_pages', async () => {
    await writeLesson({ ...baseInput, write_mode: 'supervised' })

    // insert chamado exatamente uma vez (só wiki_agent_writes)
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockInsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'wiki_agent_pages' }),
    )
  })

  it('modo auto — insere em wiki_agent_writes (approved) E wiki_agent_pages', async () => {
    await writeLesson({ ...baseInput, write_mode: 'auto' })

    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockInsert).toHaveBeenCalledTimes(2)
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ name: 'wiki_agent_writes' }))
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ name: 'wiki_agent_pages' }))
  })

  it('modo auto — wiki_agent_writes tem status approved', async () => {
    await writeLesson({ ...baseInput, write_mode: 'auto' })

    const writesCall = mockValues.mock.calls.find((call) =>
      (call[0] as Record<string, unknown>)['status'] === 'approved',
    )
    expect(writesCall).toBeDefined()
  })

  it('slug gerado começa com lesson- e contém timestamp', async () => {
    await writeLesson({ ...baseInput, write_mode: 'supervised' })

    const insertArg = mockValues.mock.calls[0]?.[0] as Record<string, unknown>
    expect(typeof insertArg?.['slug']).toBe('string')
    expect((insertArg?.['slug'] as string).startsWith('lesson-')).toBe(true)
  })

  it('type inválido do LLM é normalizado para padrao', async () => {
    mockComplete.mockResolvedValue({
      content: JSON.stringify({ ...mockLesson, type: 'tipo-invalido' }),
    })

    await writeLesson({ ...baseInput, write_mode: 'supervised' })

    const insertArg = mockValues.mock.calls[0]?.[0] as Record<string, unknown>
    expect(insertArg?.['type']).toBe('padrao')
  })

  it('falha na síntese LLM (JSON inválido) — não lança exceção', async () => {
    mockComplete.mockResolvedValue({ content: 'não é JSON' })

    await expect(writeLesson({ ...baseInput, write_mode: 'supervised' })).resolves.not.toThrow()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('falha no LLM (exception) — não lança exceção', async () => {
    mockComplete.mockRejectedValue(new Error('Network error'))

    await expect(writeLesson({ ...baseInput, write_mode: 'auto' })).resolves.not.toThrow()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('falha no embed — continua e persiste sem embedding (modo auto)', async () => {
    mockEmbed.mockRejectedValue(new Error('Embed failed'))

    await writeLesson({ ...baseInput, write_mode: 'auto' })

    // transaction ainda foi chamada (embedding failure é non-fatal)
    expect(mockTransaction).toHaveBeenCalledOnce()
    // execute (UPDATE embedding) NÃO foi chamado
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Executar teste e confirmar falha**

```bash
cd packages/agents && npx vitest run src/__tests__/wiki-writer.test.ts
```

Esperado: FAIL com "Cannot find module '../lib/wiki/wiki-writer'"

- [ ] **Step 3: Criar o módulo WikiWriter**

Crie o diretório e arquivo `packages/agents/src/lib/wiki/wiki-writer.ts`:

```typescript
import { createRegistryFromEnv } from '../provider'
import { embed } from '@ethra-nexus/wiki'
import { getDb, wikiAgentWrites, wikiAgentPages } from '@ethra-nexus/db'
import { sql } from 'drizzle-orm'

export interface WikiLessonInput {
  agent_id: string
  tenant_id: string
  aios_event_id: string
  question: string
  answer: string
  write_mode: string
}

interface SynthesizedLesson {
  title: string
  type: string
  content: string
}

const SYNTHESIS_PROMPT = `Você é um sintetizador de conhecimento organizacional.
Dada a interação abaixo, gere uma página de conhecimento reutilizável em JSON com:
- title: string (título conciso da lição aprendida, máximo 80 chars)
- type: "padrao" | "procedimento" | "conceito" | "referencia"
- content: string (conteúdo em Markdown, 3-8 parágrafos, sem dados pessoais)

Capture o conhecimento reutilizável, não o contexto específico da conversa.
Responda APENAS com o JSON, sem markdown ao redor.`

const VALID_TYPES = ['padrao', 'procedimento', 'conceito', 'referencia']

function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

async function synthesizeLesson(question: string, answer: string): Promise<SynthesizedLesson | null> {
  const registry = createRegistryFromEnv()
  try {
    const completion = await registry.complete('wiki:lint', {
      messages: [
        { role: 'system', content: SYNTHESIS_PROMPT },
        { role: 'user', content: `PERGUNTA: ${question}\n\nRESPOSTA: ${answer}` },
      ],
      max_tokens: 800,
      sensitive_data: false,
    })

    const parsed = JSON.parse(completion.content) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)['title'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['type'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['content'] === 'string'
    ) {
      return parsed as SynthesizedLesson
    }
    return null
  } catch {
    return null
  }
}

export async function writeLesson(input: WikiLessonInput): Promise<void> {
  if (input.write_mode === 'manual') return

  const lesson = await synthesizeLesson(input.question, input.answer)
  if (!lesson) return

  const timestamp = Date.now()
  const slug = `lesson-${timestamp}-${titleToSlug(lesson.title)}`
  const type = VALID_TYPES.includes(lesson.type) ? lesson.type : 'padrao'

  let embedding: number[] | null = null
  try {
    embedding = await embed(`${lesson.title}\n${lesson.content}`)
  } catch {
    // embedding failure é non-fatal
  }

  const db = getDb()
  const status = input.write_mode === 'auto' ? 'approved' : 'draft'

  await db.transaction(async (tx) => {
    await tx.insert(wikiAgentWrites).values({
      tenant_id: input.tenant_id,
      agent_id: input.agent_id,
      target_wiki: 'agent',
      slug,
      title: lesson.title,
      content: lesson.content,
      type,
      status,
      aios_event_id: input.aios_event_id,
      metadata: { question_preview: input.question.slice(0, 200) },
    })

    if (input.write_mode === 'auto') {
      await tx.insert(wikiAgentPages).values({
        agent_id: input.agent_id,
        tenant_id: input.tenant_id,
        slug,
        title: lesson.title,
        type,
        content: lesson.content,
        origin: `aios_event:${input.aios_event_id}`,
        confidence: 'media',
        status: 'ativo',
      })

      if (embedding) {
        const vectorStr = `[${embedding.join(',')}]`
        await tx.execute(
          sql`UPDATE wiki_agent_pages SET embedding = ${vectorStr}::vector
              WHERE agent_id = ${input.agent_id} AND slug = ${slug}`,
        )
      }
    }
  })
}
```

- [ ] **Step 4: Executar testes e confirmar aprovação**

```bash
cd packages/agents && npx vitest run src/__tests__/wiki-writer.test.ts
```

Esperado: 9/9 testes passando.

- [ ] **Step 5: Verificar typecheck**

```bash
cd packages/agents && npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/lib/wiki/wiki-writer.ts packages/agents/src/__tests__/wiki-writer.test.ts
git commit -m "feat(agents): WikiWriter — síntese LLM + write-back de lições pós-execução"
```

---

## Task 3: skill-executor — wiki config por agente + WikiWriter call

**Files:**
- Modify: `packages/agents/src/lib/skills/skill-executor.ts`
- Modify: `packages/agents/src/__tests__/skill-executor.test.ts`

- [ ] **Step 1: Adicionar testes para os novos comportamentos**

Em `packages/agents/src/__tests__/skill-executor.test.ts`:

1. Adicione o mock do WikiWriter no topo, junto aos outros mocks:

```typescript
const mockWriteLesson = vi.fn().mockResolvedValue(undefined)

vi.mock('../lib/wiki/wiki-writer', () => ({
  writeLesson: mockWriteLesson,
}))
```

2. Adicione os campos wiki ao `agent` fixture existente (logo após a definição):

```typescript
const agent = {
  system_prompt: 'Você é um assistente de teste.',
  model: 'claude-sonnet-4-6',
  wiki_enabled: true,
  wiki_top_k: 5,
  wiki_min_score: 0.72,
  wiki_write_mode: 'supervised',
}
```

3. Adicione `session_id` e `wiki_scope` ao `context` fixture:

```typescript
const context: AgentContext = {
  tenant_id: 'tenant-1',
  agent_id: 'agent-1',
  session_id: 'event-uuid-test',
  wiki_scope: 'agent-test',
  timestamp: '2026-01-01T00:00:00.000Z',
  budget_remaining_usd: 50,
  tokens_remaining: 0,
}
```

4. Adicione `vi.clearAllMocks()` em `beforeEach` se não existir. Adicione também no bloco `beforeEach`:

```typescript
mockWriteLesson.mockResolvedValue(undefined)
```

5. Adicione os novos testes no final do describe principal:

```typescript
  it('wiki:query com wiki_enabled=false — não chama embed e não busca na wiki', async () => {
    const result = await executeSkill(
      'wiki:query',
      context,
      { question: 'O que é X?' },
      { ...agent, wiki_enabled: false },
    )

    expect(result.ok).toBe(true)
    // embed não deve ser chamado
    const { embed: mockEmbedFn } = await import('@ethra-nexus/wiki')
    expect(vi.mocked(mockEmbedFn)).not.toHaveBeenCalled()
  })

  it('wiki:query com wiki_enabled=true — chama WikiWriter após execução', async () => {
    await executeSkill('wiki:query', context, { question: 'Qual é a política de X?' }, agent)

    // WikiWriter chamado após execução bem-sucedida
    expect(mockWriteLesson).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: 'agent-1',
        tenant_id: 'tenant-1',
        aios_event_id: 'event-uuid-test',
        write_mode: 'supervised',
      }),
    )
  })

  it('wiki:query — falha silenciosa do WikiWriter não afeta resultado', async () => {
    mockWriteLesson.mockRejectedValue(new Error('DB down'))

    const result = await executeSkill('wiki:query', context, { question: 'Teste' }, agent)

    expect(result.ok).toBe(true)
  })
```

- [ ] **Step 2: Executar testes e confirmar falha nos novos testes**

```bash
cd packages/agents && npx vitest run src/__tests__/skill-executor.test.ts
```

Esperado: novos testes FAIL; testes antigos podem falhar por TypeScript (agent fixture desatualizado).

- [ ] **Step 3: Atualizar `executeSkill` e `executeWikiQuery` em skill-executor.ts**

No início de `executeSkill`, substitua o parâmetro `agent` de:

```typescript
  agent: { system_prompt: string; model: string },
```

Para:

```typescript
  agent: {
    system_prompt: string
    model: string
    wiki_enabled: boolean
    wiki_top_k: number
    wiki_min_score: number
    wiki_write_mode: string
  },
```

Adicione o import do WikiWriter no topo do arquivo (após os imports existentes):

```typescript
import { writeLesson } from '../wiki/wiki-writer'
```

Substitua a função `executeWikiQuery` completa:

```typescript
async function executeWikiQuery(
  skill_id: SkillId,
  context: AgentContext,
  input: SkillInput,
  agent: {
    system_prompt: string
    model: string
    wiki_enabled: boolean
    wiki_top_k: number
    wiki_min_score: number
    wiki_write_mode: string
  },
  ts: string,
): Promise<AgentResult<SkillOutput>> {
  const question = input.question ?? input.message ?? ''
  const db = getDb()

  let wikiContext = ''
  if (agent.wiki_enabled) {
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
              LIMIT ${agent.wiki_top_k}`,
        ),
        db.execute(
          sql`SELECT title, content, 1 - (embedding <=> ${vectorStr}::vector) AS similarity
              FROM wiki_agent_pages
              WHERE agent_id = ${context.agent_id}
                AND status = 'ativo'
                AND embedding IS NOT NULL
              ORDER BY embedding <=> ${vectorStr}::vector
              LIMIT ${agent.wiki_top_k}`,
        ),
      ])

      type WikiRow = { title: string; content: string; similarity: number }
      const combined = [
        ...(systemRows.rows as WikiRow[]),
        ...(agentRows.rows as WikiRow[]),
      ]
        .filter((r) => r.similarity > agent.wiki_min_score)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, agent.wiki_top_k)

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

  // Fire-and-forget write-back — non-fatal, não bloqueia a resposta
  void writeLesson({
    agent_id: context.agent_id,
    tenant_id: context.tenant_id,
    aios_event_id: context.session_id,
    question,
    answer: completion.content,
    write_mode: agent.wiki_write_mode,
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
```

Atualize também a chamada interna a `executeWikiQuery` no dispatcher `executeSkill` para passar o `agent` completo:

```typescript
if (skill_id === 'wiki:query' || skill_id === 'channel:respond') {
  return executeWikiQuery(skill_id, context, input, agent, ts)
}
```

- [ ] **Step 4: Executar testes e confirmar aprovação**

```bash
cd packages/agents && npx vitest run src/__tests__/skill-executor.test.ts
```

Esperado: todos os testes passando (antigos + novos).

- [ ] **Step 5: Typecheck**

```bash
cd packages/agents && npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/lib/skills/skill-executor.ts packages/agents/src/__tests__/skill-executor.test.ts
git commit -m "feat(agents): skill-executor usa wiki config por agente + chama WikiWriter pós-execução"
```

---

## Task 4: aios-master — passar wiki config ao executeSkill

**Files:**
- Modify: `packages/agents/src/lib/aios/aios-master.ts:127-131`
- Modify: `packages/agents/src/__tests__/aios-master.test.ts:19-27`

- [ ] **Step 1: Atualizar mockAgent no teste para incluir wiki fields**

Em `packages/agents/src/__tests__/aios-master.test.ts`, adicione os campos wiki ao `mockAgent`:

```typescript
const mockAgent = {
  id: 'agent-1',
  tenant_id: 'tenant-1',
  status: 'active',
  budget_monthly: '50.00',
  model: 'claude-sonnet-4-6',
  system_prompt: 'Test prompt.',
  slug: 'test-agent',
  wiki_enabled: true,
  wiki_top_k: 5,
  wiki_min_score: '0.72',
  wiki_write_mode: 'supervised',
}
```

- [ ] **Step 2: Executar aios-master tests e confirmar que ainda passam**

```bash
cd packages/agents && npx vitest run src/__tests__/aios-master.test.ts
```

Esperado: todos passando (mockAgent era indiferente antes, ainda é — executeSkill está mockado).

- [ ] **Step 3: Atualizar aios-master.ts para passar wiki config**

Em `packages/agents/src/lib/aios/aios-master.ts`, substitua a chamada a `executeSkill` (linhas ~127-131):

```typescript
    skillResult = await executeSkill(task.skill_id, context, task.input, {
      system_prompt: agent.system_prompt,
      model: agent.model,
      wiki_enabled: agent.wiki_enabled ?? true,
      wiki_top_k: agent.wiki_top_k ?? 5,
      wiki_min_score: Number(agent.wiki_min_score ?? '0.72'),
      wiki_write_mode: agent.wiki_write_mode ?? 'supervised',
    })
```

- [ ] **Step 4: Executar aios-master tests**

```bash
cd packages/agents && npx vitest run src/__tests__/aios-master.test.ts
```

Esperado: todos passando.

- [ ] **Step 5: Executar todos os testes do packages/agents**

```bash
cd packages/agents && npx vitest run
```

Esperado: todos os testes passando.

- [ ] **Step 6: Typecheck**

```bash
cd packages/agents && npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 7: Commit**

```bash
git add packages/agents/src/lib/aios/aios-master.ts packages/agents/src/__tests__/aios-master.test.ts
git commit -m "feat(agents): aios-master passa wiki config (enabled, top_k, min_score, write_mode) ao executeSkill"
```

---

## Task 5: PATCH /agents/:id wiki fields + E2E tests

**Files:**
- Modify: `apps/server/src/routes/agents.ts:162-292`
- Modify: `apps/server/src/__tests__/e2e/agents.test.ts`

- [ ] **Step 1: Adicionar testes E2E para os novos campos**

Em `apps/server/src/__tests__/e2e/agents.test.ts`, adicione após o último `describe` existente:

```typescript
describe.skipIf(!process.env['DATABASE_URL_TEST'])('E2E: Wiki config nos agentes', () => {
  let app: FastifyInstance
  let tenantId: string
  let agentId: string

  beforeAll(async () => {
    const { buildApp } = await import('../../app')
    app = await buildApp()

    // Criar tenant de teste
    const tenantRes = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants',
      payload: { name: 'Wiki Test Tenant', slug: `wiki-tenant-${Date.now()}` },
    })
    tenantId = (JSON.parse(tenantRes.body) as { data: { id: string } }).data.id
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    const token = app.jwt.sign({ tenantId })
    const agentRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Wiki Agent',
        slug: `wiki-agent-${Date.now()}`,
        role: 'assistente',
      },
    })
    agentId = (JSON.parse(agentRes.body) as { data: { id: string } }).data.id
  })

  afterEach(async () => {
    const token = app.jwt.sign({ tenantId })
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/agents/${agentId}`,
      headers: { authorization: `Bearer ${token}` },
    })
  })

  async function patch(payload: Record<string, unknown>) {
    const token = app.jwt.sign({ tenantId })
    return app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    })
  }

  it('GET /agents/:id retorna campos wiki com defaults', async () => {
    const token = app.jwt.sign({ tenantId })
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/${agentId}`,
      headers: { authorization: `Bearer ${token}` },
    })
    const agent = (JSON.parse(res.body) as { data: Record<string, unknown> }).data
    expect(agent['wiki_enabled']).toBe(true)
    expect(agent['wiki_top_k']).toBe(5)
    expect(Number(agent['wiki_min_score'])).toBeCloseTo(0.72)
    expect(agent['wiki_write_mode']).toBe('supervised')
  })

  it('PATCH wiki_enabled: false — desabilita wiki do agente', async () => {
    const res = await patch({ wiki_enabled: false })
    expect(res.statusCode).toBe(200)
    const agent = (JSON.parse(res.body) as { data: Record<string, unknown> }).data
    expect(agent['wiki_enabled']).toBe(false)
  })

  it('PATCH wiki_top_k: 10 — atualiza valor', async () => {
    const res = await patch({ wiki_top_k: 10 })
    expect(res.statusCode).toBe(200)
    const agent = (JSON.parse(res.body) as { data: Record<string, unknown> }).data
    expect(agent['wiki_top_k']).toBe(10)
  })

  it('PATCH wiki_top_k: 0 — retorna 400 (fora do range 1-20)', async () => {
    const res = await patch({ wiki_top_k: 0 })
    expect(res.statusCode).toBe(400)
  })

  it('PATCH wiki_top_k: 21 — retorna 400 (fora do range 1-20)', async () => {
    const res = await patch({ wiki_top_k: 21 })
    expect(res.statusCode).toBe(400)
  })

  it('PATCH wiki_min_score: 0.85 — atualiza valor', async () => {
    const res = await patch({ wiki_min_score: 0.85 })
    expect(res.statusCode).toBe(200)
    const agent = (JSON.parse(res.body) as { data: Record<string, unknown> }).data
    expect(Number(agent['wiki_min_score'])).toBeCloseTo(0.85)
  })

  it('PATCH wiki_min_score: -0.1 — retorna 400', async () => {
    const res = await patch({ wiki_min_score: -0.1 })
    expect(res.statusCode).toBe(400)
  })

  it('PATCH wiki_min_score: 1.1 — retorna 400', async () => {
    const res = await patch({ wiki_min_score: 1.1 })
    expect(res.statusCode).toBe(400)
  })

  it('PATCH wiki_write_mode: auto — atualiza valor', async () => {
    const res = await patch({ wiki_write_mode: 'auto' })
    expect(res.statusCode).toBe(200)
    const agent = (JSON.parse(res.body) as { data: Record<string, unknown> }).data
    expect(agent['wiki_write_mode']).toBe('auto')
  })

  it('PATCH wiki_write_mode: invalid — retorna 400', async () => {
    const res = await patch({ wiki_write_mode: 'invalid' })
    expect(res.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Confirmar que novos testes são skipados (sem DATABASE_URL_TEST)**

```bash
cd apps/server && npx vitest run src/__tests__/e2e/agents.test.ts
```

Esperado: testes wiki skipados, demais passando.

- [ ] **Step 3: Atualizar PATCH /agents/:id em agents.ts**

Em `apps/server/src/routes/agents.ts`, adicione os 4 campos ao Body type do PATCH (linha ~165):

```typescript
  app.patch<{
    Params: { id: string }
    Body: {
      name?: string
      model?: string
      system_prompt?: string
      system_prompt_extra?: string
      response_language?: string
      tone?: string
      restrictions?: string[]
      description?: string
      avatar_url?: string
      tags?: string[]
      budget_monthly?: string
      status?: string
      wiki_enabled?: boolean
      wiki_top_k?: number
      wiki_min_score?: number
      wiki_write_mode?: 'auto' | 'supervised' | 'manual'
      skills?: SkillInput[]
      channels?: ChannelInput[]
    }
  }>('/agents/:id', async (request, reply) => {
```

Após a validação de `body.tone` (linha ~191), adicione:

```typescript
    if (body.wiki_top_k !== undefined && (body.wiki_top_k < 1 || body.wiki_top_k > 20)) {
      return reply.status(400).send({ error: 'wiki_top_k must be between 1 and 20' })
    }
    if (body.wiki_min_score !== undefined && (body.wiki_min_score < 0 || body.wiki_min_score > 1)) {
      return reply.status(400).send({ error: 'wiki_min_score must be between 0 and 1' })
    }
    if (body.wiki_write_mode !== undefined && !['auto', 'supervised', 'manual'].includes(body.wiki_write_mode)) {
      return reply.status(400).send({ error: 'wiki_write_mode must be auto, supervised, or manual' })
    }
```

Ao construir `agentUpdate` (após `if (body.status !== undefined)...`), adicione:

```typescript
      if (body.wiki_enabled !== undefined) agentUpdate.wiki_enabled = body.wiki_enabled
      if (body.wiki_top_k !== undefined) agentUpdate.wiki_top_k = body.wiki_top_k
      if (body.wiki_min_score !== undefined) agentUpdate.wiki_min_score = String(body.wiki_min_score)
      if (body.wiki_write_mode !== undefined) agentUpdate.wiki_write_mode = body.wiki_write_mode
```

O tipo de `agentUpdate` também precisa dos novos campos. Atualize a declaração do `Partial<{...}>`:

```typescript
      const agentUpdate: Partial<{
        name: string
        model: string
        system_prompt: string
        system_prompt_extra: string | null
        response_language: string
        tone: string
        restrictions: string[]
        description: string | null
        avatar_url: string | null
        tags: string[]
        budget_monthly: string
        status: string
        wiki_enabled: boolean
        wiki_top_k: number
        wiki_min_score: string
        wiki_write_mode: string
        updated_at: Date
      }> = { updated_at: new Date() }
```

- [ ] **Step 4: Verificar typecheck do server**

```bash
cd apps/server && npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 5: Executar testes unitários do server**

```bash
cd apps/server && npx vitest run
```

Esperado: todos os testes não-skipados passando.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/agents.ts apps/server/src/__tests__/e2e/agents.test.ts
git commit -m "feat(server): PATCH /agents/:id aceita wiki_enabled, wiki_top_k, wiki_min_score, wiki_write_mode"
```

---

## Verificação final

- [ ] **Executar todos os testes do monorepo**

```bash
cd packages/agents && npx vitest run
cd apps/server && npx vitest run
```

Esperado: todos os testes não-skipados passando. Testes E2E wiki skipados (sem DATABASE_URL_TEST).

- [ ] **Typecheck global**

```bash
cd packages/db && npx tsc --noEmit
cd packages/agents && npx tsc --noEmit
cd apps/server && npx tsc --noEmit
```

Esperado: zero erros em todos os packages.

---

## Aplicar migration na VPS

Após deploy, aplicar:

```bash
docker exec $(docker ps --filter name=ethra-nexus-api -q) \
  psql "$DATABASE_URL" -c "
ALTER TABLE agents ADD COLUMN IF NOT EXISTS wiki_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS wiki_top_k INTEGER NOT NULL DEFAULT 5;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS wiki_min_score NUMERIC(4,2) NOT NULL DEFAULT 0.72;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS wiki_write_mode TEXT NOT NULL DEFAULT 'supervised';
ALTER TABLE wiki_agent_writes ADD COLUMN IF NOT EXISTS aios_event_id UUID REFERENCES aios_events(id);
"
```

Verificar:

```bash
docker exec $(docker ps --filter name=ethra-nexus-api -q) \
  psql "$DATABASE_URL" -c "\d agents" | grep wiki
```

Esperado: 4 linhas com `wiki_enabled`, `wiki_top_k`, `wiki_min_score`, `wiki_write_mode`.
