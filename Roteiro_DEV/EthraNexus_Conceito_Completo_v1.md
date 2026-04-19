

**ETHRA NEXUS**

AI Orchestration Platform

**Documento de Conceito Completo**

*Visão de produto, arquitetura, stack, decisões técnicas, deploy e roadmap*

| Versão 1.0 — Abril 2026 | Autor Paulo Nakamura | Repositório github.com/pnakamura/ethra-nexus |
| :---- | :---- | :---- |

| Propósito deste documento Este documento consolida o conceito completo da plataforma Ethra Nexus: origem, visão de produto, arquitetura técnica, decisões definitivas, estado atual do deploy, subsistema wiki baseado no conceito LLM Wiki de Andrej Karpathy, squad de referência POA+SOCIAL, e roadmap de execução. Destina-se a orientar o desenvolvimento, onboarding de colaboradores e apresentações a potenciais clientes B2B. |
| :---- |

# 1\. Visão Geral

O Ethra Nexus é uma plataforma B2B self-hosted de orquestração de agentes de IA. Seu objetivo central é permitir que empresas, organizações e indivíduos automatizem e gerenciem processos complexos usando agentes especializados — sem precisar construir infraestrutura de IA do zero.

## 1.1 Origem e motivação

O projeto nasceu da consolidação de dois frameworks de referência:

| Framework | Contribuição principal | Limitação original |
| :---- | :---- | :---- |
| Paperclip | Governança empresarial robusta: org charts, orçamentos por agente, audit logs imutáveis, heartbeats | Sem agentes especializados nativos — 'Bring Your Own Agent' |
| AIOS-Core | Motor ágil de desenvolvimento: 11 agentes especializados, ADE Engine, histórias contextualizadas | Sem governança, sem controle de custo, sem multi-tenant |
| Ethra Nexus | Unificação: governança Paperclip \+ squads AIOS-Core \+ TypeScript unificado \+ VPS self-hosted | — |

## 1.2 Proposta de valor

| Por que o Ethra Nexus existe Não existe solução que combine governança empresarial robusta com motor ágil de agentes IA em um produto instalável na VPS do cliente. O mercado oferece ou ferramentas cloud com vendor lock-in (OpenAI, Anthropic Console), ou frameworks de baixo nível que exigem engenharia intensiva. O Ethra Nexus resolve isso entregando: agentes especializados \+ controle de custo por agente \+ auditoria imutável \+ memória persistente via wiki \+ instalação em VPS própria — em um único produto. |
| :---- |

## 1.3 Modelo de negócio

| Dimensão | Definição |
| :---- | :---- |
| Mercado-alvo | B2B — empresas, organizações públicas e privadas, programas de financiamento internacional |
| Modelo de entrega | Self-hosted — cliente instala na própria VPS. Sem dados em infraestrutura Anthropic ou terceiros. |
| Licença | MIT (open-source) — produto instalável livremente; monetização via serviços, suporte e squads comerciais |
| Diferencial competitivo | Produto que melhora com uso: wikis individuais por agente acumulam conhecimento institucional sem retreinamento |
| LGPD / compliance | Dados sensíveis processados exclusivamente via Anthropic API direta — nunca via OpenRouter ou terceiros |

# 2\. Arquitetura do Sistema

## 2.1 As seis camadas verticais

O sistema é organizado em camadas verticais. Cada camada depende apenas das inferiores, nunca das superiores:

| Camada | Nome | Responsabilidades |
| :---- | :---- | :---- |
| **5** | Interfaces | CLI (npx nexus) · Dashboard Next.js · WhatsApp bridge · REST API |
| **4** | Observabilidade | SSE tempo real · métricas de tokens · audit trail · custo por agente/squad |
| **3** | Runtime de agentes | Squads especializados · AgentAdapter · SkillsManager · ADE Engine |
| **2** | Governança | Org chart · metas · heartbeats · tickets · approval gates · budget |
| **1** | Persistência | PostgreSQL · Memory Layer (wiki dual) · pgvector · Drizzle ORM |
| **0** | Fundação | @nexus/types · @nexus/db · @nexus/config · @nexus/utils · pnpm |

## 2.2 Stack tecnológico definitivo

| Camada | Tecnologia | Justificativa |
| :---- | :---- | :---- |
| Monorepo | pnpm workspaces \+ TypeScript 5.x strict | Eficiência de dependências; strict mode elimina erros de tipo silenciosos |
| Backend API | Fastify \+ Drizzle ORM | Fastify: roteador radix tree — mais rápido que Express. Drizzle: conexão direta ao PostgreSQL, type-safe, sem PostgREST |
| Autenticação | @fastify/jwt (sem GoTrue) | Auth implementado na API — menos containers, menos pontos de falha |
| Banco de dados | PostgreSQL 16 \+ pgvector 0.8.2 | Robusto para produção; pgvector habilita busca semântica no subsistema wiki |
| Frontend | Next.js 15 \+ React 19 \+ Tailwind \+ Shadcn | Server components, App Router moderno; Shadcn para componentes acessíveis |
| Automação | N8N (visual workflow builder) | Ingestão Google Drive → wiki; bridge WhatsApp; notificações de revisão |
| IA multi-provider | Anthropic direto (dados sensíveis) \+ OpenRouter (Groq/Gemini) | LGPD: dados sensíveis nunca via OpenRouter. OpenRouter para custo/contexto |
| Conhecimento | SilverBullet \+ pgvector \+ wiki dual | Wiki legível por humanos \+ busca semântica vetorial \+ mecanismo de promoção |
| Deploy | Docker \+ Easypanel (VPS) | Easypanel simplifica deploy de containers Docker, SSL automático, gestão de domínios |
| CI/CD | GitHub Actions | Build, typecheck, lint, test e push de imagem Docker automatizados |

