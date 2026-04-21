# Fase 21A — CRUD Completo de Agentes

**Data:** 2026-04-21  
**Status:** Aprovado  
**Escopo:** Expandir POST /agents + adicionar PATCH + DELETE + migration de identidade e canais

---

## Contexto

O `POST /agents` atual aceita apenas 5 campos (`name`, `slug`, `role`, `model`, `system_prompt`, `budget_monthly`). Não existem endpoints PATCH nem DELETE. A spec define agentes com 5 dimensões (identidade, skills, ativação, canais, orçamento), mas o backend só persiste a dimensão mínima de identidade.

Esta fase fecha os gaps de CRUD sem tocar na Fase 21B (skills management endpoints) nem 21D (budget granular). Skills e canais podem ser passados na criação/atualização, mas o gerenciamento individual de cada skill/canal fica para fases posteriores.

---

## Decisões de design

- **Abordagem cirúrgica (Opção A):** sem migrations destrutivas. O campo JSONB `config` na tabela `agents` fica como legado — nenhuma escrita nova vai para ele. Novos campos vão em colunas próprias ou tabelas próprias.
- **`agent_channels`** como nova tabela (não JSONB em `agents`): canais são polimórficos, mas não precisamos filtrar dentro do config por campo — uma tabela com `config JSONB` por canal é correto aqui.
- **UNIQUE (agent_id, channel_type):** um canal por tipo por agente. Simplifica o upsert no PATCH.
- **Soft delete:** `DELETE /agents/:id` muda status para `archived`. Não apaga dados.
- **Slug imutável:** uma vez criado, o slug não pode ser alterado via PATCH (afeta wiki_scope e referências externas).
- **Skills no POST/PATCH:** upsert por `skill_id`. Criar `agent_skills` se não existir, atualizar se existir.

---

## Camada de dados

### Migration 012 — `infra/supabase/migrations/012_agent_identity_channels.sql`

```sql
-- Safe: apenas ADD COLUMN IF NOT EXISTS (com DEFAULT) e CREATE TABLE
-- description/avatar_url/tags podem já existir da migration 002 — IF NOT EXISTS é idempotente

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS description         TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url          TEXT,
  ADD COLUMN IF NOT EXISTS tags                TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS system_prompt_extra TEXT,
  ADD COLUMN IF NOT EXISTS response_language   TEXT NOT NULL DEFAULT 'pt-BR',
  ADD COLUMN IF NOT EXISTS tone                TEXT NOT NULL DEFAULT 'professional'
    CHECK (tone IN ('formal','professional','friendly','technical','custom')),
  ADD COLUMN IF NOT EXISTS restrictions        TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS agent_channels (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id),
  agent_id     UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  channel_type TEXT        NOT NULL
    CHECK (channel_type IN ('whatsapp','webchat','email','webhook','slack','api')),
  enabled      BOOLEAN     NOT NULL DEFAULT true,
  config       JSONB       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, channel_type)
);

ALTER TABLE agent_channels ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS agent_channels_agent_id_idx  ON agent_channels(agent_id);
CREATE INDEX IF NOT EXISTS agent_channels_tenant_id_idx ON agent_channels(tenant_id);
```

### Drizzle schema — `packages/db/src/schema/core.ts`

Adicionar ao objeto `agents` (confirmar quais já existem antes de adicionar — evitar duplicata):
```typescript
description:         text('description'),
avatar_url:          text('avatar_url'),
tags:                text('tags').array().notNull().default([]),
system_prompt_extra: text('system_prompt_extra'),
response_language:   text('response_language').notNull().default('pt-BR'),
tone:                text('tone').notNull().default('professional'),
restrictions:        text('restrictions').array().notNull().default([]),
```

Adicionar nova tabela `agentChannels`:
```typescript
export const agentChannels = pgTable('agent_channels', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenant_id:    uuid('tenant_id').notNull().references(() => tenants.id),
  agent_id:     uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  channel_type: text('channel_type').notNull(),
  enabled:      boolean('enabled').notNull().default(true),
  config:       jsonb('config').notNull().default({}),
  created_at:   timestamp('created_at').defaultNow().notNull(),
  updated_at:   timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  agentChannelsAgentIdIdx:  index('agent_channels_agent_id_idx').on(table.agent_id),
  agentChannelsTenantIdIdx: index('agent_channels_tenant_id_idx').on(table.tenant_id),
  agentChannelsUnique:      unique('agent_channels_agent_channel_type_unique').on(table.agent_id, table.channel_type),
}))
```

