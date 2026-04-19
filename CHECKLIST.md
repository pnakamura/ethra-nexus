# Ethra Nexus — Checklist de Implementação

> Documento vivo. Atualizado conforme as fases avançam.
> VPS target: nova VPS dedicada (stack do zero).
> Última atualização: 2026-04-12

---

## Legenda

- [x] Concluído
- [ ] Pendente
- [~] Parcialmente feito

---

## Fase 0 — Arquitetura e Decisões

> Definir o que construir antes de escrever código.

- [x] Definir visão do produto (plataforma de orquestração de agentes para empresas)
- [x] Escolher modelo de deployment (Modelo C: self-hosted primeiro, cloud depois)
- [x] Definir stack tecnológico (React, TypeScript, Supabase, N8N, Docker)
- [x] Definir combinação de agentes iniciais (C: Knowledge + A: Atendimento + B: Monitoramento)
- [x] Projetar arquitetura de wikis hierárquicas (System Wiki Tier 0 + Agent Wikis Tier 1)
- [x] Integrar padrão Karpathy (raw → wiki → embeddings → query)
- [x] Projetar especificação de agente em 5 dimensões (identidade, skills, ativação, canais, orçamento)
- [x] Definir sistema de skills composíveis (10 skills built-in + custom via N8N)
- [x] Definir controle de orçamento por agente (limite mensal, alertas, ações automáticas)
- [x] Definir modos de ativação (on_demand, scheduled, event)
- [x] Definir arquitetura multi-provider (Anthropic + OpenRouter com roteamento por skill)
- [x] Definir hierarquia de resolução de provider (skill → agent → env → system map)
- [x] Documentar ADRs (Architecture Decision Records)
- [ ] Definir modelo de precificação do produto (planos, preços)
- [ ] Definir branding (logo, cores, identidade visual)

---

## Fase 1 — Scaffolding do Monorepo

> Estrutura de projeto, tooling, configuração base.

- [x] Criar monorepo (package.json, turbo.json, tsconfig.base.json)
- [x] Configurar TypeScript strict mode (zero `any`, strict null checks)
- [x] Criar .gitignore (protege .env, secrets, raw/, node_modules)
- [x] Criar .env.example com todas as variáveis documentadas
- [x] Criar apps/web (Vite + React 18 + TypeScript)
- [x] Criar packages/core (tipos compartilhados)
- [x] Criar packages/agents (AIOS Master + providers)
- [x] Criar packages/wiki (engine de wiki)
- [x] Criar .github/workflows/ci.yml (typecheck + lint + test + build + security)
- [ ] Inicializar repositório Git
- [ ] Criar repositório no GitHub (github.com/pnakamura/ethra-nexus)
- [ ] Fazer primeiro commit e push
- [ ] Configurar branch protection (main + dev)
- [ ] Configurar Husky (pre-commit hooks)
- [ ] Configurar ESLint + Prettier
- [ ] Verificar que `npm run typecheck` passa sem erros

---

## Fase 2 — Tipos e Contratos (packages/core)

> Interfaces TypeScript que definem TODO o sistema.

- [x] tenant.types.ts — multi-tenant, planos, config, limites
- [x] agent.types.ts — 5 dimensões (identidade, skills, ativação, canais, orçamento)
- [x] wiki.types.ts — WikiPage, WikiRawSource, IngestParams, QueryParams, LintReport
- [x] provider.types.ts — AIProvider, CompletionParams, SYSTEM_PROVIDER_MAP, estimateCostUsd
- [x] Aliases de compatibilidade (ModuleId, MODULE_PROVIDER_MAP, skillToModuleId)
- [x] Templates de agente (atendimento, monitoramento, knowledge)
- [x] DEFAULT_BUDGET com thresholds de alerta

---

## Fase 3 — Segurança (packages/core/security)

> Módulo centralizado. Toda entrada externa passa por aqui.

- [x] validate.ts — 10 funções de validação (scope, path, slug, UUID, cron, etc.)
- [x] sanitize.ts — sanitizeForHtml, wrapUserContentForPrompt, sanitizeErrorMessage, safeJsonParse
- [x] rate-limiter.ts — rate limiting por tenant + módulo com janelas de tempo
- [x] Prompt injection isolation (delimitadores anti-injection para conteúdo de clientes)
- [x] Checklist de segurança para PRs documentada no CLAUDE.md
- [ ] Testes unitários para validate.ts
- [ ] Testes unitários para sanitize.ts
- [ ] Testes unitários para rate-limiter.ts
- [ ] Configurar SAST (Static Application Security Testing) no CI
- [ ] Configurar Dependabot ou Snyk para vulnerabilidades de dependências

