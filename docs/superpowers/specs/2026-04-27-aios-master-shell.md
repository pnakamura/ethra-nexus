# AIOS Master Agent (Shell) — Design Spec

> **Spec #1 de 5** na trilha que termina com o critério de aceite "xlsx → HTML dashboard end-to-end".
> Specs subsequentes (em ordem): #2 File Storage + Alerts · #3 Input Worker + Parsers · #4 Output Worker + HTML Dashboard · #5 Integração E2E.

**Data**: 2026-04-27
**Autor**: Paulo Nakamura (com Claude)
**Status**: Approved for plan writing

---

## Goal

Criar um **agente conversacional read-only** chamado AIOS Master que serve como concierge sobre o estado do sistema Ethra Nexus. Usuário (admin ou member com permissão) abre `/copilot`, conversa em linguagem natural, e o agente responde invocando tools que consultam o estado do tenant: agentes, execuções, custo, wiki, aprovações pendentes, saúde operacional.

## Acceptance criteria (Spec #1)

- Usuário admin abre `/copilot`, vê empty state com chips de pergunta sugerida.
- Click em "Quais agentes estão ativos?" cria thread, dispara turno, agente chama `system:list_agents` e responde com lista.
- Streaming visível: texto aparece progressivamente, tool calls aparecem no painel direito com duração.
- Thread persiste após reload, ganha auto-título (~2s após 1º turno).
- Member sem `copilot_enabled` recebe 403.
- Per-turn caps funcionam (10 tool calls / $0.50 USD).
- Cobertura de testes ≥80% nos arquivos novos do backend.
- Smoke test manual de aceite (lista na seção Testing) passa em todos os 11 itens.

## Out of scope (Spec #1)

- Write tools / mutations (pause agent, approve write, retry event) → Spec #6 ou depois
- Sidepanel global / contextual chat → Spec separado futuro
- Attachments na chat (xlsx upload, etc.) → Specs #2 + #3
- Output artifacts inline (HTML dashboard, PDF) → Spec #4
- UI de toggle do `copilot_enabled` → defer até 2º membro existir
- MCP exposure → Fase D (não-prevista)
- Mobile/responsive → desktop-first como resto do app
- Stop generation button (cancel mid-stream) → defer
- Markdown rich rendering / code highlighting → texto plano + `<pre>` no MVP

---

## Decisions log

| # | Decisão | Escolha |
|---|---------|---------|
| Q1 | Modelo de persistência de conversa | C — múltiplas threads com auto-título |
| Q2 | Escopo de tools no MVP | C — 9 tools (ampliado) |
| Q3 | UI shape | Página dedicada `/copilot` seguindo padrão 3-panel do `OrchestratorPage` |
| Q4 | Tool calling integration | Anthropic Tool Use API nativo (Claude SDK direto, sem ProviderRegistry) |
| Q5 | Modelo padrão | Claude Sonnet 4.6 |
| Q6 | Permission scope | C — admin sempre + member com `tenant_members.copilot_enabled=TRUE` |
| Q7 | Per-turn safety cap | C+E — 10 tool calls e $0.50 USD, env-configurable |
| Q8 | Schema de mensagens | C — Anthropic content blocks JSONB + tabela `copilot_tool_calls` separada para audit |

---

## Architecture overview

```
                    USUÁRIO (admin ou copilot_enabled)
                            │
                            ▼
              ┌─────────────────────────────┐
              │  /copilot (React, 3-panel)  │
              │  threads | chat | tool-log  │
              └─────────────────────────────┘
                            │  fetch + ReadableStream (SSE)
                            ▼
        ┌─────────────────────────────────────────┐
        │  /copilot/conversations/:id/messages    │
        │  Fastify + JWT + tenant_id + permcheck  │
        └─────────────────────────────────────────┘
                            │
                ┌───────────┴────────────┐
                ▼                        ▼
   ┌────────────────────┐    ┌─────────────────────────┐
   │ Anthropic Tool Use │    │ copilot_conversations   │
   │ Sonnet 4.6, multi- │    │ copilot_messages        │
   │ turn agentic loop  │    │ copilot_tool_calls      │
   └────────────────────┘    └─────────────────────────┘
            │
            ▼  tool_use blocks
   ┌─────────────────────────────────┐
   │ Tool Registry (9 read-only)     │
   │ packages/agents/lib/copilot/    │
   │   ├─ system:list_agents         │
   │   ├─ system:get_recent_events   │
   │   ├─ system:explain_event       │
   │   ├─ system:get_budget_status   │
   │   ├─ system:cost_breakdown      │
   │   ├─ system:agent_health        │
   │   ├─ system:list_pending_appr.  │
   │   ├─ system:wiki_query          │
   │   └─ system:list_storage_alerts │ (stub até Spec #2)
   └─────────────────────────────────┘
            │
            ▼
   DB queries via Drizzle, com tenant_id sempre filtrado.
```

