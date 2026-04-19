# Ethra Nexus — Manual de Instalação para Produção

> Documento operacional baseado na primeira instalação real do sistema
> (VPS Hostgator, Abril 2026). Consolida procedimento, decisões técnicas
> definitivas e armadilhas conhecidas para guiar futuras instalações
> em ambientes de cliente.

| Versão | 1.0 |
| --- | --- |
| Data | Abril 2026 |
| Stack validada | Fastify 5 + Drizzle ORM 0.35 + PostgreSQL 17 + pgvector 0.8.2 |
| Tempo total estimado | 4-6 horas para o caminho crítico (Fases 0-2) |
| Pré-requisitos | VPS Linux ≥4GB RAM, Docker, Easypanel ou orquestrador equivalente |

---

## Sumário Executivo

Este manual descreve a instalação completa do Ethra Nexus em uma VPS Linux usando Easypanel. Foi escrito após a primeira instalação real, capturando exatamente o que funcionou, o que falhou, e como contornar cada obstáculo conhecido.

**Destinatários:**
- Engenheiros instalando o produto em VPS de cliente final
- Equipe de suporte/onboarding
- Documentação técnica para due diligence comercial

**Não cobrem este documento:**
- Customização de agentes (vide Fase 6 do plano de execução)
- Configuração de canais (WhatsApp, etc — vide Fase 3)
- Wiki engine completa (vide Fase 5)

---

## 1. Pré-requisitos da VPS

### 1.1 Especificações mínimas

| Recurso | Mínimo | Recomendado | Validado em |
| --- | --- | --- | --- |
| RAM | 4 GB | 8 GB | Hostgator 8GB |
| vCPU | 2 | 4 | 2 vCPU |
| Disco | 40 GB SSD | 80 GB NVMe | 40 GB SSD |
| Sistema | Debian 12 / AlmaLinux 9.x / Ubuntu 22.04 | AlmaLinux 9.7 | AlmaLinux 9.7 |
| Rede | IPv4 público + porta SSH customizada | IPv4 + IPv6 + DNS reverso | IPv4 only |

### 1.2 Software pré-instalado pela infraestrutura

- Docker Engine ≥ 20.x
- Easypanel (ou compatível: CapRover, Coolify, Portainer)
- OpenSSH com porta customizada (recomendado: nunca 22)
- Acesso root via SSH key (preferível) ou senha forte

### 1.3 Acessos necessários antes de começar

| Item | Onde obter | Quando usar |
| --- | --- | --- |
| GitHub Personal Access Token | github.com/settings/tokens | Login no ghcr.io |
| Anthropic API key | console.anthropic.com | Env var ANTHROPIC_API_KEY |
| OpenRouter API key (opcional) | openrouter.ai/keys | Env var OPENROUTER_API_KEY |
| Domínio + acesso DNS | Registrar do cliente | Subdomínio para a API |

---

## 2. Visão geral do procedimento

A instalação é dividida em três fases sequenciais (caminho crítico) e cinco fases adicionais não-críticas que podem ser feitas em paralelo:

```
CAMINHO CRÍTICO (~6 horas)
├── Fase 0: Build da imagem Docker (~2h)
├── Fase 1: Migração do banco (~2h)
└── Fase 2: Deploy + validação (~2h)

NÃO-CRÍTICAS (em qualquer ordem após Fase 2)
├── Fase 3: N8N + WhatsApp (~6h)
├── Fase 4: SilverBullet + sync (~4h)
├── Fase 5: Wiki engine (~12h)
├── Fase 6: Agentes com briefing wiki (~8h)
└── Fase 8: Hardening + monitoramento (~5h)
```

Este documento cobre apenas as Fases 0, 1 e 2 — após elas, o sistema está operacional e validado.

---

## 3. Fase 0 — Build da imagem Docker

### 3.1 Decisão de arquitetura

O sistema usa **Fastify + Drizzle ORM** com conexão direta ao PostgreSQL. **Não use `@supabase/supabase-js`** — essa biblioteca exige PostgREST e GoTrue, que adicionam complexidade sem benefício no modelo self-hosted.

### 3.2 Procedimento

#### 3.2.1 Clonar repositório na VPS

```bash
ssh -p PORT_SSH root@VPS_IP
mkdir -p /opt/ethra-nexus
cd /opt/ethra-nexus
git clone https://github.com/pnakamura/ethra-nexus.git .
```

