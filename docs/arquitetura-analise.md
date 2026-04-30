# Análise: Estilo Visual + Arquitetura Ethra Nexus

> Documento de análise prévia para geração do HTML da arquitetura
> seguindo o padrão visual do diagrama RAG/REFRAG anexado.

---

## Parte 1 — Análise do estilo de desenho da imagem (RAG/REFRAG)

A imagem é um diagrama educacional de duas seções (RAG vs REFRAG) com forte apelo
didático. O estilo é "infográfico hand-drawn limpo" e tem características muito
específicas que precisam ser replicadas.

### 1.1 Paleta de cores

| Elemento | Cor |
|----------|-----|
| Fundo seção RAG | Lavanda muito claro (`#EFEBF7` aprox.) |
| Fundo seção REFRAG | Verde menta muito claro (`#E8F0E8` aprox.) |
| Tag de seção (à esquerda) | Cinza-azulado claro com texto preto |
| Círculos numerados (passos) | Laranja-pêssego (`#F5A85C` aprox.), número branco |
| Caixas de ícones (documentos, DB) | Borda fina cinza, fundo branco |
| Embedding model (cérebro) | Roxo-claro com gradiente |
| Database (cilindro) | Amarelo mostarda + cinza |
| Token-level embeddings | Quadradinhos coloridos (azul, rosa, verde, lilás) |
| Componente RL-trained | Roxo-pastel destacado |
| Setas | Tracejadas, pretas, ponta de seta simples |

### 1.2 Layout estrutural

- **Sectioning:** duas faixas horizontais empilhadas, cada uma com fundo pastel
  diferente. Tag identificadora à esquerda em pílula arredondada.
- **Fluxo:** lê-se da esquerda para a direita, com setas tracejadas conectando
  cada estágio.
- **Numeração:** cada passo do fluxo tem um círculo laranja com número branco,
  posicionado *sobre* a seta ou ao lado do componente.
- **Densidade:** muito espaço em branco. Componentes "respiram".

### 1.3 Iconografia

- **Documento:** retângulo branco com cantos arredondados, três listras
  coloridas (azul/rosa/verde) no topo simulando metadata.
- **Query bubble:** balão de fala com três pontinhos ("...").
- **Embedding model:** caixa com ilustração de cérebro/neurônio em roxo.
- **Vector DB:** cilindro com tampa amarela e linhas horizontais (estilo
  banco de dados clássico).
- **LLM:** logo do provider (deepseek na imagem) com nome embaixo.
- **Token grid:** matriz de quadrados coloridos representando vetores
  token-by-token.
- **Light-weight policy:** caixa destacada em roxo com cérebro estilizado.

### 1.4 Tipografia

- Texto em sans-serif limpa (parece Nunito/Quicksand).
- Tags de seção em fonte ligeiramente "manuscrita".
- Tamanhos: títulos médios, labels pequenos, sem hierarquia gritante.

### 1.5 Setas e conexões

- **Sempre tracejadas** (`stroke-dasharray`).
- Pretas, finas (1.5–2px).
- Ponta de seta clássica triangular pequena.
- Curvas suaves quando precisam contornar componentes.

### 1.6 Elementos a replicar no HTML do Ethra Nexus

1. Faixas horizontais empilhadas, uma por subsistema.
2. Tag de seção em pílula à esquerda.
3. Numeração laranja em círculos sobre o fluxo.
4. Setas tracejadas em SVG.
5. Ícones SVG inline (sem dependência externa).
6. Paleta pastel rotacionando entre seções.
7. Componentes em caixas brancas com borda fina e canto arredondado.

---

## Parte 2 — Inventário arquitetural do Ethra Nexus

Mapeamento estrutural do monorepo em `/home/user/ethra-nexus`. Esta é a base
factual para o diagrama HTML.

### 2.1 Topologia do monorepo

```
ethra-nexus/
├── apps/
│   ├── web/      ← React 18 + Vite + TS strict (frontend SPA)
│   └── server/   ← Fastify 5 + TS (API backend)
├── packages/
│   ├── core/     ← types + security (sem deps externas)
│   ├── agents/   ← AIOS Master + ProviderRegistry + Skills + Scheduler
│   ├── wiki/     ← extract + embed + index-generator
│   └── db/       ← Drizzle ORM + schema PostgreSQL
├── infra/
│   ├── docker/   ← compose dev/prod + Dockerfile + nginx
│   ├── supabase/migrations/  ← 20 migrations SQL
│   └── n8n/workflows/        ← wiki-ingest-watcher.json
├── wikis/
│   ├── _system/        ← System Wiki (Tier 0)
│   └── agent-template/ ← template de Agent Wiki (Tier 1)
└── docs/
    └── superpowers/   ← plans/ + specs/ (não usa ADRs)
```

### 2.2 apps/web — Frontend React

**Stack:** React 18, TypeScript strict, Vite, React Router, TailwindCSS,
Radix UI, React Query, react-hook-form, Zod.