---

## Fase 4 — AIOS Master + ProviderRegistry (packages/agents)

> O cérebro do sistema. Toda execução de agente passa pelo Master.

- [x] AnthropicProvider (SDK oficial)
- [x] OpenRouterProvider (SDK OpenAI-compatible)
- [x] ProviderRegistry (roteamento por módulo, fallback, sensitive_data enforcement)
- [x] createRegistryFromEnv() — factory com overrides por variável de ambiente
- [x] AiosMasterOrchestrator — ciclo completo:
  - [x] Resolução de agente
  - [x] Verificação de status (active, paused, budget_exceeded, etc.)
  - [x] Verificação de skill (habilitada + executor registrado)
  - [x] Verificação de budget (monthly_limit_usd, monthly_token_limit)
  - [x] Dispatch para SkillExecutor
  - [x] Contabilização de custo pós-execução
  - [x] Alertas de budget (50%, 75%, 90%, 100%)
  - [x] Error normalization com sanitização de segredos
- [ ] Adicionar estimateCostUsd() dentro dos providers (Anthropic + OpenRouter)
- [ ] Testes unitários para ProviderRegistry (mock providers)
- [ ] Testes unitários para Orchestrator (mock DB + skills)
- [ ] Teste de fallback (simular falha do provider primário)
- [ ] Teste de budget enforcement (simular limite atingido)

---

## Fase 5 — Wiki Engine (packages/wiki)

> Padrão Karpathy: raw → wiki compilada → embeddings → query.

- [x] ingest.ts — pipeline completo (Claude processa → valida → sanitiza → upsert)
- [x] query.ts — busca semântica + síntese com citação
- [x] lint.ts — auditoria (órfãs, links quebrados, contradições, health score)
- [x] Validação de output do LLM campo a campo (path, title, content, frontmatter)
- [x] Isolamento de conteúdo de cliente em prompts (anti prompt injection)
- [ ] Testes unitários para parseIngestResponse (outputs maliciosos)
- [ ] Testes unitários para sanitizeStringArray
- [ ] Testes de integração (mock Claude → verificar páginas geradas)
- [ ] Teste de lint com wiki real

---

## Fase 6 — Camada de Infraestrutura (packages/agents/src/lib)

> Conectores concretos que implementam as interfaces.

### Supabase Client
- [x] client.ts — singleton com suporte a Docker Secrets (*_FILE)
- [x] db-wiki.ts — CRUD wiki_pages, searchWiki RPC, operation log
- [x] db-agents.ts — CRUD agents, aios_events, budget spend query
- [x] db-raw-sources.ts — CRUD wiki_raw_sources
- [ ] Testes com Supabase real (local dev)
- [ ] Tratamento de erros de conexão (retry, circuit breaker)

### Embeddings
- [x] embeddings.service.ts — OpenAI text-embedding-3-small (768 dims → pgvector)
- [x] createEmbeddingsService() — factory com fallback para OpenRouter
- [ ] Suporte a Ollama local (nomic-embed-text) para self-hosted sem API key
- [ ] Teste de geração de embedding + upsert no banco

### File Parsers
- [x] file-parser.ts — dispatcher por tipo (PDF, DOCX, XLSX, MD, TXT, URL)
- [x] PDF via pdf-parse
- [x] DOCX via mammoth
- [x] XLSX via SheetJS
- [x] URL via fetch + strip HTML
- [ ] Teste com arquivo PDF real
- [ ] Teste com arquivo DOCX real
- [ ] Teste com planilha XLSX real
- [ ] Limite de tamanho de arquivo (prevenir OOM com PDFs de 500MB)

### Filesystem
- [x] wiki-fs.adapter.ts — acesso seguro com validação de path traversal
- [ ] Teste de path traversal bloqueado
- [ ] Teste de leitura/escrita em wikis/

---

## Fase 7 — Skill Executors (packages/agents/src/modules)

> Implementações concretas das skills que o AIOS Master despacha.