#### 3.2.2 Login no GitHub Container Registry

```bash
echo "GITHUB_PAT" | docker login ghcr.io -u GITHUB_USER --password-stdin
```

> ⚠️ **Token expira.** Renove a cada 90 dias ou use credentials helper.

#### 3.2.3 Build da imagem

```bash
cd /opt/ethra-nexus
docker build --no-cache -f infra/docker/Dockerfile \
  -t ghcr.io/GITHUB_USER/ethra-nexus:latest . 2>&1 | tee /tmp/build.log
```

**Tempo esperado:** 3-5 minutos.

**Saída esperada:** `naming to ghcr.io/.../ethra-nexus:latest done`

#### 3.2.4 Push para o registry

```bash
docker push ghcr.io/GITHUB_USER/ethra-nexus:latest
```

### 3.3 Armadilhas conhecidas — Fase 0

#### 🚨 Armadilha #1: npm install falha com EISDIR no Windows

**Sintoma:** `EISDIR: illegal operation on a directory, symlink 'packages\wiki' -> 'node_modules\@ethra-nexus\wiki'`

**Causa:** Bug do npm workspaces no Windows com symlinks. **Não acontece no Linux** (a VPS).

**Solução:** Não tente buildar localmente em Windows. Faça SCP dos arquivos e build na VPS.

#### 🚨 Armadilha #2: drizzle-orm não é instalado mesmo com `npm install` "ok"

**Sintoma:** Build TypeScript falha com `Cannot find module 'drizzle-orm/pg-core'`. Os outros pacotes funcionam (fastify, etc), mas drizzle-orm fica em `packages/db/node_modules/` em vez do root.

**Causa:** drizzle-orm tem 28 peer dependencies (react, knex, kysely, etc.). O npm 10.x se confunde e não faz hoisting.

**Solução obrigatória no Dockerfile:**

```dockerfile
RUN npm install --legacy-peer-deps
```

Sem essa flag, o build sempre falha.

#### 🚨 Armadilha #3: HEALTHCHECK falha por falta de wget/curl

**Sintoma:** Container sobe, fica `unhealthy` por ~90 segundos, depois é morto pelo Docker. Logs mostram `Server listening` seguido de `Shutting down`.

**Causa:** `node:20-alpine` não tem `wget` nem `curl`. O HEALTHCHECK no Dockerfile usa um deles e falha.

**Solução:** Use `node` para o healthcheck (já vem na imagem):

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

#### 🚨 Armadilha #4: Sintaxe de índices Drizzle versão-dependente

**Sintoma:** `error TS2769: No overload matches this call` em todas as `pgTable(...)` calls.

**Causa:** drizzle-orm 0.35.x exige objeto `(table) => ({...})` para índices. A sintaxe de array `(table) => [...]` só foi adicionada em 0.36+.

**Solução:** Manter sintaxe de objeto enquanto estivermos em 0.35.x:

```typescript
}, (table) => ({
  myIdx: uniqueIndex('my_idx').on(table.col1, table.col2),
}))
```

---

## 4. Fase 1 — Migração do banco

### 4.1 Pré-requisitos

PostgreSQL 17 rodando como serviço Docker no Easypanel. Anote:
- Hostname interno (geralmente `PROJETO_postgres`)
- Senha do `POSTGRES_PASSWORD`
- Nome do banco (default: `PROJETO`)

Para descobrir esses dados:

```bash
docker inspect $(docker ps -q -f name=postgres) \
  --format '{{range .Config.Env}}{{println .}}{{end}}' | grep POSTGRES
```

### 4.2 Procedimento

#### 4.2.1 Garantir pgvector instalado

A imagem `postgres:17` vanilla **não traz pgvector**. Instalar manualmente:

```bash
PGCONTAINER=$(docker ps -q -f name=postgres)

docker exec $PGCONTAINER bash -c "
  apt-get update && \
  apt-get install -y postgresql-17-pgvector
"

# Verificar
docker exec $PGCONTAINER ls /usr/lib/postgresql/17/lib/vector.so
```

> ⚠️ **Instalação não persiste se o container for recriado.** Solução definitiva está na seção "Recomendações para produção" (item 7.1).

#### 4.2.2 Aplicar schema Drizzle

O schema completo está em `infra/vps/schema-drizzle.sql` (15 tabelas, 2 índices HNSW, tenant seed).

