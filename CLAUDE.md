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
Monorepo: apps/web + packages/core + packages/agents + packages/wiki
Frontend:  React 18 + TypeScript 5 (strict) + Vite
Backend:   Supabase (PostgreSQL + Auth + Storage + pgvector + RLS)
Automação: N8N (workflows de agentes)
Wiki UI:   SilverBullet
AI:        Anthropic (dados sensíveis) + OpenRouter (Groq, Gemini — custo)
Infra:     Docker Compose + Easypanel + GitHub Actions
```

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
│   └── web/                    ← React 18 + TypeScript (frontend)
├── packages/
│   ├── core/                   ← tipos compartilhados (sem dependências externas)
│   ├── agents/                 ← AIOS Master + ProviderRegistry
│   └── wiki/                   ← engine de wiki (ingest, query, lint)
├── infra/
│   ├── docker/                 ← Dockerfile + docker-compose dev/prod
│   ├── supabase/migrations/    ← SQL migrations numeradas
│   └── n8n/workflows/          ← workflows N8N exportados em JSON
├── wikis/
│   ├── _system/                ← System Wiki (Tier 0)
│   └── agent-{slug}/           ← Agent Wiki (Tier 1) — criado por agente
├── docs/
│   └── adr/                    ← Architecture Decision Records
├── .github/workflows/          ← CI pipeline
├── CLAUDE.md                   ← este arquivo
└── .env.example
```

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

Skills custom: `custom:{nome}` — implementadas via N8N workflows.

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

- **ingest.ts**: processa raw/ → gera páginas wiki → embeddings
- **query.ts**: busca semântica → síntese com citação
- **lint.ts**: auditoria periódica → score de saúde

---

## 6. Banco de dados — tabelas principais

| Tabela | Propósito |
|--------|-----------|
| `tenants` | Organizações — isolamento multi-tenant |
| `tenant_members` | Usuários por tenant com roles |
| `agents` | Agentes configurados (5 dimensões em JSONB) |
| `agent_budget_periods` | Histórico mensal de gastos por agente |
| `agent_conversations` | Histórico de conversas |
| `agent_messages` | Mensagens individuais (com cost_usd) |
| `wiki_raw_sources` | Fontes brutas (imutáveis) |
| `wiki_pages` | Conhecimento compilado + embeddings |
| `wiki_operation_log` | Log append-only de operações |
| `aios_events` | Log de execução do orquestrador |
| `provider_usage_log` | Observabilidade de custo de AI |

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
# Desenvolvimento
npm run dev          # inicia todos os apps (Turbo)
npm run typecheck    # TypeScript check em todos os packages
npm run lint         # ESLint em todos os packages
npm run test         # Vitest em todos os packages
npm run build        # build de produção

# Docker
docker compose -f infra/docker/docker-compose.dev.yml up -d   # dev
docker compose -f infra/docker/docker-compose.prod.yml up -d  # prod

# Supabase
npx supabase start                    # local dev
npx supabase db push                  # push para remote
npx supabase migration new [nome]     # nova migration
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

- `docs/adr/ADR-001-monorepo-turborepo.md`
- `docs/adr/ADR-002-supabase-over-firebase.md`
- `docs/adr/ADR-003-silverbullet-wiki.md`
- `docs/adr/ADR-004-multi-provider-openrouter.md`
- `docs/adr/ADR-005-modelo-c-hybrid-deployment.md`
