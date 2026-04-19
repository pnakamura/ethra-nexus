# NEXUS-ROADMAP.md — Roteiro de Desenvolvimento do Ethra Nexus

> Documento de planejamento e referência para o desenvolvimento do Ethra Nexus, a partir do Governance Hub existente (repositório `poa-social-governance-hub`). Estruturado como um dev sênior planejaria um projeto de software de médio porte com lançamento público.

**Duração estimada:** 12–16 semanas  
**Stack:** React 18 · TypeScript 5 · Supabase · N8N · Claude API · Docker · Easypanel  
**Repositório alvo:** `github.com/pnakamura/ethra-nexus`

---

## Visão geral das fases

```
Fase 0  │ Auditoria do Governance Hub          │ 1–2 semanas
Fase 1  │ Extração e repositório limpo         │ 1–2 semanas
Fase 2  │ Especificação técnica                │ 1 semana
Fase 3  │ Dev environment e CI/CD              │ 1 semana
Fase 4  │ Core: AIOS Master + módulos base     │ 3–4 semanas
Fase 5  │ LLM Wiki + pipeline de conhecimento  │ 2 semanas
Fase 6  │ Testes e hardening                   │ 2 semanas
Fase 7  │ Build e pacotes de instalação VPS    │ 1 semana
Fase 8  │ Documentação e publicação Git        │ 1 semana
```

**Regra sênior fundamental:** nunca avançar para a próxima fase enquanto os critérios de aceite da fase atual não foram atingidos. A dívida técnica acumulada no Governance Hub é prova de que atalhos custam mais tempo no longo prazo.

---

## Fase 0 — Auditoria do Governance Hub

**Objetivo:** entender precisamente o que funciona antes de escrever uma linha nova.

### Por que isso é a fase mais importante

O maior erro em refactoring é começar a escrever código antes de mapear o que realmente funciona. O Governance Hub acumulou código de experimentos, integrações abandonadas, hooks que consultam tabelas renomeadas, e componentes que nunca são renderizados. Sem uma auditoria, o código "limpo" vai herdar bugs silenciosos.

### Tarefa principal: sessão de auditoria com Claude Code

```bash
# Na raiz do Governance Hub
claude -p "Você é um engenheiro sênior auditando este codebase React/TypeScript.
Gere um arquivo AUDIT.md com as seguintes seções:

## Arquivos ativos
Lista de arquivos em src/ que são importados por componentes em uso.

## Arquivos mortos
Arquivos que não são importados por nenhum componente renderizável.

## Hooks com problema
Hooks que fazem chamadas Supabase para tabelas que não existem, ou que
têm tratamento de erro ausente.

## Dependências desnecessárias
Pacotes no package.json sem uso real no código.

## Features que funcionam de ponta a ponta
Liste as features que têm: componente UI + hook + tabela Supabase + RLS policy.

## Decisão monorepo
Recomende: monorepo (Turborepo) ou repo separado, com justificativa."
```

### Ferramentas de análise estática

```bash
# Detecta exports e arquivos não usados
npx knip

# Identifica código TypeScript morto (funções nunca chamadas)
npx ts-prune

# Dependências npm sem uso real
npx depcheck

# Verifica cobertura de tipos (quanto any existe)
npx tsc --noEmit --strict 2>&1 | grep "error TS" | wc -l
```

### Critérios de aceite da Fase 0

- [ ] `AUDIT.md` gerado com inventário completo
- [ ] Lista de features "vivas" (funcionam de ponta a ponta) confirmada
- [ ] Número de arquivos mortos identificado
- [ ] Decisão monorepo vs repo separado documentada com justificativa

---

## Fase 1 — Extração e repositório limpo

**Objetivo:** criar o repositório `ethra-nexus` com apenas código funcional, configurado com padrões profissionais desde o início.

### Regra de ouro da extração

Só entra no novo repositório código que passa no smoke test. O Governance Hub existente permanece intacto como referência — não é migração, é cirurgia seletiva.

### Criação do repositório

```bash
# Criar repositório no GitHub
gh repo create pnakamura/ethra-nexus --public --description "AI-powered governance system for international funding programs"

# Inicializar com Vite + React + TypeScript
npm create vite@latest ethra-nexus -- --template react-ts
cd ethra-nexus

# Estrutura de pastas
mkdir -p apps/hub/src/{components,hooks,modules,lib,pages,contexts}
mkdir -p packages/{core,agents,wiki,ui}/src
mkdir -p infra/{docker,supabase/migrations,n8n/workflows}
mkdir -p wiki/{raw,wiki/{entidades,conceitos,respostas},schema}
mkdir -p docs
```

### Configuração TypeScript (strict mode)

```json
// tsconfig.json — sem concessões
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

### Tooling obrigatório

```bash
# ESLint + regras React/TypeScript
npm install -D eslint @typescript-eslint/eslint-plugin eslint-plugin-react-hooks

# Prettier
npm install -D prettier

# Husky (pre-commit hooks)
npm install -D husky lint-staged
npx husky install

# Vitest (testes)
npm install -D vitest @testing-library/react @testing-library/user-event

