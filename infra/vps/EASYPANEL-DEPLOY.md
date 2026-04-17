# Deploy no Easypanel — Ethra Nexus

## Pré-requisitos confirmados

- [x] VPS Hostinger KVM 1 (1vCPU, 4GB RAM)
- [x] Easypanel instalado e acessível
- [x] PostgreSQL + pgvector já rodando no Easypanel
- [x] Domínio configurado e apontando para a VPS

---

## Passo 1 — Configurar o banco de dados

### 1.1 Acessar o PostgreSQL

No Easypanel, vá em **Services → PostgreSQL → Connection**.
Copie a connection string (formato: `postgres://user:password@host:5432/dbname`).

### 1.2 Criar database (se necessário)

Se o banco `ethra_nexus` ainda não existe, crie via terminal do Easypanel:

```bash
# No terminal SSH da VPS ou via Easypanel terminal:
docker exec -it <container-postgres> psql -U postgres -c "CREATE DATABASE ethra_nexus;"
```

### 1.3 Aplicar migrations

Copie o conteúdo de `easypanel-setup.sql` e execute no banco:

```bash
# Opção A: via psql na VPS
docker exec -i <container-postgres> psql -U postgres -d ethra_nexus < /path/to/easypanel-setup.sql

# Opção B: copie e cole no terminal psql
docker exec -it <container-postgres> psql -U postgres -d ethra_nexus
# Cole o conteúdo do arquivo easypanel-setup.sql
```

Deve terminar com: `✅ Ethra Nexus — banco configurado com sucesso!`

---

## Passo 2 — Criar os serviços no Easypanel

### 2.1 Ethra Nexus API

No Easypanel: **Create Service → Docker Image**

| Campo | Valor |
|-------|-------|
| **Name** | `ethra-nexus-api` |
| **Image** | `ghcr.io/pnakamura/ethra-nexus:latest` |
| **Port** | `3000` |

**Environment Variables:**

```
NODE_ENV=production
PORT=3000
WIKIS_BASE_PATH=/data/wikis

# PostgreSQL (da connection string do Easypanel)
DATABASE_URL=postgres://USER:PASSWORD@HOSTNAME:5432/ethra_nexus

# API Keys (substitua pelos valores reais)
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...
OPENAI_API_KEY=sk-...
```

**Volumes:**

| Mount Path | Volume |
|---|---|
| `/data/wikis` | `nexus-wikis` |

**Domain:** Configure o domínio principal (ex: `nexus.seudominio.com.br`)

**Health Check:** `http://localhost:3000/health`

### 2.2 N8N (Automação)

No Easypanel: **Create Service → Docker Image**

| Campo | Valor |
|-------|-------|
| **Name** | `n8n` |
| **Image** | `n8nio/n8n:1.68.0` |
| **Port** | `5678` |

**Environment Variables:**

```
N8N_BASIC_AUTH_ACTIVE=true
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=GERE_SENHA_FORTE
N8N_ENCRYPTION_KEY=GERE_COM_openssl_rand_hex_16
N8N_HOST=n8n.seudominio.com.br
N8N_PORT=5678
N8N_PROTOCOL=https
WEBHOOK_URL=https://n8n.seudominio.com.br
GENERIC_TIMEZONE=America/Sao_Paulo
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=HOSTNAME_DO_POSTGRES
DB_POSTGRESDB_PORT=5432
DB_POSTGRESDB_DATABASE=ethra_nexus
DB_POSTGRESDB_USER=postgres
DB_POSTGRESDB_PASSWORD=SENHA_DO_POSTGRES
DB_POSTGRESDB_SCHEMA=n8n
```

**Volumes:**

| Mount Path | Volume |
|---|---|
| `/home/node/.n8n` | `n8n-data` |

**Domain:** `n8n.seudominio.com.br`

### 2.3 SilverBullet (Wiki Editor) — Opcional

No Easypanel: **Create Service → Docker Image**

| Campo | Valor |
|-------|-------|
| **Name** | `silverbullet` |
| **Image** | `ghcr.io/silverbulletmd/silverbullet:0.10.0` |
| **Port** | `3000` |

**Environment Variables:**

```
SB_USER=admin:GERE_SENHA_FORTE
```

**Volumes:**

| Mount Path | Volume |
|---|---|
| `/space` | `nexus-wikis` (mesmo volume da API!) |

**Domain:** `wiki.seudominio.com.br`

---

## Passo 3 — Verificar que tudo está rodando

1. **API:** `curl https://nexus.seudominio.com.br/health`
   - Deve retornar `{"status":"ok"}`

2. **N8N:** Acesse `https://n8n.seudominio.com.br`
   - Login com as credenciais configuradas

3. **SilverBullet:** Acesse `https://wiki.seudominio.com.br`
   - Login com admin:senha

4. **Banco:** Verifique as tabelas:
   ```bash
   docker exec -it <postgres> psql -U postgres -d ethra_nexus -c "\dt"
   ```

---

## Passo 4 — Primeiro teste end-to-end

### 4.1 Obter o tenant_id

```bash
curl -s https://nexus.seudominio.com.br/rest/v1/tenants | jq '.[0].id'
```

### 4.2 Criar o primeiro agente (via API)

```bash
TENANT_ID="o-id-retornado-acima"

curl -X POST https://nexus.seudominio.com.br/api/task \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "CRIAR_PRIMEIRO",
    "skill_id": "wiki:query",
    "payload": {"query": "teste"},
    "activation": "on_demand",
    "triggered_by": "api"
  }'
```

---

## Segurança das API Keys no Easypanel

No Easypanel, as variáveis de ambiente são armazenadas no banco interno do
Easypanel (SQLite criptografado). Isso é mais seguro que texto puro no disco,
mas menos seguro que Docker Secrets ou Vault.

**Para a fase atual (MVP/staging), é aceitável.**

Para produção com clientes corporativos, migrar para Docker Secrets
ou HashiCorp Vault.

### O que o Easypanel protege:
- ✅ Variáveis não aparecem em `docker inspect` (Easypanel gerencia)
- ✅ SSL automático via Traefik (HTTPS em todos os serviços)
- ✅ Isolamento de containers
- ✅ Dashboard protegido por senha

### O que você deve fazer:
- 🔒 Não usar a mesma senha do Easypanel para os serviços
- 🔒 Usar senhas fortes (20+ caracteres) para N8N e SilverBullet
- 🔒 Rotacionar API keys se suspeitar de comprometimento
- 🔒 Habilitar 2FA no painel do Easypanel (se disponível)

---

## Consumo estimado de RAM

| Serviço | RAM |
|---------|-----|
| PostgreSQL + pgvector (já rodando) | ~400MB |
| Ethra Nexus API | ~200MB |
| N8N | ~350MB |
| SilverBullet | ~80MB |
| Easypanel + Traefik | ~300MB |
| **Total** | **~1.3GB** |
| **Livre para OS + swap** | **~2.7GB** |
