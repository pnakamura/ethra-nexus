# Ethra Nexus — AI Orchestration Platform
# CLAUDE.md — Memória persistente do Claude Code

---

## 1. Visão Geral do Projeto

Plataforma B2B self-hosted de orquestração de agentes IA.
Fork dual de Paperclip + AIOS-Core. Licença MIT.
Repositório: github.com/pnakamura/ethra-nexus

---

## 2. Stack Tecnológico

- **Monorepo:** pnpm workspaces + TypeScript 5.x strict mode
- **Backend:** Fastify + Drizzle ORM + PostgreSQL 16 (conexão direta — sem PostgREST)
- **Auth:** @fastify/jwt (sem GoTrue — auth implementado diretamente na API)
- **Frontend:** Next.js 15 + React 19 + Tailwind + Shadcn/UI
- **Automação:** N8N (workflow builder, ingestão Google Drive, bridge WhatsApp)
- **IA:** Multi-provider — Anthropic direto (dados sensíveis/LGPD), OpenRouter (Groq/Gemini)
- **Conhecimento:** SilverBullet + pgvector (wiki estratégica + wikis individuais por agente)
- **Deploy:** Docker + Easypanel (VPS Hostgator, AlmaLinux 9.7, 8GB RAM, IP 129.121.38.172)
- **CI/CD:** GitHub Actions

---

## 3. Packages do Monorepo

```
packages/
  types         → @nexus/types       (interfaces compartilhadas — sem dependências)
  db            → @nexus/db          (Drizzle schema + migrations + client pg)
  config        → @nexus/config      (Zod env validation)
  utils         → @nexus/utils       (logger Pino, crypto, retry)
  governance    → @nexus/governance  (CompanyManager, OrgChart, GoalTree, ApprovalGates)
  ticketing     → @nexus/ticketing   (TicketStore atômico, ThreadManager, AuditLog)
  budget        → @nexus/budget      (BudgetManager, CostTracker, Throttle)
  heartbeat     → @nexus/heartbeat   (CronScheduler, EventTrigger, SessionPersist)
  agent-runtime → @nexus/agent-runtime (AgentAdapter interface, SkillsManager)
  squads        → @nexus/squads      (11 agentes AIOS, ADE Engine, Memory Layer)
  wiki          → @nexus/wiki        (ingest, index-generator, lint, RAG search)

apps/
  server        → Fastify REST API + WebSockets + SSE + auth JWT
  dashboard     → Next.js 15: org chart, ticket board, métricas
  cli           → npx nexus: CLI interativo (@clack/prompts)
```

**Dependência crítica:** `IProviderRegistry` vive em `@nexus/core` para evitar circular imports entre `wiki ↔ agents`.

---

## 4. Convenções de Código

- **Commits:** Conventional Commits (`feat/fix/docs/refactor/test/chore/ci`)
- **Branches:** Git Flow (`main/develop/feature/*/fix/*`)
- **Testes:** Vitest, cobertura mínima 80%
- **Código:** inglês | **Documentação:** PT-BR
- **TypeScript:** strict mode, zero `any`
- **Módulos:** CommonJS (moduleResolution: Node) — não ESM no backend
- **Multi-tenant:** isolamento via hook `onRequest` do Fastify que extrai `tenantId` do JWT — todas as queries Drizzle filtram por `tenantId`
- **LGPD:** dados sensíveis (ex: beneficiários IVCAD, CadÚnico) APENAS via Anthropic direto, nunca via OpenRouter

---

## 5. Decisões Arquiteturais — DEFINITIVAS

> Estas decisões foram tomadas e não devem ser revertidas sem discussão explícita.

### 5.1 Fastify + Drizzle ORM — sem Supabase stack

**Decisão:** o backend usa Fastify conectado diretamente ao PostgreSQL via Drizzle ORM.
**PostgREST:** NUNCA instalar. Desnecessário e era a causa do crash do container.
**GoTrue:** NUNCA instalar. Auth substituído por `@fastify/jwt`.
**`@supabase/supabase-js`:** REMOVIDO de todos os packages.