# Playwright (E2E)
npm install -D @playwright/test
npx playwright install
```

### Pre-commit hook (`.husky/pre-commit`)

```bash
#!/bin/sh
npx lint-staged

# Bloqueia commit se TypeScript tiver erro
npx tsc --noEmit
```

### Processo de extração

Para cada feature confirmada como "viva" no `AUDIT.md`:

1. Copiar os arquivos relevantes do Governance Hub
2. Limpar: remover código comentado, remover `console.log`, tipar explicitamente
3. Executar smoke test manual
4. Criar teste unitário mínimo no Vitest
5. Fazer commit atômico: `feat(budget): extract budget control hook`

### Critérios de aceite da Fase 1

- [ ] Repositório `ethra-nexus` criado no GitHub
- [ ] TypeScript strict mode sem erros (`npx tsc --noEmit` passa)
- [ ] ESLint passa sem warnings em todos os arquivos extraídos
- [ ] Husky bloqueia commits com erros de lint/TypeScript
- [ ] Cada feature extraída tem ao menos um teste Vitest passando
- [ ] `CLAUDE.md` e `NEXUS-SPEC.md` na raiz do repo

---

## Fase 2 — Especificação técnica

**Objetivo:** documentar as decisões arquiteturais antes de implementá-las. Mudar uma interface TypeScript depois que três módulos dependem dela custa 10x mais que defini-la corretamente no início.

### NEXUS-SPEC.md — estrutura

```markdown
# Ethra Nexus — Especificação Técnica v1.0

## 1. Visão geral e escopo
## 2. Princípios arquiteturais e ADRs (Architecture Decision Records)
## 3. Módulos AIOS — interfaces TypeScript
## 4. Eventos entre módulos
## 5. Schema do banco de dados
## 6. Políticas RLS por tabela
## 7. Design da LLM Wiki
## 8. Integrações externas (N8N, Evolution API)
## 9. Segurança e LGPD
## 10. Glossário
```

### Interfaces obrigatórias a definir

```typescript
// packages/core/src/types/agent.types.ts

interface AgentContext {
  programId: string
  userId: string
  sessionId: string
  constitutionVersion: string
  timestamp: string
}

type AgentResult<T> =
  | { ok: true; data: T; agentId: string; timestamp: string }
  | { ok: false; error: AgentError; agentId: string; timestamp: string }

interface AgentError {
  code: AgentErrorCode
  message: string
  context?: Record<string, unknown>
  retryable: boolean
}

type AgentErrorCode =
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'INVALID_INPUT'
  | 'SUPABASE_ERROR'
  | 'AI_ERROR'
  | 'UNKNOWN'
```

### ADR (Architecture Decision Record) — template

Cada decisão arquitetural relevante deve ter um ADR em `docs/adr/`:

```markdown
# ADR-001: Usar N8N como camada de automação

**Status:** aceito  
**Data:** YYYY-MM-DD

## Contexto
[problema que motivou a decisão]

## Decisão
[o que foi decidido]

## Consequências
[prós e contras, o que fica mais fácil, o que fica mais difícil]
```

### Critérios de aceite da Fase 2

- [ ] `NEXUS-SPEC.md` criado com todas as seções preenchidas
- [ ] Interfaces TypeScript dos 5 módulos definidas e revisadas
- [ ] Schema Supabase final documentado (todas as tabelas + RLS)
- [ ] `CLAUDE.md` na raiz (AIOS Constitution) revisado e finalizado
- [ ] Pelo menos 3 ADRs documentando decisões relevantes

---

## Fase 3 — Dev environment e CI/CD

**Objetivo:** ambiente de desenvolvimento que replica produção, com pipeline automatizado desde o primeiro dia.

### Estratégia de branches

```
main     → produção (deploy automático via Easypanel)
dev      → staging (deploy automático, porta diferente na VPS)
feature/ → branches de desenvolvimento (PRs para dev)
```

### GitHub Actions — CI pipeline

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main, dev]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: TypeScript check
        run: npx tsc --noEmit

      - name: Lint
        run: npm run lint

      - name: Tests
        run: npm run test -- --coverage

      - name: Build
        run: npm run build
```

### Docker Compose para desenvolvimento local

```yaml
# infra/docker/docker-compose.dev.yml
services:
  app:
    build: .
    ports:
      - "5173:5173"
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      - VITE_SUPABASE_URL=${SUPABASE_URL}
      - VITE_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}

  n8n:
    image: n8nio/n8n
    ports:
      - "5678:5678"
    volumes:
      - n8n_data:/home/node/.n8n

  silverbullet:
    image: ghcr.io/silverbulletmd/silverbullet
    ports:
      - "3001:3000"
    environment:
      - SB_USER=admin:${SILVERBULLET_PASSWORD}
    volumes:
      - ./wiki:/space

volumes:
  n8n_data:
```

### Variáveis de ambiente — `.env.example`

