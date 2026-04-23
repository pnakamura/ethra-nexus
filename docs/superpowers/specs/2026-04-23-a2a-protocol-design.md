# Fase A2A — Protocolo Agent2Agent: Design

**Data:** 2026-04-23
**Status:** Aprovado
**Escopo:** Implementação completa do protocolo A2A v1.0 no Ethra Nexus — servidor (inbound) + cliente (outbound) + SSE streaming + registry de agentes externos

---

## Contexto

O Ethra Nexus já suporta multi-agent chaining interno via call_depth + event-bus + parent_event_id. Esta fase adiciona comunicação A2A na fronteira externa: o Nexus passa a ser um participante do ecossistema A2A (JSON-RPC 2.0 over HTTPS), tanto recebendo tasks de sistemas externos quanto delegando subtasks para agentes externos compatíveis.

O sistema interno de multi-agent não é alterado — A2A é uma camada separada na fronteira da plataforma.

---

## Decisões de design

- **Abordagem:** estender packages existentes (sem novo package) — tipos em `packages/core`, cliente em `packages/agents/src/lib/a2a/`, rotas em `apps/server`
- **Autenticação inbound:** API Key estático (`enx_` prefix, SHA-256 hash no banco) — padrão M2M, não JWT de usuário
- **Agente público:** um agente por tenant com `a2a_enabled = true` serve como embaixador — agentes internos não são expostos diretamente
- **Registry externo:** `POST /api/v1/a2a/agents` descobre + valida + persiste Agent Card — SSRF check na hora do cadastro, não em runtime
- **Skill `a2a:call`:** nova skill built-in, usa `agent_skills` existente com `external_agent_id` no `skill_config`
- **SSE:** polling de `aios_events` a cada 1s, timeout 5 minutos, fecha em estados terminais
- **SSRF:** DNS lookup + blocked IP ranges em `packages/core/src/security/validate.ts` (extensão da função existente)
- **Sem SDK externo:** A2A é HTTP + JSON-RPC 2.0 — ~150 linhas de fetch. Sem dependência `a2a-js`.
- **Falha no agente externo:** fatal para a skill `a2a:call` — retorna `AgentResult` com `ok: false`, `error.retryable: true`

---

## Arquivos criados / modificados

| Arquivo | Operação |
|---|---|
| `infra/supabase/migrations/014_a2a.sql` | Criar |
| `packages/db/src/schema/core.ts` | Modificar — `a2a_enabled` em `agents` |
| `packages/db/src/schema/core.ts` | Modificar — `a2a_context_id` em `aios_events`; novas tabelas `a2aApiKeys`, `externalAgents` |
| `packages/core/src/types/a2a.types.ts` | Criar — AgentCard, A2ATask, A2APart, AgentCardSchema (Zod) |
| `packages/core/src/security/validate.ts` | Modificar — adicionar `validateExternalUrl()` |
| `packages/core/src/types/agent.types.ts` | Modificar — adicionar `'a2a:call'` ao BuiltinSkillId |
| `packages/agents/src/lib/a2a/client.ts` | Criar — A2AClient (sendTask, getTask) |
| `packages/agents/src/lib/a2a/schemas.ts` | Criar — AgentCardSchema Zod |
| `packages/agents/src/lib/skills/skill-executor.ts` | Modificar — handler para `a2a:call` |
| `packages/agents/src/__tests__/a2a-client.test.ts` | Criar |
| `packages/agents/src/__tests__/validate-url.test.ts` | Criar |
| `packages/agents/src/__tests__/skill-executor.test.ts` | Modificar — testes `a2a:call` |
| `apps/server/src/routes/a2a.ts` | Criar — todos os endpoints A2A |
| `apps/server/src/app.ts` | Modificar — registrar rotas A2A |
| `apps/server/src/__tests__/e2e/a2a.test.ts` | Criar |

---

## Migration 014