```typescript
// packages/db/src/client.ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
export const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }), { schema })
```

```typescript
// apps/server/src/app.ts — padrão de isolamento multi-tenant
app.addHook('onRequest', async (req) => {
  await req.jwtVerify()
  req.tenantId = req.user.tenantId
})
```

**Por quê:** produto B2B self-hosted — cada cliente instala na própria VPS. Menos containers = menos atrito na instalação e menos pontos de falha.

### 5.2 Arquitetura de duas wikis (baseada em Karpathy / LLM Wiki)

Cada tenant possui duas camadas de conhecimento persistente:

**Wiki estratégica** (`wiki_strategic_pages`):
- Compartilhada entre todos os agentes do tenant
- Contém: entidades, conceitos, normativos, análises, sumários de fontes
- Escrita por: humanos via SilverBullet ou API, e pelo mecanismo de promoção
- Navegação: `index.md` sintético gerado pelo `index-generator.ts`

**Wiki individual** (`wiki_agent_pages`):
- Uma por agente, privada
- Contém: padrões aprendidos, templates validados, erros registrados, checklists
- Escrita por: feedback loop de aprovação/rejeição de tickets
- Campos essenciais: `type` (padrao|template|checklist|erro), `origin`, `confidence`, `status`

**Mecanismo de promoção:**
- Quando 3+ agentes convergem para o mesmo padrão em suas wikis individuais → `checkAndPromote()` eleva para a wiki estratégica com `confidence='alta'`
- Job diário via heartbeat scheduler

**Regra de precedência:** se wiki estratégica e individual têm claims conflitantes, a estratégica prevalece. Instrução explícita no system prompt de cada agente.

### 5.3 Navegação da wiki — index.md + pgvector opcional

**Fluxo no `onHeartbeat()`:**
1. Carrega `index.md` sintético da wiki estratégica do tenant
2. Carrega `index.md` sintético da wiki individual do agente
3. LLM identifica páginas relevantes para a tarefa atual
4. Carrega conteúdo das páginas identificadas
5. Injeta no system prompt antes de executar
6. Após execução: propõe aprendizado via `POST /api/v1/wiki/agent-write` (staging)

**pgvector:** fallback para wikis com mais de ~200 páginas. Para o caso típico, `index.md` + leitura direta é mais preciso que busca vetorial em chunks brutos.

**Short-circuit:** se o index tiver menos de 5 páginas, pular o briefing para evitar latência desnecessária.

### 5.4 Feedback loop — aprovação alimenta as wikis

```
Ticket executado
  → Gestor APROVA via WhatsApp/Dashboard
      → onApproval(): lições transversais → wiki estratégica
      → onApproval(): padrões específicos → wiki individual de cada agente participante
  → Gestor REJEITA
      → onRejection(): padrão de erro → wiki individual do agente responsável
```

---

## 6. Schema das Tabelas Wiki

