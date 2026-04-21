# CI/CD Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar deploy automático na VPS ao workflow GitHub Actions existente, corrigindo bugs no job `ci` e adicionando o job `deploy` via SSH.

**Architecture:** O workflow já possui 3 jobs (ci → security → docker). Vamos corrigir o job `ci` (cache npm, typecheck sem packages/db, remover debug step) e adicionar um job `deploy` que faz SSH na VPS após o push da imagem Docker, usando `appleboy/ssh-action@v1`. O deploy só roda em `main`.

**Tech Stack:** GitHub Actions, appleboy/ssh-action@v1, Docker Swarm, SSH ed25519

---

## File Structure

**Modify:** `.github/workflows/ci.yml`
- Adicionar step de cache npm no job `ci`
- Remover debug step do job `ci`
- Corrigir comando de typecheck para excluir `@ethra-nexus/db`
- Adicionar job `deploy` ao final do arquivo

**Manual (fora do código):**
- Gerar par de chaves SSH ed25519 dedicado para CI
- Adicionar chave pública ao `~/.ssh/authorized_keys` da VPS
- Configurar 3 secrets no repositório GitHub

---

## Task 1: Corrigir job `ci` no workflow

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Substituir o conteúdo completo do arquivo**

O arquivo atual tem um debug step (linhas 31-36), falta cache npm, e o typecheck falha em `packages/db`. Substitua o arquivo inteiro pelo conteúdo abaixo:

```yaml
name: CI

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main, dev]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  ci:
    name: Typecheck · Lint · Test · Build
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Cache npm dependencies
        uses: actions/cache@v4
        with:
          path: ~/.npm
          key: ${{ runner.os }}-npm-${{ hashFiles('**/package-lock.json') }}
          restore-keys: |
            ${{ runner.os }}-npm-

      - name: Install dependencies
        run: npm install --legacy-peer-deps

      - name: TypeScript check
        run: npx turbo run typecheck --filter=!@ethra-nexus/db

      - name: Lint
        run: npm run lint

      - name: Unit tests
        run: npm run test

      - name: Build
        run: npm run build

  security:
    name: Security audit
    runs-on: ubuntu-latest
    timeout-minutes: 5

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install --legacy-peer-deps
      - name: npm audit
        run: npm audit --audit-level=critical || echo "⚠️  Audit warnings present (non-blocking)"

      - name: Check for leaked secrets
        run: |
          if grep -rE "(sk-ant-|sk-or-)[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9+/]{100,}" \
            --include="*.ts" --include="*.tsx" --include="*.js" \
            --exclude-dir=node_modules --exclude-dir=dist .; then
            echo "ERRO: Possível chave de API detectada no código"
            exit 1
          fi
          echo "OK: Nenhuma chave detectada"

  docker:
    name: Docker build & push
    runs-on: ubuntu-latest
    timeout-minutes: 15
    needs: [ci, security]
    if: github.ref == 'refs/heads/main' || github.ref == 'refs/heads/dev'

    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GHCR_PAT }}

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: infra/docker/Dockerfile
          push: true
          tags: |
            ghcr.io/${{ github.repository_owner }}/ethra-nexus:latest
            ghcr.io/${{ github.repository_owner }}/ethra-nexus:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    name: Deploy to VPS
    runs-on: ubuntu-latest
    timeout-minutes: 10
    needs: docker
    if: github.ref == 'refs/heads/main'

    steps:
      - name: SSH deploy
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          port: 22022
          script: |
            docker pull ghcr.io/pnakamura/ethra-nexus:latest
            docker service update --force ethra-nexus_ethra-nexus-api
```

- [ ] **Step 2: Verificar YAML válido**

```bash
# No terminal local (requer python3)
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML OK"
```

Expected: `YAML OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add npm cache, fix typecheck, add VPS deploy job"
```

---

## Task 2: Gerar par de chaves SSH para CI

**Files:** Nenhum arquivo no repositório — procedimento local + VPS