```bash
# Anthropic (provider primário para módulos sensíveis)
ANTHROPIC_API_KEY=sk-ant-...

# OpenRouter (gateway multi-provider — módulos não-sensíveis)
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

# Supabase
SUPABASE_URL=https://[project].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# N8N
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=

# SilverBullet
SILVERBULLET_PASSWORD=

# Evolution API (WhatsApp)
EVOLUTION_API_URL=https://[vps]/evolution
EVOLUTION_API_KEY=

# Provider routing overrides (opcional — sobrescreve MODULE_PROVIDER_MAP)
# Formato: NEXUS_PROVIDER_[MODULO]=[provider]:[modelo]
# Exemplo: NEXUS_PROVIDER_HEARTBEAT=openrouter:groq/llama-3.1-8b-instant
# Exemplo: NEXUS_PROVIDER_QUALITY_GATES=anthropic:claude-sonnet-4-6

# App
VITE_APP_URL=https://nexus.ethra.app
NODE_ENV=development
```

### Critérios de aceite da Fase 3

- [ ] `docker compose up` levanta ambiente completo em menos de 2 minutos
- [ ] GitHub Actions passa em todos os PRs (lint + typecheck + tests + build)
- [ ] Branch `dev` faz deploy automático no Easypanel (staging)
- [ ] `.env.example` documenta todas as variáveis necessárias
- [ ] README inicial com instruções de instalação

---

## Fase 4 — Core: AIOS Master + módulos base

**Objetivo:** implementar os 5 módulos AIOS com testes, seguindo a especificação da Fase 2.

### Estratégia de sprints

Cada sprint tem duração de 1 semana e segue a mesma estrutura:

```
Segunda/Terça  → spec do módulo + interfaces TypeScript refinadas
Quarta/Quinta  → implementação com Claude Code em sessão tmux
Sexta          → testes unitários + code review + PR para dev
```

**Regra inviolável:** o sprint não avança enquanto os testes do sprint anterior não passam.

### Sprint 1 — AIOS Master orchestrator

```typescript
// packages/agents/src/master/orchestrator.ts

interface OrchestratorConfig {
  programId: string
  constitutionVersion: string
  modules: ModuleRegistry
  providerRegistry: ProviderRegistry   // injeção do registry multi-provider
}

interface ModuleRegistry {
  budgetControl: BudgetControlModule
  heartbeat: HeartbeatModule
  qualityGates: QualityGatesModule
  goalAlignment: GoalAlignmentModule
  concierge: ConciergeAgent
}

async function delegateTask(
  task: AgentTask,
  context: AgentContext
): Promise<AgentResult<AgentTaskResult>> {
  // 1. Registrar task em program_events
  // 2. Selecionar módulo adequado
  // 3. Executar com timeout
  // 4. Registrar resultado
  // 5. Retornar AgentResult<T>
}
```

**Tabela Supabase necessária:**
```sql
CREATE TABLE aios_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES programs(id),
  agent_id text NOT NULL,
  task_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  result jsonb,
  status text NOT NULL DEFAULT 'pending',  -- pending | running | ok | error
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  error_code text,
  retryable boolean DEFAULT false
);
ALTER TABLE aios_events ENABLE ROW LEVEL SECURITY;
```

### Sprint 2 — Budget Control (Módulo 1)

Foco: monitorar execução orçamentária do PEP, alertar desvios.

```typescript
interface BudgetControlModule {
  checkDeviation(programId: string): Promise<AgentResult<DeviationReport>>
  getAlerts(programId: string): Promise<AgentResult<BudgetAlert[]>>
  compareVersions(v1: string, v2: string): Promise<AgentResult<VersionDiff>>
}

interface DeviationReport {
  programId: string
  components: ComponentDeviation[]
  totalPlanned: number
  totalActual: number
  deviationPercent: number
  alertLevel: 'ok' | 'warning' | 'critical'
}
```

### Sprint 3 — Heartbeat Scheduler (Módulo 2) + Quality Gates (Módulo 3)

**Heartbeat** — health check dos agentes e da wiki:
```typescript
interface HeartbeatModule {
  checkAllAgents(): Promise<AgentResult<SystemHealth>>
  getWikiHealth(): Promise<AgentResult<WikiHealthReport>>
  scheduleCheck(intervalMs: number): NodeJS.Timer
}
```

**Quality Gates** — validação de entregas e Lint da wiki:
```typescript
interface QualityGatesModule {
  runGate(gateId: string, context: AgentContext): Promise<AgentResult<GateResult>>
  lintWiki(wikiPath: string): Promise<AgentResult<LintReport>>
  buildRetryContext(failedResult: AgentResult<never>): RetryContext
}
```

### Sprint 4 — Goal Alignment (Módulo 4) + integração

Goal Alignment — rastrear alinhamento com objetivos BID:
```typescript
interface GoalAlignmentModule {
  calculateAlignment(programId: string): Promise<AgentResult<AlignmentScore>>
  getIndicators(component: string): Promise<AgentResult<Indicator[]>>
}
```

Na última semana do sprint 4, o foco é integração: todos os módulos se comunicando via `aios_events` e o AIOS Master delegando corretamente.

### Critérios de aceite da Fase 4