**Pontos-chave**:

- AIOS Master é um **agente real** na tabela `agents` (slug `aios-master`). Reusa budget, audit, RLS. Zero código novo de orquestração.
- **Tool registry ≠ Skill registry**. Tools operam em estado da plataforma. Skills operam em dados do usuário. Lugares e contratos diferentes.
- **Multi-turn loop** dentro de um único POST: servidor chama Anthropic → recebe tool_use blocks → executa tools → repassa tool_results → repete até `stop_reason: end_turn`. Caps por turno: 10 chamadas, $0.50.
- **Streaming via Server-Sent Events**, formato `data: <JSON>\n\n` linhas.
- **Permission**: middleware checa `tenant_members.role='admin' OR copilot_enabled=TRUE`.
- `copilot_messages.content` em formato Anthropic native (text / tool_use / tool_result blocks). Specs futuros adicionam novos block types sem migration.
- **Auto-title** via Haiku 4.5 fire-and-forget após 1º turno completo.

---

## Database schema

Migração: `infra/supabase/migrations/012_copilot_tables.sql`.
Schema Drizzle: `packages/db/src/schema/copilot.ts` (novo), exportado de `index.ts`.

### Tabela 1 · `copilot_conversations`

```sql
CREATE TABLE copilot_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  user_id         TEXT NOT NULL,
  agent_id        UUID NOT NULL REFERENCES agents(id),
  title           TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  message_count   INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  total_cost_usd  NUMERIC(10,6) NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE copilot_conversations ENABLE ROW LEVEL SECURITY;
CREATE INDEX cc_tenant_user_recent_idx ON copilot_conversations(tenant_id, user_id, last_message_at DESC);
CREATE INDEX cc_tenant_status_idx      ON copilot_conversations(tenant_id, status);
```

- `user_id` (não shared no tenant): cada user tem suas próprias threads.
- Aggregates denormalizados (`message_count`, `total_tokens`, `total_cost_usd`): atualizados em transação após cada turno. Evita SUM em list rendering.
- `status='archived'` é soft delete (purge real após 30 dias via cron).

### Tabela 2 · `copilot_messages`

```sql
CREATE TABLE copilot_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  role            TEXT NOT NULL,
  content         JSONB NOT NULL,
  model           TEXT,
  tokens_in       INTEGER NOT NULL DEFAULT 0,
  tokens_out      INTEGER NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(10,6) NOT NULL DEFAULT 0,
  stop_reason     TEXT,
  error_code      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE copilot_messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX cm_conv_time_idx   ON copilot_messages(conversation_id, created_at);
CREATE INDEX cm_tenant_role_idx ON copilot_messages(tenant_id, role);
```

`content` segue formato Anthropic content blocks. Exemplos:

```json
// User turn
[{ "type": "text", "text": "quanto gastei esse mês?" }]

// Assistant com tool_use
[
  { "type": "text", "text": "vou checar..." },
  { "type": "tool_use", "id": "toolu_01abc", "name": "system:get_budget_status",
    "input": { "month": "2026-04" } }
]

// User com tool_result (gerado pelo servidor após executar tool)
[{ "type": "tool_result", "tool_use_id": "toolu_01abc",
   "content": "{\"total_usd\": 4.21, \"limit_usd\": 20}" }]

// Assistant resposta final
[{ "type": "text", "text": "Você gastou $4.21 de $20 esse mês (21%)." }]
```

`stop_reason`: `end_turn` | `tool_use` | `max_tokens` | `turn_cap_exceeded`.

### Tabela 3 · `copilot_tool_calls`

```sql
CREATE TABLE copilot_tool_calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID NOT NULL REFERENCES copilot_messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES copilot_conversations(id),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  tool_use_id     TEXT NOT NULL,
  tool_name       TEXT NOT NULL,
  tool_input      JSONB NOT NULL DEFAULT '{}',
  tool_result     JSONB,
  status          TEXT NOT NULL,
  error_code      TEXT,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE copilot_tool_calls ENABLE ROW LEVEL SECURITY;
CREATE INDEX ctc_tenant_tool_time_idx ON copilot_tool_calls(tenant_id, tool_name, created_at DESC);
CREATE INDEX ctc_message_idx          ON copilot_tool_calls(message_id);
CREATE INDEX ctc_status_idx           ON copilot_tool_calls(status);
```

`message_id` aponta para a assistant message que continha o `tool_use` block. `tool_result` é duplicado aqui propositalmente (audit table = denormalizada).

### Alteração 4 · `tenant_members.copilot_enabled`