```bash
cd /opt/ethra-nexus
cat infra/vps/schema-drizzle.sql | docker exec -i $PGCONTAINER \
  psql -U postgres -d NOME_DO_BANCO
```

**Saída esperada:** `total_tables = 15, pgvector_version = 0.8.2, tenants_seeded = 1`

#### 4.2.3 Verificar estado final

```bash
docker exec $PGCONTAINER psql -U postgres -d NOME_DO_BANCO -c "\dt"
docker exec $PGCONTAINER psql -U postgres -d NOME_DO_BANCO -c "SELECT id, name, slug FROM tenants;"
```

Deve listar 15 tabelas e 1 tenant seed.

### 4.3 Armadilhas conhecidas — Fase 1

#### 🚨 Armadilha #5: Banco existe com nome diferente do esperado

**Sintoma:** `psql: error: database "ethra_nexus" does not exist`

**Causa:** Easypanel usa o nome do projeto como nome do banco. Se o projeto tem hífen (`ethra-nexus`), o banco também tem.

**Solução:** Use o nome real do banco:

```bash
docker exec $PGCONTAINER psql -U postgres -c "\l"
```

E ajuste o `DATABASE_URL` da aplicação para corresponder.

#### 🚨 Armadilha #6: pg_dump falha com "could not access file libdir/vector"

**Sintoma:** Backup do banco falha mesmo com pgvector aparentemente instalado.

**Causa:** Extensão `vector` está registrada na metadata do PostgreSQL, mas o arquivo `vector.so` foi perdido (provavelmente container recriado após install manual).

**Solução:** Reinstalar pgvector (item 4.2.1) ou trocar a imagem para `pgvector/pgvector:pg17`.

#### 🚨 Armadilha #7: Tabelas em banco "errado"

**Sintoma:** Banco do projeto está vazio mas existem tabelas no banco `postgres`.

**Causa:** Migrations anteriores foram aplicadas no banco padrão `postgres` em vez do banco do projeto.

**Solução:** Limpar o banco `postgres` se quiser começar do zero:

```bash
docker exec $PGCONTAINER psql -U postgres -d postgres -c "
DROP TABLE IF EXISTS lista_de_tabelas CASCADE;
"
```

---

## 5. Fase 2 — Deploy e validação

### 5.1 Configuração de variáveis de ambiente

No Easypanel, dentro do serviço `ethra-nexus` (a API), aba **Environment**:

#### REMOVER (se existirem de instalação anterior):

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

#### ADICIONAR (obrigatórias):

| Variável | Valor | Como gerar |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://postgres:SENHA@HOST_POSTGRES:5432/NOME_BANCO` | Senha do passo 4.1 |
| `JWT_SECRET` | string hex de 128 chars | `openssl rand -hex 64` |
| `NODE_ENV` | `production` | — |
| `PORT` | `3000` | — |

#### ADICIONAR (opcionais para Fase 2, obrigatórias depois):

| Variável | Valor | Necessária para |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Skills com LLM (Fase 5) |
| `OPENROUTER_API_KEY` | `sk-or-...` | Modelos via OpenRouter (Fase 5) |

### 5.2 Hostname interno do PostgreSQL

No Easypanel/Docker Swarm, o hostname é o nome do serviço. Convenção:

```
PROJETO_NOME-DO-SERVICO
```

Exemplo real: projeto `ethra-nexus`, serviço `postgres` → hostname `ethra-nexus_postgres`.

### 5.3 Deploy

1. No Easypanel → serviço **ethra-nexus** → aba **Source**
2. Confirme image: `ghcr.io/USER/ethra-nexus:latest`
3. Botão **Deploy**

### 5.4 Validação

#### 5.4.1 Conferir logs

Aba **Logs** do Easypanel deve mostrar (sem `Shutting down`):

```
[Nexus] Starting server...
[Nexus] Server listening on http://0.0.0.0:3000
[Nexus] Routes:
  GET  /api/v1/health
  POST /api/v1/auth/login
  ...
{"level":30,...,"msg":"Server listening at http://...:3000"}
```

#### 5.4.2 Testar /health

```bash
APICONTAINER=$(docker ps -q -f name=ethra-nexus-api)

docker exec $APICONTAINER node -e "
  fetch('http://localhost:3000/api/v1/health')
    .then(r => r.json())
    .then(d => console.log(JSON.stringify(d, null, 2)))
"
```

