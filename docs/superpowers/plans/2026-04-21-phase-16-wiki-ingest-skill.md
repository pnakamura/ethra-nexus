# Fase 16 — wiki:ingest como Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a skill `wiki:ingest` no SkillExecutor para que agentes possam ingerir documentos na wiki estratégica via AIOS Master (POST /aios/execute).

**Architecture:** A skill `wiki:ingest` recebe `{ content, source_name }` no `SkillInput`, chama `extractPagesFromContent()` do `@ethra-nexus/wiki` para extrair páginas via LLM, persiste cada página com `createWikiDb().upsertStrategicPage()`, e gera embeddings com `embed()` + raw SQL. Tokens/custo reportados como 0 pois `extractPagesFromContent` não expõe o custo da chamada interna — limitação conhecida a resolver em fase futura.

**Tech Stack:** Vitest, TypeScript strict, `@ethra-nexus/wiki` (extractPagesFromContent, embed), `packages/agents/src/lib/db` (createWikiDb), drizzle-orm (sql), Anthropic via ProviderRegistry

---

## File Structure

**Modify:** `packages/agents/src/lib/skills/skill-executor.ts`
- Adicionar import de `extractPagesFromContent` de `@ethra-nexus/wiki`
- Adicionar import de `createWikiDb` de `'../db'`
- Adicionar branch `wiki:ingest` no dispatcher `executeSkill()`
- Implementar função `executeWikiIngest()`

**Modify:** `packages/agents/src/__tests__/skill-executor.test.ts`
- Adicionar `extractPagesFromContent` ao mock de `@ethra-nexus/wiki`
- Adicionar mock de `'../lib/db'` com `createWikiDb`
- Adicionar imports de tipo para os mocks
- Adicionar caso de teste `wiki:ingest → extrai páginas e retorna ok:true`
- Adicionar caso de teste `wiki:ingest → retorna INVALID_INPUT quando content ausente`

---

## Task 1: Adicionar testes para wiki:ingest

**Files:**
- Modify: `packages/agents/src/__tests__/skill-executor.test.ts`

- [ ] **Step 1: Atualizar mocks no topo do arquivo**

O arquivo atual tem 4 mocks globais. Substitua as primeiras 30 linhas do arquivo pelo bloco abaixo (preserva os mocks existentes e adiciona os novos):

```typescript
// packages/agents/src/__tests__/skill-executor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentContext } from '@ethra-nexus/core'
import type { ExtractResult } from '@ethra-nexus/wiki'
import { extractPagesFromContent } from '@ethra-nexus/wiki'  // mocked below — hoisting garante que é o mock

const mockComplete = vi.fn()
const mockUpsertStrategicPage = vi.fn()

vi.mock('../lib/provider', () => ({
  createRegistryFromEnv: () => ({ complete: mockComplete }),
}))

vi.mock('@ethra-nexus/wiki', () => ({
  embed: vi.fn().mockResolvedValue(Array(1536).fill(0.1)),
  extractPagesFromContent: vi.fn(),
}))

vi.mock('../lib/db', () => ({
  createWikiDb: vi.fn(() => ({
    upsertStrategicPage: mockUpsertStrategicPage,
  })),
}))

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({
    execute: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] }),
  }),
}))

// skill-executor imports sql from drizzle-orm directly
vi.mock('drizzle-orm', () => ({
  sql: vi.fn().mockReturnValue(''),
}))

const { executeSkill } = await import('../lib/skills/skill-executor')

const context: AgentContext = {
  tenant_id: 'tenant-1',
  agent_id: 'agent-1',
}

const agent = {
  system_prompt: 'Você é um assistente de teste.',
  model: 'claude-sonnet-4-6',
}

const mockResponse = {
  content: 'Resposta do LLM mockado',
  input_tokens: 100,
  output_tokens: 50,
  estimated_cost_usd: 0.001,
  provider: 'mock',
  model: 'mock',
  is_fallback: false,
}
```

- [ ] **Step 2: Adicionar os 2 novos casos de teste ao describe existente**

Adicione os casos abaixo ANTES do caso `'skill desconhecida → retorna ok:false com SKILL_NOT_FOUND'` (última posição do describe):