```sql
ALTER TABLE tenant_members ADD COLUMN copilot_enabled BOOLEAN NOT NULL DEFAULT FALSE;
```

### Seed 5 · Agent `aios-master` para tenant existente

```sql
INSERT INTO agents (
  id, tenant_id, slug, name, role, status, system_prompt,
  model, budget_monthly, wiki_enabled, wiki_top_k,
  wiki_min_score, wiki_write_mode
)
SELECT
  gen_random_uuid(), t.id, 'aios-master', 'AIOS Master',
  'Concierge conversacional', 'active',
  $$<conteúdo do system prompt — ver Tool Registry>$$,
  'claude-sonnet-4-6', 20.00,
  FALSE, 5, 0.72, 'manual'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM agents WHERE tenant_id = t.id AND slug = 'aios-master'
);
```

Para SaaS futuro: hook no signup flow insere `aios-master` ao criar tenant. Não está no escopo deste spec.

---

## Tool registry

### Estrutura de arquivos

```
packages/agents/src/lib/copilot/
├── index.ts
├── tool-registry.ts          # getToolsForAnthropic() + executeToolCall()
├── system-prompt.ts          # builder do system prompt
├── anthropic-client.ts       # Anthropic SDK direto
├── turn-loop.ts              # executeCopilotTurn() — orchestration
├── tools/
│   ├── index.ts              # array com as 9 tools
│   ├── list-agents.ts
│   ├── get-recent-events.ts
│   ├── explain-event.ts
│   ├── get-budget-status.ts
│   ├── cost-breakdown.ts
│   ├── agent-health.ts
│   ├── list-pending-approvals.ts
│   ├── wiki-query.ts
│   └── list-storage-alerts.ts
└── __tests__/
```

### Interface `CopilotTool`

```typescript
export interface CopilotTool<TInput = unknown, TOutput = unknown> {
  name: string                          // 'system:list_agents'
  description: string                   // descrição passada para Claude
  input_schema: JSONSchema7              // JSON Schema (Anthropic format)
  permission: 'all_members' | 'admin_only'
  handler: (input: TInput, ctx: ToolContext) => Promise<TOutput>
}

export interface ToolContext {
  tenant_id: string
  user_id: string
  user_role: 'admin' | 'member'
}
```

### As 9 tools

