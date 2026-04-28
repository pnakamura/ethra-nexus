# NEXUS-STATUS.md — Estado de Implementação

> Documento vivo: reflete o estado real do codebase em 28 de Abril de 2026.
> Atualizar sempre que uma fase for concluída.

---

## Resumo executivo

| Dimensão | Estado |
|----------|--------|
| Backend (Fastify + Drizzle) | ✅ Operacional |
| Banco de dados (PostgreSQL + pgvector) | ✅ 19+ tabelas, 11 migrations aplicadas em prod |
| AIOS Master (orquestrador) | ✅ Completo com multi-agent orchestration |
| Skills built-in | ✅ 10/10 implementadas |
| **Spec #1 — AIOS Master Agent (shell conversacional)** | ✅ **shipped no branch `feature/copilot-aios-master-shell` (33 commits, último f91f19c)** |
| Testes backend | ✅ 118 passing em packages/agents (1 file pre-existing failure: cron-utils dep faltando) |
| CI/CD pipeline | ⚠️ CI falhando desde commit 3926144 — bloqueia Docker/VPS, não afeta Vercel |
| VPS (backend) | ✅ Rodando — última imagem: commit 0165c77 (pré-Sprint A) |
| Frontend (apps/web) | ✅ MVP + Sprint A em produção no Vercel |

---

## Spec #1 (AIOS Master Agent shell) — entregas

Branch: `feature/copilot-aios-master-shell` (33 commits, todos verdes nos respectivos task-runs)

| Camada | Entregas |
|--------|----------|
| DB | Migration 021 (3 tabelas + RLS + CHECK + trigger), Migration 022 (seed aios-master), Drizzle schema |
| Tools | 9 read-only tools: list_agents, get_recent_events, explain_event, get_budget_status, cost_breakdown (3 group_by), agent_health, list_pending_approvals, wiki_query, list_storage_alerts (stub) |
| Orchestration | Turn loop multi-step com Anthropic Tool Use, budget tracking integrado (canExecute/logProviderUsage/upsertBudget), per-turn caps (cost + tools, env-configurable), auto-title via Haiku |
| API | Admin-only middleware, 5 conversation CRUD endpoints, SSE message endpoint com abort handling |
| Frontend | `/copilot` route, ConversationsSidebar, ChatView+MessageList+bubbles, MessageInput, ToolCallsLog, EmptyState com chips |
| Audit & Docs | Karpathy principles audit, Spec #1 design doc, plan com Task 17.5 (budget integration fix) |

**Pendências antes de prod**:
- Aplicar migrations 021+022 em DB de dev/stage e validar schema
- Smoke test manual do `/copilot` end-to-end (rodar `npm run dev`, criar thread, mandar mensagem, ver streaming)
- Merge para main + push para GHCR + service update (workflow padrão da casa)

---

## Stack atual (confirmado no codebase)

```
Monorepo:    Turborepo
Backend:     Fastify 5 + Drizzle ORM + node-postgres (pg)
Auth:        @fastify/jwt — JWT extraído em onRequest hook, tenantId injetado
DB:          PostgreSQL + pgvector (1536 dims) para embeddings
AI:          Anthropic direto (sensitive_data:true) | OpenRouter (Groq, Gemini — custo)
Infra:       Docker Swarm (single node) + GHCR + GitHub Actions
Automação:   N8N Community Edition
Wiki UI:     SilverBullet
Frontend:    React 18 + TypeScript strict + Vite + TanStack Query v5 + Tailwind
Design:      ETHRA APERTURE — Swiss Brutalist, Inter + JetBrains Mono, hairline 0.5px
Deploy FE:   Vercel (auto-deploy em push para main, SPA com vercel.json rewrites)
Packages:    core · db · agents · wiki
Apps:        apps/server (API REST) · apps/web (React — MVP completo)
```

---

## Backend implementado

### packages/core
Tipos compartilhados e segurança. Sem dependências externas.
- `types/agent.types.ts`: AgentStatus, SkillId (10 built-in + custom), AgentBudget, AiosEvent, AgentResult<T>, AgentErrorCode
- `types/wiki.types.ts`: WikiScope, WikiPageType, WikiConfidence, WikiPage, IngestResult, QueryResult, LintReport
- `security/validate.ts`, `sanitize.ts`, `rate-limiter.ts`

### packages/db
19+ tabelas Drizzle ORM: tenants, agents, goals, tickets, sessions, budgets, auditLog, providerUsageLog, agentSkills, agentTools, orgChart, wikiStrategicPages, wikiAgentPages, wikiOperationsLog, wikiRawSources, wikiAgentWrites, aiosEvents, agentSchedules, agentEventSubscriptions, scheduledResults + clone_wizard_sessions, agent_feedback

### packages/agents
ProviderRegistry (Anthropic+OpenRouter), db layer, fs layer, parsers (PDF/DOCX/XLSX/TXT/MD), scheduler loop, event-bus, skill-executor (10 skills), AIOS Master