```typescript
  it('wiki:ingest → extrai páginas e retorna ok:true com contagem', async () => {
    const mockResult: ExtractResult = {
      pages: [
        {
          slug: 'conceito-teste',
          title: 'Conceito Teste',
          type: 'conceito',
          content: 'Conteúdo do conceito teste.',
          confidence: 'alta',
          sources: ['doc.pdf'],
          tags: ['teste'],
        },
        {
          slug: 'entidade-teste',
          title: 'Entidade Teste',
          type: 'entidade',
          content: 'Descrição da entidade.',
          confidence: 'media',
          sources: ['doc.pdf'],
          tags: [],
        },
      ],
      invalid_reasons: [],
      log_entry: 'Extraídas 2 páginas de doc.pdf',
    }
    vi.mocked(extractPagesFromContent).mockResolvedValue(mockResult)
    mockUpsertStrategicPage.mockResolvedValue({ id: 'page-uuid-1' })

    const result = await executeSkill(
      'wiki:ingest',
      context,
      { content: 'Texto do documento a ser ingerido.', source_name: 'doc.pdf' },
      agent,
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.answer).toContain('2 páginas extraídas')
      expect(result.data.answer).toContain('2 persistidas')
      expect(result.data.answer).toContain('doc.pdf')
    }
    expect(mockUpsertStrategicPage).toHaveBeenCalledTimes(2)
    expect(mockUpsertStrategicPage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        slug: 'conceito-teste',
        author_type: 'agent',
      }),
    )
  })

  it('wiki:ingest → retorna INVALID_INPUT quando content está ausente', async () => {
    const result = await executeSkill('wiki:ingest', context, { source_name: 'doc.pdf' }, agent)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT')
    }
    expect(mockUpsertStrategicPage).not.toHaveBeenCalled()
  })
```

- [ ] **Step 3: Rodar os novos testes para confirmar que falham**

```bash
cd packages/agents && npx vitest run src/__tests__/skill-executor.test.ts --reporter=verbose
```

Expected: 2 novos testes FAIL com `wiki:ingest not yet implemented` (SKILL_NOT_FOUND) ou similar. Os 4 testes existentes devem continuar PASS.

---

## Task 2: Implementar wiki:ingest no SkillExecutor

**Files:**
- Modify: `packages/agents/src/lib/skills/skill-executor.ts`

- [ ] **Step 1: Atualizar imports no topo do arquivo**

Substitua as primeiras 6 linhas do arquivo (imports atuais):

```typescript
import type { SkillId, AgentResult, AgentContext } from '@ethra-nexus/core'
import { embed, extractPagesFromContent } from '@ethra-nexus/wiki'
import { createRegistryFromEnv } from '../provider'
import { createWikiDb } from '../db'
import { getDb } from '@ethra-nexus/db'
import { sql } from 'drizzle-orm'
```

- [ ] **Step 2: Adicionar branch wiki:ingest no dispatcher executeSkill()**

No corpo de `executeSkill()`, adicione o branch logo após o `wiki:lint`:

```typescript
  if (skill_id === 'wiki:ingest') {
    return executeWikiIngest(skill_id, context, input, ts)
  }
```

O dispatcher completo ficará assim (mostre apenas a função executeSkill para contexto):

```typescript
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
```

- [ ] **Step 3: Implementar a função executeWikiIngest()**

Adicione a função ao final do arquivo (após `executeWikiLint`):

```typescript
async function executeWikiIngest(
  skill_id: SkillId,
  context: AgentContext,
  input: SkillInput,
  ts: string,
): Promise<AgentResult<SkillOutput>> {
  const content = typeof input['content'] === 'string' ? input['content'] : ''
  const sourceName = typeof input['source_name'] === 'string' ? input['source_name'] : 'unknown'

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
  if (failedSlugs.length > 0) parts.push(`Falhas: ${failedSlugs.join(', ')}.`)
  if (extraction.invalid_reasons.length > 0) {
    parts.push(`Páginas inválidas descartadas: ${extraction.invalid_reasons.length}.`)
  }
  const answer = parts.join(' ')

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
```

- [ ] **Step 4: Rodar todos os testes do skill-executor**

```bash
cd packages/agents && npx vitest run src/__tests__/skill-executor.test.ts --reporter=verbose
```

Expected:
```
✓ wiki:query → executa executeWikiQuery e retorna ok:true
✓ channel:respond → usa o mesmo handler que wiki:query
✓ wiki:lint → executa executeWikiLint e retorna ok:true com métricas
✓ wiki:ingest → extrai páginas e retorna ok:true com contagem
✓ wiki:ingest → retorna INVALID_INPUT quando content está ausente
✓ skill desconhecida → retorna ok:false com SKILL_NOT_FOUND

Test Files  1 passed (1)
Tests       6 passed (6)
```

- [ ] **Step 5: Rodar typecheck do package agents**

```bash
cd packages/agents && npx tsc --noEmit
```

Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/lib/skills/skill-executor.ts \
        packages/agents/src/__tests__/skill-executor.test.ts
git commit -m "feat(agents): implement wiki:ingest skill — extract + persist + embed"
```

---

## Task 3: Rodar suite completa e verificar

**Files:** Nenhum — verificação

- [ ] **Step 1: Rodar todos os testes do monorepo**

```bash
cd p:/ME/Atitude45/Projetos/CLAUDE/Ethra-Nexus
npx vitest run --reporter=verbose 2>&1 | tail -15
```

Expected:
```
Test Files  9 passed (9)
Tests       87 passed | 15 skipped (102)
```

(87 = 85 anteriores + 2 novos para wiki:ingest)

- [ ] **Step 2: Commit do push final**

```bash
git push origin main
```

Expected: pipeline GitHub Actions verde (ci → security → docker → deploy).