Esperado:

```json
{
  "status": "ok",
  "db": "connected",
  "timestamp": "2026-04-..."
}
```

#### 5.4.3 Testar /auth/login

```bash
docker exec $APICONTAINER node -e "
  fetch('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({slug:'minha-org', password:'minha-org'})
  }).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)))
"
```

Esperado:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "tenant": {
    "id": "62bbb28f-f707-425b-b6fb-833adb1e0bf6",
    "name": "Minha Organização",
    "slug": "minha-org"
  }
}
```

> ⚠️ **Senha do tenant seed = slug.** Em produção, troque imediatamente após validação.

### 5.5 Armadilhas conhecidas — Fase 2

#### 🚨 Armadilha #8: Container reinicia em loop

**Sintoma:** Container sobe, roda 60-90 segundos, exit 0, sobe de novo.

**Causa:** HEALTHCHECK falhando (vide Armadilha #3).

**Solução:** Garantir que Dockerfile usa `node` no HEALTHCHECK e que a imagem foi reconstruída após a correção.

#### 🚨 Armadilha #9: Erro `ECONNREFUSED` ao conectar ao Postgres

**Sintoma:** Logs mostram falha de conexão imediata após startup.

**Causa:** `DATABASE_URL` aponta para hostname errado. O container da API e o do Postgres precisam estar na mesma rede Docker.

**Diagnóstico:**

```bash
docker network inspect easypanel | grep -E "(Name|IPv4Address)"
```

Ambos os containers devem aparecer.

**Solução:** Ajustar `DATABASE_URL` para usar o nome do serviço Postgres (não IP nem `localhost`).

---

## 6. Lições aprendidas

### 6.1 Conceituais

1. **Não tente "modernizar" o stack sem necessidade real.** A escolha por Fastify+Drizzle veio depois de tentar e falhar com Supabase JS — não foi premissa inicial. A primeira tentativa com Supabase JS quebrou por exigir PostgREST+GoTrue como serviços extras.

2. **Build local em Windows é frágil para monorepos.** Symlinks de workspace npm causam `EISDIR` consistentemente. Adote desde o início: build sempre em Linux (CI ou VPS).

3. **HEALTHCHECK é parte do contrato da imagem.** Um healthcheck quebrado faz o orquestrador matar o container em loop infinito, dando a falsa impressão de "código com bug" quando na verdade o app está perfeito.

4. **pgvector na imagem `postgres:17` vanilla é uma armadilha.** Mesmo instalado via apt, perde-se em qualquer recriação do container. Use `pgvector/pgvector:pg17` em produção.

### 6.2 Operacionais

1. **Backup antes de qualquer alteração de schema é não-negociável.** Mesmo "vamos dropar tudo" se beneficia de um snapshot — alguma coisa pode estar errada e o backup vira referência.

2. **Acompanhe logs durante o deploy.** Não confie apenas no status "Running" do orquestrador. Os primeiros 60-90 segundos depois de subir são onde 80% dos problemas aparecem.

3. **Diferencie "container rodando" de "aplicação saudável".** O orquestrador usa o exit code, não a lógica de negócio. Um app que sobe e fica preso esperando algo para sempre vai aparecer como "running" indefinidamente.

4. **Documente o `DATABASE_URL` real após cada instalação.** O hostname interno varia conforme o orquestrador (Docker Swarm vs Compose vs Kubernetes). Não suponha — verifique.

### 6.3 Específicas ao Ethra Nexus

1. **15 tabelas é o mínimo para o sistema funcionar.** 11 core + 4 wiki. Faltando qualquer uma, alguma rota vai quebrar mais cedo ou mais tarde.

2. **JWT_SECRET nunca pode ser o default `dev-secret`.** O código fornece um default para facilitar dev local, mas em produção isso é uma vulnerabilidade crítica.

3. **Tenant seed `minha-org` é placeholder.** Em produção, criar o tenant real do cliente como primeiro passo após a Fase 2 e desativar o seed (ou trocá-lo).

---

## 7. Recomendações para produção

### 7.1 Segurança crítica

#### 7.1.1 Trocar imagem do Postgres para pgvector built-in

Eliminar a armadilha do pgvector não-persistente:

No Easypanel, editar serviço Postgres:
- **Source > Image:** `pgvector/pgvector:pg17` (em vez de `postgres:17`)
- Manter mesmo volume de dados → restart preserva tudo

#### 7.1.2 Trocar senha do tenant seed

Imediatamente após validação:

```sql
UPDATE tenants SET slug = 'CLIENTE_SLUG', name = 'Nome Real do Cliente'
WHERE slug = 'minha-org';
```

E implementar `password_hash` na tabela `tenants` (TODO no `apps/server/src/routes/auth.ts`).

#### 7.1.3 Habilitar HTTPS no Easypanel

- Cada serviço público (`ethra-nexus`, `n8n`, `silverbullet`) deve ter domínio configurado
- Easypanel gerencia SSL automaticamente via Let's Encrypt
- Evite expor portas diretamente — sempre via reverse proxy do Easypanel

#### 7.1.4 Proteção contra brute force no SSH

```bash
dnf install fail2ban -y
cat > /etc/fail2ban/jail.local <<EOF
[sshd]
enabled = true
port = PORTA_SSH
maxretry = 3
bantime = 3600
EOF
systemctl restart fail2ban
```

### 7.2 Observabilidade

#### 7.2.1 Backups automáticos

```bash
crontab -e
# Adicionar:
0 3 * * * docker exec $(docker ps -q -f name=postgres) pg_dump -U postgres NOME_BANCO | gzip > /opt/backups/db_$(date +\%Y\%m\%d).sql.gz
0 4 * * * find /opt/backups -name "*.sql.gz" -mtime +30 -delete
```

#### 7.2.2 Monitoramento via Uptime Kuma

No Easypanel, adicionar serviço `louislam/uptime-kuma:1`. Configurar monitores para:
- `https://API_DOMAIN/api/v1/health` (60s)
- `https://N8N_DOMAIN` (300s) — se Fase 3 instalada
- `https://WIKI_DOMAIN` (300s) — se Fase 4 instalada