# 3\. Estrutura do Monorepo

## 3.1 Packages e responsabilidades

| Package | Nome npm | Responsabilidade |
| :---- | :---- | :---- |
| packages/types | @nexus/types | Interfaces e tipos TypeScript compartilhados — zero dependências externas |
| packages/db | @nexus/db | Drizzle ORM schema \+ migrations \+ client node-postgres |
| packages/config | @nexus/config | Leitura e validação de variáveis de ambiente com Zod |
| packages/utils | @nexus/utils | Logger Pino, crypto, retry com backoff exponencial, queue em memória |
| packages/governance | @nexus/governance | CompanyManager, OrgChart hierárquico, GoalTree C→P→SP→PT, ApprovalGates |
| packages/ticketing | @nexus/ticketing | TicketStore atômico, ThreadManager, ToolCallTracer, AuditLog imutável |
| packages/budget | @nexus/budget | BudgetManager, CostTracker, TokenCounter por modelo, Throttle automático |
| packages/heartbeat | @nexus/heartbeat | CronScheduler, EventTrigger, SessionPersistence entre ciclos |
| packages/agent-runtime | @nexus/agent-runtime | AgentAdapter interface, SkillsManager, AGENTS.md generator |
| packages/squads | @nexus/squads | 11 agentes AIOS portados, ADE Engine (7 Epics), Memory Layer |
| packages/wiki | @nexus/wiki | Ingestão de documentos, chunking, embedding, busca RAG, lint semanal |
| apps/server | — | Fastify REST API \+ WebSockets \+ SSE \+ auth JWT |
| apps/dashboard | — | Next.js 15: org chart visual, ticket board, métricas de custo em tempo real |
| apps/cli | — | npx nexus: CLI interativo com @clack/prompts |

## 3.2 Cascata de dependências

| Regra crítica do monorepo Os packages têm dependências em cascata. Uma mudança em @nexus/types sem verificar impacto em cascata quebra o build inteiro. Antes de editar qualquer interface pública em @nexus/types, execute: grep \-r "from '@nexus/types'" packages/ apps/ e verifique todos os arquivos afetados. Alerta especial: IProviderRegistry DEVE viver em @nexus/types ou @nexus/core. Nunca em @nexus/wiki nem @nexus/squads — causaria circular import wiki ↔ agents. |
| :---- |

# 4\. Modelo de Dados

## 4.1 Tabelas do core (11 tabelas originais)

| Tabela | Descrição | Campos-chave |
| :---- | :---- | :---- |
| tenants | Isolamento multi-tenant — cada cliente é um tenant | id (uuid), name, slug, settings (jsonb) |
| agents | Agentes registrados por tenant | id, tenant\_id, name, role, model, budget\_monthly, system\_prompt |
| tickets | Tarefas atômicas com rastreamento de custo | id, tenant\_id, agent\_id, goal\_id, status, thread (jsonb), tokens\_used, cost\_usd |
| goals | Hierarquia de metas C→P→SP→PT | id, tenant\_id, parent\_id (self-FK), title, status, priority |
| sessions | Contexto persistente entre heartbeats | id, agent\_id, ticket\_id, heartbeat\_at, context (jsonb), status |
| budgets | Orçamento mensal por agente | id, agent\_id, month, limit\_usd, spent\_usd, throttled\_at |
| audit\_log | Registro imutável de todas as ações | id, tenant\_id, entity\_type, entity\_id, action, actor, payload (jsonb) |
| provider\_usage\_log | Custo e tokens por chamada de LLM | id, agent\_id, model, tokens\_in, tokens\_out, cost\_usd, provider |
| agent\_skills | Skills associadas a cada agente | id, agent\_id, skill\_name, skill\_config (jsonb) |
| agent\_tools | Ferramentas MCP disponíveis por agente | id, agent\_id, tool\_name, tool\_config (jsonb) |
| org\_chart | Hierarquia de reporte entre agentes | id, tenant\_id, agent\_id, parent\_agent\_id, reporting\_line |

## 4.2 Tabelas do subsistema wiki (4 tabelas novas)

| Tabela | Tipo | Descrição |
| :---- | :---- | :---- |
| wiki\_strategic\_pages | Estratégica | Páginas de conhecimento compartilhadas por todos os agentes do tenant. Campos: slug, title, type (entidade|conceito|analise|sumario), content (Markdown), sources\[\], tags\[\], confidence, status, promoted\_from\_id |
| wiki\_agent\_pages | Individual | Páginas privadas de cada agente. Campos: agent\_id, type (padrao|template|checklist|erro), content, origin (rastreabilidade), confidence, promoted\_at |
| wiki\_operations\_log | Log | Registro cronológico de todas as operações wiki: ingest, query, lint, approve, reject, promote. Equivale ao log.md do conceito Karpathy. |
| wiki\_agent\_writes | Staging | Fila de propostas dos agentes antes de aprovação humana. Status: draft → approved/rejected. Toda escrita de agente passa por aqui. |