- [ ] Todos os 5 módulos implementados com interfaces da spec
- [ ] Cobertura de testes > 70% em `packages/agents` e `packages/core`
- [ ] AIOS Master delega para todos os módulos sem erro em teste de integração
- [ ] Tabelas Supabase criadas com RLS habilitado e policies corretas
- [ ] Zero uso de `any` explícito nos módulos novos
- [ ] Cada módulo tem seu próprio `README.md` em `packages/agents/src/modules/[nome]/`
- [ ] `ProviderRegistry` implementado com Anthropic + OpenRouter providers
- [ ] Todos os módulos recebem `providerRegistry` via injeção (sem hardcode de SDK)
- [ ] Teste de fallback: simular falha do provider primário e verificar fallback automático

---

## Fase 4.5 — Arquitetura multi-provider

**Objetivo:** desacoplar os módulos AIOS de qualquer provider específico de IA, implementando roteamento por tarefa, fallback automático, e proteção de dados LGPD.

### Por que esta fase existe

Many teams use multiple models depending on the task. The "one provider" constraint is more of a default than a requirement. Para o Ethra Nexus, o motivo é tanto técnico quanto estratégico:

- **Custo:** Groq/Llama custa até 200x menos que Claude Sonnet para health checks simples
- **Contexto:** Bifrost, assim como OpenRouter, suportam 15+ providers incluindo OpenAI, Anthropic, Google Gemini, Groq e mais, com roteamento sem mudança de código no agente
- **Resiliência:** fallback automático se um provider tiver outage
- **LGPD:** dados sensíveis ficam exclusivamente na Anthropic API direta

### ADR-004 — Usar OpenRouter como gateway multi-provider

```markdown
# ADR-004: Gateway multi-provider via OpenRouter

**Status:** aceito
**Data:** Abril 2026

## Contexto
O Ethra Nexus tem módulos com requisitos muito diferentes de IA:
- Heartbeat precisa de velocidade e baixo custo (milhares de checks/dia)
- Quality Gates precisa de janela de contexto de 1M tokens (documentos BID completos)
- Budget Control e Concierge precisam de máxima confiabilidade e raciocínio

Usar apenas Anthropic Claude para todos os módulos resulta em custo desnecessário
e limitações técnicas (janela de contexto).

## Decisão
Implementar interface AIProvider com ProviderRegistry que roteia por módulo:
- Módulos com dados sensíveis (LGPD): Anthropic API direto, sempre
- Módulos operacionais simples: OpenRouter/Groq (Llama 8B)
- Módulos com documentos longos: OpenRouter/Gemini 2.5 Pro (1M ctx)

Usar OpenRouter como gateway para providers secundários porque:
- Interface OpenAI-compatível (zero mudança no formato de request)
- Fallback automático entre providers
- 300+ modelos disponíveis

## Consequências
+ Redução de custo estimada em 40-60% nas operações do Heartbeat
+ Documentos BID analisados inteiros (sem chunking) via Gemini 2.5 Pro
+ Código dos módulos agnóstico de provider (testabilidade melhorada)
- Complexidade adicional no ProviderRegistry
- Necessidade de gerenciar 2 chaves de API (Anthropic + OpenRouter)
- Latência adicional ~25-40ms no OpenRouter vs chamada direta
```

### Implementação do ProviderRegistry

```bash
# Instalar dependências
npm install openai @anthropic-ai/sdk
# OpenAI SDK é usado para o cliente OpenRouter (interface compatível)
```

```typescript
// packages/agents/src/lib/provider/index.ts — exports públicos
export { AnthropicProvider } from './anthropic.provider'
export { OpenRouterProvider } from './openrouter.provider'
export { ProviderRegistry, MODULE_PROVIDER_MAP } from './registry'
export type { AIProvider, CompletionParams, CompletionResult, ModuleProviderConfig } from './provider.types'
```

### Tabela `provider_usage_log` — observabilidade de custo

```sql
-- infra/supabase/migrations/020_add_provider_usage_log.sql
CREATE TABLE provider_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  is_fallback boolean NOT NULL DEFAULT false,
  is_sensitive_data boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE provider_usage_log ENABLE ROW LEVEL SECURITY;

-- View de custo estimado por módulo (para o dashboard)
CREATE VIEW provider_cost_summary AS
SELECT
  module_id,
  provider,
  model,
  COUNT(*) as calls,
  SUM(input_tokens) as total_input_tokens,
  SUM(output_tokens) as total_output_tokens,
  AVG(latency_ms) as avg_latency_ms,
  SUM(is_fallback::int) as fallback_count
FROM provider_usage_log
WHERE created_at > now() - interval '30 days'
GROUP BY module_id, provider, model
ORDER BY module_id, calls DESC;
```

### Tabela de custo estimado por módulo (referência Abril 2026)

