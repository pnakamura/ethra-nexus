# ADR-002: Migrar backend de Supabase para Fastify + Drizzle

**Status:** Aceito  
**Data:** 2026-04 (decidido durante a fase 7)  
**Autores:** pnakamura  
**Substitui:** decisão original do CLAUDE.md (rascunho v1) que adotava Supabase como backend.

---

## Contexto

A primeira versão do Ethra Nexus foi projetada sobre Supabase: PostgREST (auto-API),
Auth (gotrue), Storage e Realtime. A migração começou quando ficou claro que:

1. **Acoplamento ao gerenciador Supabase** dificultava self-hosting em VPS
   onde o cliente quer rodar tudo num único Docker Swarm. Supabase exige
   stack com 7+ containers (gotrue, postgrest, kong, realtime, etc.).
2. **PostgREST não atende a queries complexas** que o AIOS Master precisa
   executar (joins multi-tabela, agregações, transactions com side effects).
   Acabaríamos escrevendo RPCs em SQL/PLPGSQL, perdendo type safety.
3. **Auth nativo do Supabase** não dá flexibilidade necessária para o nosso
   modelo multi-tenant com `tenantId` injetado em toda request, lookup de
   permissions por skill, e auditoria customizada.
4. **RLS depende de `auth.jwt()`** (função do schema `auth` do Supabase) —
   em vanilla Postgres essa função não existe e as policies silenciosamente
   não aplicam. O isolamento real precisa ser app-level via filtro `tenantId`
   em toda query.
5. **Storage do Supabase** estava sendo usado só para arquivos de wiki, e
   migramos para filesystem local (montado como volume Docker) por
   simplicidade.

## Decisão

Adotar a stack:

- **Fastify 5** — servidor HTTP com plugins (`@fastify/jwt`, `@fastify/cors`,
  `@fastify/rate-limit`, `@fastify/static`)
- **Drizzle ORM** + **node-postgres (`pg`)** — schema TypeScript-first,
  queries com type safety, migrations geradas via `drizzle-kit`
- **Postgres** + **pgvector** — sem PostgREST, sem gotrue. Continua a
  pgvector pra busca semântica
- **JWT custom** — `request.jwtVerify()` em hook global que injeta
  `request.tenantId` baseado no `tenantId` claim do token

## Consequências

**Positivas:**

- ✅ Self-hosted em 1 container backend (não 7) + Postgres + N8N + SilverBullet
- ✅ Type safety completa nas queries (Drizzle infere tipos do schema)
- ✅ Sem PostgREST quirks; queries arbitrárias diretas no controller
- ✅ JWT custom com `tenantId` permite hooks Fastify limpos sem RLS magic
- ✅ Build da imagem Docker e deploy em GHCR cabem em um Dockerfile multi-stage

**Negativas / Aceitas:**

- ❌ Perdemos `auth.jwt()` no Postgres — RLS policies que referenciam isso
  precisam ser reescritas usando `current_setting('app.tenant_id')` ou
  removidas. Hoje o backend conecta como `postgres` superuser e o
  isolamento é app-level via Drizzle. Migração futura: usar session
  variable.
- ❌ Sem Realtime nativo — quando precisarmos de subscriptions, vamos
  implementar via SSE (já em uso no `/copilot`) ou WebSocket dedicado.
- ❌ Sem Storage do Supabase — anexos de wiki ficam em volume Docker
  montado em `/wikis/`. Backup é responsabilidade do operador.
- ❌ Migrations em `infra/supabase/migrations/` mantêm o nome legado por
  enquanto — os arquivos são SQL puro aplicável a qualquer Postgres,
  mas o nome do diretório confunde. A renomear quando houver janela.

## Validação

A migração foi concluída e validada na Fase 7 (Sprint A) e novamente na
Spec #1 (AIOS Master shell, abril 2026). 35+ rotas Fastify substituem
o que antes eram chamadas PostgREST + RPCs. Drizzle schema cobre
28 tabelas de produção. Nenhuma regressão funcional foi observada.

## Referências

- `apps/server/src/app.ts` — registro de plugins Fastify e hook global
- `packages/db/src/client.ts` — Pool/Drizzle setup
- `packages/db/src/schema/` — schema vivo
- `infra/supabase/migrations/` — SQL legado (nome) aplicado pelo entrypoint do Postgres
