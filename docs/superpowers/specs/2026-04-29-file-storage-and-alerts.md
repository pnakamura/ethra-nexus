# Spec #2 — File Storage + Alerts

> **Spec #2 de 5** na trilha que termina com "xlsx → HTML dashboard end-to-end".
> Specs subsequentes (em ordem): #3 Input Worker + Parsers · #4 Output Worker + HTML Dashboard · #5 Integração E2E.

**Data:** 2026-04-29  
**Autor:** Paulo Nakamura (com Claude)  
**Status:** Approved for implementation  
**Depende de:** Spec #1 (AIOS Master shell) — shipped 2026-04-29

---

## Goal

Entregar dois subsistemas independentes mas relacionados:

1. **File Storage** — capacidade do sistema receber, armazenar, listar e apagar arquivos por tenant, com quotas opcionais e TTL configurável. Backend abstraído em interface `FileStorageDriver` para permitir migração futura para S3-compatible sem refactor de chamadores.

2. **Alerts subsystem** — tabela `system_alerts` unificada (categoria + código + severity) populada por job diário no scheduler. Categoria `storage` é o único cliente no MVP; futuras specs adicionam categorias (`budget`, `agent_health`, `schedule`) sem migration.

A tool `system_list_storage_alerts` que está stubbed na Spec #1 vira real ao final desta spec. Nova tool `system_get_storage_usage` adicionada.

## Acceptance criteria (Spec #2)

- Migration 023 aplicada cria tabelas `files`, `system_alerts`, e adiciona coluna `tenants.storage_limit_bytes`.
- Backend Fastify expõe 4 endpoints (`POST /files`, `GET /files/:id/download`, `GET /files`, `DELETE /files/:id`), todos admin-only, todos isolados por `tenant_id` via hook JWT global.
- Upload bem-sucedido cria row em `files`, persiste bytes via `LocalFsDriver`, registra em `audit_log`.
- Pre-check de quota antes do upload: rejeita com `413 STORAGE_LIMIT_EXCEEDED` se passar `storage_limit_bytes`.
- Download stream com `Content-Disposition: attachment` força browser a baixar (anti mime sniffing).
- Cron job diário (junta com o cleanup de TTL existente) computa uso por tenant, cria/resolve alerts em 70/85/95%.
- Tool `system_list_storage_alerts` retorna alerts ativos do tenant; `system_get_storage_usage` retorna totals + percentual + counts.
- Endpoint `/copilot/health` ganha campo `banner_alerts` listando apenas categoria=storage code=hard_limit ativos.
- Frontend `/copilot` mostra banner vermelho fixo no topo quando `banner_alerts.length > 0`.
- Cobertura de testes ≥80% nos arquivos novos (driver, alerts logic, route handlers).
- Smoke test manual passa em todos os 11 itens (lista no fim do doc).

## Out of scope (Spec #2)

- Widget de attachment no input do `/copilot` — fica pra Spec #3 (quando Input Worker existir pra consumir).
- Parsers de conteúdo — Spec #3.
- Geração de artefatos pelo Output Worker — Spec #4.
- Categorias de alert além de `storage` — Specs futuras populam.
- Auto-deleção de orphans (DB rows sem arquivo, ou vice-versa) — apenas log no MVP.
- Soft delete / versioning / dedupe via sha256 — YAGNI.
- Tags, labels, folders em files — Specs futuras.
- Driver S3 implementado — interface preparada, impl deferida.
- Presigned URLs — `getDownloadUrl()` retorna URL relativa via Fastify; presigned externa entra com S3Driver.
- Quota por agente, por skill ou por tipo de arquivo — apenas por tenant.
- UI dedicada `/files` ou `/alerts` — admin gerencia via API/curl no MVP.
- ACL granular (membro X pode ver file Y) — admin-only segue a regra Spec #1.

---

## Decisions log