| Índice HNSW obrigatório Após criar wiki\_agent\_pages, executar: CREATE INDEX wiki\_chunks\_embedding\_idx ON wiki\_chunks USING hnsw (embedding vector\_cosine\_ops) WITH (m \= 16, ef\_construction \= 64); — sem este índice, a busca semântica é O(n) linear e inaceitável para wikis grandes. |
| :---- |

# 5\. API — Fastify com Drizzle ORM

## 5.1 Por que esta combinação

Esta é a decisão arquitetural mais importante do projeto. O container estava crashando porque o código original usava @supabase/supabase-js, que exige PostgREST (REST API sobre PostgreSQL) e GoTrue (autenticação) — dois serviços que adicionam complexidade operacional sem benefício no modelo self-hosted.

| Aspecto | @supabase/supabase-js (abandonado) | Fastify \+ Drizzle ORM (adotado) |
| :---- | :---- | :---- |
| Containers extras | \+2 (PostgREST \+ GoTrue) | 0 — conexão direta ao PostgreSQL |
| Autenticação | GoTrue (serviço separado) | @fastify/jwt integrado na API |
| Queries | Via REST API do PostgREST | SQL type-safe via Drizzle — vê o SQL gerado |
| Isolamento multi-tenant | RLS no banco (complexo) | Hook onRequest no Fastify — testável com Vitest |
| Busca vetorial pgvector | RPC functions obrigatórias | db.execute(sql) direto — operador \<=\> nativo |
| Deploy para cliente | 3 containers para configurar | 1 container — menos atrito |
| Debugging em produção | SQL oculto atrás do PostgREST | SQL visível, migrations versionadas |

## 5.2 Padrão de isolamento multi-tenant

Toda requisição passa pelo hook onRequest do Fastify, que extrai o tenantId do JWT e o injeta em req.tenantId. Todas as queries Drizzle filtram por esse campo. Não há query que acesse dados de outro tenant — garantido por tipagem TypeScript e validado por testes Vitest.

## 5.3 Rotas da API

| Módulo | Rotas principais |
| :---- | :---- |
| Auth | POST /api/v1/auth/login → JWT \+ refresh token |
| Agents | GET/POST /api/v1/agents · PATCH /api/v1/agents/:id · DELETE |
| Tickets | POST /api/v1/tickets (atômico com budget check) · GET com filtros e paginação · PATCH /:id/approve |
| Budget | GET /api/v1/budgets/report · PUT /api/v1/budgets/:agentId |
| Heartbeat | POST /api/v1/tickets/:id/heartbeat · GET /api/v1/sessions/:agentId |
| Wiki estratégica | POST /wiki/pages · POST /wiki/search (RAG) · POST /wiki/ingest · POST /wiki/lint |
| Wiki agentes | POST /wiki/agent-write (staging) · PATCH /wiki/agent-writes/:id/approve · PATCH /:id/reject |
| Observabilidade | GET /api/v1/audit · GET /api/v1/events/stream (SSE) · GET /api/v1/health |
| WhatsApp | POST /api/v1/whatsapp/webhook (N8N → Nexus) |

# 6\. Subsistema Wiki — Conceito Karpathy

## 6.1 O problema que o wiki resolve

LLMs não têm memória entre sessões. Cada chamada começa do zero. A janela de contexto é temporária — desaparece quando a sessão termina. A solução não é retreinar o modelo: é dar a ele uma wiki externa que ele lê antes de agir e escreve depois de aprender.

| Abordagem | Como funciona | Limitação |
| :---- | :---- | :---- |
| RAG clássico | Busca chunks de documentos brutos por similaridade vetorial | Contexto fragmentado; contradições não mapeadas; sem síntese prévia |
| LLM Wiki (Karpathy) | Agente lê páginas já sintetizadas via index.md; escreve o que aprendeu de volta | Requer manutenção do index; wikis grandes precisam de pgvector como fallback |
| Memória em banco de texto | Campo texto livre que cresce com o tempo | Sem estrutura; sem validade; modelo ignora partes quando fica grande |

## 6.2 Arquitetura de duas wikis

| Wiki estratégica | Wiki individual por agente |
| :---- | :---- |
| Compartilhada entre todos os agentes do tenant Conteúdo: entidades, conceitos, normativos, análises, sumários de fontes Escrita por: humanos via SilverBullet ou API, e pelo mecanismo de promoção Navegação: index.md sintético gerado pelo index-generator.ts **Precedência: prevalece sobre wiki individual em conflito** | Uma por agente — isolada e privada Conteúdo: padrões aprendidos, templates validados, checklists, erros corrigidos Escrita por: feedback loop de aprovação e rejeição de tickets Campos-chave: type, origin, confidence, status, promoted\_at **Evolução: quando 3+ agentes convergem → promoção para estratégica** |

## 6.3 Ciclo de vida do conhecimento

