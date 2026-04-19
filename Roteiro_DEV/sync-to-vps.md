# Sincronização Fase 0 → VPS

Lista completa dos arquivos modificados/criados na Fase 0 (Fastify + Drizzle ORM).

## Comandos SCP (PowerShell)

Execute cada bloco. Pode rodar em paralelo abrindo várias janelas PowerShell.

### 1. Configuração base

```powershell
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\tsconfig.base.json" root@129.121.38.172:/opt/ethra-nexus/tsconfig.base.json
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\infra\docker\Dockerfile" root@129.121.38.172:/opt/ethra-nexus/infra/docker/Dockerfile
```

### 2. packages/db (NOVO — criar diretório primeiro)

```powershell
# Criar diretórios via SSH antes
ssh -p 22022 root@129.121.38.172 "mkdir -p /opt/ethra-nexus/packages/db/src/schema"

# Transferir arquivos
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\packages\db\package.json" root@129.121.38.172:/opt/ethra-nexus/packages/db/package.json
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\packages\db\tsconfig.json" root@129.121.38.172:/opt/ethra-nexus/packages/db/tsconfig.json
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\packages\db\drizzle.config.ts" root@129.121.38.172:/opt/ethra-nexus/packages/db/drizzle.config.ts
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\packages\db\src\client.ts" root@129.121.38.172:/opt/ethra-nexus/packages/db/src/client.ts
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\packages\db\src\index.ts" root@129.121.38.172:/opt/ethra-nexus/packages/db/src/index.ts
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\packages\db\src\schema\core.ts" root@129.121.38.172:/opt/ethra-nexus/packages/db/src/schema/core.ts
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\packages\db\src\schema\wiki.ts" root@129.121.38.172:/opt/ethra-nexus/packages/db/src/schema/wiki.ts
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\packages\db\src\schema\index.ts" root@129.121.38.172:/opt/ethra-nexus/packages/db/src/schema/index.ts
```

### 3. apps/server (NOVO — criar diretório primeiro)

```powershell
ssh -p 22022 root@129.121.38.172 "mkdir -p /opt/ethra-nexus/apps/server/src/routes"

scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\apps\server\package.json" root@129.121.38.172:/opt/ethra-nexus/apps/server/package.json
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\apps\server\tsconfig.json" root@129.121.38.172:/opt/ethra-nexus/apps/server/tsconfig.json
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\apps\server\src\app.ts" root@129.121.38.172:/opt/ethra-nexus/apps/server/src/app.ts
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\apps\server\src\index.ts" root@129.121.38.172:/opt/ethra-nexus/apps/server/src/index.ts
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\apps\server\src\routes\health.ts" root@129.121.38.172:/opt/ethra-nexus/apps/server/src/routes/health.ts
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\apps\server\src\routes\auth.ts" root@129.121.38.172:/opt/ethra-nexus/apps/server/src/routes/auth.ts
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\apps\server\src\routes\agents.ts" root@129.121.38.172:/opt/ethra-nexus/apps/server/src/routes/agents.ts
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\apps\server\src\routes\tickets.ts" root@129.121.38.172:/opt/ethra-nexus/apps/server/src/routes/tickets.ts
```

### 4. packages atualizados

```powershell
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\packages\core\package.json" root@129.121.38.172:/opt/ethra-nexus/packages/core/package.json
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\packages\wiki\package.json" root@129.121.38.172:/opt/ethra-nexus/packages/wiki/package.json
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\packages\agents\package.json" root@129.121.38.172:/opt/ethra-nexus/packages/agents/package.json
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\packages\agents\src\index.ts" root@129.121.38.172:/opt/ethra-nexus/packages/agents/src/index.ts
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\packages\agents\src\bootstrap.ts" root@129.121.38.172:/opt/ethra-nexus/packages/agents/src/bootstrap.ts
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\packages\agents\src\lib\embeddings\embeddings.service.ts" root@129.121.38.172:/opt/ethra-nexus/packages/agents/src/lib/embeddings/embeddings.service.ts
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\apps\web\package.json" root@129.121.38.172:/opt/ethra-nexus/apps/web/package.json
```

### 5. packages/agents/src/lib/db (NOVO)

```powershell
ssh -p 22022 root@129.121.38.172 "mkdir -p /opt/ethra-nexus/packages/agents/src/lib/db"

scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\packages\agents\src\lib\db\client.ts" root@129.121.38.172:/opt/ethra-nexus/packages/agents/src/lib/db/client.ts
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\packages\agents\src\lib\db\db-agents.ts" root@129.121.38.172:/opt/ethra-nexus/packages/agents/src/lib/db/db-agents.ts
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\packages\agents\src\lib\db\db-wiki.ts" root@129.121.38.172:/opt/ethra-nexus/packages/agents/src/lib/db/db-wiki.ts
scp -P 22022 "p:\ME\Atitude45\Projetos\CLAUDE\Ethra-Nexus\packages\agents\src\lib\db\index.ts" root@129.121.38.172:/opt/ethra-nexus/packages/agents/src/lib/db/index.ts
```

### 6. Limpar arquivos antigos (Supabase) na VPS

```bash
# SSH na VPS:
ssh -p 22022 root@129.121.38.172
cd /opt/ethra-nexus

rm -rf packages/agents/src/lib/supabase
rm -rf packages/agents/src/master
rm -rf packages/agents/src/modules
rm -f packages/agents/src/server.ts

# Verificar
find packages/agents/src -type f -name "*.ts" | sort
```

### 7. Build na VPS

```bash
cd /opt/ethra-nexus
docker build --no-cache -f infra/docker/Dockerfile -t ghcr.io/pnakamura/ethra-nexus:latest . 2>&1 | tee /tmp/build-phase0.log
```

Quando passar:

```bash
docker push ghcr.io/pnakamura/ethra-nexus:latest
```