**Páginas principais** (`apps/web/src/pages/`):
- `DashboardPage` — dashboard
- `LoginPage` / `SignupPage` — autenticação
- `AgentsPage` / `AgentDetailPage` / `AgentNewPage` — CRUD de agentes
- `WikiPage` — busca/navegação na wiki
- `OrchestratorPage` — UI de orquestração
- `SettingsPage` — configurações

**Restrição de segurança:** só consome variáveis `VITE_*`. Nunca tem acesso a
`SERVICE_ROLE_KEY`.

### 2.3 apps/server — Backend Fastify

**Rotas** (`apps/server/src/routes/`):

| Rota | Função |
|------|--------|
| `auth.ts` | JWT auth |
| `agents.ts` | CRUD de agentes + execução de skills |
| `agent-skills.ts` | Gestão de skills por agente |
| `agent-channels.ts` | Gestão de canais (WhatsApp, webchat, etc.) |
| `wiki.ts` | Query e indexação da wiki |
| `schedules.ts` | Agendamento cron de agentes |
| `aios.ts` | Dispatch de tasks pro AIOS Master |
| `a2a.ts` | Protocolo agent-to-agent |
| `event-subscriptions.ts` / `webhooks.ts` / `tickets.ts` | Eventos |
| `dashboard.ts` / `health.ts` | Operacional |

**Dependências internas:** `@ethra-nexus/core`, `@ethra-nexus/db`,
`@ethra-nexus/agents`, `@ethra-nexus/wiki`.

### 2.4 packages/core — Tipos + Segurança

**Tipos** (`packages/core/src/types/`):
- `agent.types.ts` — definição das 5 dimensões do agente
- `provider.types.ts` — `MODULE_PROVIDER_MAP`, `sensitive_data`
- `wiki.types.ts` — entidades da wiki
- `a2a.types.ts` — protocolo agent-to-agent
- `tenant.types.ts` — multi-tenancy

**Segurança** (`packages/core/src/security/`):
- `validate.ts` — validação de paths, scopes, slugs, UUIDs, cron
- `sanitize.ts` — sanitização HTML, prompt isolation, error messages,
  `safeJsonParse`
- `rate-limiter.ts` — rate limiting por tenant + módulo

### 2.5 packages/agents — Núcleo de orquestração

**Componentes principais** (`packages/agents/src/lib/`):

| Módulo | Função |
|--------|--------|
| `aios/aios-master.ts` | `executeTask()` — orquestrador central, depth limit, budget tracking |
| `provider/registry.ts` | `ProviderRegistry` (classe) — roteamento por módulo |
| `provider/anthropic.provider.ts` | Provider Anthropic (dados sensíveis) |
| `provider/openrouter.provider.ts` | Provider OpenRouter (Groq, Gemini) |
| `skills/skill-executor.ts` | Camada de execução de skills |
| `scheduler/` | Cron, event bus, output dispatch |
| `db/` | Acesso DB de agentes |
| `wiki/` | Wiki writer integration |
| `a2a/` | Cliente A2A |
| `embeddings/` | Geração de embeddings |
| `parsers/` | PDF (pdf-parse), DOCX (mammoth), XLSX |
| `fs/` | Adapter de filesystem da wiki |

**Tech:** Anthropic SDK, OpenAI SDK, cron-parser, Zod.

### 2.6 packages/wiki — Engine de conhecimento

**Módulos** (`packages/wiki/src/`):
- `extract.ts` — `extractPagesFromContent()` — extração LLM-powered
- `embedding.ts` — `embed()` — vetorização via OpenAI
- `index-generator.ts` — `generateStrategicIndex()` — geração de PageSummary

**Observação:** o CLAUDE.md menciona "ingest.ts / query.ts / lint.ts" como
plano — a implementação atual expõe `extract / embed / generateStrategicIndex`.

### 2.7 packages/db — Schema Drizzle

**Schemas** (`packages/db/src/schema/`):
- `core.ts` — `tenants`, `agents`, `agent_skills`, `agent_channels`,
  `agent_schedules`
- `aios.ts` — `aios_events`, `aios_event_logs`, `provider_usage`
- `wiki.ts` — `wiki_pages`, `wiki_indices`, `wiki_raw_sources`,
  `wiki_agent_writes`, `wiki_runtime`
- `schedules.ts` — ticketing
- `wizard.ts` — agent cloning/wizard state

### 2.8 infra — Migrations + Docker + N8N

**Supabase migrations (20 totais):** `001_tenants`, `002_agents`,
`003_wiki`, `004_aios_events`, `005_provider_usage`, `007_wiki_raw_sources`,
`010_agent_schedules`, `012_agent_identity_channels`, `013_wiki_runtime`,
`014_a2a`, `016_agent_feedback`, `018_flat_agents_schema`, etc.

**Docker:** `docker-compose.dev.yml`, `docker-compose.prod.yml`,
`Dockerfile`, `nginx/nginx.conf`.