### 7.3 Performance

#### 7.3.1 Tuning do PostgreSQL para 8GB RAM

Se o cliente tem volume alto de queries, ajustar parâmetros do Postgres no command da Easypanel:

```
-c shared_buffers=2GB
-c effective_cache_size=6GB
-c work_mem=16MB
-c maintenance_work_mem=512MB
-c max_connections=100
```

#### 7.3.2 Limites de memória nos containers

Configurar no Easypanel para evitar OOM:
- `ethra-nexus-api`: 512 MB
- `postgres`: 4 GB (numa VPS de 8GB)
- `n8n`: 800 MB
- `silverbullet`: 256 MB

### 7.4 Escala futura

#### 7.4.1 Quando escalar verticalmente (mais RAM)

Sintomas que indicam upgrade necessário:
- Logs do Postgres com `out of memory`
- Container `ethra-nexus-api` reiniciando por OOM
- Latência das queries > 100ms p95

Próximo nível recomendado: VPS de 16GB.

#### 7.4.2 Quando considerar PostgreSQL gerenciado

A partir de 5+ tenants ativos ou 10GB+ de dados, considerar migrar Postgres para um serviço gerenciado (DigitalOcean Managed DB, Supabase Cloud, Neon). A aplicação não muda — apenas o `DATABASE_URL`.

---

## 8. Checklist final de instalação

Ao terminar Fases 0/1/2, validar:

### Build
- [ ] Imagem `ghcr.io/USER/ethra-nexus:latest` publicada com SHA registrado
- [ ] `docker pull` da imagem funciona em outra máquina

### Banco
- [ ] 15 tabelas existem em `\dt` no banco do projeto
- [ ] `pgvector_version` retorna `0.8.2` ou superior
- [ ] Tenant seed acessível via `SELECT * FROM tenants`
- [ ] 2 índices HNSW criados (`\d+ wiki_strategic_pages` mostra `wsp_embedding_idx`)

### API
- [ ] Container `ethra-nexus-api` rodando há 5+ minutos sem reinício
- [ ] `GET /api/v1/health` retorna `{"status":"ok","db":"connected"}`
- [ ] `POST /api/v1/auth/login` retorna JWT válido para tenant seed
- [ ] `GET /api/v1/agents` (com Bearer JWT) retorna `{"data":[]}`

### Segurança
- [ ] `JWT_SECRET` em produção tem 128+ chars hexadecimais (não o default)
- [ ] Senha do tenant seed foi alterada
- [ ] Variáveis Supabase removidas das env vars
- [ ] HTTPS configurado para todos os domínios públicos
- [ ] Fail2Ban ativo na porta SSH

