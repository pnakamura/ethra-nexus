# Phase 7c — Scheduled Activation Design Spec

**Date:** 2026-04-19  
**Status:** Approved  
**Scope:** Ativação por agenda (cron) e por evento para o AIOS Master

---

## 1. Objetivo

Estender o AIOS Master com dois novos modos de ativação além do `on_demand` existente:

- **`scheduled`** — agente executa uma skill em horários definidos por expressão cron, configurável via API
- **`event`** — agente executa uma skill em resposta a eventos internos (budget_alert, wiki_ingested) ou externos (webhook)

O resultado de cada execução é entregue no canal configurado por schedule: `api` (salvo no banco), `whatsapp` (enviado via N8N), ou `both`.

---

## 2. Arquitetura

```
agent_schedules (DB)
  cron_expression, skill_id, input, output_channel
       ↓
  Scheduler Loop — roda a cada 60s no Fastify startup
  • SELECT schedules WHERE next_run_at ≤ NOW() AND enabled
  • Promise.allSettled → executeTask() para cada schedule
  • UPDATE next_run_at + last_run_at após execução
       ↓
  executeTask() — AIOS Master existente (sem alteração)
       ↓
  Output Dispatcher
  • 'api'      → INSERT scheduled_results
  • 'whatsapp' → POST N8N webhook
  • 'both'     → paralelo

agent_event_subscriptions (DB)
  event_type, event_filter, skill_id, input, output_channel
       ↓
  Event Bus — emitEvent(type, payload)
  • filtra subscriptions por event_type + event_filter
  • executeTask() + Output Dispatcher para cada match

Fontes de eventos:
  budget_alert  → aios-master.ts chama emitEvent após insertAuditEntry
  wiki_ingested → skill-executor.ts chama emitEvent após wiki:ingest
  webhook       → POST /webhooks/:agentSlug/:eventType → emitEvent
```

---

## 3. Modelo de dados

### 3.1 `agent_schedules`

```sql
CREATE TABLE agent_schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_id        TEXT NOT NULL,
  cron_expression TEXT NOT NULL,           -- ex: '0 9 * * 1-5'
  input           JSONB NOT NULL DEFAULT '{}',
  output_channel  TEXT NOT NULL DEFAULT 'api', -- 'api' | 'whatsapp' | 'both'
  enabled         BOOLEAN NOT NULL DEFAULT true,
  last_run_at     TIMESTAMPTZ,
  next_run_at     TIMESTAMPTZ NOT NULL,    -- calculado no CREATE/PATCH
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
```

### 3.2 `agent_event_subscriptions`

```sql
CREATE TABLE agent_event_subscriptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  agent_id       UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  event_type     TEXT NOT NULL,  -- 'budget_alert' | 'wiki_ingested' | 'webhook'
  event_filter   JSONB NOT NULL DEFAULT '{}',
  -- budget_alert:  { "threshold": 75 }
  -- webhook:       { "webhook_secret": "..." }
  -- wiki_ingested: {} (sem filtro — dispara em qualquer ingest)
  skill_id       TEXT NOT NULL,
  input          JSONB NOT NULL DEFAULT '{}',
  output_channel TEXT NOT NULL DEFAULT 'api',
  enabled        BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
```

### 3.3 `scheduled_results`

```sql
CREATE TABLE scheduled_results (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  agent_id     UUID NOT NULL REFERENCES agents(id),
  schedule_id  UUID REFERENCES agent_schedules(id) ON DELETE SET NULL,
  skill_id     TEXT NOT NULL,
  answer       TEXT NOT NULL,
  tokens_used  INTEGER NOT NULL DEFAULT 0,
  cost_usd     NUMERIC(10,6) NOT NULL DEFAULT 0,
  triggered_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
```

---

## 4. Rotas da API