| Módulo | Provider | Modelo | Custo aprox./1K calls | vs Claude Sonnet |
|--------|----------|--------|----------------------|------------------|
| Heartbeat | OpenRouter/Groq | llama-3.1-8b-instant | ~$0.05 | 100x mais barato |
| Quality Gates | OpenRouter/Google | gemini-2.5-pro | ~$2.50 | Similar + 1M ctx |
| Budget Control | Anthropic | claude-sonnet-4-6 | ~$5.00 | baseline |
| Goal Alignment | Anthropic | claude-sonnet-4-6 | ~$5.00 | baseline |
| Wiki Ingest | Anthropic | claude-sonnet-4-6 | ~$5.00 | baseline |
| AIOS Master | Anthropic | claude-sonnet-4-6 | ~$5.00 | baseline |

### Testes do ProviderRegistry

```typescript
// packages/agents/src/lib/provider/__tests__/registry.test.ts

describe('ProviderRegistry', () => {
  it('usa provider primário quando disponível', async () => {
    const registry = createTestRegistry({ heartbeat: 'groq' })
    const result = await registry.complete('heartbeat', testParams)
    expect(result.ok).toBe(true)
    expect(result.data?.provider).toBe('openrouter')
  })

  it('faz fallback para claude-haiku quando Groq falha', async () => {
    const registry = createTestRegistry({ heartbeat: 'groq' }, { groqFails: true })
    const result = await registry.complete('heartbeat', testParams)
    expect(result.ok).toBe(true)
    expect(result.data?.provider).toBe('anthropic')
  })

  it('força Anthropic direto quando sensitiveData=true', async () => {
    const registry = createTestRegistry()
    // budget-control tem sensitiveData: true
    const result = await registry.complete('budget-control', testParams)
    expect(result.data?.provider).toBe('anthropic')
  })

  it('força Anthropic direto quando forceSensitive=true, ignorando config do módulo', async () => {
    const registry = createTestRegistry()
    // heartbeat normalmente usa Groq, mas com forceSensitive=true vai para Anthropic
    const result = await registry.complete('heartbeat', testParams, { forceSensitive: true })
    expect(result.data?.provider).toBe('anthropic')
  })
})
```

### Critérios de aceite da Fase 4.5

- [ ] `packages/agents/src/lib/provider/` implementado com `AnthropicProvider` e `OpenRouterProvider`
- [ ] `ProviderRegistry` com `MODULE_PROVIDER_MAP` completo para todos os 6 módulos
- [ ] Todos os testes do `ProviderRegistry` passando (incluindo fallback e sensitiveData)
- [ ] `provider_usage_log` no Supabase com dados populados
- [ ] Dashboard de custo funcionando (view `provider_cost_summary`)
- [ ] ADR-004 documentado em `docs/adr/ADR-004-multi-provider.md`
- [ ] Variáveis `ANTHROPIC_API_KEY` e `OPENROUTER_API_KEY` no `.env.example`

---
## Fase 5 — LLM Wiki + pipeline de conhecimento

**Objetivo:** implementar o padrão Karpathy completo — vault de fontes brutas, wiki mantida por agentes, sincronização com Supabase para RAG.

### Estrutura do vault

```
wiki/
├── raw/                           ← fontes imutáveis (documentos BID, atas, PDFs)
│   └── .gitkeep
├── wiki/
│   ├── index.md                   ← catálogo de toda a wiki
│   ├── log.md                     ← log append-only
│   ├── entidades/                 ← componentes, contratos, parceiros
│   └── conceitos/                 ← SUAS, LGPD, CadÚnico, etc.
└── schema/
    └── CLAUDE.md                  ← symlink para /CLAUDE.md
```

### N8N — workflow de Ingest

O workflow N8N tem 5 nós:

```
[Trigger: arquivo novo em wiki/raw/]
  → [Ler conteúdo do arquivo]
  → [Claude API: processar + sintetizar]
      System: conteúdo de wiki/schema/CLAUDE.md (seção 7.1 Ingest)
      User: conteúdo do arquivo + index.md atual + páginas relacionadas
  → [Escrever páginas geradas em wiki/wiki/]
  → [Atualizar wiki/wiki/index.md e wiki/wiki/log.md]
  → [Trigger: pipeline de embeddings Supabase]
```

### N8N — pipeline de embeddings

```
[Trigger: arquivo novo/modificado em wiki/wiki/]
  → [Ler frontmatter + conteúdo]
  → [Chunking por heading (## sections)]
  → [Google text-embedding-004: gerar embedding por chunk]
  → [Supabase: upsert em wiki_pages]
```

### Tabela `wiki_pages`

```sql
-- infra/supabase/migrations/019_add_wiki_pages.sql
CREATE TABLE wiki_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path text NOT NULL UNIQUE,
  title text NOT NULL,
  content text NOT NULL,
  embedding vector(768),
  frontmatter jsonb DEFAULT '{}',
  page_type text NOT NULL DEFAULT 'conceito',
  confidence text NOT NULL DEFAULT 'media',
  sources text[] DEFAULT '{}',
  tags text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index vetorial para busca semântica
CREATE INDEX wiki_pages_embedding_idx
  ON wiki_pages USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE wiki_pages ENABLE ROW LEVEL SECURITY;

-- Agentes podem ler e escrever; usuários autenticados podem ler
CREATE POLICY "agents_full_access" ON wiki_pages
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "users_read" ON wiki_pages
  FOR SELECT USING (auth.role() = 'authenticated');
```