- [x] WikiIngestExecutor (wiki:ingest) — lê raw source → parseia → ingesta → embeddings
- [x] WikiQueryExecutor (wiki:query) — embedding query → pgvector search → sintetiza resposta
- [x] WikiLintExecutor (wiki:lint) — audita wiki → health score
- [x] registerBuiltinSkills() — popula Map<SkillId, SkillExecutor>
- [ ] DataExtractExecutor (data:extract) — extrai dados estruturados de documentos
- [ ] ChannelRespondExecutor (channel:respond) — responde em canal de comunicação
- [ ] ChannelProactiveExecutor (channel:proactive) — notificações proativas
- [ ] MonitorHealthExecutor (monitor:health) — health check de processos
- [ ] MonitorAlertExecutor (monitor:alert) — avalia condições e dispara alertas
- [ ] ReportGenerateExecutor (report:generate) — gera relatórios estruturados
- [ ] Testes para cada executor

---

## Fase 8 — Bootstrap + HTTP Server

> Assembly que conecta tudo e expõe via API HTTP.

- [x] bootstrap.ts — monta todas as deps e retorna NexusRuntime
- [x] server.ts — HTTP server com endpoints:
  - [x] `POST /api/task` — executa task via AIOS Master
  - [x] `POST /api/ingest` — upload + trigger ingest
  - [x] `POST /api/query` — busca na wiki
  - [x] `GET /health` — health check
- [ ] Autenticação nos endpoints (JWT via Supabase Auth)
- [ ] Middleware de rate limiting por IP
- [ ] Middleware de logging estruturado
- [ ] Endpoint `POST /api/agents` — CRUD de agentes
- [ ] Endpoint `GET /api/agents/:id/budget` — consulta de budget
- [ ] Endpoint `GET /api/agents/:id/events` — histórico de execuções
- [ ] Endpoint `POST /api/agents/:id/skills` — gerenciar skills
- [ ] WebSocket para streaming de respostas
- [ ] Testes de integração dos endpoints

---

## Fase 9 — Banco de Dados (Supabase/PostgreSQL)

> Schema multi-tenant com RLS em todas as tabelas.

- [x] Migration 001: tenants + tenant_members + helper functions (user_tenant_ids, user_is_tenant_admin)
- [x] Migration 002: agents + agent_budget_periods + conversations + messages
- [x] Migration 003: wiki_raw_sources + wiki_pages + search_wiki() + wiki_operation_log
- [x] Migration 004: aios_events + audit trail + retention policy
- [x] Migration 005: provider_usage_log + cost summary view
- [x] Migration 006: alinhar aios_events com TypeScript (skill_id, activation_mode, tokens_used, cost_usd)
- [x] Arquivo unificado easypanel-setup.sql (todas as migrations em um)
- [x] Seed: tenant inicial "self-hosted"
- [x] RLS habilitado em TODAS as tabelas
- [x] Função search_wiki() com pgvector
- [x] Função get_agent_spend_current_period()
- [x] Função reset_monthly_budgets()
- [ ] Testar migrations em PostgreSQL limpo
- [ ] Verificar que RLS bloqueia acesso cross-tenant
- [ ] Criar índices adicionais baseados em queries reais
- [ ] Configurar pg_cron para reset_monthly_budgets() automático
- [ ] Backup strategy (pg_dump automatizado)

---

## Fase 10 — Wiki Vault + CLAUDE.md

> Estrutura de conhecimento hierárquica.

- [x] wikis/_system/schema/CLAUDE.md — constituição do System Wiki
- [x] wikis/_system/wiki/index.md — índice vazio pronto para uso
- [x] wikis/_system/wiki/log.md — log append-only
- [x] wikis/_system/raw/.gitkeep
- [x] wikis/agent-template/ — template replicável (schema + wiki + raw)
- [x] CLAUDE.md raiz — constituição do sistema completa
- [ ] Documentar como criar uma nova wiki de agente a partir do template
- [ ] Script de provisionamento de wiki para novo agente

---

## Fase 11 — Docker + Infra de Deploy

> Containerização e deploy em VPS.

### Docker
- [x] Dockerfile multi-stage (deps → build → runner)
- [x] docker-compose.dev.yml (web + api + n8n + silverbullet)
- [x] docker-compose.prod.yml (com Docker Secrets, nginx, versões pinadas)
- [x] nginx.conf (security headers, HSTS, CSP, rate limiting, reverse proxy)
- [ ] Testar `docker compose -f docker-compose.dev.yml up` localmente
- [ ] Build da imagem Docker e push para ghcr.io
- [ ] Testar imagem em VPS limpa