### Schedules

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/schedules` | Cria schedule — valida cron, calcula `next_run_at` |
| `GET` | `/schedules?agent_id=` | Lista schedules do tenant |
| `GET` | `/schedules/:id` | Detalhe de um schedule |
| `PATCH` | `/schedules/:id` | Edita campos — se `cron_expression` mudar, recalcula `next_run_at` |
| `DELETE` | `/schedules/:id` | Remove schedule |
| `PATCH` | `/schedules/:id/enable` | Ativa schedule (`enabled = true`) |
| `PATCH` | `/schedules/:id/disable` | Desativa schedule (`enabled = false`) |
| `GET` | `/schedules/:id/results` | Histórico de execuções |

### Event Subscriptions

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/event-subscriptions` | Cria subscription |
| `GET` | `/event-subscriptions?agent_id=` | Lista subscriptions do tenant |
| `PATCH` | `/event-subscriptions/:id` | Edita subscription |
| `DELETE` | `/event-subscriptions/:id` | Remove subscription |
| `PATCH` | `/event-subscriptions/:id/enable` | Ativa |
| `PATCH` | `/event-subscriptions/:id/disable` | Desativa |

### Webhooks (sem JWT)

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/webhooks/:agentSlug/:eventType` | Recebe evento externo — autenticado por `X-Webhook-Secret` |

---

## 5. Novos arquivos

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `infra/supabase/migrations/010_agent_schedules.sql` | CRIAR | 3 novas tabelas + RLS + índices |
| `packages/db/src/schema/schedules.ts` | CRIAR | Drizzle schema das 3 tabelas |
| `packages/agents/src/lib/scheduler/scheduler-loop.ts` | CRIAR | Loop a cada 60s, disparo de schedules vencidos |
| `packages/agents/src/lib/scheduler/event-bus.ts` | CRIAR | `emitEvent()`, lookup de subscriptions, disparo |
| `packages/agents/src/lib/scheduler/output-dispatcher.ts` | CRIAR | Roteamento api / whatsapp / both |
| `packages/agents/src/lib/scheduler/cron-utils.ts` | CRIAR | `calcNextRun()`, `validateCron()` usando `cron-parser` |
| `apps/server/src/routes/schedules.ts` | CRIAR | CRUD + enable/disable + results |
| `apps/server/src/routes/event-subscriptions.ts` | CRIAR | CRUD + enable/disable |
| `apps/server/src/routes/webhooks.ts` | CRIAR | Endpoint público com secret validation |
| `packages/agents/src/lib/aios/aios-master.ts` | MODIFICAR | Chamar `emitEvent('budget_alert', ...)` após insertAuditEntry |
| `packages/agents/src/lib/skills/skill-executor.ts` | MODIFICAR | Adicionar stub `emitEvent('wiki_ingested', ...)` no dispatcher de wiki:ingest (skill não implementada — hook fica pronto para quando for) |
| `packages/agents/src/index.ts` | MODIFICAR | Exportar `startSchedulerLoop`, `emitEvent` |
| `apps/server/src/app.ts` | MODIFICAR | Registrar novas rotas + chamar `startSchedulerLoop()` |
| `packages/db/src/schema/index.ts` | MODIFICAR | Exportar novo schema |

---

## 6. Scheduler Loop — comportamento detalhado

```typescript
// packages/agents/src/lib/scheduler/scheduler-loop.ts

export function startSchedulerLoop(intervalMs = 60_000): NodeJS.Timer {
  return setInterval(async () => {
    const db = getDb()
    const now = new Date()

    const dueSchedules = await db
      .select()
      .from(agentSchedules)
      .where(and(
        eq(agentSchedules.enabled, true),
        lte(agentSchedules.next_run_at, now),
      ))

    await Promise.allSettled(
      dueSchedules.map((schedule) => runSchedule(schedule))
    )
  }, intervalMs)
}

