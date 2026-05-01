# File Storage + Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar um subsistema de file storage genérico (`FileStorageDriver` + `LocalFsDriver` + 4 endpoints REST) e o subsistema de alerts unificado (`system_alerts` + cron diário + 2 tools no `/copilot` + banner no frontend) seguindo as decisões do spec.

**Architecture:** Storage e alerts são módulos isolados. Storage expõe driver abstrato (filesystem hoje, S3 futuro) com 4 endpoints admin-only. Alerts reusa scheduler existente, popula uma tabela unificada, e ativa a tool stubbed da Spec #1 + adiciona uma nova. Banner do `/copilot` lê extensão do `/copilot/health`.

**Tech Stack:** TypeScript strict, Fastify 5, Drizzle ORM (Postgres), Vitest, React + TanStack Query, scheduler-loop existente em `packages/agents`.

**Spec:** [docs/superpowers/specs/2026-04-29-file-storage-and-alerts.md](../specs/2026-04-29-file-storage-and-alerts.md)

---

## File structure (criada por este plano)

```
packages/db/src/schema/
└── storage.ts                                    ← Task 2

infra/supabase/migrations/
└── 023_files_and_alerts.sql                      ← Task 1

packages/agents/src/lib/storage/
├── driver.ts                                     ← Task 3 (interface)
├── local-fs.driver.ts                            ← Task 4
├── factory.ts                                    ← Task 6
├── index.ts                                      ← Task 7
└── __tests__/
    ├── local-fs.driver.test.ts                   ← Task 4
    ├── mock.driver.ts                            ← Task 5 (helper)
    └── factory.test.ts                           ← Task 6

packages/agents/src/lib/alerts/
├── storage-alerts.ts                             ← Task 12
├── index.ts                                      ← Task 12
└── __tests__/
    └── storage-alerts.test.ts                    ← Task 12

packages/core/src/security/
└── validate.ts                                   ← Task 8 (modify)

apps/server/src/routes/
└── files.ts                                      ← Tasks 9-11

apps/server/src/__tests__/
└── files-routes.test.ts                          ← Tasks 9-11

packages/agents/src/lib/scheduler/
└── scheduler-loop.ts                             ← Task 13 (modify)

packages/agents/src/lib/copilot/tools/
├── list-storage-alerts.ts                        ← Task 14 (rewrite stub)
├── get-storage-usage.ts                          ← Task 15
└── index.ts                                      ← Task 15 (add export)

apps/server/src/routes/
└── copilot.ts                                    ← Task 16 (modify /health)

apps/web/src/components/copilot/
├── HardLimitBanner.tsx                           ← Task 17
└── __tests__/
    └── HardLimitBanner.test.tsx                  ← Task 17

apps/web/src/pages/
└── CopilotPage.tsx                               ← Task 18 (modify)

apps/web/src/hooks/
└── useCopilot.ts                                 ← Task 18 (modify - extend useCopilotHealth)
```

---

## Task 1: Migration 023 SQL — files + system_alerts + tenants column

**Files:**
- Create: `infra/supabase/migrations/023_files_and_alerts.sql`

- [ ] **Step 1: Write migration SQL**

Create `infra/supabase/migrations/023_files_and_alerts.sql`:

```sql
-- Migration 023: file storage + system alerts (Spec #2)
-- Safe: novas tabelas + uma coluna nullable em tenants (sem rewrite, sem default backfill)

-- ── 1. Coluna nova em tenants ─────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS storage_limit_bytes BIGINT
  CHECK (storage_limit_bytes IS NULL OR storage_limit_bytes > 0);
COMMENT ON COLUMN tenants.storage_limit_bytes IS
  'Hard limit em bytes. NULL = ilimitado (default self-hosted).';

-- ── 2. Tabela `files` ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS files (
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

CREATE INDEX IF NOT EXISTS files_tenant_id_idx ON files(tenant_id);
CREATE INDEX IF NOT EXISTS files_tenant_expires_idx ON files(tenant_id, expires_at)
  WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS files_sha256_idx ON files(sha256);

DROP TRIGGER IF EXISTS files_updated_at ON files;
CREATE TRIGGER files_updated_at BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- ── 3. Tabela `system_alerts` ─────────────────────────────────
CREATE TABLE IF NOT EXISTS system_alerts (
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

CREATE UNIQUE INDEX IF NOT EXISTS system_alerts_one_active_idx
  ON system_alerts(tenant_id, category, code)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS system_alerts_tenant_active_idx
  ON system_alerts(tenant_id, resolved_at)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS system_alerts_fired_at_idx ON system_alerts(fired_at DESC);

ALTER TABLE system_alerts ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply migration to dev DB and verify**

Assuming local dev Postgres on `localhost:5432` (or your CI-style Postgres), run:

```bash
psql "$DATABASE_URL" -f infra/supabase/migrations/023_files_and_alerts.sql
```

Expected: zero errors, three `CREATE TABLE` / `ALTER TABLE` / `CREATE INDEX` notices.

Then verify schema:

```bash
psql "$DATABASE_URL" -c "\d files"
psql "$DATABASE_URL" -c "\d system_alerts"
psql "$DATABASE_URL" -c "\d tenants" | grep storage_limit_bytes
```

Expected:
- `files` table with all columns + `files_updated_at` trigger + 3 indexes
- `system_alerts` with the 3 indexes (note: the unique partial appears as `_idx WHERE (resolved_at IS NULL)`)
- `tenants` shows `storage_limit_bytes | bigint`

- [ ] **Step 3: Commit**

```bash
git add infra/supabase/migrations/023_files_and_alerts.sql
git commit -m "feat(db): migration 023 — files + system_alerts + tenants.storage_limit_bytes"
```

---

## Task 2: Drizzle schema — files + systemAlerts + tenants column

**Files:**
- Create: `packages/db/src/schema/storage.ts`
- Modify: `packages/db/src/schema/core.ts` (add `storage_limit_bytes` to `tenants`)
- Modify: `packages/db/src/schema/index.ts` (export storage)

- [ ] **Step 1: Add column to tenants in `core.ts`**

In `packages/db/src/schema/core.ts`, locate the `tenants = pgTable('tenants', { ... })` block and add the new column right before `created_at`:

```typescript
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  password_hash: text('password_hash'),
  plan: text('plan').notNull().default('self-hosted'),
  settings: jsonb('settings').default({}),
  is_active: boolean('is_active').notNull().default(true),
  storage_limit_bytes: bigint('storage_limit_bytes', { mode: 'number' }),  // ← NEW
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
```

Ensure `bigint` is in the imports at the top:

```typescript
import { pgTable, uuid, text, timestamp, jsonb, integer, numeric, boolean, bigint, uniqueIndex, unique, index } from 'drizzle-orm/pg-core'
```

- [ ] **Step 2: Create `packages/db/src/schema/storage.ts`**

```typescript
import { pgTable, uuid, text, timestamp, jsonb, bigint, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { tenants } from './core'

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  storage_key: text('storage_key').notNull(),
  mime_type: text('mime_type').notNull(),
  size_bytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  original_filename: text('original_filename'),
  uploaded_by: text('uploaded_by').notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  filesTenantIdx: index('files_tenant_id_idx').on(table.tenant_id),
  filesSha256Idx: index('files_sha256_idx').on(table.sha256),
  // partial index files_tenant_expires_idx tracked in SQL only — Drizzle doesn't model partial indexes well
}))

export const systemAlerts = pgTable('system_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  category: text('category').notNull(),
  code: text('code').notNull(),
  severity: text('severity').notNull(),  // 'info' | 'warning' | 'critical' enforced by SQL CHECK
  message: text('message').notNull(),
  payload: jsonb('payload').notNull().default({}),
  fired_at: timestamp('fired_at', { withTimezone: true }).defaultNow().notNull(),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  systemAlertsFiredAtIdx: index('system_alerts_fired_at_idx').on(table.fired_at),
  // unique partial index system_alerts_one_active_idx tracked in SQL only
}))
```

- [ ] **Step 3: Export from `index.ts`**

In `packages/db/src/schema/index.ts`, add:

```typescript
export * from './core'
export * from './wiki'
export * from './aios'
export * from './schedules'
export * from './wizard'
export * from './copilot'
export * from './storage'   // ← NEW
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx turbo run typecheck --filter=@ethra-nexus/db
```

Expected: `Tasks: 1 successful` with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/storage.ts packages/db/src/schema/core.ts packages/db/src/schema/index.ts
git commit -m "feat(db): drizzle schema for files + systemAlerts + tenants.storage_limit_bytes"
```

---

## Task 3: FileStorageDriver interface

**Files:**
- Create: `packages/agents/src/lib/storage/driver.ts`

- [ ] **Step 1: Write the interface file**