**N8N:** `wiki-ingest-watcher.json`.

### 2.9 wikis — Hierarquia de conhecimento

```
_system/        ← Tier 0 — contexto estratégico do tenant
  schema/CLAUDE.md
  wiki/index.md, log.md
agent-template/ ← Tier 1 — template de Agent Wiki
  schema/CLAUDE.md
  wiki/index.md, log.md
```

### 2.10 As 5 dimensões do Agente (do CLAUDE.md)

1. **Identidade** — prompt, tom, restrições
2. **Skills** — `wiki:query`, `wiki:ingest`, `wiki:lint`, `channel:respond`,
   `channel:proactive`, `report:generate`, `monitor:health`,
   `monitor:alert`, `data:analyze`, `data:extract`, `custom:*`
3. **Ativação** — `on_demand` / `scheduled` / `event`
4. **Canais** — WhatsApp, webchat, API
5. **Orçamento** — `monthly_limit_usd`, `monthly_token_limit`,
   `max_tokens_per_call`, `alert_thresholds[]`, `on_limit_reached`

### 2.11 Ciclo de vida de uma task no AIOS Master

1. RECEBE task (canal/schedule/evento/API)
2. RESOLVE agente + skill
3. PRE-CHECK (status, skill habilitada, budget, rate limit)
4. REGISTRA em `aios_events` (status: running)
5. EXECUTA skill via ProviderRegistry
6. CONTABILIZA custo no budget
7. POST-CHECK (thresholds, esgotamento)
8. RETORNA `AgentResult<T>` com `tokens_used` + `cost_usd`

### 2.12 Hierarquia de roteamento de provider

```
1. SkillConfig.provider_override
2. NEXUS_PROVIDER_{SLUG}_{SKILL}  (env var)
3. SYSTEM_PROVIDER_MAP[skill_id]   (default)
4. tenant.config.default_provider  (fallback)
```

**Regra inviolável:** `sensitive_data: true` → sempre Anthropic direto.

---

## Parte 3 — Mapeamento estilo→arquitetura para o HTML

Plano de seções do HTML baseado na metáfora visual da imagem RAG/REFRAG.
Cada seção será uma "faixa" pastel com tag à esquerda, fluxo numerado e setas
tracejadas.

| # | Tag (esquerda) | Cor de fundo | Conteúdo do fluxo |
|---|---|---|---|
| 1 | **STACK** | Lavanda | Frontend (React) → Server (Fastify) → Packages → Supabase |
| 2 | **AGENTE** | Verde menta | 5 dimensões: Identidade · Skills · Ativação · Canais · Orçamento |
| 3 | **AIOS MASTER** | Pêssego claro | 8 passos do ciclo de vida (RECEBE → RESOLVE → PRE-CHECK → REGISTRA → EXECUTA → CONTABILIZA → POST-CHECK → RETORNA) |
| 4 | **PROVIDER ROUTING** | Azul claro | SkillConfig → ENV → SYSTEM_MAP → Tenant default; bifurcação Anthropic vs OpenRouter com flag `sensitive_data` |
| 5 | **WIKI ENGINE** | Lilás claro | raw/ → extract → embed → pgvector → query → resposta com citação |
| 6 | **MULTI-TENANT + RLS** | Rosa claro | tenant_id em toda tabela → RLS habilitado → audit trail (`aios_events`, `wiki_operation_log`) |
| 7 | **INFRA** | Amarelo claro | Docker Compose · Easypanel · GitHub Actions · N8N workflows · Supabase |

### 3.1 Componentes/ícones SVG a desenhar inline

- Documento (caixa branca + 3 listras coloridas no topo)
- Balão de fala (query)
- Cérebro (LLM/embedding model)
- Cilindro de banco de dados
- Engrenagem (orquestrador)
- Cadeado (RLS/segurança)
- Container/cubo (Docker)
- Calendário/relógio (scheduler)
- Funil (provider routing)
- Grade de quadradinhos coloridos (embeddings vetoriais)

### 3.2 Critérios visuais

- Largura responsiva (max-width ~1200px, centralizado).
- Faixas com 24–32px de padding interno e 16px entre faixas.
- Tag de seção: pílula 100px à esquerda, fonte ligeiramente "manuscrita".
- Círculos numerados: 32px, fundo `#F5A85C`, número branco bold.
- Setas: SVG com `stroke-dasharray="6 4"` e ponta `marker-end`.
- Cantos: `border-radius: 12px` em caixas, `border-radius: 999px` em pílulas.
- Fonte: Nunito ou Quicksand (Google Fonts) + Caveat para tags.

---

## Próximos passos

1. Criar `docs/architecture.html` com estrutura HTML+CSS+SVG inline
   replicando o estilo.
2. Renderizar as 7 faixas mapeadas em §3.
3. Setas tracejadas em SVG entre cada componente.
4. Garantir que o HTML seja **autocontido** (sem CDN obrigatório além de
   Google Fonts opcional com fallback).