### Função de busca semântica

```sql
-- Busca por similaridade coseno
CREATE OR REPLACE FUNCTION search_wiki(
  query_embedding vector(768),
  similarity_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  path text,
  title text,
  content text,
  similarity float
)
LANGUAGE sql STABLE AS $$
  SELECT
    path, title, content,
    1 - (embedding <=> query_embedding) AS similarity
  FROM wiki_pages
  WHERE 1 - (embedding <=> query_embedding) > similarity_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
```

### Critérios de aceite da Fase 5

- [ ] SilverBullet rodando no Docker com vault sincronizado
- [ ] Workflow N8N de Ingest testado com 3+ documentos reais do BR-L1597
- [ ] Pipeline de embeddings populando `wiki_pages` no Supabase
- [ ] Função `search_wiki` retornando resultados relevantes
- [ ] Operação Lint no Quality Gates funcionando (detecta páginas órfãs)
- [ ] `wiki/wiki/index.md` e `wiki/wiki/log.md` sendo mantidos automaticamente

---

## Fase 6 — Testes e hardening

**Objetivo:** cobertura de testes que garante confiança para deploy em produção e para contribuições externas.

### Pirâmide de testes

```
E2E (Playwright)        ← fluxos críticos do usuário (poucos, lentos)
    ↑
Integration (Vitest)    ← módulos AIOS + Supabase (médio)
    ↑
Unit (Vitest)           ← funções puras, hooks isolados (muitos, rápidos)
```

### Testes unitários — o que cobrir

```typescript
// Prioridade 1: lógica de negócio em packages/core
describe('calculateBudgetDeviation', () => {
  it('retorna 0 quando planejado === realizado', ...)
  it('retorna positivo quando realizado > planejado', ...)
  it('retorna negativo quando realizado < planejado', ...)
  it('lança erro quando planejado é 0', ...)
})

// Prioridade 2: funções de agentes
describe('buildRetryContext', () => {
  it('marca como retryable quando código é TIMEOUT', ...)
  it('marca como não retryable quando código é INVALID_INPUT', ...)
})
```

### Testes E2E — fluxos críticos (Playwright)

```typescript
// tests/e2e/budget-control.spec.ts
test('usuário visualiza dashboard de orçamento com dados reais', async ({ page }) => {
  await page.goto('/hub/budget')
  await expect(page.getByTestId('budget-summary')).toBeVisible()
  await expect(page.getByTestId('deviation-chart')).toBeVisible()
})

test('agente AIOS gera alerta de desvio orçamentário', async ({ page }) => {
  // simular desvio acima do threshold
  // verificar que alerta aparece no dashboard
})
```

### Audit de segurança

```bash
# Verificar que nenhuma chave vaza nos logs
grep -r "sk-ant\|eyJ\|password" --include="*.ts" --include="*.tsx" src/

# Verificar RLS em todas as tabelas
# (query no Supabase Dashboard ou via psql)
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND rowsecurity = false;
# Este resultado deve ser vazio

# Verificar variáveis de ambiente expostas ao frontend
grep -r "process.env\|import.meta.env" src/ | grep -v "VITE_"
# Variáveis sem prefixo VITE_ não devem aparecer no frontend
```

### Critérios de aceite da Fase 6