```typescript
// packages/agents/src/lib/storage/driver.ts

export interface PutResult {
  /** Driver-opaque path that can be passed back to get/delete. */
  storage_key: string
  size_bytes: number
  /** Hex-encoded sha256 of the bytes (64 chars). */
  sha256: string
}

export interface PutArgs {
  tenant_id: string
  /** UUID generated by caller. Driver does NOT generate IDs. */
  file_id: string
  bytes: Buffer | NodeJS.ReadableStream
  mime_type: string
}

export interface GetDownloadUrlOpts {
  ttl_seconds?: number
}

export interface FileStorageDriver {
  /**
   * Persist bytes. Returns metadata required to insert into `files` table.
   * Caller is responsible for quota checks BEFORE calling this.
   * Computes sha256 streaming (no double-read).
   */
  put(args: PutArgs): Promise<PutResult>

  /**
   * Read bytes as a stream. Returns null (no throw) if storage_key does not exist.
   */
  get(storage_key: string): Promise<NodeJS.ReadableStream | null>

  /**
   * Idempotent: never throws if storage_key already does not exist.
   */
  delete(storage_key: string): Promise<void>

  /**
   * URL the client uses to download. LocalFs returns a relative URL (e.g.
   * "/api/v1/files/<id>/download") served by the same backend. S3 will return
   * a presigned external URL.
   */
  getDownloadUrl(storage_key: string, opts?: GetDownloadUrlOpts): Promise<string>
}
```

- [ ] **Step 2: Verify it compiles standalone**

```bash
cd packages/agents && npx tsc --noEmit src/lib/storage/driver.ts
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add packages/agents/src/lib/storage/driver.ts
git commit -m "feat(agents): FileStorageDriver interface"
```

---

## Task 4: LocalFsDriver implementation + tests

**Files:**
- Create: `packages/agents/src/lib/storage/local-fs.driver.ts`
- Test: `packages/agents/src/lib/storage/__tests__/local-fs.driver.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/lib/storage/__tests__/local-fs.driver.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, accessSync, constants as fsc } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { LocalFsDriver } from '../local-fs.driver'

describe('LocalFsDriver', () => {
  let root: string
  let driver: LocalFsDriver

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'localfs-test-'))
    driver = new LocalFsDriver(root)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('put writes bytes and returns metadata', async () => {
    const result = await driver.put({
      tenant_id: 'tenant-1',
      file_id: 'file-1',
      bytes: Buffer.from('hello world'),
      mime_type: 'text/plain',
    })
    expect(result.storage_key).toBe('tenant-1/file-1')
    expect(result.size_bytes).toBe(11)
    expect(result.sha256).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')

    const onDisk = readFileSync(join(root, 'tenant-1', 'file-1'))
    expect(onDisk.toString()).toBe('hello world')
  })

  it('put with empty bytes succeeds', async () => {
    const result = await driver.put({
      tenant_id: 't', file_id: 'f', bytes: Buffer.alloc(0), mime_type: 'application/octet-stream',
    })
    expect(result.size_bytes).toBe(0)
    expect(result.sha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('get returns stream with same bytes', async () => {
    await driver.put({ tenant_id: 't', file_id: 'f', bytes: Buffer.from('abc'), mime_type: 'text/plain' })
    const stream = await driver.get('t/f')
    expect(stream).not.toBeNull()
    const chunks: Buffer[] = []
    for await (const chunk of stream!) chunks.push(chunk as Buffer)
    expect(Buffer.concat(chunks).toString()).toBe('abc')
  })

  it('get returns null for missing key', async () => {
    const result = await driver.get('does/not/exist')
    expect(result).toBeNull()
  })

  it('delete removes file from disk', async () => {
    await driver.put({ tenant_id: 't', file_id: 'f', bytes: Buffer.from('x'), mime_type: 'text/plain' })
    await driver.delete('t/f')
    expect(() => accessSync(join(root, 't', 'f'), fsc.F_OK)).toThrow()
  })

  it('delete is idempotent on missing key', async () => {
    await expect(driver.delete('never/existed')).resolves.toBeUndefined()
  })

  it('getDownloadUrl returns relative API path with file_id', async () => {
    const url = await driver.getDownloadUrl('tenant-1/file-1')
    expect(url).toBe('/api/v1/files/file-1/download')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/agents && npx vitest run src/lib/storage/__tests__/local-fs.driver.test.ts
```

Expected: FAIL — "Cannot find module '../local-fs.driver'".

- [ ] **Step 3: Implement LocalFsDriver**

Create `packages/agents/src/lib/storage/local-fs.driver.ts`:

```typescript
import { promises as fs, createReadStream, createWriteStream } from 'fs'
import { join, dirname } from 'path'
import { createHash } from 'crypto'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { FileStorageDriver, PutArgs, PutResult, GetDownloadUrlOpts } from './driver'

export class LocalFsDriver implements FileStorageDriver {
  constructor(private readonly root: string) {}

  async put(args: PutArgs): Promise<PutResult> {
    const storage_key = `${args.tenant_id}/${args.file_id}`
    const path = join(this.root, storage_key)
    await fs.mkdir(dirname(path), { recursive: true })

    const hash = createHash('sha256')
    let size = 0

    const source: Readable = Buffer.isBuffer(args.bytes)
      ? Readable.from(args.bytes)
      : (args.bytes as Readable)

    // Tee: hash + size counting + write
    source.on('data', (chunk: Buffer) => {
      hash.update(chunk)
      size += chunk.length
    })

    await pipeline(source, createWriteStream(path))

    return {
      storage_key,
      size_bytes: size,
      sha256: hash.digest('hex'),
    }
  }

  async get(storage_key: string): Promise<NodeJS.ReadableStream | null> {
    const path = join(this.root, storage_key)
    try {
      await fs.access(path)
    } catch {
      return null
    }
    return createReadStream(path)
  }

  async delete(storage_key: string): Promise<void> {
    const path = join(this.root, storage_key)
    try {
      await fs.unlink(path)
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException
      if (e.code !== 'ENOENT') throw err
    }
  }

  async getDownloadUrl(storage_key: string, _opts?: GetDownloadUrlOpts): Promise<string> {
    // storage_key is "<tenant_id>/<file_id>"; return path keyed only on file_id
    // since the API endpoint resolves tenant from JWT.
    const file_id = storage_key.split('/').pop()
    return `/api/v1/files/${file_id}/download`
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/agents && npx vitest run src/lib/storage/__tests__/local-fs.driver.test.ts
```

Expected: 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/lib/storage/local-fs.driver.ts packages/agents/src/lib/storage/__tests__/local-fs.driver.test.ts
git commit -m "feat(agents): LocalFsDriver impl + tests"
```

---

## Task 5: MockStorageDriver test helper

**Files:**
- Create: `packages/agents/src/lib/storage/__tests__/mock.driver.ts`

- [ ] **Step 1: Implement MockStorageDriver**

Create `packages/agents/src/lib/storage/__tests__/mock.driver.ts`:

```typescript
import { Readable } from 'stream'
import { createHash } from 'crypto'
import type { FileStorageDriver, PutArgs, PutResult, GetDownloadUrlOpts } from '../driver'

/**
 * In-memory storage driver for tests. Bytes are kept in a Map; never touches disk.
 * Use in route handler tests + alerts tests to avoid filesystem flakiness.
 */
export class MockStorageDriver implements FileStorageDriver {
  public readonly store = new Map<string, Buffer>()

  async put(args: PutArgs): Promise<PutResult> {
    const buf: Buffer = Buffer.isBuffer(args.bytes)
      ? args.bytes
      : await streamToBuffer(args.bytes as Readable)
    const storage_key = `${args.tenant_id}/${args.file_id}`
    this.store.set(storage_key, buf)
    return {
      storage_key,
      size_bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
    }
  }

  async get(storage_key: string): Promise<NodeJS.ReadableStream | null> {
    const buf = this.store.get(storage_key)
    if (!buf) return null
    return Readable.from(buf)
  }

  async delete(storage_key: string): Promise<void> {
    this.store.delete(storage_key)
  }