async function runSchedule(schedule) {
  const result = await executeTask({
    tenant_id: schedule.tenant_id,
    agent_id: schedule.agent_id,
    skill_id: schedule.skill_id,
    input: schedule.input,
    activation_mode: 'scheduled',
    activation_source: schedule.id,
    triggered_by: 'scheduler',
  })

  await dispatchOutput(result, schedule)

  await db.update(agentSchedules).set({
    last_run_at: new Date(),
    next_run_at: calcNextRun(schedule.cron_expression),
    updated_at: new Date(),
  }).where(eq(agentSchedules.id, schedule.id))
}
```

---

## 7. Event Bus — comportamento detalhado

```typescript
// packages/agents/src/lib/scheduler/event-bus.ts

export async function emitEvent(
  eventType: 'budget_alert' | 'wiki_ingested' | 'webhook',
  payload: Record<string, unknown>,
  tenantId: string,
  agentId?: string,
): Promise<void> {
  const db = getDb()

  const conditions = [
    eq(agentEventSubscriptions.event_type, eventType),
    eq(agentEventSubscriptions.enabled, true),
    eq(agentEventSubscriptions.tenant_id, tenantId),
  ]
  if (agentId) conditions.push(eq(agentEventSubscriptions.agent_id, agentId))

  const subscriptions = await db
    .select()
    .from(agentEventSubscriptions)
    .where(and(...conditions))

  const matched = subscriptions.filter((sub) => matchesFilter(sub.event_filter, payload))

  await Promise.allSettled(
    matched.map((sub) => runEventSubscription(sub, payload))
  )
}

// Filtro: budget_alert só dispara se payload.threshold >= event_filter.threshold
function matchesFilter(filter, payload): boolean {
  if (!filter || Object.keys(filter).length === 0) return true
  if ('threshold' in filter) return Number(payload['threshold']) >= Number(filter['threshold'])
  return true
}
```

---

## 8. Output Dispatcher

```typescript
// packages/agents/src/lib/scheduler/output-dispatcher.ts

export async function dispatchOutput(
  result: AgentResult<SkillOutput>,
  source: { tenant_id; agent_id; skill_id; output_channel; id? }
): Promise<void> {
  if (!result.ok) return  // erros já registrados no aios_events

  const { answer, tokens_in, tokens_out, cost_usd } = result.data

  await Promise.allSettled([
    source.output_channel !== 'whatsapp'
      ? saveScheduledResult(result, source)
      : Promise.resolve(),
    source.output_channel !== 'api'
      ? sendToWhatsApp(answer, source)
      : Promise.resolve(),
  ])
}

async function sendToWhatsApp(answer: string, source) {
  const webhookUrl = process.env['N8N_WHATSAPP_WEBHOOK_URL']
  if (!webhookUrl) return
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: source.agent_id, answer, source_id: source.id }),
  })
}
```

---

## 9. Segurança

- **Webhook externo**: `X-Webhook-Secret` comparado com `event_filter.webhook_secret` usando `crypto.timingSafeEqual`
- **Cron validation**: `cron-parser` valida expressão antes de salvar — 400 se inválida
- **Tenant isolation**: todas as queries filtram por `tenant_id` do JWT
- **RLS**: habilitado nas 3 novas tabelas
- **`next_run_at` recalculado** imediatamente ao fazer PATCH em `cron_expression` — sem janela de execução dupla

---

## 10. Tratamento de erros

| Situação | Comportamento |
|----------|---------------|
| Schedule com erro | `aios_events` status `error`, `next_run_at` atualizado normalmente |
| Budget excedido | `executeTask` retorna `BUDGET_EXCEEDED`, sem output dispatch |
| `cron_expression` inválida | Rejeitada com HTTP 400 no CREATE/PATCH, nunca chega ao loop |
| N8N webhook indisponível | `sendToWhatsApp` falha silenciosamente — resultado salvo em `scheduled_results` se `output_channel = 'both'` |
| Subscription sem match de filtro | Ignorada silenciosamente |

---

## 11. Dependência nova

```bash
npm install cron-parser
# cron-parser: parse e cálculo de next_run_at para expressões cron
# Sem dependências de worker process — puro Node.js
```