| # | name | input | retorna | permission |
|---|------|-------|---------|------------|
| 1 | `system:list_agents` | `{status?: 'active'\|'paused'\|'archived'}` | array de `{id, slug, name, role, status, model, budget_monthly, skills_count, channels_count}` | all_members |
| 2 | `system:get_recent_events` | `{limit?: int (default 20, max 100), agent_id?, status?, skill_id?, since?: ISO8601}` | array de `{id, agent_id, agent_name, skill_id, status, started_at, completed_at, tokens_used, cost_usd, error_code, latency_ms}` | all_members |
| 3 | `system:explain_event` | `{event_id: UUID}` | `{event details + payload + result + parent + children + provider_usage}` | all_members |
| 4 | `system:get_budget_status` | `{agent_id?, month?: 'YYYY-MM' (default current)}` | `{total_usd, limit_usd, percent_used, by_agent[], days_until_reset}` | admin_only |
| 5 | `system:cost_breakdown` | `{group_by: 'agent'\|'skill'\|'day'\|'model', period?: 'last_7d'\|'last_30d'\|'this_month' (default), limit?: int}` | array de `{group_value, total_cost_usd, total_tokens, event_count}` | admin_only |
| 6 | `system:agent_health` | `{agent_id: UUID, period?: 'last_24h'\|'last_7d'\|'last_30d' (default last_7d)}` | `{success_rate, error_rate, total_events, p50_latency_ms, p95_latency_ms, top_skills[], top_errors[]}` | all_members |
| 7 | `system:list_pending_approvals` | `{agent_id?}` | array de `{id, agent_name, slug, title, target_wiki, created_at, content_preview}` (de `wiki_agent_writes WHERE status='draft'`) | admin_only |
| 8 | `system:wiki_query` | `{question: string, agent_scope?: string (slug)}` | `{answer: string, sources[]}` (wrapper sobre `executeWikiQuery` de `skill-executor.ts`) | all_members |
| 9 | `system:list_storage_alerts` | `{level?: 'soft_warning'\|'migration_recommended'\|'hard_limit'}` | array de `{level, type, message, fired_at}` (vazio até Spec #2 implementar) | admin_only |

### System prompt

Salvo em `agents.system_prompt` na seed do `aios-master`. Admin pode editar via UI de agentes existente.

```
Você é o AIOS Master, o concierge conversacional do Ethra Nexus — uma
plataforma multi-tenant de orquestração de agentes de IA.

## Sua função
Responder perguntas sobre o estado do sistema do tenant atual:
agentes, execuções, wiki, orçamento, saúde operacional.

## Como agir
- Use as tools antes de responder. Não invente dados que dependam
  de informação atual.
- Seja conciso: 2-4 frases ou tabela quando apropriado.
  Sem prefácios ("Claro!", "Sem problemas").
- Português por padrão. Inglês só se o usuário começar em inglês.
- Cite IDs encurtados: `#3b99571c` (primeiros 8 chars).
- Tabelas markdown para listas com 3+ colunas.
- Sugira ações concretas: "veja em /agents/atendimento" ou "use a
  aba Aprovações na Wiki".
- Quando não souber, diga. Não tente.

## Boundaries
- Você é READ-ONLY. Não pode pausar agentes, aprovar wiki writes, ou
  disparar execuções. Oriente o usuário à UI apropriada.
- Você opera APENAS no tenant atual.
- Sem perguntas pessoais ou fora do escopo da plataforma.
```

### Anthropic client

Como AIOS Master é sempre `sensitive_data: true`, **bypassa o `ProviderRegistry`** — Anthropic direto:

```typescript
// packages/agents/src/lib/copilot/anthropic-client.ts
import Anthropic from '@anthropic-ai/sdk'
export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
```

### Reutilização

- Tool 8 (`system:wiki_query`) chama internamente `executeWikiQuery` que já existe em `packages/agents/src/lib/skills/skill-executor.ts`. Wrapper de ~20 linhas.
- Tools 1-7 são queries Drizzle padrão. ~30-80 linhas cada.
- Tool 9 retorna `[]` no MVP. ~5 linhas.

**Total estimado**: ~700 linhas TypeScript + ~600 linhas testes.

---

## API endpoints

Arquivo novo: `apps/server/src/routes/copilot.ts`. Registrar em `apps/server/src/app.ts` com prefix `/api/v1`.

| Método | Path | Body / Query | Retorna |
|--------|------|--------------|---------|
| POST | `/copilot/conversations` | `{}` | `{data: conversation}` (title null até 1º turno) |
| GET | `/copilot/conversations` | `?status=active&limit=20` | `{data: conversation[]}` ordenado por `last_message_at DESC` |
| GET | `/copilot/conversations/:id` | — | `{data: {conversation, messages: []}}` |
| POST | `/copilot/conversations/:id/messages` | `{content: string}` | **SSE stream** |
| PATCH | `/copilot/conversations/:id` | `{title?, status?}` | `{data: conversation}` |
| DELETE | `/copilot/conversations/:id` | — | 204 (soft delete: status='archived') |

### Permission — duas camadas

**Camada 1 (middleware, gross-grained)**: controla quem pode falar com o copilot.

```typescript
async function requireCopilotAccess(request, reply) {
  const userId = request.user.sub
  const [member] = await db.select().from(tenantMembers)
    .where(and(
      eq(tenantMembers.user_id, userId),
      eq(tenantMembers.tenant_id, request.tenantId),
    ))
    .limit(1)
  if (!member) return reply.status(403).send({ error: 'Not a member' })
  if (member.role !== 'admin' && !member.copilot_enabled) {
    return reply.status(403).send({ error: 'Copilot access not enabled' })
  }
  request.userId = userId
  request.userRole = member.role
}
```

Aplicado via `app.addHook('preHandler', requireCopilotAccess)` na função que registra rotas copilot.

**Camada 2 (per-tool, fine-grained)**: dentro do `executeToolCall`, antes de chamar o handler:

```typescript
if (tool.permission === 'admin_only' && ctx.user_role !== 'admin') {
  return { result: null, durationMs: 0, error: 'PERMISSION_DENIED' }
}
```

Resultado: admin acessa tudo. Member com `copilot_enabled=TRUE` pode conversar mas tools financeiras (`get_budget_status`, `cost_breakdown`, `list_pending_approvals`, `list_storage_alerts`) retornam erro permission denied como `tool_result`. O agente comunica isso ao usuário em linguagem natural ("não tenho acesso a custos pra você").

### Validações de input

| Endpoint | Validação | Status code se falha |
|----------|-----------|---------------------|
| `POST /messages` | `content.length > 0` | 400 (`CONTENT_EMPTY`) |
| `POST /messages` | `content.length <= 50000` | 413 (`CONTENT_TOO_LARGE`) |
| `POST /messages` | conversation pertence ao user | 404 |
| `POST /messages` | conversation.status === 'active' | 409 (`CONVERSATION_ARCHIVED`) |
| `POST /messages` | budget mensal do `aios-master` permite | 402 (`BUDGET_EXCEEDED`) |
| `POST /messages` | sem turno em progresso na mesma conv | 409 (`TURN_IN_PROGRESS`) |

---

## Turn loop algorithm

Implementado em `packages/agents/src/lib/copilot/turn-loop.ts`. Função `executeCopilotTurn(params)`.

```
1. PRE-CHECK
   - conversation pertence ao user
   - conversation.status = 'active'
   - content válido (length, etc.)
   - budget mensal do aios-master via agentsDb.canExecute(agent.id, month, 0.05)
   - lock por conversation_id (Map em-memória; reject se já locked)

2. INSERT user message (role='user', content=[{type:'text', text:body.content}])
   - Update conversation.message_count++, last_message_at = NOW()

3. ABRE SSE STREAM
   - reply.raw.writeHead(200, headers SSE)
   - emit { type: 'turn_start', user_message_id }

4. INICIALIZA TURN STATE
   - tool_calls_count = 0
   - turn_cost_usd = 0
   - MAX_TOOLS = parseInt(env.COPILOT_MAX_TOOLS_PER_TURN ?? '10')
   - MAX_COST  = parseFloat(env.COPILOT_MAX_COST_PER_TURN_USD ?? '0.50')

5. CARREGA HISTÓRICO
   - SELECT * FROM copilot_messages WHERE conversation_id=:id ORDER BY created_at
   - Converte rows para Anthropic messages format

6. LOOP AGENTIC
   while true:
     a. Stream call para anthropic.messages.create:
        - model: 'claude-sonnet-4-6'
        - system: agent.system_prompt
        - tools: getToolsForAnthropic()
        - messages: [...history, ...new_in_turn]
        - max_tokens: 4000
        - stream: true

     b. Lê stream do Anthropic, encaminha para SSE do cliente:
        - text deltas    → emit { type: 'text_delta', delta }
        - tool_use start → emit { type: 'tool_use_start', tool_use_id, tool_name, tool_input }
        - message stop   → break inner stream loop

     c. Acumula tokens_in/out e message_cost_usd
        turn_cost_usd += message_cost_usd

     d. INSERT assistant message (role='assistant', content=blocks)
        emit { type: 'assistant_message_complete', message_id, tokens_in, tokens_out, cost_usd, stop_reason }

     e. CHECK: turn_cost_usd > MAX_COST?
        - emit { type: 'error', code: 'TURN_COST_EXCEEDED' }
          update message.stop_reason = 'turn_cap_exceeded'
          break outer loop

     f. CHECK: stop_reason !== 'tool_use'?
        - break outer loop (end_turn ou max_tokens)

     g. Para cada tool_use block na resposta (executados SEQUENCIALMENTE no MVP — paralelização fica para v2):
        tool_calls_count++

        - CHECK: tool_calls_count > MAX_TOOLS?
          - emit { type: 'error', code: 'TURN_TOOLS_EXCEEDED' }
            break outer loop

        - executeToolCall(name, input, ctx) → { result, durationMs, error? }
          (interno: aplica camada 2 de permission antes de chamar o handler)

        - INSERT copilot_tool_calls row com status, tool_input, tool_result, duration_ms

        - emit { type: 'tool_use_complete', tool_use_id, status, duration_ms }

     h. Compõe nova user message com tool_result blocks
        Wraps cada result em <tool_output tool="...">{json}</tool_output> (defensive)
        INSERT copilot_messages row (role='user', content=[tool_result, ...])
        Continue outer loop

7. POST-PROCESSAMENTO (transação)
   - Update conversation:
       message_count += número de messages criadas
       total_tokens += turn_tokens
       total_cost_usd += turn_cost_usd
       last_message_at = NOW()
   - emit { type: 'turn_complete', total_tokens, total_cost_usd, tool_call_count }

8. AUTO-TITLE (se conversation.title === null E sucesso E ≥1 assistant message)
   - fire-and-forget call para anthropic com Haiku 4.5:
     - system: "Resuma esta conversa em 4-6 palavras em português, sem aspas."
     - messages: primeiras 2-4 messages (somente conteúdo de texto)
     - max_tokens: 30
   - Custo desta call (~$0.0001) é debitado do agent.budget_monthly do aios-master via agentsDb.upsertBudget — mesmo padrão das outras execuções
   - update conversation.title = result.trim()

9. CLEANUP
   - reply.raw.end()
   - libera lock

Em qualquer ponto, se exceção: emit { type: 'error', ... }, salva o que tem, fecha stream.
```

### SSE event types

| `type` | Quando | Payload |
|--------|--------|---------|
| `turn_start` | início do turno | `{user_message_id}` |
| `text_delta` | streaming de texto | `{delta: string}` |
| `tool_use_start` | LLM decidiu usar tool | `{tool_use_id, tool_name, tool_input}` |
| `tool_use_complete` | tool executada | `{tool_use_id, status, duration_ms}` |
| `assistant_message_complete` | uma mensagem assistant fechada | `{message_id, tokens_in, tokens_out, cost_usd, stop_reason}` |
| `turn_complete` | turno todo fechado | `{total_tokens, total_cost_usd, tool_call_count}` |
| `error` | erro fatal | `{code, message}` |

---

## Frontend `/copilot`

### Roteamento

```typescript
// apps/web/src/App.tsx
import { CopilotPage } from '@/pages/CopilotPage'
<Route path="/copilot" element={<CopilotPage />} />
```

```typescript
// apps/web/src/components/layout/Sidebar.tsx
import { Sparkles } from 'lucide-react'
const NAV_ITEMS = [
  { to: '/copilot', icon: Sparkles, label: 'Copilot', group: 'SISTEMA' },
  // ... resto, na ordem atual
]
```

`Copilot` no topo de SISTEMA para fácil descoberta.

### Estrutura de componentes

```
CopilotPage (apps/web/src/pages/CopilotPage.tsx)
│  layout 3-panel idêntico a OrchestratorPage:
│  -mx-8 -mb-8 overflow-hidden, height: calc(100vh - 88px)
│
├── ConversationsSidebar (220px esquerda)
│   ├── botão "Nova conversa"
│   └── lista de threads (auto-titled)
│
├── ChatView (flex-1 centro)
│   ├── ChatHeader (título, tokens totais, custo total)
│   ├── MessageList (scroll auto)
│   │   ├── UserBubble (alinhado à direita)
│   │   ├── AssistantBubble (com streaming text)
│   │   └── ToolUseInlineMarker (compacto, click expande)
│   └── MessageInput (textarea + send)
│
└── ToolCallsLog (280px direita)
    ├── header (turn cost, total cost)
    ├── timeline de tool calls
    │   ├── ToolCallRow (status dot + name + duration)
    │   └── expandable: tool_input/tool_result JSON
    └── session context (model, total tokens, total cost)
```

### Hooks

`apps/web/src/hooks/useCopilot.ts` (novo):

```typescript
useCopilotConversations(filter?)            // GET list
useCopilotConversation(id)                  // GET thread + messages
useCreateConversation()                     // POST
useUpdateConversation()                     // PATCH
useDeleteConversation()                     // DELETE (archive)
useSendCopilotMessage(conversationId)       // streaming custom
```

### Streaming via fetch

`apps/web/src/lib/copilot-stream.ts`:

```typescript
export async function streamCopilotMessage(
  conversationId: string,
  content: string,
  onEvent: (e: SSEEvent) => void,
  signal: AbortSignal,
) {
  const res = await fetch(`/api/v1/copilot/conversations/${conversationId}/messages`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try { onEvent(JSON.parse(line.slice(6))) }
        catch { /* tolera linha mal-formada */ }
      }
    }
  }
}
```

`useSendCopilotMessage` envolve isso, mantém `currentText`, `currentToolCalls`, `isStreaming`. Em `turn_complete`: invalida `['copilot', 'conversation', id]` → TanStack refetch a verdade canônica.

### Empty state

Primeira visita (sem threads): centered illustration + chips com perguntas sugeridas:

- "Quais agentes estão ativos?"
- "Mostre as últimas execuções"
- "Quanto gastei esse mês?"
- "Tem coisa pra aprovar?"

Click em chip = `useCreateConversation()` + `streamCopilotMessage(id, chipText)` em sequência.

### Estimativa de código frontend

| Componente / arquivo | Linhas |
|---------------------|--------|
| CopilotPage | ~150 |
| ConversationsSidebar | ~120 |
| ChatView + MessageList + bubbles | ~250 |
| MessageInput | ~60 |
| ToolCallsLog + ToolCallRow | ~180 |
| useCopilot.ts | ~140 |
| copilot-stream.ts | ~80 |
| **Total frontend** | **~980** |

---

## Error handling

### Princípio

Toda falha persiste estado parcial e comunica claramente. Nunca deixar conversation em estado intermediário sem indicação ao usuário.

### Catálogo

#### Categoria A · Transient (retryable)

| Falha | Tratamento |
|-------|------------|
| Anthropic 5xx | Retry interno com backoff exponencial, máx 2 tentativas. Se ainda falhar: emit `error`, salva message com `error_code='ANTHROPIC_UPSTREAM'` |
| Anthropic rate limit (429) | Mesma estratégia + log em audit_log |
| Tool DB timeout (>10s) | Tool retorna `{is_error:true, content:'Query timed out'}`; agent recebe e pode tentar abordagem diferente |

#### Categoria B · Permanent (non-retryable)

| Falha | HTTP | Tratamento |
|-------|------|------------|
| Sem `copilot_enabled` e não admin | 403 | Mensagem clara |
| Conversation arquivada | 409 | "Conversa arquivada. Crie uma nova ou desarquive" |
| Conversation não pertence ao user | 404 | Genérico (não vaza existência) |
| Tenant inativo | 403 | "Acesso suspenso. Contate suporte" |

#### Categoria C · User-induced limits

| Falha | error_code | Tratamento |
|-------|------------|------------|
| Cost cap por turno | `TURN_COST_EXCEEDED` | Loop encerra. Última message com `stop_reason='turn_cap_exceeded'`. UI: "Turno excedeu orçamento. Simplifique a pergunta." |
| Tool count cap | `TURN_TOOLS_EXCEEDED` | Mesmo padrão |
| Budget mensal esgotado | `BUDGET_EXCEEDED` | Pre-check antes do turno (reusa `agentsDb.canExecute`). 402 |
| Content > 50KB | `CONTENT_TOO_LARGE` | 413 antes de insert |
| Content vazio | `CONTENT_EMPTY` | 400 |

#### Categoria D · System integrity

| Falha | Tratamento |
|-------|------------|
| LLM "alucina" tool name não existente | Tool result: `{is_error:true, content:'Tool not found'}`. Agent normalmente se corrige |
| LLM passa input inválido | Tool result com erro de validação |
| Concurrent update (2 tabs) | Optimistic via `updated_at`. Aggregates atualizados em transação atômica |

#### Categoria E · Disconnect & concurrency

| Cenário | Tratamento |
|---------|------------|
| Cliente fecha tab mid-stream | `request.raw.on('close', () => abortController.abort())`. Anthropic call cancela. **Mensagem parcial e tool calls completados são salvos.** GET `/conversations/:id` mostra tudo persistido |
| Dois tabs mesma conversation | Lock in-memory por `conversation_id` (Map em apps/server). 2º POST recebe 409 `TURN_IN_PROGRESS`. Redis fica para depois se virar gargalo |
| Send 2x rápido | Frontend disable button + AbortSignal. Backup no servidor: lock acima |

### Trade-off conhecido

Cost cap aplica **depois** de cada assistant message completar. Pior caso: turno excede em até `MAX_COST + cost_of_one_message` (~$0.70). Pre-estimar exigiria contar tokens antecipadamente — gain marginal. **Aceito no MVP**.

### Tool result wrapping (defensive)

Tool results retornados ao Claude são envoltos em delimitadores:

```
<tool_output tool="system:wiki_query">
{json result here}
</tool_output>
```

Custa 2 linhas, força Claude a tratar como dado e não como instrução. Defesa em profundidade contra prompt injection via dados consultados.

### Audit trail

Toda falha gera entry em `audit_log`:

```typescript
agentsDb.insertAuditEntry({
  tenant_id, entity_type: 'copilot_conversation', entity_id: conversation_id,
  action: 'copilot_error',
  actor: 'aios-master',
  payload: { error_code, message_id, user_id, details },
})
```

---

## Testing strategy

### Test infrastructure

Reusa setup existente: `vitest`, mock de DB, helpers de `@ethra-nexus/db`. Novos arquivos:

```
packages/agents/src/__tests__/
├── copilot-tools.test.ts
├── copilot-turn-loop.test.ts
├── copilot-tool-registry.test.ts
└── copilot-permissions.test.ts