```sql
-- Migration 014: protocolo A2A — API keys, agentes externos, flag público
-- Safe: ADD COLUMN com DEFAULT + novas tabelas

-- Flag de agente público A2A
ALTER TABLE agents ADD COLUMN a2a_enabled BOOLEAN NOT NULL DEFAULT false;

-- Contexto externo em eventos A2A
ALTER TABLE aios_events ADD COLUMN a2a_context_id TEXT;

-- API keys para autenticação de chamadas A2A de entrada
CREATE TABLE a2a_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE a2a_api_keys ENABLE ROW LEVEL SECURITY;
CREATE INDEX a2a_api_keys_tenant_id_idx ON a2a_api_keys(tenant_id);
CREATE INDEX a2a_api_keys_key_hash_idx ON a2a_api_keys(key_hash);

-- Registry de agentes A2A externos
CREATE TABLE external_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  agent_card JSONB NOT NULL,
  auth_token TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, url)
);

ALTER TABLE external_agents ENABLE ROW LEVEL SECURITY;
CREATE INDEX external_agents_tenant_id_idx ON external_agents(tenant_id);
```

---

## Schema Drizzle

### `packages/core/src/types/a2a.types.ts` (novo)

```typescript
import { z } from 'zod'

export interface AgentCard {
  name: string
  description: string
  url: string
  version: string
  skills: AgentSkill[]
  capabilities?: { streaming?: boolean; pushNotifications?: boolean }
  defaultInputModes?: string[]
  defaultOutputModes?: string[]
}

export interface AgentSkill {
  id: string
  name: string
  description: string
  tags?: string[]
}

export type A2ATaskState = 'submitted' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled'

export interface A2ATask {
  id: string
  contextId?: string
  status: { state: A2ATaskState; message?: string }
  result?: string
}

// Nota: AgentCardSchema (Zod) fica em packages/agents/src/lib/a2a/schemas.ts
// packages/core não depende de zod — mantém apenas os tipos puros aqui
```

### `packages/agents/src/lib/a2a/schemas.ts` (novo)

```typescript
import { z } from 'zod'

export const AgentSkillSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  description: z.string().max(2048),
  tags: z.array(z.string()).optional(),
})

export const AgentCardSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(4096),
  url: z.string().url(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  skills: z.array(AgentSkillSchema).min(1).max(64),
  capabilities: z.object({
    streaming: z.boolean().optional(),
    pushNotifications: z.boolean().optional(),
  }).optional(),
})

export type ValidatedAgentCard = z.infer<typeof AgentCardSchema>
```

### `packages/db/src/schema/core.ts` — tabela `agents`

Adicionar após `wiki_write_mode`:
```typescript
a2a_enabled: boolean('a2a_enabled').notNull().default(false),
```

### `packages/db/src/schema/core.ts` — tabela `aios_events`

Adicionar após `call_depth`:
```typescript
a2a_context_id: text('a2a_context_id'),
```

### Novas tabelas Drizzle em `packages/db/src/schema/core.ts`

```typescript
export const a2aApiKeys = pgTable('a2a_api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  agent_id: uuid('agent_id').notNull().references(() => agents.id),
  name: text('name').notNull(),
  key_hash: text('key_hash').notNull(),
  key_prefix: text('key_prefix').notNull(),
  expires_at: timestamp('expires_at'),
  last_used_at: timestamp('last_used_at'),
  revoked_at: timestamp('revoked_at'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index('a2a_api_keys_tenant_id_idx').on(table.tenant_id),
  keyHashIdx: index('a2a_api_keys_key_hash_idx').on(table.key_hash),
}))

export const externalAgents = pgTable('external_agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  url: text('url').notNull(),
  agent_card: jsonb('agent_card').notNull(),
  auth_token: text('auth_token'),
  status: text('status').notNull().default('active'),
  last_checked_at: timestamp('last_checked_at'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index('external_agents_tenant_id_idx').on(table.tenant_id),
  uniqueTenantUrl: uniqueIndex('external_agents_tenant_url_idx').on(table.tenant_id, table.url),
}))
```

---

## A2A Client — `packages/agents/src/lib/a2a/client.ts`