```typescript
// packages/db/src/schema/wiki.ts

export const wikiStrategicPages = pgTable('wiki_strategic_pages', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull(),
  slug:           text('slug').notNull(),           // unique por tenant
  title:          text('title').notNull(),
  type:           text('type').notNull(),            // entidade|conceito|analise|sumario|decisao
  content:        text('content').notNull(),         // Markdown com frontmatter YAML
  sources:        text('sources').array(),           // paths raw/ que embasam
  tags:           text('tags').array(),
  confidence:     text('confidence').default('alta'), // alta|media|baixa
  status:         text('status').default('ativo'),   // ativo|rascunho|obsoleto
  promotedFromId: uuid('promoted_from_id'),          // se veio de wiki individual
  updatedAt:      timestamp('updated_at').defaultNow(),
})

export const wikiAgentPages = pgTable('wiki_agent_pages', {
  id:          uuid('id').primaryKey().defaultRandom(),
  agentId:     uuid('agent_id').notNull().references(() => agents.id),
  tenantId:    uuid('tenant_id').notNull(),
  slug:        text('slug').notNull(),
  title:       text('title').notNull(),
  type:        text('type').notNull(),               // padrao|template|checklist|erro
  content:     text('content').notNull(),
  origin:      text('origin'),                       // ex: 'aprovação ticket#42'
  confidence:  text('confidence').default('media'),
  status:      text('status').default('ativo'),
  promotedAt:  timestamp('promoted_at'),
  updatedAt:   timestamp('updated_at').defaultNow(),
})

export const wikiOperationsLog = pgTable('wiki_operations_log', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull(),
  agentId:        uuid('agent_id'),
  operation:      text('operation').notNull(),       // ingest|query|lint|approve|reject|promote
  scope:          text('scope').notNull(),           // 'strategic' | 'agent:{id}'
  summary:        text('summary'),
  pagesAffected:  integer('pages_affected').default(0),
  createdAt:      timestamp('created_at').defaultNow(),
})

export const wikiAgentWrites = pgTable('wiki_agent_writes', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull(),
  agentId:        uuid('agent_id').notNull(),
  ticketId:       uuid('ticket_id'),
  proposedPageId: uuid('proposed_page_id'),         // null = nova página
  title:          text('title').notNull(),
  content:        text('content').notNull(),
  status:         text('status').notNull().default('draft'), // draft|approved|rejected
  reviewer:       text('reviewer'),
  reviewedAt:     timestamp('reviewed_at'),
  createdAt:      timestamp('created_at').defaultNow(),
})
```

---

## 7. Rotas Wiki (Fastify)

```
POST   /api/v1/wiki/pages                    → humano cria/edita página estratégica
POST   /api/v1/wiki/search                   → busca RAG (pgvector) — fallback
POST   /api/v1/wiki/ingest                   → ingerir documento (Google Drive / upload)
POST   /api/v1/wiki/agent-write              → agente propõe aprendizado (staging)
PATCH  /api/v1/wiki/agent-writes/:id/approve → gestor aprova → promove para wiki_agent_pages
PATCH  /api/v1/wiki/agent-writes/:id/reject  → gestor rejeita → registra como erro
GET    /api/v1/wiki/index/:scope             → retorna index.md sintético (strategic | agent:{id})
POST   /api/v1/wiki/lint                     → dispara verificação de saúde da wiki
```

---

## 8. Estado do Deploy na VPS (Hostgator — atualizado 2026-04-13)

### Serviços no Easypanel

| Serviço | Estado | Ação necessária |
|---|---|---|
| PostgreSQL + pgvector 0.8.2 | Rodando — 11 tabelas + RLS | Migrar schema para Drizzle (15 tabelas) |
| ethra-nexus-api | CRASH — depende de PostgREST | Reescrever com Fastify+Drizzle + reimplantar |
| PostgREST | Não existe | **NUNCA instalar** — decisão final |
| GoTrue | Não existe | **NUNCA instalar** — decisão final |
| N8N | Não existe | Criar no Easypanel (Fase 3) |
| SilverBullet | Não existe | Criar no Easypanel (Fase 4) |
| Uptime Kuma | Não existe | Criar no Easypanel (Fase 8) |

### Env vars do serviço ethra-nexus (após migração)

**Remover:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

**Adicionar:**
```
DATABASE_URL=postgres://postgres:{PASS}@{POSTGRES_HOST}:5432/ethra_nexus
JWT_SECRET={openssl rand -hex 64}
NODE_ENV=production
PORT=3000
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...
```

### Próximos passos — sequência obrigatória

```
Fase 0: remover @supabase/supabase-js → reescrever em Drizzle → rebuild imagem
Fase 1: migrar banco na VPS → criar 4 tabelas wiki → índice HNSW pgvector
Fase 2: trocar env vars no Easypanel → reimplantar → verificar /health
Fase 3: criar N8N + workflows (WhatsApp, Google Drive, notificações)
Fase 4: criar SilverBullet + sync bidirecional
Fase 5: implementar packages/wiki (ingest, search, lint)
Fase 6: modificar onHeartbeat + feedback loop (onApproval, onRejection)
Fase 7: squad POA+SOCIAL — validação end-to-end
Fase 8: hardening, monitoramento, CI/CD
```

