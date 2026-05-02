# ADR-006: Modelo "1 user = 1 tenant" no MVP self-hosted

**Status:** Aceito
**Data:** 2026-05-02
**Autores:** pnakamura
**Contexto registrado em:** Spec #1 audit (2026-04-28) + Spec #2 implementation review (2026-05-01)

---

## Contexto

Durante a Spec #1 (AIOS Master Agent shell) descobrimos que o modelo de auth real
do Ethra Nexus diverge do que CLAUDE.md descrevia originalmente:

**O que o rascunho do CLAUDE.md prometia:**
- Tabela `tenant_members` mapeando `(tenant_id, user_id, role)`
- Multi-usuário por tenant
- JWT carregando identidade do usuário

**O que está implementado em [apps/server/src/routes/auth.ts](../../apps/server/src/routes/auth.ts):**
- Login: `POST /auth/login` com `{slug, password}`. Bcrypt compare contra `tenants.password_hash`.
- JWT payload: `{ tenantId, slug, role: 'admin' }` — `role` é **hardcoded** `'admin'`.
- Não há tabela `users` nem `tenant_members` queryável. CLAUDE.md (atualizado em 2026-04-29) já registra essa correção.
- Hook global `app.addHook('onRequest', ...)` injeta `request.tenantId` baseado no JWT.

Modelo efetivo: **1 user = 1 tenant.** Toda pessoa que faz login ganha acesso total
ao tenant. Não há per-user permissions, audit por user, nem co-administração.

A Spec #1 originalmente assumiu permissions per-user via `tenant_members.copilot_enabled`.
Após audit (Karpathy 2026-04-28), simplificamos para `admin-only` e deferimos
per-user opt-in. A Spec #2 (File Storage) mantém o mesmo padrão admin-only.

## Decisão

**No MVP atual, manter explicitamente o modelo "1 user = 1 tenant".**

Não criar tabelas `users` ou `tenant_members` antes de:
1. Primeiro cliente cloud pagante pedir multi-usuário, OU
2. Necessidade técnica concreta (ex: integração SSO corporativo).

Razões:

- **Self-hosted é o caminho primário no MVP**. Cliente self-host instala em VPS própria,
  é admin único — não há cenário onde "outro usuário" da mesma org precisa de acesso.
- **Cloud é roadmap, não presente.** Construir auth multi-tenant complexo agora é
  YAGNI. Adicionar depois é doloroso mas factível (migration + JWT shape upgrade).
- **JWT field `slug` em vez de `sub`** é hack consciente. Quando virmos o `users` table,
  `slug` vira foreign-key reference; código atual continua funcionando se mantermos
  retrocompatibilidade.
- **Performance e simplicidade.** Menos joins, menos tabelas, menos surface de
  bugs em RLS/permissions.

## Consequências

### Positivas

- Auth flow trivial — bcrypt compare em uma tabela.
- Zero código de privilege resolution.
- LGPD audit é direto: `actor` = slug do tenant.
- Onboarding novo cliente: criar tenant via `/auth/signup` e pronto.

### Negativas

- **Não temos como fazer co-administração.** Se 2 pessoas precisam usar a mesma instância
  Ethra Nexus de um cliente, compartilham credenciais — anti-pattern conhecido.
- **Audit log perde precisão** sob múltiplos usuários compartilhando login (`actor`
  reflete tenant, não pessoa).
- **Impossível ter "viewer" vs "admin"** dentro do mesmo tenant. Toda interação é admin.
- **Migrar para multi-user no futuro requer:**
  - Adicionar tabelas `users`, `tenant_members`.
  - Mudar JWT de `slug` para `sub` (com `tenant_id` separado).
  - Atualizar todos os middlewares que checam `role`.
  - Migrar dados existentes (criar 1 user por tenant existente).

### Aceitas como dívida técnica

- CLAUDE.md menciona "tenant_members" como conceito futuro — mantém clareza.
- Skills future (ex: per-skill permissions, shared dashboards) ficam adiadas.
- Specs futuras (#3-#5) que precisarem de "delegation" ou "approval workflow"
  vão precisar usar o modelo single-user até que ADR-007 reabra a decisão.

## Quando reabrir esta decisão

Voltar a discutir auth multi-user quando UM dos seguintes for verdade:

1. Cliente cloud pagante com requisito explícito de "team access".
2. Cliente self-host com 2+ pessoas precisando de identidades separadas
   (ex: compliance, audit individual, etc.).
3. Integração SSO (Google Workspace, Okta) que exige `sub` real no JWT.
4. Bug de segurança ou auditoria que torne credencial compartilhada
   inaceitável.

Em qualquer um desses, abrir **ADR-007** com plano de migração concreto:
schema diff, JWT upgrade, código a refatorar, e estratégia pra dados existentes.

## Referências

- [`apps/server/src/routes/auth.ts`](../../apps/server/src/routes/auth.ts)
- [`apps/server/src/app.ts`](../../apps/server/src/app.ts) (hook global JWT)
- [`docs/superpowers/audits/2026-04-28-karpathy-audit-spec1.md`](../superpowers/audits/2026-04-28-karpathy-audit-spec1.md) — origem da decisão "admin-only no MVP"
- [`apps/server/src/routes/copilot.ts`](../../apps/server/src/routes/copilot.ts) — middleware `requireCopilotAccess`
- [`apps/server/src/routes/files.ts`](../../apps/server/src/routes/files.ts) — middleware `requireFilesAccess`
- CLAUDE.md §6 (Banco de dados) — nota sobre `tenant_members` inexistente