- [ ] Cobertura de testes unitários > 80% em `packages/core` e `packages/agents`
- [ ] Todos os fluxos E2E críticos passando no Playwright
- [ ] `npx tsc --noEmit` sem erros
- [ ] Audit de segurança: zero chaves expostas, todas as tabelas com RLS
- [ ] `CHANGELOG.md` iniciado com formato [Keep a Changelog](https://keepachangelog.com)

---

## Fase 7 — Build e pacotes de instalação VPS

**Objetivo:** qualquer pessoa com uma VPS Ubuntu 22.04 e as credenciais necessárias deve conseguir instalar o Ethra Nexus em menos de 15 minutos.

### Docker Compose de produção

```yaml
# infra/docker/docker-compose.prod.yml
services:
  app:
    image: ghcr.io/pnakamura/ethra-nexus:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  n8n:
    image: n8nio/n8n:latest
    restart: unless-stopped
    ports:
      - "5678:5678"
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=${N8N_USER}
      - N8N_BASIC_AUTH_PASSWORD=${N8N_PASSWORD}
      - N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}
    volumes:
      - n8n_data:/home/node/.n8n
      - ./infra/n8n/workflows:/home/node/.n8n/workflows

  silverbullet:
    image: ghcr.io/silverbulletmd/silverbullet:latest
    restart: unless-stopped
    ports:
      - "3001:3000"
    environment:
      - SB_USER=${SB_USER}
    volumes:
      - ./wiki:/space

volumes:
  n8n_data:
```

### Script de instalação one-command

```bash
#!/bin/bash
# install.sh — Ethra Nexus VPS installer
# Uso: curl -sSL https://raw.githubusercontent.com/pnakamura/ethra-nexus/main/install.sh | bash
# Testado em: Ubuntu 22.04 LTS

set -euo pipefail

NEXUS_VERSION="1.0.0"
INSTALL_DIR="/opt/ethra-nexus"

echo "======================================"
echo " Ethra Nexus v${NEXUS_VERSION}"
echo " Instalador para VPS Ubuntu 22.04"
echo "======================================"

# Verificar pré-requisitos
check_requirement() {
  command -v "$1" &>/dev/null || { echo "ERRO: $1 não encontrado. Instale antes de continuar."; exit 1; }
}

check_requirement docker
check_requirement docker-compose
echo "[OK] Docker encontrado"

# Clonar repositório
if [ ! -d "$INSTALL_DIR" ]; then
  git clone https://github.com/pnakamura/ethra-nexus.git "$INSTALL_DIR"
else
  echo "[OK] Repositório já existe em $INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# Configurar variáveis de ambiente
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo ""
  echo "Configure as variáveis de ambiente em $INSTALL_DIR/.env"
  echo "Pressione ENTER após configurar..."
  read -r
fi

# Aplicar migrations Supabase
echo "Aplicando migrations do banco de dados..."
npx supabase db push --db-url "${DATABASE_URL}"

# Subir serviços
echo "Iniciando serviços..."
docker compose -f infra/docker/docker-compose.prod.yml up -d

# Health check
echo "Aguardando serviços inicializarem..."
sleep 10

STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health)
if [ "$STATUS" = "200" ]; then
  echo ""
  echo "======================================"
  echo " Instalação concluída com sucesso!"
  echo " App:          http://localhost:3000"
  echo " N8N:          http://localhost:5678"
  echo " SilverBullet: http://localhost:3001"
  echo "======================================"
else
  echo "AVISO: health check retornou status $STATUS. Verifique os logs:"
  echo "docker compose -f infra/docker/docker-compose.prod.yml logs"
fi
```

### Easypanel app template

Criar `infra/easypanel/template.json` com a configuração de deployment para importação no Easypanel — permite instalação via interface web sem SSH.

### Critérios de aceite da Fase 7

- [ ] `docker compose -f infra/docker/docker-compose.prod.yml up -d` funciona sem erros
- [ ] `install.sh` testado em VPS Ubuntu 22.04 limpa
- [ ] Easypanel template importável e funcional
- [ ] Health check endpoint `/health` retornando 200 com status dos serviços
- [ ] Migrations Supabase aplicadas automaticamente pelo installer
- [ ] Todas as variáveis de ambiente documentadas em `.env.example`

---

## Fase 8 — Documentação e publicação Git

**Objetivo:** tornar o projeto acessível para colaboradores e para uso por terceiros.

### README.md — estrutura

```markdown
# Ethra Nexus

> AI-powered governance system for international funding programs

[![CI](badge)] [![License: MIT](badge)] [![TypeScript](badge)]

## O que é

## Screenshots / Demo

## Quick start (5 minutos)

## Stack

## Documentação completa

## Contribuindo

## Licença
```

### Estrutura de documentação (`docs/`)

```
docs/
├── architecture.md       ← visão geral da arquitetura, diagrama
├── installation.md       ← guia detalhado de instalação
├── configuration.md      ← todas as variáveis de ambiente explicadas
├── modules/
│   ├── aios-master.md
│   ├── budget-control.md
│   ├── heartbeat.md
│   ├── quality-gates.md
│   └── goal-alignment.md
├── wiki-pattern.md       ← como o LLM Wiki funciona
├── api.md                ← endpoints e contratos
└── adr/
    ├── ADR-001-n8n-automation.md
    ├── ADR-002-supabase-over-firebase.md
    └── ADR-003-silverbullet-over-obsidian.md
```

### Semantic release

```bash
# Configurar semantic-release para versioning automático
npm install -D semantic-release @semantic-release/changelog @semantic-release/git

# .releaserc.json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/changelog",
    "@semantic-release/npm",
    "@semantic-release/github",
    "@semantic-release/git"
  ]
}
```

**Padrão de commits (Conventional Commits):**
```
feat: nova funcionalidade
fix: correção de bug
docs: documentação
chore: manutenção
test: testes
refactor: refactoring sem mudança de comportamento
BREAKING CHANGE: mudança que quebra compatibilidade
```

### GitHub Release v1.0.0

```bash
# Tag e release
git tag -a v1.0.0 -m "Ethra Nexus v1.0.0 - Initial release"
git push origin v1.0.0

# Assets do release:
# - ethra-nexus-1.0.0.tar.gz (source)
# - install.sh
# - docker-compose.prod.yml
# - CHANGELOG.md
```

### Critérios de aceite da Fase 8 (Definition of Done)

- [ ] README.md com badges, screenshots e quick start
- [ ] Documentação completa em `docs/`
- [ ] CONTRIBUTING.md com guia para novos contribuidores
- [ ] CHANGELOG.md atualizado
- [ ] GitHub Release v1.0.0 publicado com assets
- [ ] Licença MIT ou Apache 2.0 definida e em `LICENSE`
- [ ] Issues templates criados no GitHub

---

## Apêndice A — Comandos de referência rápida

```bash
# === DESENVOLVIMENTO ===
npm run dev                          # inicia todos os apps
npm run test                         # roda todos os testes (Vitest)
npm run test:watch                   # testes em modo watch
npm run test:e2e                     # Playwright E2E
npm run lint                         # ESLint + TypeScript check
npm run build                        # build de produção

# === SUPABASE ===
npx supabase start                   # inicia Supabase local
npx supabase stop                    # para Supabase local
npx supabase db diff                 # gera migration do diff atual
npx supabase migration up            # aplica migrations pendentes
npx supabase db push                 # push para projeto remoto

# === DOCKER ===
docker compose -f infra/docker/docker-compose.dev.yml up -d    # dev
docker compose -f infra/docker/docker-compose.prod.yml up -d   # prod
docker compose -f infra/docker/docker-compose.test.yml run --rm  # testes

# === CLAUDE CODE (VPS) ===
# Autenticação headless
export ANTHROPIC_API_KEY="sk-ant-..."

# Iniciar sessão persistente
tmux new -s nexus-dev
claude
# Ctrl+B, D para desachar

# Retornar à sessão
tmux attach -t nexus-dev

# Auditoria do codebase
claude -p "Audite o codebase em $(pwd). Gere AUDIT.md."

# Tarefa de desenvolvimento
claude -p "$(cat CLAUDE.md) Implemente o módulo Heartbeat conforme spec em NEXUS-SPEC.md seção 5.3."

# Wiki operations
claude -p "$(cat CLAUDE.md) Ingest o arquivo wiki/raw/[arquivo.md]. Siga o protocolo da seção 7.1."
claude -p "$(cat CLAUDE.md) Execute Lint na wiki em wiki/wiki/. Gere relatório de saúde."

# === GIT ===
# Commit semântico
git commit -m "feat(budget): add deviation threshold alerts"
git commit -m "fix(heartbeat): resolve null check in agent status"
git commit -m "docs: update installation guide for Ubuntu 22.04"
```

---

## Apêndice B — Métricas de qualidade

| Métrica | Mínimo aceitável | Alvo |
|---------|-----------------|------|
| Cobertura de testes (core) | 70% | 85% |
| Cobertura de testes (agents) | 70% | 80% |
| TypeScript strict errors | 0 | 0 |
| ESLint warnings | 0 | 0 |
| Tempo de build | < 60s | < 30s |
| Tempo de install.sh | < 15min | < 10min |
| Lighthouse Performance | > 80 | > 90 |

---

## Apêndice C — Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------| 
| Rate limit Anthropic API em agentes | Alta | Médio | ProviderRegistry faz fallback automático; backoff exponencial |
| Drift entre vault wiki e Supabase | Média | Alto | Heartbeat verifica consistência diariamente |
| Custo de embeddings crescendo | Média | Médio | Monitorar `provider_cost_summary`; Gemini Flash é 10x mais barato |
| Migrations com conflito em prod | Baixa | Alto | Sempre testar migration em staging antes de prod |
| Código do Governance Hub mais complexo que o esperado | Alta | Médio | Fase 0 de auditoria reduz esta incerteza |
| Outage do OpenRouter (gateway) | Baixa | Médio | Fallback nos módulos não-sensíveis volta para claude-haiku automaticamente |
| Dado sensível LGPD roteado para OpenRouter | Baixa | Alto | `sensitiveData: true` no MODULE_PROVIDER_MAP força Anthropic direto |
| Inconsistência de formato entre providers | Média | Baixo | `CompletionResult` normaliza output; testes de integração cobrem diferenças |

---

## Apêndice D — Referência de providers suportados

| Provider | Via | Modelos-chave | Melhor para | Custo relativo |
|----------|-----|--------------|-------------|----------------|
| Anthropic | Direto | claude-sonnet-4-6, claude-haiku-4-5 | Raciocínio, tool use, dados sensíveis | $$$ |
| Google/Gemini | OpenRouter | gemini-2.5-pro, gemini-2.5-flash | Contexto longo (1M tk), documentos BID | $$ |
| Groq/Llama | OpenRouter | llama-3.1-8b-instant | Velocidade, volume, health checks | $ |
| Mistral | OpenRouter | mistral-small-3.2 | Alternativa custo-eficiente | $ |
| OpenAI | OpenRouter | gpt-4o-mini | Compatibilidade com ferramentas OpenAI | $$ |

**Para adicionar novo provider:**
1. Implementar interface `AIProvider` em `packages/agents/src/lib/provider/`
2. Registrar no `ProviderRegistry` em `registry.ts`
3. Adicionar à tabela acima e ao `MODULE_PROVIDER_MAP` se aplicável
4. Adicionar variável de ambiente em `.env.example`
5. Criar teste unitário em `provider/__tests__/`

---

*NEXUS-ROADMAP.md — Roteiro de Desenvolvimento do Ethra Nexus*  
*Versão: 1.1.0 — Abril 2026 (atualizado com arquitetura multi-provider)*  
*Autor: Paulo Nakamura (gerado com assistência do Claude)*
