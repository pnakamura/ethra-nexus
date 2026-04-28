# Karpathy Principles Audit — Spec #1 (AIOS Master Shell)

**Data**: 2026-04-28
**Escopo**: Tasks 1-16 do plano `docs/superpowers/plans/2026-04-27-aios-master-shell.md`
**Avaliador**: Claude (sessão de implementação)
**Diretrizes de referência**:
- `~/.claude/skills/ethra-nexus/karpathy-guidelines.md` (4 princípios + padrões obrigatórios)
- `CLAUDE.md §3.4` (padrão wiki: raw → compiled → embedded)

---

## TL;DR

**Aderência geral: B+**. Princípios fundamentais respeitados (surgical, wiki pattern, RLS, sensitive_data, multi-tenant). Três gaps reais identificados:

1. 🔴 **Budget tracking gap** — turn loop bypassa `agentsDb.canExecute/upsertBudget/logProviderUsage`. Custo do AIOS Master não aparece em `provider_usage_log` nem em `budgets`. Precisa fix antes de Task 17 finalizar (proposta: Task 17.5).

2. 🟡 **Processo overcomplicated** — subagent-driven com 32 tasks + 2 reviewers/task viola Simplicity First para projeto single-developer. Recomendação para Specs #2-5: inline execution.

3. 🟡 **Audit reativo** — gaps do plano descobertos DURANTE implementação (não antes). Plan de 5357 linhas escrito sem grep no codebase. 1 commit de retrabalho consolidando audit.

---

## Scorecard detalhado

### Princípio 1 — Think Before Coding: **B+**

✅ **Wins:**
- Spec brainstorming com 8 perguntas foundationais (persistência, escopo, UI, modelo, permission, caps) — explicit assumption declaration
- Audit em 2026-04-28 antes de Task 3 capturou: JWT sem `sub`, `tenant_members` não-queryable, `executeWikiQuery` private
- Decisão Q5 revisada de "C: hybrid copilot_enabled" para "B: admin-only" após descoberta
- Forward-declared exports documentados (`turn-loop.ts` referenciado antes de existir)

❌ **Losses:**
- Plano escrito sem grep `infra/supabase/migrations/` (resultado: collision 012)
- Plano não verificou que `tenant_members` é usado pelo app (resultado: middleware projetado pra falhar)
- Plano não checou export de `executeWikiQuery` (resultado: Task 14 precisou rewrite inline)
- `provider_usage_log.aios_event_id` referenciado em Tasks 9 e 11 sem verificar existência (resultado: ambas precisaram correção)

### Princípio 2 — Simplicity First: **C+**