| Evento | O que acontece nas wikis |
| :---- | :---- |
| Documento ingerido (PDF, Drive, upload) | Chunking \+ embedding \+ upsert em wiki\_strategic\_pages e wiki\_chunks. Contradições com páginas existentes são sinalizadas. index.md é regenerado. |
| Agente executa heartbeat | 1\. Carrega index estratégico → LLM identifica páginas relevantes → carrega conteúdo. 2\. Carrega index individual → páginas do próprio agente. 3\. Executa tarefa com contexto das duas wikis no system prompt. |
| Gestor APROVA output | onApproval(): lições transversais → wiki estratégica. Padrões específicos → wiki individual de cada agente participante. |
| Gestor REJEITA output | onRejection(): padrão de erro → wiki individual do agente responsável. Campo origin rastreia o ticket de origem. |
| Lint semanal (toda segunda, 3h) | Detecta: páginas obsoletas, contradições, links órfãos. Verifica padrões em 3+ agentes → dispara promoção para wiki estratégica. |
| Short-circuit ativo | Se o index tiver menos de 5 páginas, o briefing é pulado para evitar latência desnecessária. |

## 6.4 SilverBullet — wiki legível por humanos

O SilverBullet é a interface de edição humana da wiki estratégica. Roda como serviço Docker no Easypanel, armazena arquivos Markdown no volume wikis\_data, e sincroniza bidirecionalmente com o banco via N8N: quando uma página é atualizada via API → arquivo .md é gerado; quando o humano edita no SilverBullet → webhook N8N → POST /api/v1/wiki/pages.

# 7\. Agentes e Runtime

## 7.1 Interface AgentAdapter

Todo agente no sistema implementa a interface AgentAdapter, que define o contrato mínimo para participar do ciclo de orquestração:

| Método | Quando é chamado | Responsabilidade |
| :---- | :---- | :---- |
| onHeartbeat(ctx) | A cada ciclo do scheduler (cron ou evento) | Consulta wikis, executa tarefa, propõe aprendizado |
| onTicketAssigned(ticket) | Quando um ticket é atribuído ao agente | Inicializa contexto, registra início na sessão |
| onApprovalRequired(gate) | Quando uma ação de alto risco precisa de aprovação | Retorna decisão e justificativa para o gestor |
| getStatus() | Polling de saúde pelo heartbeat scheduler | Retorna: ativo, pausado, throttled, erro |

## 7.2 Runtimes suportados

| Adapter | Runtime | Uso típico |
| :---- | :---- | :---- |
| ClaudeCodeAdapter | Claude Code (Anthropic) | Desenvolvimento de software — acesso ao filesystem e terminal |
| HttpAdapter | Qualquer serviço REST | Integração com APIs externas, serviços legados |
| BashAdapter | Scripts locais | Automações simples, processamento de arquivos |
| McpAdapter | MCP Server (Model Context Protocol) | Agentes que expõem ferramentas via protocolo MCP padrão |

## 7.3 Os 11 agentes AIOS (squad base)

| Agente | Categoria | Papel |
| :---- | :---- | :---- |
| AnalystAgent | Planejamento | Análise de negócio e criação de Product Requirements Document (PRD) |
| PmAgent | Planejamento | Gerência de produto, priorização de backlog, alinhamento de metas |
| ArchitectAgent | Planejamento | Arquitetura de sistema, design técnico, avaliação de complexidade |
| UxExpertAgent | Planejamento | Design de UX, usabilidade, especificações de interface |
| ScrumMasterAgent | Desenvolvimento | Sprints, criação de histórias, gestão de cerimônias ágeis |
| DevAgent | Desenvolvimento | Implementação de código com contexto completo da spec |
| QaAgent | Desenvolvimento | Testes automatizados, garantia de qualidade, review de código |
| ProductOwnerAgent | Desenvolvimento | Backlog refinement, critérios de aceite, priorização |
| OrchestratorAgent | Meta | Coordenação de squads, distribuição de trabalho entre agentes |
| MasterAgent | Meta | Orquestração de nível superior, decisões estratégicas |
| DevOpsAgent | Meta | Git worktrees, migrations de banco, pipelines de deploy |

## 7.4 ADE — Autonomous Development Engine

O ADE é o motor de desenvolvimento autônomo do Ethra Nexus, composto por 7 Epics que transformam requisitos em código funcional:

| Epic | Nome | Status | Descrição |
| :---- | :---- | :---- | :---- |
| 1 | Worktree Manager | Fase 4 | Isolamento de branches via Git worktrees para execução paralela |
| 2 | Migration V2→V3 | N/A | Migração de specs legados para formato Nexus — não necessário no greenfield |
| 3 | Spec Pipeline | Fase 2 (v1) | Requisito → AnalystAgent → ArchitectAgent → PmAgent → QaAgent → spec aprovada |
| 4 | Execution Engine | Fase 2 (v1) | Spec → ScrumMasterAgent → histórias → DevAgent → QaAgent review → código |
| 5 | Recovery System | Fase 4 | Rollback automático em falhas, retry inteligente com backoff |
| 6 | QA Evolution | Fase 4 | Review estruturado em 10 fases com métricas de qualidade |
| 7 | Memory Layer | Wiki dual | Padrões e insights persistentes — implementado como wiki dual (Karpathy) |

