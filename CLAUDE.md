# AIOS Constitution — Ethra Nexus

> Este arquivo é a constituição do sistema. Define as regras, arquitetura,
> e comportamento esperado de todos os agentes e módulos do Ethra Nexus.
> Lido por Claude Code em cada sessão de desenvolvimento.

---

## 1. O que é o Ethra Nexus

Plataforma de orquestração de agentes de IA para empresas, organizações e pessoas.
Instalável em VPS (self-hosted) ou acessível via cloud. Roda 24/7.

**Posicionamento:** não é um chatbot. É uma infraestrutura de agentes que automatiza
e gerencia processos reais de negócio, com conhecimento persistente e rastreável.

---

## 2. Stack e repositório

```
Monorepo: apps/web + apps/server + packages/core + packages/db + packages/agents + packages/wiki
Frontend:  React 18 + TypeScript 5 (strict) + Vite + TanStack Query + Radix UI + Tailwind
Backend:   Fastify 5 + Drizzle ORM + Postgres (pgvector + RLS) + JWT
Scheduler: startSchedulerLoop em @ethra-nexus/agents (chamado pelo apps/server)
Wiki UI:   SilverBullet (opcional, container separado)
AI:        Anthropic (dados sensíveis) + OpenRouter (Groq, Gemini — custo)
Infra:     Docker Compose + Easypanel + GitHub Actions
N8N:       opcional — usado apenas para skills custom externas
```

> Histórico: o backend foi originalmente projetado sobre Supabase (`@supabase/supabase-js`)
> e migrado para Fastify + Drizzle conectando direto ao Postgres. RLS e pgvector
> permanecem como features do Postgres. As migrations em `infra/supabase/migrations/`
> ainda usam o nome legado mas são SQL puro aplicável a qualquer Postgres.

---

## 3. Princípios arquiteturais invioláveis

### 3.1 Multi-tenant desde o início
- Toda tabela tem `tenant_id uuid NOT NULL`
- RLS habilitado em TODAS as tabelas — sem exceção
- Self-hosted = um tenant; Cloud = N tenants com isolamento total

### 3.2 Dados sensíveis → sempre Anthropic direto
```typescript
// NUNCA envie dados de clientes para OpenRouter/Groq
// Use MODULE_PROVIDER_MAP em packages/core/src/types/provider.types.ts
// Regra: sensitive_data: true → Anthropic, sem fallback possível
```

### 3.3 Hierarquia de wikis
```
System Wiki (_system)    ← contexto estratégico global do tenant
     ↓ herdado por
Agent Wiki (agent-*)     ← conhecimento específico de cada agente
```
- Agentes nunca duplicam o que está na System Wiki — referenciam
- Cada wiki tem: raw/ (imutável) + wiki/ (compilado) + schema/CLAUDE.md