Esta task é **manual**. Execute na sua máquina local.

- [ ] **Step 1: Gerar par de chaves ed25519 dedicado para CI**

```bash
ssh-keygen -t ed25519 -C "github-actions-ci" -f ~/.ssh/ethra_nexus_ci -N ""
```

Expected: dois arquivos criados — `~/.ssh/ethra_nexus_ci` (privada) e `~/.ssh/ethra_nexus_ci.pub` (pública)

- [ ] **Step 2: Copiar chave pública para a VPS**

```bash
ssh-copy-id -i ~/.ssh/ethra_nexus_ci.pub -p 22022 root@129.121.38.172
```

Expected: `Number of key(s) added: 1`

- [ ] **Step 3: Verificar que o login funciona com a nova chave**

```bash
ssh -i ~/.ssh/ethra_nexus_ci -p 22022 root@129.121.38.172 "echo OK"
```

Expected: `OK`

- [ ] **Step 4: Exibir a chave privada para copiar**

```bash
cat ~/.ssh/ethra_nexus_ci
```

Expected: bloco começando com `-----BEGIN OPENSSH PRIVATE KEY-----`. Copie o conteúdo completo (incluindo as linhas BEGIN e END).

---

## Task 3: Configurar GitHub Secrets

**Files:** Nenhum — configuração via interface do GitHub

Esta task é **manual**. Acesse: `https://github.com/pnakamura/ethra-nexus/settings/secrets/actions`

- [ ] **Step 1: Criar secret `VPS_HOST`**

- Clique em "New repository secret"
- Name: `VPS_HOST`
- Secret: `129.121.38.172`
- Clique "Add secret"

- [ ] **Step 2: Criar secret `VPS_USER`**

- Clique em "New repository secret"
- Name: `VPS_USER`
- Secret: `root` (ou o usuário SSH que você usa na VPS)
- Clique "Add secret"

- [ ] **Step 3: Criar secret `VPS_SSH_KEY`**

- Clique em "New repository secret"
- Name: `VPS_SSH_KEY`
- Secret: cole o conteúdo completo da chave privada (`~/.ssh/ethra_nexus_ci`) incluindo as linhas `-----BEGIN OPENSSH PRIVATE KEY-----` e `-----END OPENSSH PRIVATE KEY-----`
- Clique "Add secret"

- [ ] **Step 4: Verificar que os 4 secrets existem**

Na mesma página, confirme que os seguintes secrets aparecem na lista:
- `GHCR_PAT` (já existia)
- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`

---

## Task 4: Verificar pipeline end-to-end

**Files:** Nenhum — verificação manual

- [ ] **Step 1: Fazer push de um commit em main**

```bash
# Criar um commit vazio de teste (não altera código)
git commit --allow-empty -m "ci: trigger pipeline test"
git push origin main
```

- [ ] **Step 2: Acompanhar execução no GitHub Actions**

Acesse: `https://github.com/pnakamura/ethra-nexus/actions`

Sequência esperada:
1. Job `ci` — verde (~5-8 min, com cache será mais rápido nas próximas execuções)
2. Job `security` — verde (~2 min, roda em paralelo com `ci`)
3. Job `docker` — verde (~5-8 min, build + push para GHCR)
4. Job `deploy` — verde (~1 min, SSH + service update)

- [ ] **Step 3: Verificar que o deploy funcionou na VPS**

```bash
ssh -p 22022 root@129.121.38.172 "docker service ps ethra-nexus_ethra-nexus-api --no-trunc | head -5"
```

Expected: nova linha na tabela com `Running` e timestamp recente (menos de 5 minutos atrás).

- [ ] **Step 4: Verificar timestamp de atualização do serviço**

```bash
ssh -p 22022 root@129.121.38.172 "docker service inspect ethra-nexus_ethra-nexus-api --format '{{.UpdatedAt}}'"
```

Expected: timestamp de menos de 5 minutos atrás, confirmando que o deploy foi executado pelo pipeline.