# 8\. Governança e Controle de Custo

## 8.1 Ciclo de vida de um ticket

| Status | Descrição | Transição para |
| :---- | :---- | :---- |
| open | Ticket criado — aguardando atribuição | assigned |
| assigned | Agente designado — aguardando início | in\_progress |
| in\_progress | Agente executando — heartbeat ativo | review | blocked |
| review | Output gerado — aguardando revisão humana | done | rejected |
| done | Aprovado — conhecimento registrado nas wikis | — |
| rejected | Rejeitado — padrão de erro gravado na wiki do agente | open (reabertura opcional) |
| failed | Falha técnica — rollback se disponível | open (com contexto do erro) |

## 8.2 Controle de budget por agente

Cada agente tem um orçamento mensal em USD. O BudgetManager verifica disponibilidade antes de aceitar qualquer ticket (operação atômica com o TicketStore). Ao atingir 80% do limite, o gestor recebe alerta via WhatsApp. Ao atingir 100%, o agente é automaticamente pausado.

| Evento | Ação automática | Notificação |
| :---- | :---- | :---- |
| Budget atingido 80% | Alerta gerado no audit\_log | WhatsApp ao gestor do tenant |
| Budget atingido 100% | Agente pausado — novos tickets recusados | WhatsApp urgente ao gestor \+ admin |
| Novo mês calendário | Contador resetado automaticamente | Relatório mensal enviado ao gestor |
| Ticket aceito | Orçamento reservado atomicamente junto com o ticket | — |
| Ticket concluído | Custo real registrado em provider\_usage\_log | — |

## 8.3 Approval Gates

Ações de alto risco requerem aprovação humana antes de execução. O agente não pode prosseguir até receber decisão explícita. Gates são configuráveis por tipo de ação e por agente.

| Tipo de gate | Exemplos de ações | Canal de aprovação |
| :---- | :---- | :---- |
| Financeiro | Desembolso acima de limite, alteração de orçamento | WhatsApp /approve {id} · Dashboard |
| Técnico | Deploy em produção, migration de banco, deleção de dados | WhatsApp · Dashboard · CLI |
| Estratégico | Alteração de meta de alto nível, mudança de roadmap | Dashboard com justificativa obrigatória |

# 9\. Interfaces de Usuário

O Ethra Nexus oferece quatro canais de interação com o sistema, cada um otimizado para um contexto de uso:

## 9.1 Dashboard Web (Next.js 15\)

| Funcionalidade | Descrição |
| :---- | :---- |
| Org Chart visual | Arrastar agentes na hierarquia de reporte; visualização de squads e suas relações |
| Ticket Board | Kanban com status machine visual; thread completa de cada ticket; custo acumulado |
| Budget Dashboard | Gráficos Recharts de custo por agente, squad e empresa em tempo real via SSE |
| Agent Monitor | Status de heartbeat, última atividade, wiki individual resumida |
| Audit Log viewer | Filtro por tenant, agente, tipo de ação e intervalo de datas |
| Wiki Manager | Visualizar, editar e aprovar propostas de escrita dos agentes; histórico de promoções |
| Approval Center | Painel unificado de ações aguardando aprovação humana |

## 9.2 WhatsApp (Evolution API \+ N8N)

| Comando | Ação | Resposta típica |
| :---- | :---- | :---- |
| /status | Visão geral do sistema | 3 agentes ativos. Budget: 68% usado. 2 tickets pendentes. |
| /ticket {id} | Detalhes de um ticket | Status, agente, última mensagem, custo acumulado |
| /budget | Relatório de custos | Budget por agente, gasto total, previsão mensal |
| /approve {id} | Aprovar ação ou escrita wiki | Ticket \#15 aprovado. Agente @dev retomando. |
| /reject {id} | Rejeitar com feedback | Rejeitado. Padrão de erro registrado na wiki do agente. |
| /agents | Listar agentes | Nome, role, status, budget restante |
| /pause {agent} | Pausar um agente específico | Confirmação de pausa com razão |
| /report | Relatório semanal resumido | PDF enviado como anexo |

## 9.3 CLI (npx nexus)

| Comando | Função |
| :---- | :---- |
| nexus init {nome} | Cria projeto com assistente interativo — configura tenant, agentes e wiki |
| nexus status | Status de agentes e tickets em tempo real |
| nexus agents list | Lista agentes com status, budget e última atividade |
| nexus ticket create | Cria ticket interativamente via terminal |
| nexus budget report | Relatório de custos por agente e período |
| nexus squad import {url} | Importa squad da Squad Store |
| nexus doctor | Diagnóstico completo do sistema — health check de todos os serviços |

# 10\. Infraestrutura — VPS Hostgator

## 10.1 Especificações do servidor

| Parâmetro | Valor |
| :---- | :---- |
| Provedor | Hostgator VPS |
| IP | 129.121.38.172 |
| Sistema Operacional | AlmaLinux 9.7 (RHEL-based — usa dnf, não apt) |
| RAM | 8 GB |
| SSH | Porta 22022 (não a padrão 22), usuário root |
| Painel de gestão | Easypanel (interface web para containers Docker) |
| Node.js instalado | v20.20.2 |
| GitHub CLI | v2.68.0 |
| Registry Docker | ghcr.io/pnakamura (login configurado) |
| Código-fonte no servidor | /opt/ethra-nexus |