| # | Decisão | Escolha |
|---|---------|---------|
| Q1 | Escopo de "files" | C — storage genérico novo, wiki fica como está (`wiki_raw_sources` permanece independente) |
| Q2 | Backend storage | C — interface `FileStorageDriver` com `LocalFsDriver` em prod, `S3Driver` futuro |
| Q3 | Quotas | B simplificado — `tenants.storage_limit_bytes` nullable (null = ilimitado) |
| Q4 | Lifecycle | C — `expires_at TIMESTAMPTZ NULL` opcional por arquivo + cleanup job |
| Q5 | Acesso | C — API direto via Fastify; `getDownloadUrl()` retorna URL relativa do tipo `/api/v1/files/:id/download` |
| Q6 | Escopo de alerts | C — tabela unificada `system_alerts(category,code,…)` com apenas storage como cliente no MVP |
| Q7 | Trigger de alerts | A — polling via cron job diário (junta com cleanup de TTL) |
| Q8 | Surface de alerts | D — tool no `/copilot` lista todos + banner em `/copilot` quando há `hard_limit` ativo |
| Q9 | Resolução | A — auto-resolve via cron quando condição passa (`resolved_at` set automaticamente) |
| Q10 | UI de upload no MVP | A — sem UI nesta spec; só API testável via curl. Spec #3 traz attachment widget |

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│  FILE STORAGE                              ALERTS                │
│  ──────────────                            ──────                │
│  ┌──────────────────┐                    ┌──────────────────┐   │
│  │ FileStorageDriver│                    │ system_alerts    │   │
│  │ (interface)      │                    │ table            │   │
│  └────────┬─────────┘                    └─────────┬────────┘   │
│           │                                        │            │
│  ┌────────┴─────────┐                    ┌─────────┴────────┐   │
│  │ LocalFsDriver    │ (prod)             │ Daily cron job   │   │
│  │ S3Driver         │ (futuro)           │ in scheduler-loop│   │
│  └────────┬─────────┘                    └─────────┬────────┘   │
│           │                                        │            │
│  ┌────────┴─────────┐                              │            │
│  │ files table      │                              │            │
│  │ POST /files      │                              │            │
│  │ GET /files/:id   │                              │            │
│  │ DELETE /files/:id│                              │            │
│  └──────────────────┘                              │            │
│                                                    │            │
│           └─────── medições de uso ────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
                  Tools no /copilot (Spec #1):
                    · system_list_storage_alerts (ativa esta spec)
                    · system_get_storage_usage (nova, opcional)
                  Banner em /copilot quando há `hard_limit` ativo.
```

**Princípios:**
- `FileStorageDriver` é puro I/O. Não sabe sobre quotas, alerts ou tenants.
- Sistema de alerts roda em paralelo, lendo apenas `files` (para somar uso) e `tenants.storage_limit_bytes`. Não escreve no driver.
- Acoplamento mínimo: alerts pode ser desligado/refatorado sem mexer no storage e vice-versa.

---

## Components

### Estrutura de arquivos novos

```
packages/agents/src/lib/storage/
├── driver.ts              ← interface FileStorageDriver
├── local-fs.driver.ts     ← LocalFsDriver (prod)
├── s3.driver.ts           ← (placeholder, futuro — comentado out)
├── factory.ts             ← createStorageDriver() lê env e retorna driver
├── index.ts
└── __tests__/
    ├── local-fs.driver.test.ts
    ├── factory.test.ts
    └── mock.driver.ts     ← test helper

packages/db/src/schema/storage.ts           ← exporta files + systemAlerts
packages/db/src/schema/index.ts             ← adiciona export de storage

infra/supabase/migrations/023_files_and_alerts.sql

apps/server/src/routes/files.ts             ← POST/GET/DELETE /files
apps/server/src/__tests__/files-routes.test.ts

packages/agents/src/lib/alerts/
├── storage-alerts.ts      ← computeStorageAlerts() — chamada pelo cron
├── index.ts
└── __tests__/
    └── storage-alerts.test.ts

packages/agents/src/lib/copilot/tools/
├── list-storage-alerts.ts ← já existe (stub) — vira real
└── get-storage-usage.ts   ← novo
```

### Interface do driver

```typescript
// packages/agents/src/lib/storage/driver.ts

export interface PutResult {
  storage_key: string  // path opaco (driver-specific)
  size_bytes: number
  sha256: string       // hex 64 chars
}

export interface FileStorageDriver {
  put(args: {
    tenant_id: string
    file_id: string         // UUID gerado pelo caller
    bytes: Buffer | NodeJS.ReadableStream
    mime_type: string
  }): Promise<PutResult>

  get(storage_key: string): Promise<NodeJS.ReadableStream | null>

  delete(storage_key: string): Promise<void>  // idempotente

  getDownloadUrl(storage_key: string, opts?: { ttl_seconds?: number }): Promise<string>
}
```

### LocalFsDriver

- Root path em env `FILE_STORAGE_ROOT` (default `/data/files`).
- `storage_key` formato: `{tenant_id}/{file_id}` (sem extensão; mime_type só no DB).
- `put()` cria diretório do tenant se não existe, escreve via `fs.createWriteStream`, computa sha256 streaming via `crypto.createHash('sha256')`.
- `get()` retorna `fs.createReadStream(path)` ou null se ENOENT.
- `delete()` faz `fs.promises.unlink()` ignorando ENOENT.
- `getDownloadUrl()` retorna `/api/v1/files/${file_id}/download` (URL relativa; JWT do user resolve auth).

> Driver decodifica `storage_key` internamente — caller passa apenas IDs validados (UUID + tenant_id do JWT). Nenhum string externo entra no path. Path traversal impossível.

### Factory

```typescript
// packages/agents/src/lib/storage/factory.ts
export function createStorageDriver(): FileStorageDriver {
  const driver = process.env.FILE_STORAGE_DRIVER ?? 'local-fs'
  switch (driver) {
    case 'local-fs':
      return new LocalFsDriver(process.env.FILE_STORAGE_ROOT ?? '/data/files')
    // case 's3': return new S3Driver({ endpoint, bucket, ... })  // futuro
    default:
      throw new Error(`Unknown FILE_STORAGE_DRIVER: ${driver}`)
  }
}
```

---

## Database schema

Migração: `infra/supabase/migrations/023_files_and_alerts.sql`.  
Schema Drizzle: `packages/db/src/schema/storage.ts` (novo), exportado em `index.ts`.

### Migration 023 SQL

```sql
-- ── 1. Coluna nova em tenants ─────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN storage_limit_bytes BIGINT
  CHECK (storage_limit_bytes IS NULL OR storage_limit_bytes > 0);
COMMENT ON COLUMN tenants.storage_limit_bytes IS
  'Hard limit em bytes. NULL = ilimitado (default self-hosted).';

-- ── 2. Tabela `files` ─────────────────────────────────────────
CREATE TABLE files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  storage_key     TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL CHECK (size_bytes >= 0),
  sha256          TEXT NOT NULL CHECK (length(sha256) = 64),
  original_filename TEXT,
  uploaded_by     TEXT NOT NULL,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX files_tenant_id_idx ON files(tenant_id);
CREATE INDEX files_tenant_expires_idx ON files(tenant_id, expires_at)
  WHERE expires_at IS NOT NULL;
CREATE INDEX files_sha256_idx ON files(sha256);

CREATE TRIGGER files_updated_at BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- update_updated_at() é definida em 001_tenants.sql; reusar.

ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- ── 3. Tabela `system_alerts` ─────────────────────────────────
CREATE TABLE system_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  category      TEXT NOT NULL,
  code          TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  message       TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  fired_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX system_alerts_one_active_idx
  ON system_alerts(tenant_id, category, code)
  WHERE resolved_at IS NULL;
CREATE INDEX system_alerts_tenant_active_idx
  ON system_alerts(tenant_id, resolved_at)
  WHERE resolved_at IS NULL;
CREATE INDEX system_alerts_fired_at_idx ON system_alerts(fired_at DESC);

ALTER TABLE system_alerts ENABLE ROW LEVEL SECURITY;
```

### Cálculo de uso por tenant

```sql
SELECT COALESCE(SUM(size_bytes), 0) AS total
FROM files
WHERE tenant_id = $1
  AND (expires_at IS NULL OR expires_at > NOW());
```

Arquivos expirados ainda fisicamente lá mas já não contam — cleanup job remove no próximo passe.

---

## API endpoints

Todos com prefix `/api/v1`, todos JWT + admin-only (mesmo middleware da Spec #1).

### `POST /files` — upload

Multipart/form-data. Campo `file` obrigatório. Optional: `original_filename`, `expires_at` (ISO8601, > NOW()).

**Fluxo:**
1. Pre-check quota → 413 `STORAGE_LIMIT_EXCEEDED` se passar.
2. `file_id = uuid()`. Stream bytes via `driver.put()`. Driver computa sha256.
3. INSERT em `files`. Se INSERT falhar → `driver.delete(storage_key)` (rollback) → 500.
4. INSERT em `audit_log` com `action='create'`.
5. 201 + `{ id, original_filename, mime_type, size_bytes, sha256, download_url, expires_at }`.

**Race condition aceita:** uploads concorrentes podem ambos passar pre-check e juntos estourar limite. Próximo cron cria `hard_limit` que bloqueia futuros uploads. Sem `SELECT ... FOR UPDATE` — serializaria por tenant.

### `GET /files/:id/download`

Bytes streaming + `Content-Type: <mime_type>` + `Content-Disposition: attachment; filename="<original>"` (forçado pra anti mime sniffing). 404 se id não existe ou tenant_id não bate.

### `GET /files` — listagem (admin)

Query params: `limit` (default 50, max 200), `offset`, `mime_type` (filtro), `expires_before`, `expires_after`. Retorna `{ data: File[] }` — sem bytes, só metadata.

### `DELETE /files/:id`

DELETE no DB → `driver.delete(storage_key)` → INSERT em `audit_log` com `action='delete'` → 204. Idempotente (404 se id não existe).

### `GET /copilot/health` — extensão (Spec #1)

Adiciona campo `banner_alerts: AlertSummary[]`:

```typescript
{
  ok: true,
  user_slug: "atitude45",
  role: "admin",
  banner_alerts: [
    { id, category: 'storage', code: 'hard_limit',
      severity: 'critical', message: '...', fired_at }
  ]
}
```

Frontend lê isso no `CopilotPage`. Banner aparece se `banner_alerts.length > 0`.

---

## Cron job

Adicionado em `packages/agents/src/lib/scheduler/scheduler-loop.ts` como tarefa diária:

```typescript
async function dailyMaintenance() {
  const stats = {
    files_deleted: await cleanupExpiredFiles(),
    alerts: await computeStorageAlerts(),
  }
  log.info({ event: 'storage_cron', ...stats })
}
```

### `cleanupExpiredFiles()`

```sql
SELECT id, tenant_id, storage_key
FROM files
WHERE expires_at IS NOT NULL AND expires_at < NOW();
```

Pra cada row: `driver.delete(storage_key)` → `DELETE FROM files WHERE id = ...`. Em batch de 100. Loga total.

### `computeStorageAlerts()`

Pra cada tenant com `storage_limit_bytes IS NOT NULL`:

1. Calcula `total_bytes = SUM(size_bytes WHERE NOT expired)`.
2. `pct = total_bytes / storage_limit_bytes`.
3. Determina código atual:
   - `pct >= 0.95` → `hard_limit` (severity `critical`)
   - `0.85 <= pct < 0.95` → `migration_recommended` (severity `warning`)
   - `0.70 <= pct < 0.85` → `soft_warning` (severity `info`)
   - `pct < 0.70` → nenhum
4. Pra cada código (3 possíveis):
   - Se condição é true E não há alert ativo desse código → `INSERT ... ON CONFLICT DO NOTHING`
   - Se condição é false E há alert ativo desse código → `UPDATE SET resolved_at = NOW() WHERE …`
5. `payload` JSONB do alert: `{ current_bytes, limit_bytes, pct }`.

Idempotente. Rodar 2x não cria duplicatas (graças ao unique partial index `system_alerts_one_active_idx`).

---

## Tools no /copilot

### `system_list_storage_alerts` — vira real

```typescript
input_schema: {
  level?: 'soft_warning' | 'migration_recommended' | 'hard_limit'
}
permission: 'admin_only'
handler: async (input, ctx) => {
  const rows = await db.select()
    .from(systemAlerts)
    .where(and(
      eq(systemAlerts.tenant_id, ctx.tenant_id),
      eq(systemAlerts.category, 'storage'),
      isNull(systemAlerts.resolved_at),
      input.level ? eq(systemAlerts.code, input.level) : undefined,
    ))
    .orderBy(desc(systemAlerts.fired_at))
  return rows.map(r => ({
    code: r.code, severity: r.severity, message: r.message,
    payload: r.payload, fired_at: r.fired_at,
  }))
}
```

### `system_get_storage_usage` — nova

```typescript
input_schema: {}
permission: 'admin_only'
output: {
  total_bytes: number,
  file_count: number,
  limit_bytes: number | null,
  pct_used: number | null,
  alerts_active: {
    soft_warning: number,
    migration_recommended: number,
    hard_limit: number,
  },
}
```

Útil pra "quanto storage estou usando?" sem precisar listar alerts.

---

## Error handling & security

### Códigos de erro

| Endpoint | Código | HTTP | Trigger |
|---|---|---|---|
| `POST /files` | `STORAGE_LIMIT_EXCEEDED` | 413 | `current + new > storage_limit_bytes` |
| `POST /files` | `FILE_TOO_LARGE` | 413 | bodyLimit Fastify (50MB) |
| `POST /files` | `INVALID_FILE` | 400 | sem multipart, sem `file`, ou `expires_at` mal-formado/passado |
| `POST /files` | `STORAGE_DRIVER_ERROR` | 500 | `driver.put()` throw (ENOSPC, EIO) |
| `GET /files/:id/download` | `FILE_NOT_FOUND` | 404 | id inexistente ou tenant_id divergente |
| `GET /files/:id/download` | `STORAGE_ORPHAN` | 500 | row em DB mas `driver.get()` retornou null. Loga em audit |
| `DELETE /files/:id` | `FILE_NOT_FOUND` | 404 | id inexistente |

Todos passam por `sanitizeErrorMessage()` (regra 7.2.4).

### Validação de inputs (em `packages/core/src/security/validate.ts`)

- `validateFileId` (wrapper sobre `validateUuid`)
- `validateExpiresAt` — parse ISO8601, reject se < NOW + 1min
- `validateMimeType` — apenas formato via regex `/^[a-z]+\/[a-z0-9\-+.]+$/i`. Não filtra tipos.

### Sanitização

- `original_filename` salvo já sanitizado via `sanitizeForHtml()`. Nunca aparece no path do filesystem (driver não vê).

### Path traversal — impossível

Driver recebe `tenant_id` (validado pelo hook JWT global) + `file_id` (UUID gerado pelo handler). `LocalFsDriver` constrói path interno como `${root}/${tenant_id}/${file_id}` — nenhum string externo entra no path. Caller nunca passa `original_filename` ao driver.

### Mime sniffing — força download

`Content-Disposition: attachment; filename="<original>"` em todo download. Browser não renderiza inline. SVG malicioso, HTML com JS, etc. neutralizados. Spec #4 (dashboards) terá rota dedicada com CSP.

### Audit trail

Cada `POST /files` e `DELETE /files/:id` insere row em `audit_log`:

```typescript
{
  tenant_id,
  entity_type: 'file',
  entity_id: file_id,
  action: 'create' | 'delete',
  actor: jwt.slug,
  payload: { mime_type, size_bytes, original_filename },
  user_ip,
}
```

Downloads não vão pra audit (custo alto, baixo valor).

### Rate limiting

`@fastify/rate-limit` global em 100/min. Override estrito em `POST /files`: 20/min/IP. Justificativa: 50MB × 100/min = 5GB/min potencial. 20/min = 1GB/min, confortável pra VPS.

### Orphan recovery

Cron semanal (não diário) varre `files` × `driver.list()` e LOGA divergências:
- DB row sem arquivo no disco
- Arquivo no disco sem DB row

Spec #2 só implementa o LOG. Auto-deleção é flag separado pra ativar com cuidado depois.

### Cleanup quando tenant é deletado

Tabela `files` referencia `tenants(id)` sem `ON DELETE CASCADE` (consistência com padrão do schema). Procedimento manual de delete tenant (ver Roteiro de cleanup) precisa incluir `DELETE FROM files WHERE tenant_id = ...` e iterar `driver.delete(storage_key)` antes do `DELETE FROM tenants`.

---

## Testing strategy

### Unit (`packages/agents/src/lib/storage/__tests__/`)

**`local-fs.driver.test.ts`:**
- `put()` cria diretório, escreve bytes, computa sha256 correto
- `put()` retorna `storage_key` previsível (`{tenant_id}/{file_id}`)
- `put()` com bytes vazios funciona (size_bytes = 0)
- `get()` retorna stream com bytes idênticos ao input
- `get()` retorna null pra storage_key inexistente (sem throw)
- `delete()` é idempotente (não throw em key inexistente)
- `delete()` realmente apaga do disco
- `getDownloadUrl()` retorna formato esperado

**`factory.test.ts`:**
- Lê `FILE_STORAGE_DRIVER` do env, default `local-fs`
- Throw em driver desconhecido

### Unit (`packages/agents/src/lib/alerts/__tests__/`)

**`storage-alerts.test.ts`:**
- Tenant sem `storage_limit_bytes` → nenhum alert criado
- 60% uso → nenhum alert
- 75% → cria `soft_warning`
- 90% → cria `migration_recommended`, resolve `soft_warning` se ativo
- 96% → cria `hard_limit`, resolve outros
- Volta de 96% pra 60% → todos os alerts ativos viram `resolved_at`
- Idempotente: 2 runs consecutivos não criam duplicatas

### Integration (`apps/server/src/__tests__/`)

**`files-routes.test.ts`** (mock do `@ethra-nexus/db`, padrão `copilot-routes.test.ts`):
- 401 sem JWT
- 403 se role !== 'admin'
- 201 com upload válido — verify row criada + driver chamado
- 413 quando excede `storage_limit_bytes`
- 500 + rollback do driver quando INSERT no DB falha
- 400 com `expires_at` no passado
- Download 200 + bytes corretos + Content-Disposition forçado
- Download 404 quando file não existe ou tenant_id não bate
- Lista filtrada por `mime_type`, paginada
- DELETE 204 + driver.delete chamado + DB row removida

**`copilot-tools-storage.test.ts`:**
- `system_list_storage_alerts` retorna apenas não-resolvidos do tenant
- Filtra por `level` quando passado
- `system_get_storage_usage` retorna totals corretos com/sem `storage_limit_bytes`

**`copilot-health.test.ts`:**
- `banner_alerts` vazio quando não há `hard_limit` ativo
- `banner_alerts` lista o alert quando existe

### Mock driver

`MockStorageDriver` em `__tests__/mock.driver.ts` guarda bytes em Map em memória. Used em todos os testes que tocam handlers (não os que testam `local-fs.driver.test.ts`).

### Target

≥80% line coverage nos arquivos novos. Rodar `NEXUS_MOCK_LLM=true npm run test` (não há LLM nesta spec mas mantém o padrão do projeto).

---

## Smoke test (manual antes de merge)

```
1. Aplicar migration 023 num DB de dev/staging.
   ✓ \d files mostra colunas + índices + trigger updated_at.
   ✓ \d system_alerts mostra unique partial index.
   ✓ SELECT storage_limit_bytes FROM tenants não falha.

2. Backend roda sem erro com FILE_STORAGE_ROOT=/tmp/files-test (não-default).

3. UPDATE tenants SET storage_limit_bytes = 100000 WHERE slug='atitude45';

4. POST /files com xlsx 30KB → 201, response tem id + sha256 + download_url.
   ✓ Arquivo aparece em /tmp/files-test/<tenant>/<id>.
   ✓ Row em files table.
   ✓ Row em audit_log com action='create'.

5. GET <download_url> → 200 + bytes idênticos + Content-Disposition: attachment.

6. POST /files mais 3 vezes pra passar 70% (~75KB total / 100KB limit).
   ✓ Disparar cron manualmente: cria 1 alert soft_warning.
   ✓ Tool system_list_storage_alerts no /copilot retorna o alert.

7. Continuar uploads pra passar 95%.
   ✓ Cron cria hard_limit alert + resolve soft_warning.
   ✓ /copilot/health.banner_alerts lista o hard_limit.
   ✓ Banner vermelho aparece em /copilot.

8. Tentar POST /files com mais 1 arquivo → 413 STORAGE_LIMIT_EXCEEDED.

9. DELETE /files/<id> alguns arquivos → uso volta pra 60%.
   ✓ Cron seta resolved_at em todos os alerts.
   ✓ Banner some, banner_alerts vazio.
   ✓ Tool system_list_storage_alerts retorna [] (default filtra resolved).

10. Cron de cleanup TTL: cria file com expires_at = NOW() + 5min, espera 5min,
    rodar cron → file removido do DB e do disco.

11. Smoke 403: usuário não-admin → todos os endpoints /files retornam 403.
    Hoje todo JWT é admin (auth.ts hardcoded), teste documentado mas
    não executável até refactor de auth.
```

---

## Observabilidade pós-deploy

Logs Pino estruturados (level=info):

- Upload OK: `{ event: 'file_uploaded', file_id, tenant_id, size_bytes }`
- Quota excedida: `{ event: 'quota_exceeded', tenant_id, current_bytes, limit_bytes }`
- Cron run: `{ event: 'storage_cron', files_deleted, alerts_created, alerts_resolved }`
- Driver erro: `{ event: 'driver_error', operation, error }` (level=error)

---

## Estimativa de esforço

Subagent-Driven Development (padrão Spec #1):

| Fase | Estimativa |
|---|---|
| Migration 023 + Drizzle schema + tests | 1 dia |
| `FileStorageDriver` interface + LocalFsDriver + factory + tests | 1.5 dias |
| Routes `/files` (POST/GET/DELETE/list) + tests + audit | 2 dias |
| `computeStorageAlerts` + cron integration + tests | 1.5 dias |
| Tools `system_list_storage_alerts` (real) + `system_get_storage_usage` + tests | 1 dia |
| Endpoint `/copilot/health` extension + frontend banner | 1 dia |
| Smoke test + ajustes finais | 0.5 dia |
| **Total** | **8.5 dias** |

Cada fase pode ser executada em uma session independente via subagent-driven-development. Ordem garante que dependentes existem antes de consumidores.

---

## Apêndice: dependências entre Spec #2 e #3

Spec #3 (Input Worker + Parsers) consome diretamente o que esta spec entrega:

- Widget de attachment no `/copilot` lê `POST /files` (esta spec)
- Tool `parse_file` (Spec #3) lê via `driver.get(storage_key)` ou via `download_url`
- Output Worker (Spec #4) escreve artefatos via `POST /files` com `expires_at` mais longo (ex: 90 dias)
- Spec #5 conecta tudo: AIOS Master delega upload → Input Worker parseia → Output Worker gera artifact → AIOS Master responde com `download_url` clicável

Esta spec NÃO precisa antecipar nenhuma dessas integrações. Os contratos definidos aqui (driver interface + endpoints + table schema) são suficientes.