```typescript
import { validateExternalUrl } from '@ethra-nexus/core'

export class A2AClient {
  constructor(
    private readonly url: string,
    private readonly authToken?: string,
  ) {}

  async sendTask(message: string, contextId?: string): Promise<{ taskId: string }> {
    // validateExternalUrl é chamado no cadastro (POST /api/v1/a2a/agents), não aqui
    const body = {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'tasks/send',
      params: {
        message: { role: 'user', parts: [{ text: message }] },
        ...(contextId && { contextId }),
      },
    }
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.authToken && { Authorization: `Bearer ${this.authToken}` }),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`A2A request failed: ${res.status}`)
    const data = await res.json() as { result?: { id: string }; error?: { message: string } }
    if (data.error) throw new Error(`A2A error: ${data.error.message}`)
    return { taskId: data.result!.id }
  }

  async getTask(taskId: string): Promise<{ state: string; result?: string }> {
    const body = {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'tasks/get',
      params: { id: taskId },
    }
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.authToken && { Authorization: `Bearer ${this.authToken}` }),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    const data = await res.json() as { result?: { status: { state: string }; result?: string } }
    return {
      state: data.result?.status.state ?? 'unknown',
      result: data.result?.result,
    }
  }
}
```

---

## validateExternalUrl — `packages/core/src/security/validate.ts`

Adicionar:
```typescript
import { dns } from 'node:dns/promises'

const BLOCKED_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
]

export async function validateExternalUrl(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new SecurityValidationError('URL inválida')
  }
  if (parsed.protocol !== 'https:') {
    throw new SecurityValidationError('A2A agents devem usar HTTPS')
  }
  const addresses = await dns.lookup(parsed.hostname, { all: true })
  for (const { address } of addresses) {
    if (BLOCKED_RANGES.some((re) => re.test(address))) {
      throw new SecurityValidationError(`IP bloqueado para agente A2A: ${address}`)
    }
  }
}
```

---

## Endpoints A2A — `apps/server/src/routes/a2a.ts`

### `GET /.well-known/agent.json` (público)

Busca o agente com `a2a_enabled = true` do tenant. Aceita `?tenant_slug=` para multi-tenant. Se `tenant_slug` não informado e há múltiplos tenants, retorna 404 com `{ "error": "tenant_slug required" }`. Retorna Agent Card construído dinamicamente das skills habilitadas do agente. Retorna 404 se nenhum agente público configurado para o tenant.

### `POST /api/v1/a2a` (API key auth)

Hook de autenticação: extrai Bearer token → computa SHA-256 → busca `a2a_api_keys` por `key_hash` → valida ativo → injeta `request.tenantId` + `request.a2aAgentId`.

Dispatcher JSON-RPC:
- `tasks/send` → `executeTask()` com `activation_mode: 'a2a'`, `a2a_context_id` → retorna `{ id, status: { state: 'submitted' } }`
- `tasks/get` → busca `aios_events` por id → mapeia status
- `tasks/cancel` → atualiza `aios_events.status = 'canceled'` se `pending|running`
- método desconhecido → `{ error: { code: -32601, message: 'Method not found' } }`

**Mapeamento de estados:**
| `aios_events.status` | A2A state |
|---|---|
| `pending` | `submitted` |
| `running` | `working` |
| `ok` | `completed` |
| `error` | `failed` |
| `canceled` | `canceled` |

### `GET /api/v1/a2a/tasks/:id/events` (SSE, API key auth)

Abre stream SSE. Polling em `aios_events` a cada 1s por mudanças de status. Emite `task/updated` a cada mudança. Fecha em estados terminais. Timeout de 5 minutos.

### Endpoints de gerenciamento (JWT auth)

**API Keys:**
- `POST /api/v1/a2a/keys` — gera `enx_<32bytes-base64url>`, armazena apenas SHA-256, retorna chave uma vez
- `GET /api/v1/a2a/keys` — lista (sem revelar chave, só prefix + metadados)
- `DELETE /api/v1/a2a/keys/:id` — seta `revoked_at = NOW()`

**Registry externo:**
- `POST /api/v1/a2a/agents` — `validateExternalUrl` → fetch `/.well-known/agent.json` → `AgentCardSchema.parse()` → upsert `external_agents`
- `GET /api/v1/a2a/agents` — lista do tenant
- `GET /api/v1/a2a/agents/:id` — detalhes com skills
- `DELETE /api/v1/a2a/agents/:id` — remove

**Agente público:**
- `PATCH /api/v1/agents/:id` já existente — campo `a2a_enabled: boolean` adicionado ao body

---

## Skill `a2a:call` — `packages/agents/src/lib/skills/skill-executor.ts`

Input:
```typescript
{ external_agent_id: string; message: string; wait_for_result?: boolean }
```