  async getDownloadUrl(storage_key: string, _opts?: GetDownloadUrlOpts): Promise<string> {
    const file_id = storage_key.split('/').pop()
    return `/api/v1/files/${file_id}/download`
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd packages/agents && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/agents/src/lib/storage/__tests__/mock.driver.ts
git commit -m "test(agents): MockStorageDriver helper"
```

---

## Task 6: Factory + tests

**Files:**
- Create: `packages/agents/src/lib/storage/factory.ts`
- Test: `packages/agents/src/lib/storage/__tests__/factory.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/agents/src/lib/storage/__tests__/factory.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createStorageDriver } from '../factory'
import { LocalFsDriver } from '../local-fs.driver'

describe('createStorageDriver', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.FILE_STORAGE_DRIVER
    delete process.env.FILE_STORAGE_ROOT
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns LocalFsDriver by default', () => {
    const driver = createStorageDriver()
    expect(driver).toBeInstanceOf(LocalFsDriver)
  })

  it('uses FILE_STORAGE_ROOT env when set', () => {
    process.env.FILE_STORAGE_ROOT = '/tmp/custom-root'
    const driver = createStorageDriver()
    expect(driver).toBeInstanceOf(LocalFsDriver)
    // Internal root not directly inspectable; smoke check via getDownloadUrl
    // is enough to know it constructed.
    expect(driver.getDownloadUrl('a/b')).resolves.toBe('/api/v1/files/b/download')
  })

  it('throws on unknown driver', () => {
    process.env.FILE_STORAGE_DRIVER = 'rocket-launchers'
    expect(() => createStorageDriver()).toThrow(/Unknown FILE_STORAGE_DRIVER/)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/agents && npx vitest run src/lib/storage/__tests__/factory.test.ts
```

Expected: FAIL — "Cannot find module '../factory'".

- [ ] **Step 3: Implement the factory**

```typescript
// packages/agents/src/lib/storage/factory.ts
import type { FileStorageDriver } from './driver'
import { LocalFsDriver } from './local-fs.driver'

const DEFAULT_LOCAL_FS_ROOT = '/data/files'

export function createStorageDriver(): FileStorageDriver {
  const driver = process.env['FILE_STORAGE_DRIVER'] ?? 'local-fs'
  switch (driver) {
    case 'local-fs':
      return new LocalFsDriver(process.env['FILE_STORAGE_ROOT'] ?? DEFAULT_LOCAL_FS_ROOT)
    default:
      throw new Error(`Unknown FILE_STORAGE_DRIVER: ${driver}`)
  }
}
```

- [ ] **Step 4: Run tests to verify**

```bash
cd packages/agents && npx vitest run src/lib/storage/__tests__/factory.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/lib/storage/factory.ts packages/agents/src/lib/storage/__tests__/factory.test.ts
git commit -m "feat(agents): createStorageDriver factory + tests"
```

---

## Task 7: Storage module index.ts (public exports)

**Files:**
- Create: `packages/agents/src/lib/storage/index.ts`

- [ ] **Step 1: Write the index**

```typescript
// packages/agents/src/lib/storage/index.ts
export type { FileStorageDriver, PutArgs, PutResult, GetDownloadUrlOpts } from './driver'
export { LocalFsDriver } from './local-fs.driver'
export { createStorageDriver } from './factory'
```

- [ ] **Step 2: Re-export from packages/agents/src/index.ts**

Open `packages/agents/src/index.ts` and add (location: alongside other exports like `lib/copilot`):

```typescript
export * from './lib/storage'
```

- [ ] **Step 3: Verify package builds**

```bash
npx turbo run build --filter=@ethra-nexus/agents
```

Expected: `Tasks: 1 successful` with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/agents/src/lib/storage/index.ts packages/agents/src/index.ts
git commit -m "feat(agents): export storage module from package root"
```

---

## Task 8: Validation helpers in core

**Files:**
- Modify: `packages/core/src/security/validate.ts`

- [ ] **Step 1: Write tests for the new validators**

Append to `packages/core/src/security/__tests__/validate.test.ts` (or create if doesn't exist):

```typescript
import { describe, it, expect } from 'vitest'
import { validateMimeType, validateExpiresAt } from '../validate'

describe('validateMimeType', () => {
  it('accepts standard mime types', () => {
    expect(validateMimeType('application/pdf')).toBe('application/pdf')
    expect(validateMimeType('text/plain')).toBe('text/plain')
    expect(validateMimeType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
      .toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  })

  it('rejects malformed strings', () => {
    expect(() => validateMimeType('')).toThrow()
    expect(() => validateMimeType('no-slash')).toThrow()
    expect(() => validateMimeType('a/b/c')).toThrow()
    expect(() => validateMimeType('UPPER/case')).not.toThrow()  // case-insensitive ok
    expect(() => validateMimeType('text/<script>')).toThrow()
  })
})

describe('validateExpiresAt', () => {
  it('accepts future ISO8601', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    expect(validateExpiresAt(future)).toBeInstanceOf(Date)
  })

  it('rejects past', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    expect(() => validateExpiresAt(past)).toThrow(/in the past/i)
  })

  it('rejects malformed', () => {
    expect(() => validateExpiresAt('not-a-date')).toThrow()
    expect(() => validateExpiresAt('')).toThrow()
  })

  it('returns null when input is null/undefined', () => {
    expect(validateExpiresAt(null)).toBeNull()
    expect(validateExpiresAt(undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/core && npx vitest run src/security/__tests__/validate.test.ts
```

Expected: FAIL — `validateMimeType is not a function` or similar.

- [ ] **Step 3: Implement validators**

Append to `packages/core/src/security/validate.ts`:

```typescript
const MIME_RE = /^[a-z]+\/[a-z0-9\-+.]+$/i

export function validateMimeType(input: string): string {
  if (typeof input !== 'string' || !MIME_RE.test(input)) {
    throw new Error('Invalid mime_type')
  }
  return input
}

export function validateExpiresAt(input: string | null | undefined): Date | null {
  if (input === null || input === undefined) return null
  const d = new Date(input)
  if (isNaN(d.getTime())) {
    throw new Error('Invalid expires_at: must be ISO8601')
  }
  if (d.getTime() <= Date.now() + 60_000) {
    throw new Error('Invalid expires_at: must be at least 1 minute in the future (not in the past)')
  }
  return d
}
```

- [ ] **Step 4: Run tests to verify**

```bash
cd packages/core && npx vitest run src/security/__tests__/validate.test.ts
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/security/validate.ts packages/core/src/security/__tests__/validate.test.ts
git commit -m "feat(core): validateMimeType + validateExpiresAt helpers"
```

---

## Task 9: POST /files endpoint + tests

**Files:**
- Create: `apps/server/src/routes/files.ts`
- Modify: `apps/server/src/app.ts` (register route)
- Create: `apps/server/src/__tests__/files-routes.test.ts`

- [ ] **Step 1: Install multipart plugin**

```bash
cd apps/server && npm install @fastify/multipart
```

Then commit lockfile:

```bash
git add apps/server/package.json package-lock.json
```

(don't commit yet — wait for Step 7)

- [ ] **Step 2: Write the failing test for POST /files**

Create `apps/server/src/__tests__/files-routes.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'

// Mock @ethra-nexus/db with a stubbed db
const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  execute: vi.fn(),
}
vi.mock('@ethra-nexus/db', async () => {
  const actual = await vi.importActual<typeof import('@ethra-nexus/db')>('@ethra-nexus/db')
  return {
    ...actual,
    getDb: () => mockDb,
  }
})

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ c, v })),
  and: vi.fn((...c) => ({ c })),
  or: vi.fn((...c) => ({ c })),
  isNull: vi.fn((c) => ({ isnull: c })),
  isNotNull: vi.fn((c) => ({ isnotnull: c })),
  gt: vi.fn((c, v) => ({ gt: { c, v } })),
  lt: vi.fn((c, v) => ({ lt: { c, v } })),
  desc: vi.fn((c) => ({ desc: c })),
  asc: vi.fn((c) => ({ asc: c })),
  sql: vi.fn((...args) => ({ sql: args })),
}))

// Mock storage driver
const mockDriver = {
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  getDownloadUrl: vi.fn(),
}
vi.mock('@ethra-nexus/agents', async () => {
  const actual = await vi.importActual<typeof import('@ethra-nexus/agents')>('@ethra-nexus/agents')
  return {
    ...actual,
    createStorageDriver: () => mockDriver,
  }
})

const { fileRoutes } = await import('../routes/files')

async function buildApp(userSlug: string, tenantId: string, role: 'admin' | 'member' = 'admin'): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register((await import('@fastify/multipart')).default)
  app.addHook('onRequest', async (request) => {
    request.tenantId = tenantId
    ;(request as { user?: { tenantId: string; slug: string; role: string } }).user = {
      tenantId, slug: userSlug, role,
    }
  })
  await app.register(fileRoutes, { prefix: '/api/v1' })
  return app
}

describe('POST /api/v1/files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects with 403 when role is not admin', async () => {
    const app = await buildApp('user-slug', 'tenant-1', 'member')
    const res = await app.inject({
      method: 'POST', url: '/api/v1/files', payload: 'irrelevant',
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 413 when upload exceeds tenant storage_limit_bytes', async () => {
    const app = await buildApp('s', 'tenant-1', 'admin')
    // Tenant has 1000 bytes limit, currently using 800
    mockDb.select
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ storage_limit_bytes: 1000 }]) }) }) })  // tenant lookup
      .mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve([{ total: 800 }]) }) })  // SUM usage

    // Build a multipart body with 300 bytes of payload (would push to 1100)
    const boundary = '------TestBoundary'
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="big.bin"',
      'Content-Type: application/octet-stream',
      '',
      'X'.repeat(300),
      `--${boundary}--`, '',
    ].join('\r\n')

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(413)
    expect(res.json().error).toBe('STORAGE_LIMIT_EXCEEDED')
    // Driver must NOT have been called
    expect(mockDriver.put).not.toHaveBeenCalled()
  })

  it('returns 201 with file metadata on successful upload', async () => {
    const app = await buildApp('s', 'tenant-1', 'admin')
    mockDb.select
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ storage_limit_bytes: null }]) }) }) })
      .mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve([{ total: 0 }]) }) })

    mockDriver.put.mockResolvedValueOnce({
      storage_key: 'tenant-1/abc',
      size_bytes: 4,
      sha256: '88d4266fd4e6338d13b845fcf289579d209c897823b9217da3e161936f031589',
    })
    mockDriver.getDownloadUrl.mockResolvedValueOnce('/api/v1/files/abc/download')

    mockDb.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 'abc' }]) }),
    })
    // audit_log insert
    mockDb.insert.mockReturnValueOnce({
      values: () => Promise.resolve(),
    })

    const boundary = '------TB'
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="hi.txt"',
      'Content-Type: text/plain',
      '',
      'data',
      `--${boundary}--`, '',
    ].join('\r\n')

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(201)
    const json = res.json()
    expect(json.id).toBe('abc')
    expect(json.size_bytes).toBe(4)
    expect(json.sha256).toBe('88d4266fd4e6338d13b845fcf289579d209c897823b9217da3e161936f031589')
    expect(json.download_url).toBe('/api/v1/files/abc/download')
    expect(mockDriver.put).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd apps/server && npx vitest run src/__tests__/files-routes.test.ts
```

Expected: FAIL — "Cannot find module '../routes/files'".

- [ ] **Step 4: Implement POST handler**

Create `apps/server/src/routes/files.ts`:

```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import multipart from '@fastify/multipart'
import { eq, and, sql, desc } from 'drizzle-orm'
import { getDb, files, tenants, auditLog } from '@ethra-nexus/db'
import { createStorageDriver } from '@ethra-nexus/agents'
import { sanitizeForHtml, validateMimeType, validateExpiresAt } from '@ethra-nexus/core'

declare module 'fastify' {
  interface FastifyRequest {
    userSlug?: string
    userRole?: 'admin' | 'member'
  }
}

async function requireFilesAccess(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as { tenantId?: string; slug?: string; role?: string } | undefined
  if (!user?.slug) return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing JWT' })
  if (user.role !== 'admin') {
    return reply.status(403).send({ error: 'FORBIDDEN', message: 'Files API is admin-only' })
  }
  request.userSlug = user.slug
  request.userRole = user.role as 'admin' | 'member'
}

async function getCurrentUsage(tenantId: string): Promise<number> {
  const db = getDb()
  const rows = await db.execute(sql`
    SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total
    FROM files
    WHERE tenant_id = ${tenantId}
      AND (expires_at IS NULL OR expires_at > NOW())
  `)
  const row = rows.rows[0] as { total: number | string }
  return typeof row.total === 'string' ? parseInt(row.total, 10) : row.total
}

export async function fileRoutes(app: FastifyInstance) {
  // Register multipart only if not already registered
  if (!app.hasContentTypeParser('multipart/form-data')) {
    await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } })
  }
  app.addHook('preHandler', requireFilesAccess)

  // POST /files
  app.post('/files', async (request, reply) => {
    const driver = createStorageDriver()
    const db = getDb()

    const part = await (request as unknown as { file: () => Promise<unknown> }).file()
    if (!part) return reply.status(400).send({ error: 'INVALID_FILE', message: 'Missing file field' })

    const fileLike = part as {
      filename?: string
      mimetype?: string
      toBuffer: () => Promise<Buffer>
      fields?: Record<string, { value?: string }>
    }

    const original_filename_raw = fileLike.filename ?? 'unnamed'
    const original_filename = sanitizeForHtml(original_filename_raw).slice(0, 255)

    let mime_type: string
    try { mime_type = validateMimeType(fileLike.mimetype ?? 'application/octet-stream') }
    catch (e) { return reply.status(400).send({ error: 'INVALID_FILE', message: (e as Error).message }) }

    const expires_at_raw = fileLike.fields?.expires_at?.value
    let expires_at: Date | null
    try { expires_at = validateExpiresAt(expires_at_raw ?? null) }
    catch (e) { return reply.status(400).send({ error: 'INVALID_FILE', message: (e as Error).message }) }

    const buf = await fileLike.toBuffer()
    const size_bytes = buf.length

    // Quota pre-check
    const tenantRows = await db.select({ limit: tenants.storage_limit_bytes })
      .from(tenants)
      .where(eq(tenants.id, request.tenantId))
      .limit(1)
    const limit = tenantRows[0]?.limit ?? null
    if (limit !== null) {
      const current = await getCurrentUsage(request.tenantId)
      if (current + size_bytes > limit) {
        return reply.status(413).send({
          error: 'STORAGE_LIMIT_EXCEEDED',
          message: `Tenant would exceed storage_limit_bytes (${current} + ${size_bytes} > ${limit})`,
        })
      }
    }

    // Generate file_id and persist via driver
    const file_id = crypto.randomUUID()
    let putResult: { storage_key: string; size_bytes: number; sha256: string }
    try {
      putResult = await driver.put({ tenant_id: request.tenantId, file_id, bytes: buf, mime_type })
    } catch (e) {
      request.log.error({ err: e }, 'storage driver put failed')
      return reply.status(500).send({ error: 'STORAGE_DRIVER_ERROR', message: 'Failed to persist bytes' })
    }

    // Insert DB row; rollback on failure
    try {
      await db.insert(files).values({
        id: file_id,
        tenant_id: request.tenantId,
        storage_key: putResult.storage_key,
        mime_type,
        size_bytes: putResult.size_bytes,
        sha256: putResult.sha256,
        original_filename,
        uploaded_by: request.userSlug!,
        expires_at,
      }).returning({ id: files.id })

      await db.insert(auditLog).values({
        tenant_id: request.tenantId,
        entity_type: 'file',
        entity_id: file_id,
        action: 'create',
        actor: request.userSlug!,
        payload: { mime_type, size_bytes: putResult.size_bytes, original_filename },
        user_ip: request.ip,
      })
    } catch (e) {
      await driver.delete(putResult.storage_key).catch(() => undefined)
      request.log.error({ err: e }, 'files insert failed; rolled back driver')
      return reply.status(500).send({ error: 'DB_ERROR', message: 'Failed to record file' })
    }

    const download_url = await driver.getDownloadUrl(putResult.storage_key)
    return reply.status(201).send({
      id: file_id,
      original_filename,
      mime_type,
      size_bytes: putResult.size_bytes,
      sha256: putResult.sha256,
      download_url,
      expires_at: expires_at?.toISOString() ?? null,
    })
  })
}
```

- [ ] **Step 5: Register routes in `app.ts`**

In `apps/server/src/app.ts`, add the import and registration:

```typescript
import { fileRoutes } from './routes/files'

// ... in buildApp(), after other route registrations:
await app.register(fileRoutes, { prefix: '/api/v1' })
```

Also add `'/api/v1/files'` to the `publicPaths` exclusion logic? **No** — files API requires JWT, so it should be in the JWT-protected branch (which it already is by default).

- [ ] **Step 6: Run test to verify**

```bash
cd apps/server && npx vitest run src/__tests__/files-routes.test.ts
```

Expected: 3 passing.

- [ ] **Step 7: Commit**

```bash
git add apps/server/package.json package-lock.json apps/server/src/routes/files.ts apps/server/src/app.ts apps/server/src/__tests__/files-routes.test.ts
git commit -m "feat(server): POST /files endpoint with quota check + audit"
```

---

## Task 10: GET /files/:id/download

**Files:**
- Modify: `apps/server/src/routes/files.ts`
- Modify: `apps/server/src/__tests__/files-routes.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `files-routes.test.ts`:

```typescript
describe('GET /api/v1/files/:id/download', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('streams bytes with Content-Disposition: attachment', async () => {
    const app = await buildApp('s', 'tenant-1', 'admin')
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{
        storage_key: 'tenant-1/abc', mime_type: 'text/plain', original_filename: 'file.txt',
      }]) }) })
    })
    const { Readable } = await import('stream')
    mockDriver.get.mockResolvedValueOnce(Readable.from(Buffer.from('hello')))

    const res = await app.inject({ method: 'GET', url: '/api/v1/files/abc/download' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.headers['content-disposition']).toContain('file.txt')
    expect(res.body).toBe('hello')
  })

  it('returns 404 when file does not exist or tenant mismatches', async () => {
    const app = await buildApp('s', 'tenant-1', 'admin')
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) })
    })
    const res = await app.inject({ method: 'GET', url: '/api/v1/files/missing/download' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('FILE_NOT_FOUND')
  })

  it('returns 500 STORAGE_ORPHAN when row exists but driver get returns null', async () => {
    const app = await buildApp('s', 'tenant-1', 'admin')
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{
        storage_key: 'tenant-1/abc', mime_type: 'text/plain', original_filename: 'file.txt',
      }]) }) })
    })
    mockDriver.get.mockResolvedValueOnce(null)

    const res = await app.inject({ method: 'GET', url: '/api/v1/files/abc/download' })
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toBe('STORAGE_ORPHAN')
  })
})
```

- [ ] **Step 2: Run test to confirm fail**

```bash
cd apps/server && npx vitest run src/__tests__/files-routes.test.ts -t "GET /api/v1/files"
```

Expected: 3 failing.

- [ ] **Step 3: Add handler in `files.ts`**

Inside `fileRoutes(app)`, add after the POST handler:

```typescript
  // GET /files/:id/download
  app.get<{ Params: { id: string } }>('/files/:id/download', async (request, reply) => {
    const db = getDb()
    const driver = createStorageDriver()
    const rows = await db.select({
      storage_key: files.storage_key,
      mime_type: files.mime_type,
      original_filename: files.original_filename,
    }).from(files)
      .where(and(eq(files.id, request.params.id), eq(files.tenant_id, request.tenantId)))
      .limit(1)

    const row = rows[0]
    if (!row) return reply.status(404).send({ error: 'FILE_NOT_FOUND', message: 'File not found' })

    const stream = await driver.get(row.storage_key)
    if (!stream) {
      request.log.error({ storage_key: row.storage_key }, 'STORAGE_ORPHAN — db row without driver bytes')
      return reply.status(500).send({ error: 'STORAGE_ORPHAN', message: 'File metadata exists but bytes missing' })
    }

    const filename = row.original_filename ?? 'file'
    reply.header('Content-Type', row.mime_type)
    reply.header('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`)
    return reply.send(stream)
  })
```

- [ ] **Step 4: Run tests to verify**

```bash
cd apps/server && npx vitest run src/__tests__/files-routes.test.ts -t "GET /api/v1/files"
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/files.ts apps/server/src/__tests__/files-routes.test.ts
git commit -m "feat(server): GET /files/:id/download stream + tenant scoping"
```

---

## Task 11: GET /files (list) + DELETE /files/:id

**Files:**
- Modify: `apps/server/src/routes/files.ts`
- Modify: `apps/server/src/__tests__/files-routes.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `files-routes.test.ts`:

```typescript
describe('GET /api/v1/files (list)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('lists files filtered by tenant with default pagination', async () => {
    const app = await buildApp('s', 'tenant-1', 'admin')
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ offset: () => Promise.resolve([
        { id: 'a', original_filename: 'f.txt', mime_type: 'text/plain', size_bytes: 5, expires_at: null, created_at: new Date() },
      ]) }) }) }) })
    })
    const res = await app.inject({ method: 'GET', url: '/api/v1/files' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('clamps limit to 200', async () => {
    const app = await buildApp('s', 'tenant-1', 'admin')
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ offset: () => Promise.resolve([]) }) }) }) })
    })
    const res = await app.inject({ method: 'GET', url: '/api/v1/files?limit=10000' })
    expect(res.statusCode).toBe(200)
    // hard to assert internal clamp without inspecting; smoke check it doesn't error
  })
})

describe('DELETE /api/v1/files/:id', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 204 and calls driver.delete', async () => {
    const app = await buildApp('s', 'tenant-1', 'admin')
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{ storage_key: 'tenant-1/abc' }]) }) })
    })
    mockDb.delete.mockReturnValueOnce({ where: () => Promise.resolve() })
    mockDb.insert.mockReturnValueOnce({ values: () => Promise.resolve() }) // audit
    mockDriver.delete.mockResolvedValueOnce(undefined)

    const res = await app.inject({ method: 'DELETE', url: '/api/v1/files/abc' })
    expect(res.statusCode).toBe(204)
    expect(mockDriver.delete).toHaveBeenCalledWith('tenant-1/abc')
  })

  it('returns 404 when file not found', async () => {
    const app = await buildApp('s', 'tenant-1', 'admin')
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) })
    })
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/files/missing' })
    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests to confirm fail**

```bash
cd apps/server && npx vitest run src/__tests__/files-routes.test.ts -t "list|DELETE"
```

Expected: 4 failing.

- [ ] **Step 3: Add handlers in `files.ts`**

Inside `fileRoutes(app)`, after the GET download handler, add:

```typescript
  // GET /files (list with optional filters)
  app.get<{ Querystring: { limit?: string; offset?: string; mime_type?: string } }>(
    '/files',
    async (request) => {
      const db = getDb()
      const limit = Math.min(Math.max(parseInt(request.query.limit ?? '50', 10) || 50, 1), 200)
      const offset = Math.max(parseInt(request.query.offset ?? '0', 10) || 0, 0)

      const where = request.query.mime_type
        ? and(eq(files.tenant_id, request.tenantId), eq(files.mime_type, request.query.mime_type))
        : eq(files.tenant_id, request.tenantId)

      const rows = await db.select({
        id: files.id,
        original_filename: files.original_filename,
        mime_type: files.mime_type,
        size_bytes: files.size_bytes,
        sha256: files.sha256,
        expires_at: files.expires_at,
        created_at: files.created_at,
      })
        .from(files)
        .where(where)
        .orderBy(desc(files.created_at))
        .limit(limit)
        .offset(offset)

      return { data: rows }
    },
  )

  // DELETE /files/:id
  app.delete<{ Params: { id: string } }>('/files/:id', async (request, reply) => {
    const db = getDb()
    const driver = createStorageDriver()

    const rows = await db.select({ storage_key: files.storage_key })
      .from(files)
      .where(and(eq(files.id, request.params.id), eq(files.tenant_id, request.tenantId)))
      .limit(1)
    const row = rows[0]
    if (!row) return reply.status(404).send({ error: 'FILE_NOT_FOUND', message: 'File not found' })

    await db.delete(files).where(eq(files.id, request.params.id))
    await driver.delete(row.storage_key).catch((e) => {
      request.log.warn({ err: e }, 'driver.delete failed; row already removed (orphan in storage)')
    })
    await db.insert(auditLog).values({
      tenant_id: request.tenantId,
      entity_type: 'file',
      entity_id: request.params.id,
      action: 'delete',
      actor: request.userSlug!,
      payload: {},
      user_ip: request.ip,
    })

    return reply.status(204).send()
  })
```

- [ ] **Step 4: Run all files-routes tests**

```bash
cd apps/server && npx vitest run src/__tests__/files-routes.test.ts
```

Expected: 9-10 tests passing total.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/files.ts apps/server/src/__tests__/files-routes.test.ts
git commit -m "feat(server): GET /files (list) + DELETE /files/:id with audit"
```

---

## Task 12: storage-alerts logic + tests

**Files:**
- Create: `packages/agents/src/lib/alerts/storage-alerts.ts`
- Create: `packages/agents/src/lib/alerts/index.ts`
- Test: `packages/agents/src/lib/alerts/__tests__/storage-alerts.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/agents/src/lib/alerts/__tests__/storage-alerts.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  execute: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}
vi.mock('@ethra-nexus/db', async () => {
  const actual = await vi.importActual<typeof import('@ethra-nexus/db')>('@ethra-nexus/db')
  return { ...actual, getDb: () => mockDb }
})
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ eq: { c, v } })),
  and: vi.fn((...c) => ({ and: c })),
  isNull: vi.fn((c) => ({ isnull: c })),
  sql: vi.fn((parts, ...vals) => ({ sql: { parts, vals } })),
}))

const { computeStorageAlerts } = await import('../storage-alerts')

describe('computeStorageAlerts', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('does nothing for tenants without storage_limit_bytes', async () => {
    mockDb.execute.mockResolvedValueOnce({ rows: [] })  // no tenants with limit
    const stats = await computeStorageAlerts()
    expect(stats.created).toBe(0)
    expect(stats.resolved).toBe(0)
  })

  it('creates soft_warning at 75%', async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ tenant_id: 't1', limit: 1000 }] })  // tenants
      .mockResolvedValueOnce({ rows: [{ total: 750 }] })                    // usage
      .mockResolvedValueOnce({ rows: [] })                                  // existing active alerts
      .mockResolvedValueOnce({ rows: [] })                                  // insert returning
    const stats = await computeStorageAlerts()
    expect(stats.created).toBe(1)
    expect(stats.resolved).toBe(0)
  })

  it('upgrades soft_warning to migration_recommended at 90%', async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ tenant_id: 't1', limit: 1000 }] })
      .mockResolvedValueOnce({ rows: [{ total: 900 }] })
      .mockResolvedValueOnce({ rows: [{ code: 'soft_warning', id: 'a1' }] })  // soft_warning is active
      .mockResolvedValueOnce({ rows: [] })  // insert migration_recommended
      .mockResolvedValueOnce({ rows: [] })  // resolve soft_warning
    const stats = await computeStorageAlerts()
    expect(stats.created).toBe(1)
    expect(stats.resolved).toBe(1)
  })

  it('resolves all alerts when usage drops below 70%', async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ tenant_id: 't1', limit: 1000 }] })
      .mockResolvedValueOnce({ rows: [{ total: 600 }] })
      .mockResolvedValueOnce({ rows: [
        { code: 'soft_warning', id: 'a1' },
        { code: 'hard_limit', id: 'a2' },
      ] })
      .mockResolvedValueOnce({ rows: [] })  // resolve all
    const stats = await computeStorageAlerts()
    expect(stats.created).toBe(0)
    expect(stats.resolved).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to confirm fail**

```bash
cd packages/agents && npx vitest run src/lib/alerts/__tests__/storage-alerts.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `computeStorageAlerts`**

```typescript
// packages/agents/src/lib/alerts/storage-alerts.ts
import { sql } from 'drizzle-orm'
import { getDb } from '@ethra-nexus/db'

export interface StorageAlertStats {
  tenants_processed: number
  created: number
  resolved: number
}

const SEVERITY: Record<string, 'info' | 'warning' | 'critical'> = {
  soft_warning: 'info',
  migration_recommended: 'warning',
  hard_limit: 'critical',
}

const CODES = ['soft_warning', 'migration_recommended', 'hard_limit'] as const
type StorageCode = typeof CODES[number]

function codeForPct(pct: number): StorageCode | null {
  if (pct >= 0.95) return 'hard_limit'
  if (pct >= 0.85) return 'migration_recommended'
  if (pct >= 0.70) return 'soft_warning'
  return null
}

export async function computeStorageAlerts(): Promise<StorageAlertStats> {
  const db = getDb()
  const stats: StorageAlertStats = { tenants_processed: 0, created: 0, resolved: 0 }

  const tenantsRes = await db.execute(sql`
    SELECT id AS tenant_id, storage_limit_bytes AS "limit"
    FROM tenants
    WHERE storage_limit_bytes IS NOT NULL
  `)

  for (const row of tenantsRes.rows as Array<{ tenant_id: string; limit: number | string }>) {
    const tenant_id = row.tenant_id
    const limit = typeof row.limit === 'string' ? parseInt(row.limit, 10) : row.limit
    if (!limit || limit <= 0) continue
    stats.tenants_processed++

    const usageRes = await db.execute(sql`
      SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total
      FROM files
      WHERE tenant_id = ${tenant_id}
        AND (expires_at IS NULL OR expires_at > NOW())
    `)
    const usageRow = usageRes.rows[0] as { total: number | string }
    const current_bytes = typeof usageRow.total === 'string' ? parseInt(usageRow.total, 10) : usageRow.total
    const pct = current_bytes / limit
    const target = codeForPct(pct)

    const activeRes = await db.execute(sql`
      SELECT id, code FROM system_alerts
      WHERE tenant_id = ${tenant_id} AND category = 'storage' AND resolved_at IS NULL
    `)
    const activeRows = activeRes.rows as Array<{ id: string; code: string }>
    const activeCodes = new Set(activeRows.map(r => r.code))

    // Create target alert if it doesn't exist
    if (target && !activeCodes.has(target)) {
      await db.execute(sql`
        INSERT INTO system_alerts (tenant_id, category, code, severity, message, payload)
        VALUES (${tenant_id}, 'storage', ${target}, ${SEVERITY[target]},
                ${`Storage usage at ${(pct * 100).toFixed(1)}% — ${target}`},
                ${JSON.stringify({ current_bytes, limit_bytes: limit, pct })}::jsonb)
        ON CONFLICT DO NOTHING
      `)
      stats.created++
    }

    // Resolve any active code that is not the target
    const obsoleteIds = activeRows.filter(r => r.code !== target).map(r => r.id)
    if (obsoleteIds.length > 0) {
      await db.execute(sql`
        UPDATE system_alerts SET resolved_at = NOW()
        WHERE id = ANY(${obsoleteIds}::uuid[])
      `)
      stats.resolved += obsoleteIds.length
    }
  }

  return stats
}
```

- [ ] **Step 4: Create `index.ts`**

```typescript
// packages/agents/src/lib/alerts/index.ts
export { computeStorageAlerts } from './storage-alerts'
export type { StorageAlertStats } from './storage-alerts'
```

Add to `packages/agents/src/index.ts`:

```typescript
export * from './lib/alerts'
```

- [ ] **Step 5: Run tests to verify**

```bash
cd packages/agents && npx vitest run src/lib/alerts/__tests__/storage-alerts.test.ts
```

Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/lib/alerts/ packages/agents/src/index.ts
git commit -m "feat(agents): computeStorageAlerts with 70/85/95 thresholds + tests"
```

---

## Task 13: cleanupExpiredFiles + cron integration

**Files:**
- Create: `packages/agents/src/lib/storage/cleanup.ts`
- Modify: `packages/agents/src/lib/scheduler/scheduler-loop.ts`

- [ ] **Step 1: Write tests for cleanupExpiredFiles**

Create `packages/agents/src/lib/storage/__tests__/cleanup.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MockStorageDriver } from './mock.driver'