Exportar `agentChannels` em `packages/db/src/schema/index.ts`.

---

## Endpoints

### Tipos compartilhados (novo arquivo `apps/server/src/routes/agents.types.ts`)

```typescript
export const VALID_SKILL_IDS = [
  'wiki:query', 'wiki:ingest', 'wiki:lint',
  'channel:respond', 'channel:proactive',
  'report:generate', 'monitor:health', 'monitor:alert',
  'data:analyze', 'data:extract',
] as const

export const VALID_CHANNEL_TYPES = [
  'whatsapp', 'webchat', 'email', 'webhook', 'slack', 'api',
] as const

export const VALID_TONES = [
  'formal', 'professional', 'friendly', 'technical', 'custom',
] as const

export function isValidSkillId(id: string): boolean {
  return (VALID_SKILL_IDS as readonly string[]).includes(id)
    || /^custom:[a-z0-9-]+$/.test(id)
}

export interface SkillInput {
  skill_id: string
  enabled?: boolean
  provider_override?: { provider: string; model: string }
  max_tokens_per_call?: number
  max_calls_per_hour?: number
  timeout_ms?: number
}

export interface ChannelInput {
  channel_type: string
  enabled?: boolean
  config: Record<string, unknown>
}
```

---

### POST /agents (expandido)

**Body:**
```typescript
{
  // Obrigatórios
  name: string
  slug: string
  role: string

  // Identidade (opcionais)
  model?: string               // default: 'claude-sonnet-4-6'
  system_prompt?: string       // default: ''
  system_prompt_extra?: string
  response_language?: string   // default: 'pt-BR'
  tone?: string                // default: 'professional'
  restrictions?: string[]      // default: []
  description?: string
  avatar_url?: string
  tags?: string[]
  budget_monthly?: string      // default: '50.00'

  // Skills (opcional)
  skills?: SkillInput[]

  // Canais (opcional)
  channels?: ChannelInput[]
}
```

**Fluxo:**
1. Validar campos obrigatórios
2. Validar `slug` com `validateSlug()`
3. Validar `tone` se fornecido
4. Validar cada `skill_id` com `isValidSkillId()`
5. Validar cada `channel_type` contra `VALID_CHANNEL_TYPES`
6. Validar `config` mínimo por `channel_type` (ver abaixo)
7. `db.transaction()`:
   - `INSERT INTO agents`
   - `INSERT INTO agent_skills` (para cada skill)
   - `INSERT INTO agent_channels` (para cada canal)
8. Retornar `201` com agente + skills + canais

**Resposta 201:**
```json
{
  "data": {
    "id": "uuid",
    "name": "...",
    "slug": "...",
    "role": "...",
    "model": "claude-sonnet-4-6",
    "system_prompt": "...",
    "system_prompt_extra": null,
    "response_language": "pt-BR",
    "tone": "professional",
    "restrictions": [],
    "description": null,
    "avatar_url": null,
    "tags": [],
    "budget_monthly": "50.00",
    "status": "active",
    "skills": [...],
    "channels": [...],
    "created_at": "...",
    "updated_at": "..."
  }
}
```

**Erros:**
- `400` — campo obrigatório ausente, slug inválido, tone inválido, skill_id inválido, channel_type inválido, config de canal incompleto
- `409` — slug já existe para este tenant (constraint violation)

---

### PATCH /agents/:id

**Body:** todos os campos do POST, exceto `slug` (imutável). Partial update — omitir campo = não atualizar.

Para `skills` e `channels`: upsert completo do array enviado.
- Skills não enviadas no array **não são removidas** (para remoção, Fase 21B).
- Canais não enviados no array **não são removidos** (para remoção, Fase 21C).
- Se `skills: []` for enviado, nenhuma operação é executada em skills.

**Fluxo:**
1. Verificar que agente existe e pertence ao tenant (404 se não)
2. Verificar que agente não está `archived` (404)
3. Validar campos fornecidos
4. `db.transaction()`:
   - `UPDATE agents SET ... WHERE id = :id AND tenant_id = :tenantId`
   - Para cada skill: `INSERT ... ON CONFLICT (agent_id, skill_name) DO UPDATE SET ...`
   - Para cada canal: `INSERT ... ON CONFLICT (agent_id, channel_type) DO UPDATE SET ...`
