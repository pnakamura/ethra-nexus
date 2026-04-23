# Fase 22A — Wiki Runtime: Configuração por Agente e Write-back de Lições

**Data:** 2026-04-23  
**Status:** Aprovado  
**Escopo:** Wiki configurável por agente + WikiWriter com síntese LLM pós-execução

---

## Contexto

O `executeWikiQuery` já implementa RAG (lê wiki antes de responder), mas com valores hardcoded: `wiki_min_score = 0.30`, `wiki_top_k = 5`, sem write-back após execução.

Esta fase fecha dois gaps:
1. **Configuração por agente** — cada agente define seus próprios thresholds de relevância
2. **Write-back de lições** — após cada execução bem-sucedida, um modelo barato sintetiza a interação numa página wiki estruturada

Baseado no conceito Karpathy: agentes leem a wiki antes de agir e escrevem lições após agir, acumulando conhecimento organizacional sem retraining.

---

## Decisões de design

- **Default `wiki_write_mode`: `supervised`** — protege contra writes automáticos não-intencionais em produção. Modo `auto` deve ser habilitado explicitamente por agente.
- **WikiWriter é non-fatal** — falha de write-back nunca bloqueia ou altera a resposta ao usuário.
- **WikiWriter chama Groq (OpenRouter, `sensitive_data: false`)** — a lição é uma síntese semântica, não contém dados brutos do usuário. Custo ~$0.0001/execução.
- **`wiki_min_score` default sobe de 0.30 para 0.72** — 0.30 era permissivo demais (ruído). 0.72 garante que apenas páginas genuinamente relacionadas entram no contexto do agente.
- **Sem novos endpoints** — os 4 campos wiki entram no `PATCH /agents/:id` existente.
- **Aprovação de drafts (`supervised`)** — deferred para Fase 22 (UI de review).
- **`aios_event_id` em `wiki_agent_writes`** — rastreabilidade sem `wiki_execution_log` (YAGNI).
- **Slug de lição**: `lesson-{timestamp}-{slug-do-titulo}` — garante unicidade sem colisão.

---

## Arquivos modificados / criados

| Arquivo | Operação |
|---|---|
| `infra/supabase/migrations/013_wiki_runtime.sql` | Criar |
| `packages/db/src/schema/core.ts` | Modificar — 4 colunas em `agents` |
| `packages/db/src/schema/wiki.ts` | Modificar — `aios_event_id` em `wiki_agent_writes` |
| `packages/agents/src/lib/wiki/wiki-writer.ts` | Criar (novo diretório `lib/wiki/`) |
| `packages/agents/src/lib/skills/skill-executor.ts` | Modificar — wiki config + WikiWriter call |
| `packages/agents/src/lib/aios/aios-master.ts` | Modificar — passar wiki config ao executor |
| `apps/server/src/routes/agents.ts` | Modificar — 4 campos no PATCH body |
| `apps/server/src/__tests__/e2e/agents.test.ts` | Modificar — testes dos novos campos e WikiWriter |

---

## Migration 013

```sql
-- Migration 013: wiki runtime — config por agente + link de write-back
-- Safe: apenas ADD COLUMN com DEFAULT, sem rewrite de dados existentes

ALTER TABLE agents ADD COLUMN wiki_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE agents ADD COLUMN wiki_top_k INTEGER NOT NULL DEFAULT 5;
ALTER TABLE agents ADD COLUMN wiki_min_score NUMERIC(4,2) NOT NULL DEFAULT 0.72;
ALTER TABLE agents ADD COLUMN wiki_write_mode TEXT NOT NULL DEFAULT 'supervised';

ALTER TABLE wiki_agent_writes ADD COLUMN aios_event_id UUID REFERENCES aios_events(id);
```

---

## Schema Drizzle

### `packages/db/src/schema/core.ts` — tabela `agents`

Adicionar após `budget_monthly`:

```typescript
wiki_enabled: boolean('wiki_enabled').notNull().default(true),
wiki_top_k: integer('wiki_top_k').notNull().default(5),
wiki_min_score: numeric('wiki_min_score', { precision: 4, scale: 2 }).notNull().default('0.72'),
wiki_write_mode: text('wiki_write_mode').notNull().default('supervised'),
```

### `packages/db/src/schema/wiki.ts` — tabela `wiki_agent_writes`

Adicionar após `origin_ticket_id`:

```typescript
aios_event_id: uuid('aios_event_id'),
```