### VPS Setup
- [x] docker-compose.vps.yml (stack otimizado para 4GB RAM)
- [x] init-db.sql (extensões, roles, grants)
- [x] setup.sh (swap, clone, senhas, SSL, migrations, start)
- [x] manage-keys.sh (entrada segura de API keys, rotação, criptografia)
- [x] nginx.conf para VPS (TLS, proxy, rate limiting)
- [x] EASYPANEL-DEPLOY.md (guia para quem usa Easypanel)
- [x] easypanel-setup.sql (todas as migrations em um arquivo)
- [ ] Testar setup.sh em VPS Ubuntu 22.04 limpa
- [ ] Testar setup.sh em VPS Ubuntu 24.04
- [ ] Documentar requisitos mínimos de VPS (RAM, disco, OS)

### CI/CD
- [x] GitHub Actions: typecheck + lint + test + build + security audit
- [ ] GitHub Actions: build e push Docker image no merge para main
- [ ] GitHub Actions: deploy automático para staging (branch dev)
- [ ] Semantic release (versionamento automático)

---

## Fase 12 — N8N Workflows

> Automações que conectam eventos a skills.

- [x] wiki-ingest-watcher.json (poll pendentes → trigger ingest)
- [ ] wiki-lint-scheduled.json (cron semanal → lint em todas as wikis)
- [ ] budget-reset-monthly.json (cron mensal → reset_monthly_budgets)
- [ ] agent-health-check.json (cron → health check de todos os agentes ativos)
- [ ] Testar workflows com N8N real
- [ ] Documentar como importar workflows no N8N

---

## Fase 13 — Frontend (apps/web)

> Dashboard e interface de gestão.

- [x] Scaffolding (Vite + React + TypeScript + React Router)
- [x] CSS base (variáveis, dark theme)
- [ ] Autenticação (login, signup via Supabase Auth)
- [ ] Layout principal (sidebar + header + content area)
- [ ] Dashboard: status dos agentes, custo do mês, eventos recentes
- [ ] Página de Agentes: lista, criar, editar, pausar/ativar
- [ ] Página de Agente individual:
  - [ ] Configuração das 5 dimensões
  - [ ] Gráfico de custo mensal
  - [ ] Skills habilitadas/desabilitadas
  - [ ] Histórico de execuções (aios_events)
  - [ ] Conversas
- [ ] Página de Wiki: visualizar páginas, status do ingest, lint report
- [ ] Upload de documentos (drag & drop → trigger ingest)
- [ ] Chat integrado (testar agente direto no dashboard)
- [ ] Página de Settings: tenant config, API keys (mascaradas), membros
- [ ] Responsivo (mobile-friendly)
- [ ] Testes E2E (Playwright)

---

## Fase 14 — Integrações de Canais

> Conectar agentes ao mundo externo.

- [ ] WebChat widget embeddable (script JS para sites de clientes)
- [ ] WhatsApp via Evolution API
- [ ] Email (IMAP/SMTP para receber e responder)
- [ ] Slack bot
- [ ] API pública (REST com API key por agente)
- [ ] Webhook inbound (receber eventos de sistemas externos)
- [ ] Webhook outbound (notificar sistemas externos)
- [ ] Documentar cada integração

---

## Fase 15 — Testes e Hardening

> Cobertura que garante confiança para produção.

- [ ] Testes unitários > 70% em packages/core
- [ ] Testes unitários > 70% em packages/agents
- [ ] Testes unitários > 70% em packages/wiki
- [ ] Testes de integração (DB real, API keys de teste)
- [ ] Teste end-to-end: upload PDF → ingest → query retorna resposta certa
- [ ] Teste de segurança: prompt injection via PDF malicioso
- [ ] Teste de segurança: path traversal via scope malicioso
- [ ] Teste de budget: agente pausa ao atingir limite
- [ ] Teste de fallback: provider primário falha → secundário assume
- [ ] Teste de RLS: tenant A não vê dados do tenant B
- [ ] `npx tsc --noEmit` sem erros
- [ ] Zero `any` explícito
- [ ] Audit de segurança completo (checklist do CLAUDE.md §7.3)
- [ ] Load test básico (quantos requests/segundo a API aguenta)
- [ ] Penetration test básico (OWASP top 10)

---

## Fase 16 — Documentação

> Tornar o projeto acessível para usuários e contribuidores.