5. Retornar `200` com agente atualizado + skills + canais completos

**Erros:**
- `400` — validação de campos
- `404` — agente não existe neste tenant ou está arquivado

---

### DELETE /agents/:id

Soft delete.

**Fluxo:**
1. Verificar que agente existe e pertence ao tenant
2. Verificar que agente não está já `archived` (404)
3. `UPDATE agents SET status = 'archived', updated_at = NOW()`
4. Retornar `204 No Content`

**Erros:**
- `404` — agente não existe, pertence a outro tenant, ou já arquivado

---

### GET /agents e GET /agents/:id (ajustados)

- `GET /agents`: filtra `status != 'archived'`; retorna skills e canais via LEFT JOIN
- `GET /agents/:id`: retorna skills e canais; retorna 404 se arquivado

---

## Validação de config por canal

Validação leve — verifica apenas campos obrigatórios mínimos:

| canal_type | campos obrigatórios no config |
|---|---|
| `whatsapp` | `evolution_instance` (string) |
| `webhook`  | `endpoint_url` (string, começa com `https://`) |
| `email`    | `address` (string, contém `@`) |
| `webchat`  | nenhum obrigatório |
| `slack`    | `bot_token` (string) |
| `api`      | nenhum obrigatório |

---

## Arquivos modificados / criados

| Arquivo | Operação |
|---|---|
| `infra/supabase/migrations/012_agent_identity_channels.sql` | Criar |
| `packages/db/src/schema/core.ts` | Modificar — novos campos em `agents` + tabela `agentChannels` |
| `packages/db/src/schema/index.ts` | Modificar — exportar `agentChannels` |
| `apps/server/src/routes/agents.types.ts` | Criar — tipos e validadores compartilhados |
| `apps/server/src/routes/agents.ts` | Modificar — expandir POST, adicionar PATCH/DELETE, ajustar GETs |
| `packages/agents/src/lib/db/db-agents.ts` | Modificar se necessário — helper de load agent+skills+channels |

---

## Testes

Arquivo: `apps/server/src/routes/__tests__/agents.test.ts` (novo ou expandir existente)

```
POST /agents
  ✓ cria com campos mínimos (name, slug, role)
  ✓ cria com identidade completa (tone, language, restrictions)
  ✓ cria com skills
  ✓ cria com canais
  ✓ retorna 400 para slug inválido
  ✓ retorna 409 para slug duplicado no tenant
  ✓ retorna 400 para skill_id inválido
  ✓ retorna 400 para channel_type inválido
  ✓ retorna 400 para config de canal incompleto (whatsapp sem evolution_instance)
  ✓ rollback: agente não criado se insert de skill falhar

PATCH /agents/:id
  ✓ atualiza system_prompt
  ✓ atualiza tone e response_language
  ✓ upsert de skill nova
  ✓ upsert de skill existente (atualiza config)
  ✓ upsert de canal novo
  ✓ upsert de canal existente
  ✓ não altera skills não enviadas
  ✓ retorna 404 para agente de outro tenant
  ✓ retorna 404 para agente arquivado

DELETE /agents/:id
  ✓ muda status para 'archived'
  ✓ retorna 204
  ✓ retorna 404 para agente já arquivado
  ✓ retorna 404 para agente de outro tenant

GET /agents
  ✓ não retorna agentes arquivados
  ✓ retorna skills e canais embutidos

GET /agents/:id
  ✓ retorna 404 para agente arquivado
  ✓ retorna skills e canais embutidos
```

---

## Critérios de aceite

- [ ] `npm run typecheck` passa sem erros
- [ ] `npm run lint` passa sem warnings
- [ ] `npm run test` passa (todos os casos acima)
- [ ] Migration aplicada sem erro no banco local e na VPS
- [ ] POST com body completo (identidade + skills + canais) retorna agente completo
- [ ] PATCH atualiza campos parcialmente sem afetar campos não enviados
- [ ] DELETE arquiva agente; `GET /agents` não o retorna mais
- [ ] Agente de outro tenant retorna 404 em todas as operações

---

*Spec gerada em 2026-04-21 — aprovada pelo usuário antes da implementação.*