apps/server/src/__tests__/
└── copilot-routes.test.ts

apps/web/src/__tests__/
└── copilot-stream.test.ts
```

### Camada 1 · Tool handlers

Cada tool tem 3-5 testes. Padrão obrigatório:
- happy path
- empty result
- **anti-leak (multi-tenant)**: cria 2 tenants, query como tenant A, verifica que dados de B não vazam

Total: ~38 testes.

### Camada 2 · Turn loop

Mock de `anthropic.messages.create` retorna respostas canned. DB real (test schema). Cenários:

| Teste | Valida |
|-------|--------|
| `single_turn_text_only` | User → assistant text. 2 messages persistidas |
| `single_turn_one_tool` | tool_use → executa → tool_result → final. 4 messages |
| `multi_tool_parallel` | 3 tool_use blocks → todos executados → resposta |
| `tool_handler_error` | Tool throws → tool_result is_error → agent recovers |
| `turn_cost_cap_exceeded` | Após cap: stop_reason=turn_cap_exceeded |
| `turn_tools_cap_exceeded` | Após 10 tools: error event |
| `anthropic_5xx_retries` | 1ª falha 503 → retry succeed |
| `anthropic_5xx_exhausted` | 3 falhas → error event, message com error_code |
| `client_disconnect_persists` | AbortSignal mid-stream → estado parcial salvo |
| `concurrent_send_blocked` | 2 POSTs simultâneos → 2º recebe 409 |

~10 testes.

### Camada 3 · Permission middleware

5 testes:
- admin → permite
- member com copilot_enabled=true → permite
- member com copilot_enabled=false → 403
- user sem entry em tenant_members → 403
- tool admin-only chamada por member → tool retorna PERMISSION_DENIED no result

### Camada 4 · SSE format (apps/server)

5 testes em `copilot-routes.test.ts`. Usa fake `reply.raw` que captura writes:
- emite turn_start primeiro, turn_complete último
- emite text_delta para cada chunk
- emite tool_use_start/complete em ordem
- em erro, emite error event antes de fechar
- headers corretos (`text/event-stream`, `no-cache`)

### Camada 5 · Frontend stream parser

3 testes:
- parseia eventos SSE multi-line corretamente
- tolera linha mal-formada sem crashar
- aborta quando AbortSignal dispara

### Camada 6 · E2E gated

Um teste com Anthropic real, gated em `RUN_E2E=true`:

```typescript
describe.skipIf(!process.env.RUN_E2E)('Copilot E2E', () => {
  it('user pergunta sobre agentes, recebe resposta com tool call real', async () => {
    // 1. POST /conversations
    // 2. POST /messages com "quais agentes estão ativos?"
    // 3. Lê stream
    // 4. Asserta: tool_use_start de system:list_agents
    // 5. Asserta: text_delta accumulado contém nome real
    // 6. Asserta: turn_complete com cost_usd > 0
    // 7. Asserta: GET /conversations/:id retorna messages persistidas
  })
})
```

### Smoke test manual de aceite

Antes de marcar Spec #1 done:

- [ ] Abrir `/copilot`, ver empty state
- [ ] Click em chip "Quais agentes estão ativos?"
- [ ] Ver streaming do texto chegando
- [ ] Ver tool call no painel direito (`system:list_agents`, duração)
- [ ] Resposta final lista agentes reais
- [ ] Sidebar esquerda mostra thread auto-titulada após ~2s
- [ ] Recarregar página → thread persiste
- [ ] Follow-up "quanto gastei?" → ver `system:get_budget_status`
- [ ] Pergunta vaga ampla → ver cap funcionando
- [ ] Erro proposital (matar Anthropic key temporariamente) → erro inline + toast
- [ ] Login como member sem `copilot_enabled` → /copilot retorna 403

### Cobertura alvo

| Camada | Tests | Linhas est. |
|--------|-------|-------------|
| Tool handlers | ~38 | ~600 |
| Turn loop | ~10 | ~500 |
| Permissions | 5 | ~120 |
| SSE format | 5 | ~180 |
| Frontend stream parser | 3 | ~100 |
| E2E gated | 1 | ~80 |
| **Total** | **~62 testes** | **~1580 linhas** |

Backend coverage projetada: ≥80% para arquivos novos.

---

## Effort estimate

| Subtarefa | Tempo |
|-----------|-------|
| Migration + schema Drizzle (3 tabelas + ALTER + seed) | 1 dia |
| Tool registry shell + interface + 3 tools simples (list_agents, get_recent_events, get_budget_status) | 2 dias |
| Tools restantes (explain_event, cost_breakdown, agent_health, list_pending_approvals, wiki_query wrapper, list_storage_alerts stub) | 3 dias |
| Turn loop + Anthropic SDK integration + per-turn caps | 3 dias |
| API endpoints + SSE streaming + permission middleware | 2 dias |
| Frontend `/copilot` page + 3-panel layout + componentes | 4 dias |
| Streaming parser + useCopilot hooks | 2 dias |
| Empty state + chips + auto-title flow | 1 dia |
| Testes (todas as camadas) | 3 dias |
| Smoke test + ajustes | 1 dia |

**Total: ~22 dias úteis (~3 semanas calendário)**.

Alinhado com a estimativa anterior na conversa de brainstorming (Phase A: 3 semanas).

---

## Open questions / future work

Capturado para Specs subsequentes ou iterações futuras:

- **UI de toggle do `copilot_enabled` para members** — quando 2º membro real existir
- **Stop generation button** (cancel mid-stream) — Spec separado ou v2 do shell
- **Sidepanel global contextual** — Spec separado, reusa todo backend
- **Markdown rich rendering** com Mermaid, code highlighting — Spec separado
- **Threads search/filter** — quando user típico tiver >50 threads
- **Mobile/responsive** — quando o resto do app for mobile-ready
- **Reconexão automática mid-stream** após disconnect — v2 do shell
- **Idempotency keys** — quando volume justificar
- **Lock distribuído (Redis)** ao invés de in-memory Map — quando houver múltiplas instâncias do server
- **System prompt refinement** com base em uso real — iterativo
- **Write tools (mutations)** com confirmação UI — Spec #6+
- **MCP server exposure** — Fase D ou depois