- [x] CLAUDE.md (constituição do sistema — para devs)
- [x] NEXUS-ROADMAP.md (roadmap original)
- [x] EASYPANEL-DEPLOY.md (guia de deploy com Easypanel)
- [ ] README.md (com badges, screenshots, quick start)
- [ ] docs/architecture.md (diagrama de arquitetura, fluxos)
- [ ] docs/installation.md (guia detalhado para VPS limpa)
- [ ] docs/configuration.md (todas as variáveis de ambiente explicadas)
- [ ] docs/agents.md (como criar e configurar agentes)
- [ ] docs/skills.md (referência de skills built-in)
- [ ] docs/wiki-pattern.md (como o padrão Karpathy funciona)
- [ ] docs/security.md (modelo de segurança, LGPD)
- [ ] docs/api.md (referência da API REST)
- [ ] docs/adr/ (pelo menos 5 ADRs documentados)
- [ ] CONTRIBUTING.md (guia para contribuidores)
- [ ] CHANGELOG.md (formato Keep a Changelog)
- [ ] LICENSE (MIT ou Apache 2.0)
- [ ] Issue templates no GitHub

---

## Fase 17 — Release v1.0

> Publicação e primeiros clientes.

- [ ] GitHub Release v1.0.0 com assets (source, install.sh, docker-compose)
- [ ] Docker image publicada em ghcr.io/pnakamura/ethra-nexus:1.0.0
- [ ] install.sh funcional em Ubuntu 22.04 e 24.04
- [ ] Landing page do produto
- [ ] Demo online (instância pública com dados de exemplo)
- [ ] Onboarding de primeiro cliente beta
- [ ] Feedback loop estabelecido (issues, email, ou formulário)
- [ ] Monitoramento de uptime configurado (UptimeRobot ou similar)

---

## Fase 18 — Pós-launch (contínuo)

> Evolução baseada em feedback real.

- [ ] Modelo cloud multi-tenant (NEXUS_CLOUD_MODE=true)
- [ ] Planos e billing (Stripe)
- [ ] SSO (SAML/OIDC) para clientes enterprise
- [ ] White-label (branding customizável)
- [ ] Agent marketplace (templates de agentes por indústria)
- [ ] SDK para skills customizadas
- [ ] Mobile app (React Native ou PWA)
- [ ] Integrações adicionais (Telegram, Discord, Microsoft Teams)
- [ ] Suporte a mais providers (Google Vertex AI, AWS Bedrock, Azure OpenAI)
- [ ] Multi-idioma na interface
- [ ] LGPD compliance audit formal
- [ ] SOC2 Type II (se targeting enterprise)

---

## Resumo de Progresso

```
Fase  0 — Arquitetura e Decisões        ██████████████████░░  90%
Fase  1 — Scaffolding                   ██████████████░░░░░░  70%
Fase  2 — Tipos e Contratos             ████████████████████  100%
Fase  3 — Segurança                     ██████████████░░░░░░  70%
Fase  4 — AIOS Master + Providers       ██████████████░░░░░░  70%
Fase  5 — Wiki Engine                   ██████████████░░░░░░  70%
Fase  6 — Infraestrutura                ████████████████░░░░  80%
Fase  7 — Skill Executors               ████████░░░░░░░░░░░░  40%
Fase  8 — Bootstrap + Server            ██████████░░░░░░░░░░  50%
Fase  9 — Banco de Dados                ████████████████░░░░  80%
Fase 10 — Wiki Vault                    ████████████████████  100%
Fase 11 — Docker + Infra                ████████████░░░░░░░░  60%
Fase 12 — N8N Workflows                 ████░░░░░░░░░░░░░░░░  20%
Fase 13 — Frontend                      ██░░░░░░░░░░░░░░░░░░  10%
Fase 14 — Canais                        ░░░░░░░░░░░░░░░░░░░░  0%
Fase 15 — Testes                        ░░░░░░░░░░░░░░░░░░░░  0%
Fase 16 — Documentação                  ████░░░░░░░░░░░░░░░░  20%
Fase 17 — Release v1.0                  ░░░░░░░░░░░░░░░░░░░░  0%
Fase 18 — Pós-launch                    ░░░░░░░░░░░░░░░░░░░░  0%
```

**Progresso geral estimado: ~45% do código, ~0% de deploy testado.**

**Próximo marco crítico:** Fazer o sistema funcionar end-to-end
(upload documento → ingest → query retorna resposta).
Requer: VPS configurada + banco rodando + API deployada.