### Observabilidade
- [ ] Backup diário do Postgres configurado via cron
- [ ] Uptime Kuma monitorando `/health` (se Fase 8 instalada)
- [ ] Logs do Easypanel acessíveis e legíveis

---

## 9. Próximos passos após a instalação base

Com Fases 0/1/2 completas, o sistema está operacional mas mínimo. Para entregar valor real ao cliente:

| Fase | Entrega | Necessária para |
| --- | --- | --- |
| 3 | N8N + workflow WhatsApp | Cliente recebe respostas via WhatsApp |
| 4 | SilverBullet | Cliente edita wiki institucional |
| 5 | Wiki engine (ingest, RAG, lint) | Sistema responde com base no conhecimento do cliente |
| 6 | Agentes lendo/escrevendo wikis | Sistema aprende com aprovações e rejeições |
| 7 | Validação de squad real | Caso de uso completo end-to-end |
| 8 | Hardening + monitoramento | Pronto para produção comercial |

Cada fase tem checklist próprio em `EthraNexus_Checklist_Implementacao.md`.

---

## 10. Suporte e troubleshooting

### 10.1 Logs principais

| Container | Como acessar | O que procurar |
| --- | --- | --- |
| `ethra-nexus-api` | `docker logs CONTAINER_ID --tail 50` | Erros de conexão DB, falhas JWT, exceções não tratadas |
| `postgres` | `docker logs CONTAINER_ID --tail 100` | Falhas de autenticação, OOM, deadlocks |
| `nginx` (Easypanel) | Aba Logs do Easypanel | Erros 502/504 (backend down), 429 (rate limit) |

### 10.2 Comandos de diagnóstico úteis

```bash
# Estado de todos os containers
docker ps -a | grep ethra-nexus

# Uso de recursos
docker stats --no-stream

# Conexões ativas no Postgres
docker exec PGCONTAINER psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"

# Tamanho do banco
docker exec PGCONTAINER psql -U postgres -d ethra-nexus -c "
SELECT pg_size_pretty(pg_database_size('ethra-nexus'));
"

# Top tabelas por tamanho
docker exec PGCONTAINER psql -U postgres -d ethra-nexus -c "
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;
"
```

### 10.3 Recuperação de desastres

**Cenário: container `ethra-nexus-api` morto e não reinicia**

1. Conferir env vars (geralmente `DATABASE_URL` ou `JWT_SECRET` ausente)
2. Conferir se Postgres está rodando e acessível
3. Conferir se a imagem existe (`docker images | grep ethra-nexus`)
4. Em último caso: redeploy via Easypanel forçando pull da imagem

**Cenário: banco corrompido**

1. Restaurar do último backup:
   ```bash
   gunzip < /opt/backups/db_YYYYMMDD.sql.gz | docker exec -i PGCONTAINER psql -U postgres -d ethra-nexus
   ```

2. Se tabelas ainda existem mas com dados inválidos: TRUNCATE seletivo + re-seed

3. Pior caso: dropar tudo e reaplicar `infra/vps/schema-drizzle.sql` (perde dados, mas rápido)

---

## 11. Glossário

| Termo | Definição |
| --- | --- |
| **AIOS Master** | Orquestrador central — recebe tasks, valida, executa skill, registra custo |
| **Tenant** | Cliente isolado no sistema. Self-hosted = 1 tenant. Cloud = N tenants |
| **Skill** | Capacidade discreta de um agente (`wiki:query`, `channel:respond`, etc.) |
| **Wiki estratégica** | Conhecimento compartilhado por todos os agentes do tenant |
| **Wiki individual** | Aprendizado privado de um agente (padrões, erros, templates) |
| **Promoção** | Quando 3+ agentes convergem para mesma lição → vai para wiki estratégica |
| **HNSW** | Algoritmo de índice para busca vetorial aproximada (pgvector) |
| **JWT** | JSON Web Token — autenticação stateless usada pela API |

---

## 12. Histórico de versões deste documento

| Versão | Data | Autor | Mudanças |
| --- | --- | --- | --- |
| 1.0 | 2026-04-14 | Paulo Nakamura | Primeira versão, baseada em instalação real na Hostgator VPS |

---

**Ethra Nexus — AI Orchestration Platform**
Manual de instalação para produção · Abril 2026