---

## 9. Squad de Referência — POA+SOCIAL (BID BR-L1597)

Agentes do squad e seus papéis:

| Agente | Função | Modelo |
|---|---|---|
| `auditor-pep` | Auditoria financeira de planilhas PEP | claude-sonnet (LGPD) |
| `gestor-contrato` | Monitoramento de desembolsos BID | claude-haiku |
| `analista-ivcad` | Análise de vulnerabilidade social | claude-sonnet (LGPD) |
| `engenheiro-obras` | Orçamento SINAPI/BDI | claude-haiku |
| `classificador-gmail` | Triagem de emails do programa | claude-haiku |

**Regra LGPD:** `auditor-pep` e `analista-ivcad` usam `model='claude-sonnet'` e NUNCA OpenRouter — processam dados pessoais de beneficiários.

**Wiki estratégica do tenant:** contrato BR-L1597, NOBs, normativas GN-2349-15, OP-273, relatórios de desembolso — ingeridos via N8N workflow do Google Drive.

---

## 10. Regras Comportamentais (Karpathy Guidelines)

> Estas diretrizes reduzem erros comuns de LLMs em tarefas de código.
> **Tradeoff:** Biasam para cautela em vez de velocidade. Para tarefas triviais, use julgamento.

### 10.1 Think Before Coding
**Não assuma. Não esconda confusão. Explicite tradeoffs.**

Antes de implementar qualquer coisa:
- Declare suas suposições explicitamente. Se incerto, pergunte.
- Se múltiplas interpretações existem, apresente-as — não escolha silenciosamente.
- Se uma abordagem mais simples existe, diga. Questione quando necessário.
- Se algo está obscuro, pare. Nomeie o que está confuso. Pergunte.

### 10.2 Simplicity First
**Mínimo de código que resolve o problema. Nada especulativo.**

- Sem features além do que foi pedido.
- Sem abstrações para código de uso único.
- Sem "flexibilidade" ou "configurabilidade" que não foi solicitada.
- Sem error handling para cenários impossíveis.
- Se você escreveu 200 linhas e poderia ser 50, reescreva.

Pergunta de checagem: *"Um engenheiro sênior diria que isso está overcomplicated?"* Se sim, simplifique.

### 10.3 Surgical Changes
**Toque apenas o que deve ser tocado. Limpe apenas sua própria bagunça.**

Ao editar código existente:
- Não "melhore" código adjacente, comentários ou formatação.
- Não refatore o que não está quebrado.
- Mantenha o estilo existente, mesmo que você faria diferente.
- Se notar dead code não relacionado, mencione — não delete.

Ao criar orphans com suas mudanças:
- Remova imports/variáveis/funções que AS SUAS mudanças tornaram desnecessários.
- Não remova dead code pré-existente a menos que seja solicitado.

**Teste:** cada linha alterada deve rastrear diretamente para o pedido do usuário.

### 10.4 Goal-Driven Execution
**Defina critérios de sucesso. Itere até verificar.**

Transforme tarefas em metas verificáveis:
- `"Adiciona validação"` → `"Escreve testes para inputs inválidos, depois os faz passar"`
- `"Corrige o bug"` → `"Escreve teste que reproduz o bug, depois o faz passar"`
- `"Refatora X"` → `"Garante que testes passam antes e depois"`

Para tarefas multi-step, declare um plano breve:
```
1. [Passo] → verificar: [checagem]
2. [Passo] → verificar: [checagem]
3. [Passo] → verificar: [checagem]
```

---

## 11. Sinais de que está funcionando

- Diffs com menos mudanças desnecessárias
- Menos rewrites por overcomplicação
- Perguntas de clarificação chegam **antes** da implementação, não depois dos erros
- Cada alteração no código traça diretamente ao pedido

---

*Atualize este arquivo sempre que a arquitetura mudar. Um CLAUDE.md desatualizado gera código inconsistente.*
*Última atualização: 2026-04-13 — decisões Fastify+Drizzle, wiki dual (Karpathy), plano VPS v3.*