---

## WikiWriter — `packages/agents/src/lib/wiki/wiki-writer.ts`

```typescript
import { createRegistryFromEnv } from '../provider'
import { embed } from '@ethra-nexus/wiki'
import { getDb } from '@ethra-nexus/db'
import { wikiAgentWrites, wikiAgentPages } from '@ethra-nexus/db'
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
      'title' in parsed &&
      'type' in parsed &&
      'content' in parsed &&
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
  const validTypes = ['padrao', 'procedimento', 'conceito', 'referencia']
  const type = validTypes.includes(lesson.type) ? lesson.type : 'padrao'

  // Gerar embedding — non-fatal
  let embedding: number[] | null = null
  try {
    embedding = await embed(`${lesson.title}\n${lesson.content}`)
  } catch {
    // continua sem embedding — pode ser gerado depois via wiki:lint
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

---

## executeSkill — mudanças em `skill-executor.ts`

### Assinatura estendida

```typescript
export async function executeSkill(
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
): Promise<AgentResult<SkillOutput>>
```

### executeWikiQuery — mudanças

1. **Early exit se wiki desabilitada:**
```typescript
if (!agent.wiki_enabled) {
  wikiContext = ''
} else {
  // busca semântica existente, com config por agente:
  // LIMIT ${agent.wiki_top_k} nas queries SQL
  // .filter(r => r.similarity > agent.wiki_min_score)
  // .slice(0, agent.wiki_top_k)
}
```

2. **Call WikiWriter pós-execução:**
```typescript
// após o return do completion — fire and forget, non-fatal
void writeLesson({
  agent_id: context.agent_id,
  tenant_id: context.tenant_id,
  aios_event_id: context.session_id,
  question,
  answer: completion.content,
  write_mode: agent.wiki_write_mode,
}).catch(() => undefined)
```

---

## aios-master.ts — mudanças

Passar wiki config na chamada a `executeSkill`:

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

---

## agents.ts — mudanças no PATCH /agents/:id

### Body type — adicionar:
```typescript
wiki_enabled?: boolean
wiki_top_k?: number
wiki_min_score?: number
wiki_write_mode?: 'auto' | 'supervised' | 'manual'
```

### Validação:
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

### agentUpdate — adicionar:
```typescript
if (body.wiki_enabled !== undefined) agentUpdate.wiki_enabled = body.wiki_enabled
if (body.wiki_top_k !== undefined) agentUpdate.wiki_top_k = body.wiki_top_k
if (body.wiki_min_score !== undefined) agentUpdate.wiki_min_score = body.wiki_min_score
if (body.wiki_write_mode !== undefined) agentUpdate.wiki_write_mode = body.wiki_write_mode
```

---

## Testes

Adicionados em `apps/server/src/__tests__/e2e/agents.test.ts`:

```
PATCH /agents/:id — wiki config
  ✓ atualiza wiki_enabled para false
  ✓ atualiza wiki_top_k (válido: 1–20)
  ✓ retorna 400 para wiki_top_k fora do range (0, 21)
  ✓ atualiza wiki_min_score (válido: 0–1)
  ✓ retorna 400 para wiki_min_score fora do range (< 0, > 1)
  ✓ atualiza wiki_write_mode para auto, supervised, manual
  ✓ retorna 400 para wiki_write_mode inválido
  ✓ campos wiki aparecem no GET /agents/:id

WikiWriter (unit tests em packages/agents)
  ✓ modo manual não gera write
  ✓ modo supervised insere em wiki_agent_writes com status draft
  ✓ modo supervised NÃO insere em wiki_agent_pages
  ✓ modo auto insere em wiki_agent_writes (approved) E wiki_agent_pages
  ✓ falha na síntese LLM não lança exceção (non-fatal)
  ✓ slug gerado contém prefixo 'lesson-' e timestamp
```

---

## Critérios de aceite

- [ ] `npm run typecheck` passa sem erros
- [ ] `npm run lint` passa sem warnings
- [ ] WikiWriter unit tests passam
- [ ] `PATCH /agents/:id` com `wiki_write_mode: 'invalid'` retorna 400
- [ ] `wiki_enabled: false` desabilita a busca semântica completamente
- [ ] Falha no WikiWriter não altera resposta ao usuário
- [ ] Migration 013 aplicada na VPS sem downtime

---

*Spec gerada em 2026-04-23 — aprovada pelo usuário antes da implementação.*