Fluxo:
1. Busca `external_agents` por `id` + `tenant_id` (404 se não encontrar ou `status != 'active'`)
2. Instancia `A2AClient(agent.url, agent.auth_token ?? undefined)`
3. `sendTask(message, context.session_id)` → obtém `taskId`
4. Se `wait_for_result !== false`: polling `getTask()` a cada 2s, máximo 30 iterações (60s). Lança erro se timeout.
5. Retorna `AgentResult<{ answer: string; external_task_id: string }>`

Falha → `AgentResult` com `ok: false`, `error.code: 'EXTERNAL_AGENT_ERROR'`, `error.retryable: true`.

---

## Rate limiting

Configurado no hook da rota `POST /api/v1/a2a`:
- 100 requests/minuto por `key_hash`
- 500 requests/hora por `tenant_id`
- Resposta 429: `{ "error": "Rate limit exceeded", "retryAfter": 60 }`

---

## Testes

### Unitários — `packages/agents/src/__tests__/`

**`a2a-client.test.ts`:**
- `sendTask` retorna `taskId` correto com fetch mockado
- `sendTask` lança em resposta não-ok (400, 500)
- `sendTask` lança em timeout (AbortSignal)
- `getTask` mapeia estados corretamente
- `sendTask` com `authToken` inclui header Authorization

**`validate-url.test.ts`:**
- Rejeita `http://` (não HTTPS)
- Rejeita IPs privados: `10.0.0.1`, `192.168.1.1`, `172.16.0.1`, `127.0.0.1`, `169.254.169.254`
- Rejeita hostname que resolve para IP privado (mock DNS)
- Aceita URL HTTPS com IP público válido
- Lança `SecurityValidationError` em todos os casos inválidos

**`skill-executor.test.ts`** (extensão):
- `a2a:call` com `wait_for_result: true` — polling até `completed`
- `a2a:call` com `wait_for_result: false` — retorna `taskId` imediatamente
- Agente externo `status: 'inactive'` — `ok: false`
- Falha no agente externo — `AgentResult` com `error.code: 'EXTERNAL_AGENT_ERROR'`

### E2E — `apps/server/src/__tests__/e2e/a2a.test.ts`

`describe.skipIf(!process.env['DATABASE_URL_TEST'])`:

**Servidor A2A:**
- `GET /.well-known/agent.json` — retorna Agent Card válido (passa `AgentCardSchema.parse()`)
- `GET /.well-known/agent.json` sem agente a2a_enabled — 404
- `POST /api/v1/a2a` sem Authorization — 401
- `POST /api/v1/a2a` com chave revogada — 401
- `POST /api/v1/a2a` com chave expirada — 401
- `POST /api/v1/a2a` `tasks/send` — retorna `state: submitted`
- `POST /api/v1/a2a` método desconhecido — `error.code: -32601`
- `GET /api/v1/a2a/tasks/:id` — retorna estado da task

**Registry externo:**
- `POST /api/v1/a2a/agents` com URL SSRF (`http://localhost`) — 400
- `POST /api/v1/a2a/agents` com Agent Card malformado — 400
- `POST /api/v1/a2a/agents` duplicado — upsert (não duplica)
- `GET /api/v1/a2a/agents` — lista do tenant
- `DELETE /api/v1/a2a/agents/:id` de outro tenant — 404

**API Keys:**
- `POST /api/v1/a2a/keys` — retorna chave com prefixo `enx_`, visível uma vez
- `DELETE /api/v1/a2a/keys/:id` — chamada subsequente com a chave retorna 401

---

## Critérios de aceite

- [ ] `npm run typecheck` passa sem erros em todos os packages
- [ ] `npm run lint` passa sem warnings
- [ ] Testes unitários (`a2a-client`, `validate-url`, `skill-executor`) passam
- [ ] `validateExternalUrl('http://192.168.1.1')` lança `SecurityValidationError`
- [ ] `POST /api/v1/a2a/agents` com `http://localhost` retorna 400
- [ ] `GET /.well-known/agent.json` retorna JSON que passa `AgentCardSchema.parse()`
- [ ] Chave A2A revogada retorna 401 em `POST /api/v1/a2a`
- [ ] Migration 014 aplicada sem downtime

---

*Spec gerada em 2026-04-23 — aprovada pelo usuário antes da implementação.*