### 3.4 Padrão Karpathy para conhecimento
- **raw/**: fontes brutas — NUNCA modificadas
- **wiki/**: conhecimento compilado pelo LLM — atualizado por ingest
- **embeddings**: pgvector via função `search_wiki()` — busca semântica
- Operações: Ingest → Query → Lint (periódico)

### 3.5 TypeScript strict — sem concessões
```json
{
  "strict": true,
  "noImplicitAny": true,
  "strictNullChecks": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true
}
```
Zero uso de `any` explícito. Zero `as unknown as X` sem justificativa.

---

## 4. Estrutura de diretórios

```
ethra-nexus/
├── apps/
│   ├── web/                    ← React 18 + Vite (frontend)
│   └── server/                 ← Fastify 5 (API HTTP + scheduler)
│       └── src/routes/         ← agents, aios, wiki, schedules, webhooks, a2a, wizard, …
├── packages/
│   ├── core/                   ← tipos + security/ (validate, sanitize, rate-limiter)
│   ├── db/                     ← Drizzle schema (core, wiki, aios, wizard, schedules) + pg client
│   ├── agents/                 ← AIOS Master + ProviderRegistry + scheduler loop
│   └── wiki/                   ← engine de wiki (ingest, query, lint)
├── infra/
│   ├── docker/                 ← Dockerfile + docker-compose dev/prod
│   ├── vps/                    ← compose e env específicos do deploy VPS/Hostgator
│   ├── supabase/migrations/    ← SQL migrations numeradas (nome legado; é Postgres puro)
│   └── n8n/workflows/          ← workflows N8N exportados em JSON (skills custom)
├── wikis/
│   ├── _system/                ← System Wiki (Tier 0) — possui schema/CLAUDE.md próprio
│   └── agent-{slug}/           ← Agent Wiki (Tier 1) — possui schema/CLAUDE.md próprio
├── docs/
│   ├── design-system.md        ← ETHRA APERTURE — identidade visual canônica
│   ├── superpowers/plans/      ← planos de implementação por sprint
│   └── adr/                    ← Architecture Decision Records (a criar)
├── .github/workflows/          ← CI pipeline
├── CLAUDE.md                   ← este arquivo
└── .env.example
```

### 4.1 Isolamento por tenant (padrão obrigatório no backend)

`apps/server/src/app.ts` registra `@fastify/jwt` e estende `FastifyRequest` com
`tenantId: string`. Um hook global lê o JWT, resolve o tenant e injeta o ID na
request. **Toda query Drizzle deve filtrar por `tenantId`** — não confie em RLS
sozinho como rede de segurança no nível da aplicação. Pesquise por handlers
existentes em `apps/server/src/routes/` antes de criar uma rota nova; o padrão é:

```ts
app.get('/agents', async (req) => {
  return db.select().from(agents).where(eq(agents.tenantId, req.tenantId))
})
```

`wikis/_system/schema/CLAUDE.md` e `wikis/agent-template/schema/CLAUDE.md` são
constituições de escopo menor para a engine de wiki — leia-as ao tocar em ingest/query.

---

## 5. Especificação de Agente — 5 Dimensões

Um agente Ethra Nexus é definido por 5 dimensões ortogonais:

```
┌─────────────────────────────────────────────────────────┐
│                    AGENTE                                │
│                                                         │
│  1. IDENTIDADE  → quem é (prompt, tom, restrições)      │
│  2. SKILLS      → o que faz (wiki:query, monitor:alert) │
│  3. ATIVAÇÃO    → quando age (on_demand, scheduled, event)│
│  4. CANAIS      → onde comunica (WhatsApp, chat, API)   │
│  5. ORÇAMENTO   → quanto gasta ($USD, tokens, alertas)  │
└─────────────────────────────────────────────────────────┘
```

### 5.1 Skills — capacidades discretas

Skills built-in do Ethra Nexus:

| Skill | Descrição | Provider padrão |
|-------|-----------|-----------------|
| `wiki:query` | Busca e responde usando wiki | Anthropic |
| `wiki:ingest` | Processa documentos para wiki | Anthropic |
| `wiki:lint` | Audita saúde da wiki | Groq/OpenRouter |
| `channel:respond` | Responde em canal | Anthropic |
| `channel:proactive` | Envia notificação/alerta | Anthropic |
| `report:generate` | Gera relatório estruturado | Anthropic |
| `monitor:health` | Health check de processos | Groq/OpenRouter |
| `monitor:alert` | Avalia condições e dispara alertas | Groq/OpenRouter |
| `data:analyze` | Analisa dados estruturados | Gemini/OpenRouter |
| `data:extract` | Extrai dados de documentos | Anthropic |
| `a2a:call` | Chama agente externo via protocolo A2A | (delegado) |

Skills custom: `custom:{nome}` — implementadas via N8N workflows.

**Adicional (Spec #1):** `copilot:turn` — skill interna do AIOS Master Agent
shell, registrada em `provider_usage_log` quando o `/copilot` é usado.

**Não existem "tipos de agente" hardcoded.** Um agente de "atendimento" é simplesmente
um agente com skills `wiki:query` + `channel:respond` e canais WhatsApp/webchat.

### 5.2 Modos de ativação

Um agente pode ter múltiplos modos simultâneos:

- **`on_demand`** — ativado por mensagem de usuário, chamada API, ou interação UI
- **`scheduled`** — cron expression + skill + payload (ex: "relatório diário às 9h")
- **`event`** — listener de eventos do sistema (novo documento, webhook, alert threshold)

### 5.3 Controle de orçamento

O AIOS Master verifica budget ANTES de cada execução:

```
Task chega → Agente ativo? → Skill habilitada? → Budget permite?
                                                       │
                                    ┌──────────────────┴───────────────────┐
                                    ↓                                      ↓
                               SIM → executa                          NÃO → ação
                                                                           │
                                                          ┌────────────────┼────────────────┐
                                                          ↓                ↓                ↓
                                                    pause_agent    reject_tasks     alert_only
```

Campos de budget por agente:

| Campo | Descrição |
|-------|-----------|
| `monthly_limit_usd` | Limite mensal em USD (0 = sem limite) |
| `monthly_token_limit` | Limite de tokens/mês (0 = sem limite) |
| `max_tokens_per_call` | Máximo por chamada (default: 4096) |
| `alert_thresholds[]` | Alertas em 50%, 75%, 90%, 100% do budget |
| `on_limit_reached` | Ação: pause_agent, reject_new_tasks, alert_only, downgrade_model |

Budget é resetado no primeiro dia de cada mês via `reset_monthly_budgets()`.

### 5.4 AIOS Master Orchestrator

Ciclo de vida de uma task:

1. **RECEBE** task (canal, schedule, evento, API)
2. **RESOLVE** agente + skill
3. **PRE-CHECK**: status ativo? skill habilitada? budget ok? rate limit ok?
4. **REGISTRA** em `aios_events` (status: running)
5. **EXECUTA** skill via ProviderRegistry
6. **CONTABILIZA** custo no budget do agente
7. **POST-CHECK**: threshold de alerta? budget esgotado?
8. **RETORNA** `AgentResult<T>` com tokens_used + cost_usd

### 5.5 Provider routing (por agente e skill)

Hierarquia de resolução:

```
1. SkillConfig.provider_override    → definido na skill do agente
2. NEXUS_PROVIDER_{SLUG}_{SKILL}    → override por variável de ambiente
3. SYSTEM_PROVIDER_MAP[skill_id]    → default do sistema
4. tenant.config.default_provider   → fallback do tenant
```

Regra inviolável: `sensitive_data: true` → sempre Anthropic direto.

### 5.6 Wiki Engine (packages/wiki)

`packages/wiki` é **pure logic, sem dependência de DB**. Expõe três funções:

- **`embed()`** (em `embedding.ts`): vetorização via OpenAI `text-embedding-3-small` (1536 dims)
- **`extractPagesFromContent()`** (em `extract.ts`): extração LLM-powered — split de documento bruto em `ExtractedPage[]`
- **`generateStrategicIndex()`** (em `index-generator.ts`): produz `PageSummary[]` para navegação

A lógica de **ingest / query / lint** vive em `apps/server/src/routes/wiki.ts` e nas
skills em `packages/agents/src/lib/skills/skill-executor.ts` (`executeWikiQuery`,
`executeWikiIngest`, `executeWikiLint`). O CLAUDE.md original previa esses módulos
em `packages/wiki/` mas a implementação distribuiu pelo backend e skills.

---

## 6. Banco de dados — tabelas principais

| Tabela | Propósito |
|--------|-----------|
| `tenants` | Organizações — isolamento multi-tenant; auth via `slug` + `password_hash` (bcrypt) |
| `agents` | Agentes configurados (identidade + provider + status + flat fields) |
| `agent_skills` | Skills habilitadas por agente (com `provider_override` opcional) |
| `agent_channels` | Canais de comunicação por agente (WhatsApp, webchat, email) |
| `agent_schedules` | Cron schedules por agente |
| `agent_event_subscriptions` | Subscrições multi-agent a eventos do sistema |
| `scheduled_results` | Histórico de execução dos schedules |
| `tickets` | Tarefas atômicas com rastreamento de custo |
| `goals` | Hierarquia C→P→SP→PT |
| `sessions` | Contexto persistente entre heartbeats |
| `budgets` | Orçamento mensal por agente (`agent_id, month` único) |
| `provider_usage_log` | Observabilidade de custo por chamada LLM |
| `audit_log` | Registro imutável (LGPD) |
| `aios_events` | Log de execução do orquestrador (com `call_depth`) |
| `wiki_strategic_pages` | Wiki estratégica (compartilhada por tenant) com embeddings 1536-dim |
| `wiki_agent_pages` | Wiki individual por agente |
| `wiki_raw_sources` | Fontes brutas (imutáveis) |
| `wiki_agent_writes` | Propostas HITL de escrita pendentes/aprovadas |
| `wiki_operations_log` | Log append-only de operações de wiki |
| `clone_wizard_sessions` | Estado do wizard de criação de agente |
| `agent_feedback` | Avaliações de qualidade |
| `org_chart` | Hierarquia de reporte entre agentes |
| `a2a_api_keys` | Autenticação M2M para chamadas A2A inbound |
| `external_agents` | Registry de agentes A2A externos |
| `copilot_conversations` | Threads do AIOS Master shell (admin-only) |
| `copilot_messages` | Mensagens (Anthropic content blocks JSONB) |
| `copilot_tool_calls` | Tool calls executadas durante turn loop |

**Não existem `tenant_members`, `agent_conversations`, `agent_messages`, `wiki_pages`,
`agent_budget_periods` nem `wiki_operation_log` (singular).** Em rascunhos antigos
estes nomes apareceram mas a implementação consolidou em outros nomes (acima).
Modelo efetivo: **1 user = 1 tenant** (login por slug + senha do tenant).

---

## 7. Segurança

### 7.1 Módulo de segurança centralizado (`packages/core/src/security/`)

```
validate.ts    → validação de inputs (paths, scopes, slugs, UUIDs, cron)
sanitize.ts    → sanitização de HTML, prompt isolation, error messages, JSON safe parse
rate-limiter.ts → rate limiting por tenant + módulo
```

**Regra: toda entrada externa passa por `validate.ts` ou `sanitize.ts` antes de uso.**

### 7.2 Regras invioláveis

1. **RLS em TODAS as tabelas** — verificar com:
   ```sql
   SELECT tablename FROM pg_tables
   WHERE schemaname='public' AND rowsecurity=false;
   -- deve retornar vazio
   ```

2. **Sem API keys em variáveis de ambiente do container** em produção
   - Usar Docker Secrets (`/run/secrets/`) em `docker-compose.prod.yml`
   - Credenciais lidas de arquivo, não de `process.env` direto

3. **Documentos do cliente isolados em prompts**
   - Usar `wrapUserContentForPrompt()` — nunca interpolar conteúdo bruto
   - Delimitadores anti-injection impedem que PDFs maliciosos virem instruções

4. **Erros nunca vazam segredos**
   - Usar `sanitizeErrorMessage()` — remove API keys, JWTs, connection strings
   - Erros truncados a 500 chars antes de retornar ao frontend

5. **Paths validados contra traversal**
   - Usar `validateWikiPath()` e `validateWikiScope()` antes de interpolar em FS
   - Rejeita `..`, `~`, paths absolutos, caracteres especiais

6. **Frontend isolado**
   - Só usa variáveis `VITE_*` — nunca `SERVICE_ROLE_KEY`
   - Nginx com CSP, HSTS, X-Frame-Options, rate limiting por IP
   - HTTPS obrigatório em produção (HTTP → 301)

7. **Rate limiting por tenant**
   - `RateLimiter` em `packages/core/src/security/rate-limiter.ts`
   - Limites por módulo: wiki-ingest 50/h, agent-atendimento 500/h, etc.
   - Previne custo descontrolado em AI providers

8. **Audit trail completo (LGPD)**
   - `aios_events`: triggered_by, user_ip, user_agent, timestamps
   - `wiki_operation_log`: todas as operações na wiki
   - Retention policy: 90 dias (LGPD art. 16)

### 7.3 Checklist de segurança para cada PR

```bash
# 1. RLS
SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=false;

# 2. Secrets no código
grep -rE "sk-ant-|sk-or-|eyJ[A-Za-z0-9+/]{100}" --include="*.ts" --include="*.tsx" src/ packages/

# 3. Variáveis expostas ao frontend
grep -r "process.env\|import.meta.env" apps/web/src/ | grep -v "VITE_"

# 4. any explícito
grep -rn "as any\|: any" --include="*.ts" --include="*.tsx" packages/ apps/

# 5. JSON.parse sem safe wrapper
grep -rn "JSON.parse" --include="*.ts" packages/ | grep -v "safeJsonParse"
```

---

## 8. Comandos essenciais

```bash
# Desenvolvimento (raiz — orquestrado por Turbo, respeita ^build)
npm run dev          # inicia todos os apps em watch mode
npm run typecheck    # TypeScript check em todos os packages
npm run lint         # ESLint em todos os packages
npm run test         # Vitest em todos os packages
npm run test:e2e     # Playwright (apps/web) + e2e backend
npm run build        # build de produção
npm run clean        # limpa dist/ de todos os workspaces
```

### 8.1 Rodar comando em UM workspace só

```bash
# por nome do workspace (npm)
npm run -w @ethra-nexus/server typecheck
npm run -w @ethra-nexus/web   build

# por filtro Turbo (resolve dependências antes — ex: builda packages/db primeiro)
npx turbo run test --filter=@ethra-nexus/server
npx turbo run typecheck --filter=@ethra-nexus/web...   # ... = inclui dependentes
```

### 8.2 Rodar UM teste específico

```bash
# um arquivo
npm run -w @ethra-nexus/server test -- src/__tests__/e2e/agents.test.ts

# por nome do teste (substring do describe/it)
npm run -w @ethra-nexus/server test -- -t "creates agent"

# watch mode (apenas no workspace alvo)
npm run -w @ethra-nexus/web test:watch
```

### 8.3 Rodar testes/CI sem gastar API credit

```bash
# Mockа todas as chamadas de LLM (Anthropic, OpenRouter, OpenAI embeddings)
NEXUS_MOCK_LLM=true npm run test
```
Os e2e do backend dependem disso — sempre defina antes de `test:e2e`.

### 8.4 Banco e migrations

```bash
# Drizzle (schema vive em packages/db/src/schema/*)
npm run -w @ethra-nexus/db generate   # gera migration a partir de mudanças no schema
npm run -w @ethra-nexus/db migrate    # aplica migrations no DATABASE_URL atual
```
Migrations SQL legadas em `infra/supabase/migrations/` são aplicadas por
`infra/docker/` na subida do Postgres. Novas migrations devem ir via Drizzle.

### 8.5 Docker

```bash
docker compose -f infra/docker/docker-compose.dev.yml  up -d   # dev local
docker compose -f infra/docker/docker-compose.prod.yml up -d   # prod genérico
docker compose -f infra/vps/docker-compose.vps.yml     up -d   # VPS Hostgator
```

---

## 9. Critérios de aceite por sprint

**Antes de avançar ao próximo sprint:**
- [ ] `npm run typecheck` passa sem erros
- [ ] `npm run lint` passa sem warnings
- [ ] `npm run test` passa com cobertura > 70%
- [ ] Todas as tabelas novas têm RLS habilitado
- [ ] Zero `any` explícito no código novo

---

## 10. ADRs relevantes

> Pendentes de criação — manter esta lista como índice das decisões a documentar.

- `docs/adr/ADR-001-monorepo-turborepo.md` _(planejado)_
- `docs/adr/ADR-002-fastify-drizzle-over-supabase.md` — registra a migração saindo de `@supabase/supabase-js` para Fastify + Drizzle direto no Postgres ✅
- `docs/adr/ADR-003-silverbullet-wiki.md` _(planejado)_
- `docs/adr/ADR-004-multi-provider-openrouter.md` _(planejado)_
- `docs/adr/ADR-005-modelo-c-hybrid-deployment.md` _(planejado)_
- `docs/adr/ADR-006-1-user-per-tenant-auth.md` — modelo "1 user = 1 tenant" mantido no MVP self-hosted; adiar multi-user até cliente cloud pedir ✅