## 10.2 Estado dos serviços (2026-04-13)

| Serviço | Imagem Docker | Estado | Ação necessária |
| :---- | :---- | :---- | :---- |
| PostgreSQL \+ pgvector | postgres:15 \+ pgvector 0.8.2 | Rodando | Migrar schema para Drizzle (15 tabelas) |
| ethra-nexus-api | ghcr.io/pnakamura/ethra-nexus:latest | CRASH | Reescrever com Fastify+Drizzle \+ reimplantar |
| PostgREST | — | NUNCA instalar | Decisão definitiva — desnecessário |
| GoTrue | — | NUNCA instalar | Decisão definitiva — desnecessário |
| N8N | n8nio/n8n:latest | Criar (Fase 3\) | New Service no Easypanel, porta 5678 |
| SilverBullet | zefhemel/silverbullet:latest | Criar (Fase 4\) | New Service no Easypanel, porta 3000 |
| Uptime Kuma | louislam/uptime-kuma:1 | Criar (Fase 8\) | Monitoramento de saúde dos serviços |

## 10.3 Variáveis de ambiente após migração

| Variável | Valor / instrução | Remover? |
| :---- | :---- | :---- |
| DATABASE\_URL | postgres://postgres:{PASS}@{POSTGRES\_HOST}:5432/ethra\_nexus | — |
| JWT\_SECRET | Gerar com: openssl rand \-hex 64 | — |
| NODE\_ENV | production | — |
| PORT | 3000 | — |
| ANTHROPIC\_API\_KEY | sk-ant-... (obrigatório para dados sensíveis) | — |
| OPENROUTER\_API\_KEY | sk-or-... (opcional para Groq/Gemini) | — |
| SUPABASE\_URL | — | **Remover** |
| SUPABASE\_ANON\_KEY | — | **Remover** |
| SUPABASE\_SERVICE\_ROLE\_KEY | — | **Remover** |

# 11\. Squad de Referência — POA+SOCIAL

O squad nexus-poa-social é o caso de uso de referência do Ethra Nexus. Demonstra que a plataforma funciona para domínios além de desenvolvimento de software — especificamente para a gestão de programas de financiamento internacional.

## 11.1 Contexto do programa

| Parâmetro | Valor |
| :---- | :---- |
| Programa | POA+SOCIAL — Programa de Inclusão Social de Porto Alegre |
| Contrato BID | BR-L1597 |
| Valor total | US$ 161 milhões |
| Financiador | Banco Interamericano de Desenvolvimento (BID) |
| Executor | Prefeitura Municipal de Porto Alegre (PMPA) |
| Unidade gestora | UGP POA+SOCIAL |
| Duração | 2022–2029 |
| Componentes | C1: Transformação Digital (3 produtos) · C2: Reabilitação Social (5 produtos) |

## 11.2 Agentes especializados do squad

| Agente | Função principal | Modelo LLM | Skills-chave |
| :---- | :---- | :---- | :---- |
| auditor-pep | Auditoria financeira de planilhas PEP (Plano de Execução do Projeto) | claude-sonnet (LGPD) | Verificação hierárquica C→P→SP→PT, detecção de inconsistências BID/Local, comparação entre versões |
| gestor-contrato | Monitoramento de desembolsos e metas físico-financeiras do contrato BID | claude-haiku | Relatórios de progresso, alertas de atraso, consulta de normativas BID |
| analista-ivcad | Análise de vulnerabilidade social com base no IVCAD de Porto Alegre | claude-sonnet (LGPD) | Cruzamento IVCAD \+ CadÚnico, identificação de territórios prioritários |
| engenheiro-obras | Orçamento e acompanhamento de obras de infraestrutura social | claude-haiku | Levantamento quantitativo SINAPI/BDI, memorial de cálculo, revisão de projetos |
| classificador-gmail | Triagem e classificação de emails do programa por categoria e urgência | claude-haiku | Classificação por tema, urgência, ação necessária; roteamento para gestores |

| Regra LGPD obrigatória Os agentes auditor-pep e analista-ivcad processam dados pessoais de beneficiários (IVCAD, CadÚnico). Devem usar model='claude-sonnet' com chamada DIRETA à API Anthropic — NUNCA via OpenRouter ou qualquer intermediário. Esta regra é inegociável e deve ser verificada no seed de configuração dos agentes. |
| :---- |

## 11.3 Wiki estratégica do tenant POA+SOCIAL

| Categoria | Documentos a ingerir | Agentes que consultam |
| :---- | :---- | :---- |
| Contrato e financiamento | Contrato BR-L1597, Adendos, Revisões orçamentárias | gestor-contrato, auditor-pep |
| Normativas BID | GN-2349-15 (aquisições), OP-273 (meio ambiente), NOBs periódicas | todos os agentes |
| Instrumentos de gestão | Planilhas PEP, Marcos de desembolso, Matrizes de resultados | auditor-pep, gestor-contrato |
| Vulnerabilidade social | Base IVCAD 2023, Territórios prioritários, Dados CadÚnico (anonimizados) | analista-ivcad |
| Normas técnicas de obras | SINAPI vigente, BDI referência TCE-RS, Memoriais de projetos | engenheiro-obras |
| Comunicações internas | Atas de reunião, Relatórios de missão BID, Ofícios e pareceres | classificador-gmail, gestor-contrato |