const mockDb = { execute: vi.fn() }
vi.mock('@ethra-nexus/db', async () => {
  const actual = await vi.importActual<typeof import('@ethra-nexus/db')>('@ethra-nexus/db')
  return { ...actual, getDb: () => mockDb }
})
vi.mock('drizzle-orm', () => ({ sql: vi.fn((parts, ...vals) => ({ sql: { parts, vals } })) }))

const { cleanupExpiredFiles } = await import('../cleanup')

describe('cleanupExpiredFiles', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 0 when no expired files', async () => {
    const driver = new MockStorageDriver()
    mockDb.execute
      .mockResolvedValueOnce({ rows: [] })  // SELECT expired
    const count = await cleanupExpiredFiles(driver)
    expect(count).toBe(0)
  })

  it('deletes from driver and DB for each expired file', async () => {
    const driver = new MockStorageDriver()
    driver.store.set('t1/f1', Buffer.from('data1'))
    driver.store.set('t1/f2', Buffer.from('data2'))
    mockDb.execute
      .mockResolvedValueOnce({ rows: [
        { id: 'f1', tenant_id: 't1', storage_key: 't1/f1' },
        { id: 'f2', tenant_id: 't1', storage_key: 't1/f2' },
      ] })
      .mockResolvedValueOnce({ rows: [] })  // DELETE rows
    const count = await cleanupExpiredFiles(driver)
    expect(count).toBe(2)
    expect(driver.store.has('t1/f1')).toBe(false)
    expect(driver.store.has('t1/f2')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to confirm fail**

```bash
cd packages/agents && npx vitest run src/lib/storage/__tests__/cleanup.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cleanupExpiredFiles`**

Create `packages/agents/src/lib/storage/cleanup.ts`:

```typescript
import { sql } from 'drizzle-orm'
import { getDb } from '@ethra-nexus/db'
import type { FileStorageDriver } from './driver'

/**
 * Removes files where expires_at < NOW. Deletes from driver first (best effort)
 * then from DB. Returns number of files removed.
 */
export async function cleanupExpiredFiles(driver: FileStorageDriver): Promise<number> {
  const db = getDb()
  const res = await db.execute(sql`
    SELECT id, tenant_id, storage_key
    FROM files
    WHERE expires_at IS NOT NULL AND expires_at < NOW()
    LIMIT 500
  `)
  const rows = res.rows as Array<{ id: string; tenant_id: string; storage_key: string }>
  if (rows.length === 0) return 0

  for (const row of rows) {
    await driver.delete(row.storage_key).catch(() => undefined)  // best-effort
  }

  const ids = rows.map(r => r.id)
  await db.execute(sql`DELETE FROM files WHERE id = ANY(${ids}::uuid[])`)
  return rows.length
}
```

Export from `packages/agents/src/lib/storage/index.ts`:

```typescript
export { cleanupExpiredFiles } from './cleanup'
```

- [ ] **Step 4: Run tests to verify**

```bash
cd packages/agents && npx vitest run src/lib/storage/__tests__/cleanup.test.ts
```

Expected: 2 passing.

- [ ] **Step 5: Wire to scheduler-loop**

Open `packages/agents/src/lib/scheduler/scheduler-loop.ts`. Find where the existing loop runs scheduled tasks. Add a daily-maintenance hook that runs cleanup + alerts.

Add at top of file:

```typescript
import { createStorageDriver, cleanupExpiredFiles } from '../storage'
import { computeStorageAlerts } from '../alerts'
```

Add a maintenance function:

```typescript
let lastMaintenanceAt: number = 0
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000  // 24h

async function runDailyMaintenanceIfDue(): Promise<void> {
  const now = Date.now()
  if (now - lastMaintenanceAt < MAINTENANCE_INTERVAL_MS) return
  lastMaintenanceAt = now
  try {
    const driver = createStorageDriver()
    const files_deleted = await cleanupExpiredFiles(driver)
    const alerts = await computeStorageAlerts()
    console.log('[scheduler] daily maintenance:', { files_deleted, alerts })
  } catch (e) {
    console.error('[scheduler] maintenance failed:', e)
  }
}
```

In the existing scheduler tick (the function that runs every N seconds), add `await runDailyMaintenanceIfDue()` near the start.

- [ ] **Step 6: Verify build**

```bash
npx turbo run build --filter=@ethra-nexus/agents
```

Expected: success.

- [ ] **Step 7: Commit**

```bash
git add packages/agents/src/lib/storage/cleanup.ts packages/agents/src/lib/storage/__tests__/cleanup.test.ts packages/agents/src/lib/storage/index.ts packages/agents/src/lib/scheduler/scheduler-loop.ts
git commit -m "feat(agents): cleanupExpiredFiles + daily maintenance in scheduler"
```

---

## Task 14: Activate `system_list_storage_alerts` tool (replace stub)

**Files:**
- Modify: `packages/agents/src/lib/copilot/tools/list-storage-alerts.ts`

- [ ] **Step 1: Write tests**

Create `packages/agents/src/lib/copilot/tools/__tests__/list-storage-alerts.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = { select: vi.fn() }
vi.mock('@ethra-nexus/db', async () => {
  const actual = await vi.importActual<typeof import('@ethra-nexus/db')>('@ethra-nexus/db')
  return { ...actual, getDb: () => mockDb }
})
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ eq: { c, v } })),
  and: vi.fn((...c) => ({ and: c.filter(Boolean) })),
  isNull: vi.fn((c) => ({ isnull: c })),
  desc: vi.fn((c) => ({ desc: c })),
}))

const { listStorageAlertsTool } = await import('../list-storage-alerts')

describe('system_list_storage_alerts', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns active alerts for the tenant', async () => {
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ orderBy: () => Promise.resolve([
        { code: 'soft_warning', severity: 'info', message: 'm', payload: { pct: 0.75 }, fired_at: new Date() },
      ]) }) })
    })
    const result = await listStorageAlertsTool.handler({}, { tenant_id: 't1', user_id: 'u', user_role: 'admin' })
    expect(result.alerts).toHaveLength(1)
    expect(result.alerts[0].code).toBe('soft_warning')
  })

  it('filters by level when passed', async () => {
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) })
    })
    const result = await listStorageAlertsTool.handler({ level: 'hard_limit' }, { tenant_id: 't1', user_id: 'u', user_role: 'admin' })
    expect(result.alerts).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to confirm current stub returns wrong shape**

```bash
cd packages/agents && npx vitest run src/lib/copilot/tools/__tests__/list-storage-alerts.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Replace stub with real implementation**

Replace `packages/agents/src/lib/copilot/tools/list-storage-alerts.ts` content:

```typescript
import { eq, and, isNull, desc } from 'drizzle-orm'
import { getDb, systemAlerts } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

interface Input {
  level?: 'soft_warning' | 'migration_recommended' | 'hard_limit'
}

interface AlertView {
  code: string
  severity: string
  message: string
  payload: unknown
  fired_at: Date
}

interface Output {
  alerts: AlertView[]
}

export const listStorageAlertsTool: CopilotTool<Input, Output> = {
  name: 'system:list_storage_alerts',
  description: 'Lista alertas ativos de storage do tenant. Retorna apenas não-resolvidos. Pode filtrar por level (soft_warning, migration_recommended, hard_limit).',
  input_schema: {
    type: 'object',
    properties: {
      level: {
        type: 'string',
        enum: ['soft_warning', 'migration_recommended', 'hard_limit'],
        description: 'Filtra apenas alerts deste código.',
      },
    },
  },
  permission: 'admin_only',
  handler: async (input, ctx) => {
    const db = getDb()
    const conditions = [
      eq(systemAlerts.tenant_id, ctx.tenant_id),
      eq(systemAlerts.category, 'storage'),
      isNull(systemAlerts.resolved_at),
    ]
    if (input.level) conditions.push(eq(systemAlerts.code, input.level))

    const rows = await db.select({
      code: systemAlerts.code,
      severity: systemAlerts.severity,
      message: systemAlerts.message,
      payload: systemAlerts.payload,
      fired_at: systemAlerts.fired_at,
    })
      .from(systemAlerts)
      .where(and(...conditions))
      .orderBy(desc(systemAlerts.fired_at))

    return { alerts: rows as AlertView[] }
  },
}
```

- [ ] **Step 4: Run tests to verify**

```bash
cd packages/agents && npx vitest run src/lib/copilot/tools/__tests__/list-storage-alerts.test.ts
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/lib/copilot/tools/list-storage-alerts.ts packages/agents/src/lib/copilot/tools/__tests__/list-storage-alerts.test.ts
git commit -m "feat(copilot): activate system:list_storage_alerts (real impl)"
```

---

## Task 15: New tool `system_get_storage_usage`

**Files:**
- Create: `packages/agents/src/lib/copilot/tools/get-storage-usage.ts`
- Modify: `packages/agents/src/lib/copilot/tools/index.ts`
- Test: `packages/agents/src/lib/copilot/tools/__tests__/get-storage-usage.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/agents/src/lib/copilot/tools/__tests__/get-storage-usage.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = { execute: vi.fn() }
vi.mock('@ethra-nexus/db', async () => {
  const actual = await vi.importActual<typeof import('@ethra-nexus/db')>('@ethra-nexus/db')
  return { ...actual, getDb: () => mockDb }
})
vi.mock('drizzle-orm', () => ({ sql: vi.fn((parts, ...vals) => ({ sql: { parts, vals } })) }))

const { getStorageUsageTool } = await import('../get-storage-usage')

describe('system_get_storage_usage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns usage with limit and pct', async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ total: 5000, file_count: 10 }] })
      .mockResolvedValueOnce({ rows: [{ limit: 10000 }] })
      .mockResolvedValueOnce({ rows: [
        { code: 'soft_warning', count: 1 },
      ] })
    const result = await getStorageUsageTool.handler({}, { tenant_id: 't', user_id: 'u', user_role: 'admin' })
    expect(result.total_bytes).toBe(5000)
    expect(result.file_count).toBe(10)
    expect(result.limit_bytes).toBe(10000)
    expect(result.pct_used).toBe(0.5)
    expect(result.alerts_active.soft_warning).toBe(1)
    expect(result.alerts_active.hard_limit).toBe(0)
  })

  it('returns null pct when no limit set', async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ total: 100, file_count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ limit: null }] })
      .mockResolvedValueOnce({ rows: [] })
    const result = await getStorageUsageTool.handler({}, { tenant_id: 't', user_id: 'u', user_role: 'admin' })
    expect(result.limit_bytes).toBeNull()
    expect(result.pct_used).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to confirm fail**

```bash
cd packages/agents && npx vitest run src/lib/copilot/tools/__tests__/get-storage-usage.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tool**

```typescript
// packages/agents/src/lib/copilot/tools/get-storage-usage.ts
import { sql } from 'drizzle-orm'
import { getDb } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

interface Output {
  total_bytes: number
  file_count: number
  limit_bytes: number | null
  pct_used: number | null
  alerts_active: { soft_warning: number; migration_recommended: number; hard_limit: number }
}

export const getStorageUsageTool: CopilotTool<Record<string, never>, Output> = {
  name: 'system:get_storage_usage',
  description: 'Retorna uso atual de storage do tenant (bytes, file_count, % do limite, contagem de alertas ativos por código).',
  input_schema: { type: 'object', properties: {} },
  permission: 'admin_only',
  handler: async (_input, ctx) => {
    const db = getDb()

    const usageRes = await db.execute(sql`
      SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total,
             COUNT(*)::int AS file_count
      FROM files
      WHERE tenant_id = ${ctx.tenant_id}
        AND (expires_at IS NULL OR expires_at > NOW())
    `)
    const usage = usageRes.rows[0] as { total: number | string; file_count: number }
    const total_bytes = typeof usage.total === 'string' ? parseInt(usage.total, 10) : usage.total
    const file_count = usage.file_count

    const limitRes = await db.execute(sql`
      SELECT storage_limit_bytes AS "limit" FROM tenants WHERE id = ${ctx.tenant_id}
    `)
    const limitRaw = (limitRes.rows[0] as { limit: number | string | null }).limit
    const limit_bytes: number | null = limitRaw === null ? null
      : typeof limitRaw === 'string' ? parseInt(limitRaw, 10) : limitRaw
    const pct_used = limit_bytes ? total_bytes / limit_bytes : null

    const alertsRes = await db.execute(sql`
      SELECT code, COUNT(*)::int AS count
      FROM system_alerts
      WHERE tenant_id = ${ctx.tenant_id}
        AND category = 'storage'
        AND resolved_at IS NULL
      GROUP BY code
    `)
    const alerts_active = { soft_warning: 0, migration_recommended: 0, hard_limit: 0 }
    for (const row of alertsRes.rows as Array<{ code: string; count: number }>) {
      if (row.code in alerts_active) {
        (alerts_active as Record<string, number>)[row.code] = row.count
      }
    }

    return { total_bytes, file_count, limit_bytes, pct_used, alerts_active }
  },
}
```

- [ ] **Step 4: Add to tools registry**

In `packages/agents/src/lib/copilot/tools/index.ts`, add:

```typescript
import { getStorageUsageTool } from './get-storage-usage'

export const allCopilotTools: CopilotTool[] = [
  // ... existing tools ...
  getStorageUsageTool,  // ← NEW
] as CopilotTool[]
```

- [ ] **Step 5: Run tests to verify**

```bash
cd packages/agents && npx vitest run src/lib/copilot/tools/__tests__/get-storage-usage.test.ts
```

Expected: 2 passing.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/lib/copilot/tools/get-storage-usage.ts packages/agents/src/lib/copilot/tools/__tests__/get-storage-usage.test.ts packages/agents/src/lib/copilot/tools/index.ts
git commit -m "feat(copilot): system:get_storage_usage tool"
```

---

## Task 16: Extend /copilot/health with banner_alerts

**Files:**
- Modify: `apps/server/src/routes/copilot.ts`
- Modify: `apps/server/src/__tests__/copilot-routes.test.ts`

- [ ] **Step 1: Add failing test**

Append to `apps/server/src/__tests__/copilot-routes.test.ts`:

```typescript
describe('GET /api/v1/copilot/health (banner_alerts)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns empty banner_alerts when no hard_limit is active', async () => {
    const app = await buildApp('s', 'tenant-1', 'admin')
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => Promise.resolve([]) })
    })
    const res = await app.inject({ method: 'GET', url: '/api/v1/copilot/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json().banner_alerts).toEqual([])
  })

  it('returns active hard_limit alerts in banner_alerts', async () => {
    const app = await buildApp('s', 'tenant-1', 'admin')
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => Promise.resolve([
        { id: 'a1', category: 'storage', code: 'hard_limit', severity: 'critical',
          message: 'Storage at 96%', fired_at: new Date('2026-04-29') },
      ]) })
    })
    const res = await app.inject({ method: 'GET', url: '/api/v1/copilot/health' })
    const banner = res.json().banner_alerts
    expect(banner).toHaveLength(1)
    expect(banner[0].code).toBe('hard_limit')
  })
})
```

- [ ] **Step 2: Run test to confirm fail**

```bash
cd apps/server && npx vitest run src/__tests__/copilot-routes.test.ts -t "banner_alerts"
```

Expected: FAIL — `banner_alerts` is undefined.

- [ ] **Step 3: Modify the /health handler**

In `apps/server/src/routes/copilot.ts`, find the `app.get('/copilot/health', ...)` handler and replace it:

```typescript
  app.get('/copilot/health', async (request) => {
    const db = getDb()
    const banner_rows = await db.select({
      id: systemAlerts.id,
      category: systemAlerts.category,
      code: systemAlerts.code,
      severity: systemAlerts.severity,
      message: systemAlerts.message,
      fired_at: systemAlerts.fired_at,
    })
      .from(systemAlerts)
      .where(and(
        eq(systemAlerts.tenant_id, request.tenantId),
        eq(systemAlerts.category, 'storage'),
        eq(systemAlerts.code, 'hard_limit'),
        isNull(systemAlerts.resolved_at),
      ))

    return {
      ok: true,
      user_slug: request.userSlug,
      role: request.userRole,
      banner_alerts: banner_rows,
    }
  })