✅ **Wins:**
- `system:list_storage_alerts` é stub `[]` (não construímos infra de Spec #2 antecipadamente)
- Reuso de `update_updated_at()` em vez de função nova
- Reuso de tabela `agents` para AIOS Master (slug `aios-master`) em vez de tabela copilot_agents
- Decisão de NÃO usar MCP no MVP (defer pra Fase D)
- Tool count fixo em 9 (poderia ter expandido)
- Removido `cm_tenant_role_idx` (low-selectivity)

❌ **Losses:**
- **Processo subagent-driven com 32 tasks é overcomplicated** para projeto single-developer self-hosted. Karpathy diria: *"just write the code yourself, document key decisions, and ship."*
- Plan de 5357 linhas com 2 reviewers/task vira o *próprio produto* em vez de meio
- Per-tool permission system (`admin_only` vs `all_members`) é speculative — designed para o futuro multi-user que ainda não existe
- 3-panel UI mirror do OrchestratorPage mantém kanban-shaped pensamento mesmo sem necessidade de kanban no chat

### Princípio 3 — Surgical Changes: **A-**

✅ **Wins:**
- 16 commits, cada um focado em uma task
- Migration 012→021 renomeada sem disturbar 013-020
- Nenhum "while I'm here, let me clean up X"
- Audit batch (3d41a16) é UM commit consolidando 4 arquivos relacionados (apropriado para mudança lógica única)

❌ **Losses:**
- Pequeno: plan/spec amendments interspersed com code commits — defensável mas poderiam ser commits separados

### Princípio 4 — Goal-Driven Execution: **B-**

✅ **Wins:**
- Cada task tem acceptance criteria clara no plan
- TDD strict: tests pass = success
- Spec tem seção explícita "Acceptance criteria"
- Per-tool tests cobrem happy path + edge cases

❌ **Losses:**
- 🔴 **Migration 021 e 022 NUNCA foram aplicadas em DB nenhum** — todo o schema está em commits mas nada foi rodado contra Postgres real
- Implementer claimed Task 2 typecheck passes mas worktree tem unresolved errors — atribuído a "environmental" sem fix
- Sem integração verificada em milestones (smoke só em Task 32)
- Karpathy: *"Itere até verificar"* — estamos iterando sem verificar end-to-end

### Padrão Wiki (CLAUDE.md §3.4): **A**

✅ **Compliance total:**
- `wiki_query` tool implementa `embed()` + pgvector + sources cited corretamente
- `sensitive_data: true` declarado explicitamente
- Wiki estratégica + agent-scoped opcional, sources sorted por similarity
- Threshold `> 0.4` aplicado (matches "similarity > 0.3" do guideline com margem)

🟡 **Pequena nota:**
- system_prompt do AIOS Master duplicado em 2 lugares: SQL seed migration 022 + `system-prompt.ts` constant. Documentado no código como "fallback when DB row is missing". Aceitável mas viola DRY.

---

## Armadilhas conhecidas — checklist

| Armadilha (do karpathy-guidelines.md) | Status |
|---|---|
| Turbo cache em build | ✅ N/A (não deployamos ainda) |
| `service update` sem push | ✅ N/A |
| `process.env` no N8N | ✅ N/A |
| `fetch` nativo no N8N | ✅ N/A |
| Circular import wiki → agents | ✅ Avoided — `wiki_query` importa de `@ethra-nexus/wiki` na direção correta |
| Schema Drizzle sem migration SQL | ✅ Migration 021 SQL + Drizzle copilot.ts criados juntos |
| RLS ausente em tabela nova | ✅ 3 tabelas com policies (catch do code reviewer Task 1) |
| `sensitive_data` ausente | ✅ wiki_query usa corretamente |

---

## Padrões obrigatórios — compliance

| Pattern | Status | Notas |
|---|---|---|
| Toda rota Fastify usa `request.tenantId` | ⏳ Pending | Tasks 21-23 ainda não implementadas |
| Retorno `{ data: result }` | ⏳ Pending | Padrão no plan, validado em Task 22 |
| Toda tabela: `tenant_id`, `created_at`, `updated_at`, RLS | ✅ | 3 tabelas copilot conformes |
| ProviderRegistry com `sensitive_data` | ⚠️ **DEVIATION** | Turn loop bypassa ProviderRegistry — chama Anthropic direto |
| Budget check pre + log post | ⚠️ **DEVIATION** | Vai pular `canExecute`, `logProviderUsage`, `upsertBudget` |

A última linha é o achado crítico desta auditoria. Detalhes abaixo.

---

## 🔴 Achado crítico — Budget tracking gap

### O problema

O plan Q4 decide: **"Tool calling integration → Anthropic Tool Use API nativo (Claude SDK direto, sem ProviderRegistry)"**.

Justificativa (válida): AIOS Master é sempre `sensitive_data: true`, então não há flexibilidade de routing a ser ganha — ir direto via Anthropic é mais simples.

**Mas isso vem com custo escondido**: o ProviderRegistry NÃO é só roteamento — ele é também o lugar onde a contabilização central acontece via patterns como:

```typescript
// Pattern do karpathy-guidelines.md §"Todo agente com budget check"
const check = await agentsDb.canExecute(agent.id, month, 0.02)  // PRE-CHECK
// ... executa ...
await agentsDb.logProviderUsage({ ... })                          // POST-LOG
await agentsDb.upsertBudget(agent.id, tenant_id, month, cost, tokens)  // BUDGET UPDATE
```

Como bypassamos ProviderRegistry, **estes 3 calls nunca acontecem para o AIOS Master**.

### Consequência

- ❌ `provider_usage_log` não terá rows do AIOS Master — observabilidade central perde visão
- ❌ `budgets.spent_usd` não atualiza para o aios-master agent — soft-cap mensal de $20/mês não é enforced
- ❌ Pre-check de budget antes do turno não acontece — risco de turno rodar com budget já estourado
- ⚠️ `copilot_conversations.total_cost_usd` recebe os totais por thread, mas isso é **isolated** do tracking central que o resto do sistema usa

### Fix proposto — Task 17.5 (nova)

Inserir antes de Task 17 (turn loop core) ou inline em Task 23 (SSE endpoint):

**Pre-check** no início de `executeCopilotTurn`:
```typescript
const month = new Date().toISOString().slice(0, 7)
const check = await agentsDb.canExecute(aiosMasterAgentId, month, 0.05)
if (!check.allowed) {
  throw { code: 'BUDGET_EXCEEDED', message: check.reason }
}
```

**Post-turn** após cada assistant message:
```typescript
await agentsDb.logProviderUsage({
  tenant_id: p.tenant_id,
  agent_id: aiosMasterAgentId,
  skill_id: 'copilot:turn',  // skill sintética para o copilot
  provider: 'anthropic',
  model: MODEL,
  tokens_in: step.tokens_in,
  tokens_out: step.tokens_out,
  cost_usd: stepCost,
  latency_ms: durationMs,
  is_fallback: false,
  is_sensitive: true,
})
await agentsDb.upsertBudget(aiosMasterAgentId, p.tenant_id, month, stepCost, totalTokens)
```

**Custo de implementação**: ~1-2 dias (já existe `agentsDb.canExecute`/`logProviderUsage`/`upsertBudget`).

**Custo de não implementar**: AIOS Master vira "fora da contabilidade" — quebra promessa do CLAUDE.md de tracking centralizado.

### Decisão recomendada

Adicionar **Task 17.5** ao plano, executar antes de fechar a fase de turn loop. Atualizar o `## Audit decision log` do plano com este achado.

---

## 🟡 Achado de processo — Subagent-driven é overkill

### Diagnóstico

O processo escolhido (subagent-driven com 32 tasks, 2 reviewers/task, plan de 5357 linhas) tem custo:

- **5-15 min por task** em dispatch overhead
- **Cada task tem 1-3 subagents** (implementer + spec review + code review)
- **Reviewers achatam edge cases** mas também produzem ruído (Task 1 teve 5 issues que vieram do plan, não do código)
- **Repetição massiva de boilerplate** (cada task duplica imports, descriptions, etc)

Para projeto single-developer self-hosted onde o "engenheiro" é o próprio user com Claude, isso é overengineering do processo.

### Princípio violado

Karpathy guideline §Princípio 2 — Simplicity First:
> *"Sem features além do que foi pedido. Sem abstrações para código de uso único. Sem 'flexibilidade' ou 'configurabilidade' não solicitada."*

Aplicado ao processo: **2 reviewers/task** é abstração para o caso onde implementer é não-confiável. Mas o implementer é Claude com plan detalhado — review encontra 95% gap-de-plano, não bugs-de-código.

### Recomendação para Specs #2-5

**Adopt inline execution** com checkpoints a cada 3-5 tasks:

```
- Brainstorming → spec curto (1-2 páginas)
- Plano resumido (~500 linhas, não 5000)
- Implementação inline, commitando cada task
- Checkpoint a cada 3-5 tasks: "implementei X, Y, Z. Testes passam. Continuo?"
- Smoke test no fim da fase, não no fim do spec inteiro
```

**Quando subagent-driven faz sentido:**
- Multiple ENGINEERS distintos no time (não nosso caso)
- Specs muito grandes (>50 tasks) com paralelismo real possível
- Quando contexto humano não é disponível para checkpoints frequentes

### Recomendação operacional

Não vamos refazer Spec #1 — está 50% feito e funciona. Mas para Specs #2-5, **default para inline execution** a menos que algo justifique subagent-driven.

---

## 🟡 Achado de processo — Pre-plan audit ausente

Plano escrito sem inspecionar:
- `infra/supabase/migrations/` (next-free-number era 021, não 012)
- `apps/server/src/routes/auth.ts` (JWT structure)
- `packages/db/src/schema/` (que tabelas existem em Drizzle vs SQL only)
- `packages/agents/src/lib/skills/skill-executor.ts` (que está exportado vs private)
- `packages/db/src/schema/aios.ts` (colunas reais de aios_events)

Audit fez TUDO isso depois e gerou 1 commit grande de retrabalho (3d41a16: 161 insertions / 125 deletions).

### Recomendação

**Antes de escrever plan**, gastar 15-20min de grep no codebase. Checklist sugerida:

```bash
# Migration numbering
ls infra/supabase/migrations/ | tail -5

# JWT structure
grep -A 3 "jwtVerify\|request.user" apps/server/src/app.ts

# Drizzle exports
grep "export const" packages/db/src/schema/*.ts

# Function privacy
grep "^export\|^async function" packages/agents/src/lib/skills/*.ts

# Specific column existence
grep "aios_event_id\|tenant_members" infra/supabase/migrations/*.sql

# Existing patterns to follow
cat packages/db/src/schema/aios.ts | head -50
```

Documentar findings em "Pre-plan audit" no topo do plan ANTES de escrever as tasks.

---

## Recomendações para retomar Spec #1

Quando voltarmos a Task 17 em sessão futura:

1. **Aplicar migrations 021 e 022** num DB de dev/local — verificar que rodam clean (psql, supabase, ou docker exec). Atualmente ZERO verificação foi feita.

2. **Rodar `npx vitest run` em `packages/agents`** — confirmar que os ~26 tests dos tools 1-9 ainda passam (baseline antes de turn loop)

3. **Adicionar Task 17.5** no plano: budget integration. Estimativa 1-2h.

4. **Continuar Tasks 17-32** com subagent-driven (já investido, melhor finalizar) — mas **NÃO usar este processo para Specs #2-5**.

5. **Checkpoint visual real**: depois de Task 23 (SSE endpoint), fazer um curl real contra o servidor local antes de mergulhar no frontend.

---

## Conclusão

Este audit não é crítica do que foi feito — Tasks 1-16 estão **arquiteturalmente sólidas**. A maior parte das violações foram de processo e de descobertas (gaps no plano que vieram do codebase real). Os fixes catch-and-correct funcionaram.

O **achado crítico real** é o budget tracking gap. Sem fix, o AIOS Master vai consumir Anthropic API "off-the-books" do ponto de vista do tracking central — viola promessa do produto.

A **lição maior** é: para Specs #2-5, **simplificar o processo**. Inline execution + pre-plan audit + checkpoint físico end-to-end. Isso é puro Karpathy: simplicity first, goal-driven, think before coding.