# 12\. Diretrizes Comportamentais — Karpathy Guidelines

Estas diretrizes reduzem os erros mais comuns de LLMs em tarefas de código. Aplicam-se a qualquer sessão de Claude Code no monorepo Ethra Nexus e estão registradas como Skill no projeto.

| Princípio 1 | Think Before Coding — Não assuma. Não esconda confusão. Explicite tradeoffs. |
| :---- | :---- |
|  | Antes de escrever qualquer código: declare suposições explicitamente; se incerto, pergunte. Se múltiplas interpretações existem, apresente-as. Se uma abordagem mais simples existe, diga. *Aplicação: 'Migra de Supabase para Drizzle' → confirmar: quais tabelas? Há FKs para schema auth para remover?* |
| **Princípio 2** | **Simplicity First — Mínimo de código que resolve o problema. Nada especulativo.** |
|  | Sem features além do pedido. Sem abstrações para código de uso único. Se escreveu 200 linhas e poderia ser 50, reescreva. *Checagem: 'Um engenheiro sênior diria que isso está overcomplicated?' — se sim, simplifique.* |
| **Princípio 3** | **Surgical Changes — Toque apenas o que deve ser tocado. Limpe apenas sua própria bagunça.** |
|  | Não melhore código adjacente não solicitado. Não refatore o que não está quebrado. Cada linha alterada deve rastrear diretamente ao pedido. *Alerta monorepo: antes de editar @nexus/types, verificar cascata completa de dependências.* |
| **Princípio 4** | **Goal-Driven Execution — Defina critérios de sucesso. Itere até verificar.** |
|  | Transforme tarefas em metas verificáveis. Template: 1\. \[Passo\] → verificar: \[checagem concreta\]. *Exemplo: 'Migra tabela para Drizzle' → drizzle-kit generate sem erros → migrate aplica → queries retornam dados.* |

# 13\. Roadmap de Execução

## 13.1 Plano de 9 fases — estado atual e próximos passos

| Fase | Nome | Esforço | Status | Entrega verificável |
| :---- | :---- | :---- | :---- | :---- |
| 0 | Preparação do repositório | \~8 h | CRÍTICO — iniciar agora | pnpm build OK sem @supabase/supabase-js |
| 1 | Migração do banco na VPS | \~3 h | Aguardando Fase 0 | 15 tabelas Drizzle \+ índice HNSW criados |
| 2 | Reconfigurar ethra-nexus no Easypanel | \~1 h | Aguardando Fase 1 | GET /health retorna {status:'ok',db:'connected'} |
| 3 | Criar serviço N8N no Easypanel | \~6 h | Aguardando Fase 2 | WhatsApp recebe /status e retorna resposta |
| 4 | Criar serviço SilverBullet | \~4 h | Aguardando Fase 2 | Wiki acessível em wiki.{dominio} e sincronizada |
| 5 | Implementar packages/wiki | \~12 h | Aguardando Fase 1 | POST /wiki/ingest processa PDF com similarity \> 0.75 |
| 6 | Modificar agentes com briefing wiki | \~8 h | Aguardando Fase 5 | onHeartbeat lê wikis e registra aprendizado |
| 7 | Validação end-to-end POA+SOCIAL | \~6 h | Aguardando Fases 3-6 | Ciclo completo: ticket → aprovação → wiki atualizada |
| 8 | Hardening e monitoramento | \~4 h | Fase final | Uptime Kuma ativo, Fail2Ban configurado, CI/CD verde |

| Caminho crítico As Fases 0 → 1 → 2 são sequenciais e bloqueantes. Nada funciona sem elas. Estimativa: 10-12 horas de trabalho concentrado para ter o container rodando sem crash. Após a Fase 2, as Fases 3, 4, 5 e 6 podem ser desenvolvidas em paralelo. |
| :---- |

## 13.2 Roadmap de produto de longo prazo (12–24 semanas)

| Fase de produto | Semanas | Entregas principais |
| :---- | :---- | :---- |
| Fase 0: Fundação | 1–2 | Repositório limpo, types, CI verde, Docker local |
| Fase 1: Core Engine | 3–6 | Governança, ticketing, budget, heartbeat, API REST |
| Fase 2: Runtime de agentes | 7–10 | 11 agentes portados, ADE v1, approval gates |
| Fase 3: Interfaces | 11–14 | CLI, Dashboard Next.js, WhatsApp bridge, auth |
| Fase 4: Wiki dual | 14–16 | packages/wiki completo, onHeartbeat com briefing, feedback loop |
| Fase 5: Recursos avançados | 17–20 | ADE completo, Squad Store, plugins externos (Jira, Asana, Drive) |
| Fase 6: Hardening | 21–24 | Observabilidade OpenTelemetry \+ Grafana, segurança OWASP, SLA 99.5% |
| Release v1.0.0 | Semana 24 | POA+SOCIAL em produção, documentação completa, npm @nexus-ai/cli publicado |