### apps/server — 33+ endpoints

| Módulo | Endpoints principais |
|--------|---------------------|
| `health` | `GET /health` |
| `auth` | `POST /auth/login`, `POST /auth/signup` |
| `agents` | CRUD completo + skills, channels, budget, feedback, clone wizard |
| `wiki` | Ingest (base64 + stream), search semântico, strategic pages, lint, sync, agent-writes |
| `aios` | `POST /aios/execute`, `GET /aios/events` |
| `schedules` | CRUD schedules + histórico de resultados |
| `event-subscriptions` | CRUD subscrições multi-agent |
| `webhooks` | `POST /webhooks/:agentSlug/:eventType` |
| `a2a` | Protocolo Agent-to-Agent (/.well-known, JSON-RPC, SSE) |

---

## Frontend implementado (apps/web)

### Páginas
| Página | Rota | Estado |
|--------|------|--------|
| Login | `/login` | ✅ |
| Signup | `/signup` | ✅ |
| Dashboard | `/dashboard` | ✅ KPIs reais (agentes ativos, execuções, custo) + lista de agentes recentes |
| Agents list | `/agents` | ✅ |
| Agent new | `/agents/new` | ✅ |
| Agent detail | `/agents/:id` | ✅ 7 tabs + painel direito |
| Wiki | `/wiki` | ✅ 3 tabs (índice, busca, ingerir) |
| Settings | `/settings` | ⚠️ stub vazio |

### AgentDetail — 7 tabs
1. **Identidade** — name, role, status, system_prompt, model, tone
2. **Skills** — lista habilitadas, toggle, adicionar nova
3. **Wiki** — placeholder (aponta para SilverBullet)
4. **Budget** — gasto do mês, progress bar, alterar limite
5. **Feedback** — histórico de avaliações
6. **Schedules** — CRUD schedules (cron, skill, timezone, canal)
7. **Executar** — testar skill com input JSON, ver resultado + tokens + custo

### Painel direito (SplitLayout)
- **Execução** — ExecutionLogPanel: últimas 50 execuções com status, skill, depth, latência, custo
- **Aprovações** — HitlPanel: propostas de escrita da wiki pendentes (aprovar/rejeitar)

### Hooks disponíveis
`useAgent`, `useAgents`, `useAgentSkills`, `useBudget`, `useSchedules`, `useWiki*`, `useAiosExecute`

---

## Skills built-in (10/10)

| Skill | Provider padrão | sensitive_data |
|-------|----------------|----------------|
| `wiki:query` | Anthropic | true |
| `wiki:ingest` | Anthropic | true |
| `wiki:lint` | Groq/OpenRouter | false |
| `channel:respond` | Anthropic | true |
| `channel:proactive` | Anthropic | true |
| `report:generate` | Anthropic | true |
| `monitor:health` | Groq/OpenRouter | false |
| `monitor:alert` | Groq/OpenRouter | false |
| `data:analyze` | Gemini/OpenRouter | false |
| `data:extract` | Anthropic | true |

---

## CI/CD Pipeline ⚠️

**Arquivo:** `.github/workflows/ci.yml`
**Status:** FAILING desde commit `3926144` (26/04/2026) — causa não investigada

```
ci (15min) → security (5min) → e2e (10min) → docker (15min) → deploy (10min, apenas main)
```

**Impacto da falha:** jobs `docker` e `deploy` bloqueados → VPS não recebe imagem nova automaticamente.
**Workaround:** deploy manual na VPS (ver Roteiro_DEV/VPS-DEPLOY.md).
**Vercel:** não afetado — deploy independente via integração GitHub direta.

---

## Fases pendentes

| Fase | O que entrega | Prioridade |
|------|---------------|------------|
| **Fix CI** | Investigar e corrigir falha desde commit 3926144 | 🔴 Alta |
| **Frontend Sprint B** | Dashboard com dados reais, Event Subscriptions UI, Agent Channels config | 🔴 Alta |
| **Settings page** | Configurações do tenant (stub vazio) | 🟢 Baixa |

---

## Princípios arquiteturais preservados

- ✅ `sensitive_data: true` → sempre Anthropic direto, sem fallback
- ✅ Toda entrada externa passa por `validate.ts` ou `sanitize.ts`
- ✅ `tenant_id` obrigatório em toda tabela
- ✅ TypeScript strict — zero `any` explícito
- ✅ `wrapUserContentForPrompt()` — conteúdo de usuário nunca interpola diretamente em prompts
- ✅ `sanitizeErrorMessage()` — erros nunca vazam API keys ou connection strings
- ✅ `call_depth` guard no AIOS Master — previne loops infinitos em chains multi-agente

---

*NEXUS-STATUS.md — 27 de Abril de 2026*
*Gerado com assistência do Claude Code (claude-sonnet-4-6)*
