# CI/CD Pipeline — Ethra Nexus

**Data:** 2026-04-21
**Status:** Aprovado

---

## Objetivo

Automatizar validação de código e deploy na VPS a cada push em `main`, usando GitHub Actions + Docker Swarm + appleboy/ssh-action.

---

## Estrutura dos Jobs

```
push → [ci] → [security] → [docker] → [deploy]
                                           ↑
                               só roda em branch main
```

### Job `ci`

- Roda em: todas as branches
- Steps: typecheck → lint → test → build
- Cache npm via `actions/cache@v4` (chave: hash do `package-lock.json`)
- Typecheck exclui `@ethra-nexus/db` com `--filter=!@ethra-nexus/db` (drizzle-orm 0.35.3 usa `.d.cts`, incompatível com `moduleResolution: "Node"`; pendência técnica separada)
- Remove debug step atualmente presente no workflow

### Job `security`

- Roda em: todas as branches, após `ci`
- Steps: `npm audit` + grep por padrões de API keys (`sk-ant-`, `sk-or-`, `eyJ`)
- Sem alterações em relação ao workflow atual

### Job `docker`

- Roda em: branches `main` e `dev`, após `[ci, security]`
- Steps: build da imagem Docker + push para `ghcr.io/pnakamura/ethra-nexus:latest`
- Sem alterações em relação ao workflow atual

### Job `deploy` *(novo)*

- Roda em: apenas `main`, após `docker`
- Condição: `if: github.ref == 'refs/heads/main'`
- Usa: `appleboy/ssh-action@v1`
- Porta SSH: 22022 (porta não-padrão da VPS Hostgator)
- Script executado na VPS:
  ```bash
  docker pull ghcr.io/pnakamura/ethra-nexus:latest
  docker service update --force ethra-nexus_ethra-nexus-api
  ```

---

## Secrets do GitHub

Configurar em: **Settings → Secrets and variables → Actions**

| Secret | Descrição | Valor |
|--------|-----------|-------|
| `VPS_HOST` | IP da VPS | `129.121.38.172` |
| `VPS_USER` | Usuário SSH | ex: `root` |
| `VPS_SSH_KEY` | Chave privada SSH (par dedicado para CI) | gerada localmente |

### Procedimento para criar a chave SSH de CI

```bash
# Na máquina local — gerar par de chaves dedicado para CI
ssh-keygen -t ed25519 -C "github-actions-ci" -f ~/.ssh/ethra_nexus_ci

# Copiar chave pública para a VPS
ssh-copy-id -i ~/.ssh/ethra_nexus_ci.pub -p 22022 root@129.121.38.172

# Conteúdo da chave privada vai para o secret VPS_SSH_KEY no GitHub
cat ~/.ssh/ethra_nexus_ci
```

---

## Comportamento em falha de deploy

Docker Swarm mantém a versão anterior do serviço rodando enquanto tenta subir o novo container. Se o novo container não iniciar corretamente, o Swarm não mata o container anterior — rollback é automático pelo próprio Swarm. Não é necessário rollback manual no pipeline.

---

## Arquivo modificado

**`.github/workflows/ci.yml`** — modificações:
1. Adicionar cache npm no job `ci`
2. Corrigir comando de typecheck para excluir `@ethra-nexus/db`
3. Remover debug step
4. Adicionar job `deploy` ao final

---

## Critérios de aceite

- [ ] Push em `main` dispara pipeline completo e faz deploy na VPS automaticamente
- [ ] Push em branch de feature roda apenas `ci` + `security` (sem deploy)
- [ ] Falha em qualquer job bloqueia os jobs seguintes
- [ ] Deploy bem-sucedido: `docker service ps ethra-nexus_ethra-nexus-api` mostra novo container rodando