```

Add `systemAlerts` and `isNull` to the imports at the top:

```typescript
import { eq, and, asc, desc, isNull } from 'drizzle-orm'
import {
  getDb, copilotConversations, copilotMessages, agents, systemAlerts,
} from '@ethra-nexus/db'
```

- [ ] **Step 4: Run tests to verify**

```bash
cd apps/server && npx vitest run src/__tests__/copilot-routes.test.ts -t "banner_alerts"
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/copilot.ts apps/server/src/__tests__/copilot-routes.test.ts
git commit -m "feat(copilot): extend /copilot/health with banner_alerts (storage hard_limit only)"
```

---

## Task 17: HardLimitBanner component + tests

**Files:**
- Create: `apps/web/src/components/copilot/HardLimitBanner.tsx`
- Test: `apps/web/src/components/copilot/__tests__/HardLimitBanner.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/copilot/__tests__/HardLimitBanner.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HardLimitBanner } from '../HardLimitBanner'

describe('HardLimitBanner', () => {
  it('renders nothing when alerts is empty', () => {
    const { container } = render(<HardLimitBanner alerts={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders banner when there is at least one alert', () => {
    render(<HardLimitBanner alerts={[
      { id: 'a1', category: 'storage', code: 'hard_limit', severity: 'critical',
        message: 'Storage at 96%', fired_at: '2026-04-29T10:00:00Z' },
    ]} />)
    expect(screen.getByText(/Storage at 96%/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to confirm fail**

```bash
cd apps/web && npx vitest run src/components/copilot/__tests__/HardLimitBanner.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// apps/web/src/components/copilot/HardLimitBanner.tsx
import { AlertTriangle } from 'lucide-react'

export interface BannerAlert {
  id: string
  category: string
  code: string
  severity: string
  message: string
  fired_at: string
}

interface Props {
  alerts: BannerAlert[]
}

export function HardLimitBanner({ alerts }: Props) {
  if (alerts.length === 0) return null

  return (
    <div role="alert" className="bg-red-50 border-b border-red-200 px-5 py-3 flex items-start gap-3">
      <AlertTriangle size={18} strokeWidth={1.5} className="text-red-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-red-800">
          {alerts.length === 1 ? 'Alerta crítico ativo' : `${alerts.length} alertas críticos ativos`}
        </div>
        <ul className="mt-1 space-y-0.5 text-[12px] text-red-700">
          {alerts.map(a => (
            <li key={a.id}>{a.message}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify**

```bash
cd apps/web && npx vitest run src/components/copilot/__tests__/HardLimitBanner.test.tsx
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/copilot/HardLimitBanner.tsx apps/web/src/components/copilot/__tests__/HardLimitBanner.test.tsx
git commit -m "feat(web): HardLimitBanner component"
```

---

## Task 18: Integrate banner in CopilotPage

**Files:**
- Modify: `apps/web/src/pages/CopilotPage.tsx`
- Modify: `apps/web/src/hooks/useCopilot.ts` (add useCopilotHealth hook)

- [ ] **Step 1: Add useCopilotHealth hook**

In `apps/web/src/hooks/useCopilot.ts`, add at the end before the export-everything block (or alongside other hooks):

```typescript
export interface CopilotHealthResponse {
  ok: boolean
  user_slug: string
  role: string
  banner_alerts: Array<{
    id: string
    category: string
    code: string
    severity: string
    message: string
    fired_at: string
  }>
}

export function useCopilotHealth() {
  return useQuery({
    queryKey: ['copilot', 'health'],
    queryFn: () => api.get<CopilotHealthResponse>('/copilot/health').then(r => r.data),
    staleTime: 30_000,        // 30s — refetch on focus or after this
    refetchInterval: 60_000,  // poll every 60s for banner updates
  })
}
```

- [ ] **Step 2: Modify CopilotPage**

In `apps/web/src/pages/CopilotPage.tsx`, add the import and use the hook:

```tsx
import { useCopilotConversation, useSendCopilotMessage, useCopilotHealth } from '@/hooks/useCopilot'
import { HardLimitBanner } from '@/components/copilot/HardLimitBanner'
```

In the component body, add:

```tsx
const { data: health } = useCopilotHealth()
```

In the JSX, add the banner above the main flex layout:

```tsx
return (
  <>
    <HardLimitBanner alerts={health?.banner_alerts ?? []} />
    <div
      className="flex -mx-8 -mb-8 overflow-hidden"
      style={{ height: 'calc(100vh - 88px)' }}
    >
      {/* ... existing layout ... */}
    </div>
  </>
)
```

- [ ] **Step 3: Smoke test build**

```bash
npx turbo run build --filter=@ethra-nexus/web
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/useCopilot.ts apps/web/src/pages/CopilotPage.tsx
git commit -m "feat(web): integrate HardLimitBanner in CopilotPage with useCopilotHealth"
```

---

## Task 19: Smoke test (manual, no code)

**No code changes.** This task is a checklist to run before merging the branch into `main`.

Apply migration:

```bash
psql "$DATABASE_URL" -f infra/supabase/migrations/023_files_and_alerts.sql
```

- [ ] `\d files` shows columns + 3 indexes + `files_updated_at` trigger
- [ ] `\d system_alerts` shows columns + 3 indexes (one is partial unique)
- [ ] `\d tenants` shows `storage_limit_bytes | bigint`

Run dev backend with `FILE_STORAGE_ROOT=/tmp/files-test` (non-default).

- [ ] Backend boots without error.

Set a tenant limit:

```bash
psql "$DATABASE_URL" -c "UPDATE tenants SET storage_limit_bytes = 100000 WHERE slug='atitude45';"
```

Upload a file via curl (replace `<JWT>` with a valid admin JWT):

```bash
curl -X POST -H "Authorization: Bearer <JWT>" \
  -F "file=@./somefile.xlsx" \
  http://localhost:3001/api/v1/files
```

- [ ] Returns 201 with `id`, `sha256`, `download_url`.
- [ ] Arquivo aparece em `/tmp/files-test/<tenant_id>/<file_id>`.
- [ ] Row em `files` table.
- [ ] Row em `audit_log` com `action='create'`.

Download:

```bash
curl -H "Authorization: Bearer <JWT>" -o downloaded.xlsx \
  http://localhost:3001/api/v1/files/<id>/download
```

- [ ] Bytes idênticos ao original. `Content-Disposition: attachment` no header.

Push usage to ~75% (multiple uploads). Trigger maintenance manually (e.g. by restarting backend or calling the function from a node script).

- [ ] `system_alerts` has one `soft_warning` for the tenant.
- [ ] `system_list_storage_alerts` tool no `/copilot` returns the alert.

Push to ~96%.

- [ ] `system_alerts` has `hard_limit`, `soft_warning` é `resolved_at`.
- [ ] `/copilot/health.banner_alerts` lists the `hard_limit`.
- [ ] Banner vermelho aparece no `/copilot` no browser.

Try one more upload.

- [ ] Returns 413 `STORAGE_LIMIT_EXCEEDED`.

Delete some files to drop usage to ~60%.

- [ ] Run maintenance: `system_alerts` rows all have `resolved_at` set.
- [ ] Banner desaparece após próximo poll do `useCopilotHealth`.
- [ ] `system_list_storage_alerts` returns `[]`.

Cleanup TTL test:

- [ ] Upload file with `expires_at = NOW() + 5min`. Wait 5min. Run maintenance.
- [ ] File row removed from DB. File removed from `/tmp/files-test/`.

403 smoke (deferred — JWT always issues `role: 'admin'`):

- [ ] Documentado mas não executável até refactor de auth permitir role!=admin.

---

## Self-review checklist (compare to spec)

- [x] Migration 023 — Task 1 ✓
- [x] Drizzle schema — Task 2 ✓
- [x] FileStorageDriver interface — Task 3 ✓
- [x] LocalFsDriver — Task 4 ✓
- [x] MockStorageDriver helper — Task 5 ✓
- [x] Factory — Task 6 ✓
- [x] Module exports — Task 7 ✓
- [x] Validate helpers — Task 8 ✓
- [x] POST /files (with quota check, audit, rollback) — Task 9 ✓
- [x] GET /files/:id/download (with Content-Disposition forced) — Task 10 ✓
- [x] GET /files (list, filter by mime_type, paginate) + DELETE /files/:id — Task 11 ✓
- [x] computeStorageAlerts (70/85/95 thresholds + auto-resolve) — Task 12 ✓
- [x] cleanupExpiredFiles + cron integration — Task 13 ✓
- [x] system:list_storage_alerts (real impl) — Task 14 ✓
- [x] system:get_storage_usage (new tool) — Task 15 ✓
- [x] /copilot/health banner_alerts extension — Task 16 ✓
- [x] HardLimitBanner component — Task 17 ✓
- [x] CopilotPage integration — Task 18 ✓
- [x] Smoke test — Task 19 ✓
- [x] Tests with ≥80% coverage on new files — embedded in Tasks 4, 6, 8, 9-11, 12, 13, 14, 15, 16, 17

**Out of scope confirmed defer:**
- Upload UI widget — Spec #3
- Parsers, Output Worker — Specs #3, #4
- Alert categories beyond storage — future specs
- S3Driver impl — interface ready, body deferred
- Orphan recovery cron — only logs in this spec
- 403 for non-admin — deferred until auth refactor