# 14\. Segurança e Conformidade

## 14.1 Decisões de segurança

| Área | Decisão implementada |
| :---- | :---- |
| Isolamento multi-tenant | Hook onRequest Fastify extrai tenantId do JWT. Todas as queries Drizzle filtram por tenantId. Impossível acessar dados de outro tenant sem comprometer o JWT. |
| LGPD — dados sensíveis | Agentes que processam dados pessoais (auditor-pep, analista-ivcad) usam Anthropic API direta. Nunca OpenRouter, nunca terceiros. Configurado no seed de agentes. |
| Secrets e API keys | Nenhuma chave hardcoded no código. Todas as secrets em variáveis de ambiente. GitHub Secret Scanning ativo no repositório. |
| SSH na VPS | Porta 22022 (não a padrão). Login root desabilitado. Apenas chave pública. Fail2Ban com bantime de 1 hora após 3 tentativas. |
| Firewall | UFW: apenas portas 80, 443 e 22022 abertas. PostgreSQL e Redis nunca expostos externamente — apenas na rede interna Docker. |
| JWT | Expiração curta (15min) \+ refresh token com rotação. Secret gerado com openssl rand \-hex 64\. |
| Rate limiting | 100 req/min por IP, 1000 req/min por tenant via @fastify/rate-limit. |
| Backup | Dump diário do PostgreSQL às 3h via cron. Retenção de 30 dias. Comprimido em .sql.gz. |

# 15\. Glossário Técnico

| Termo | Definição |
| :---- | :---- |
| ADE | Autonomous Development Engine — motor de desenvolvimento autônomo com 7 Epics que transforma requisitos em código |
| AgentAdapter | Interface TypeScript que qualquer runtime de agente deve implementar para participar do ciclo de orquestração |
| Approval Gate | Ponto de controle onde ações de alto risco requerem aprovação humana explícita antes de execução |
| Audit Log | Registro imutável e append-only de toda ação relevante no sistema — não pode ser editado ou deletado |
| Budget throttling | Mecanismo automático que pausa um agente ao atingir 100% do orçamento mensal |
| BYOA | Bring Your Own Agent — capacidade de registrar qualquer runtime externo como agente via HttpAdapter |
| Drizzle ORM | ORM TypeScript leve que conecta diretamente ao PostgreSQL — type-safe, gera SQL visível, sem PostgREST |
| Easypanel | Interface web para gerenciar containers Docker na VPS — SSL automático, gestão de domínios, volumes |
| Heartbeat | Ciclo periódico onde o agente acorda, consulta wikis, verifica tarefas, age e registra aprendizado |
| Index.md | Catálogo sintético gerado dinamicamente a partir das páginas da wiki — usado pelo agente para navegação eficiente |
| IProviderRegistry | Interface que abstrai múltiplos provedores de LLM — vive em @nexus/types para evitar circular import |
| LLM Wiki (Karpathy) | Conceito de wiki persistente mantida por LLMs — agente lê antes de agir, escreve depois de aprender |
| Lint (wiki) | Operação de health-check periódico da wiki: detecta obsolescência, contradições, links órfãos e padrões repetidos |
| MCP | Model Context Protocol — protocolo padrão para comunicação entre agentes IA e ferramentas externas |
| Multi-tenant | Capacidade de servir múltiplos clientes com isolamento total de dados — cada cliente é um tenant |
| onApproval / onRejection | Callbacks do feedback loop que registram aprendizado nas wikis após avaliação humana do output |
| OpenRouter | Gateway de API que roteia requisições para múltiplos provedores (Groq, Gemini, etc.) — nunca para dados LGPD |
| pgvector | Extensão do PostgreSQL para armazenamento e busca de vetores de embedding — habilita RAG |
| Promoção (wiki) | Mecanismo automático: quando 3+ agentes convergem para o mesmo padrão individual → elevado para wiki estratégica |
| RAG | Retrieval-Augmented Generation — técnica que injeta contexto recuperado de documentos no prompt do LLM |
| Short-circuit (wiki) | Otimização: se index tiver menos de 5 páginas, o briefing é pulado para evitar latência desnecessária |
| SilverBullet | Wiki Markdown open-source usada como interface de edição humana da wiki estratégica |
| Squad | Equipe de agentes IA especializados em um domínio — ex: squad de desenvolvimento, squad POA+SOCIAL |
| Squad Store | Marketplace para publicar, importar e versionar squads — unificação do Clipmart \+ squads AIOS |
| Tenant | Unidade de isolamento de dados — equivale a um cliente ou organização no sistema multi-tenant |
| Wiki estratégica | Wiki compartilhada por todos os agentes de um tenant — conhecimento institucional do domínio |
| Wiki individual | Wiki privada de cada agente — padrões aprendidos, templates e erros corrigidos específicos daquele agente |

**Ethra Nexus — AI Orchestration Platform**

*Da fundação ao deploy. Do conceito à produção. Da ideia ao impacto.*

| Repositório github.com/pnakamura/ethra-nexus | Licença MIT — open-source | Versão do documento 1.0 — Abril 2026 |
| :---- | :---- | :---- |

