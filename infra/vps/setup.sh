#!/bin/bash
# ============================================================
# Ethra Nexus — Setup VPS (Hostinger KVM 1, 4GB RAM, Ubuntu)
#
# Pré-requisitos: Docker instalado
# Uso: chmod +x setup.sh && ./setup.sh
# ============================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[ERRO]${NC} $1"; exit 1; }
step()  { echo -e "\n${BLUE}▶${NC} $1"; }

INSTALL_DIR="${INSTALL_DIR:-/opt/ethra-nexus}"
REPO_URL="https://github.com/pnakamura/ethra-nexus.git"

# ── Verificações ─────────────────────────────────────────────

step "Verificando sistema"

command -v docker &>/dev/null || error "Docker não encontrado"
command -v docker compose &>/dev/null || error "Docker Compose v2 não encontrado"

RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [[ "$RAM_MB" -lt 3500 ]]; then
  warn "RAM: ${RAM_MB}MB. Recomendado: 4GB+. O sistema pode ficar lento."
fi
log "RAM: ${RAM_MB}MB | Docker: $(docker --version | cut -d' ' -f3 | tr -d ',')"

# ── Swap (essencial para 4GB RAM) ────────────────────────────

step "Configurando swap (2GB)"

if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Priorizar RAM sobre swap
  sysctl vm.swappiness=10
  echo 'vm.swappiness=10' >> /etc/sysctl.conf
  log "Swap de 2GB criado"
else
  log "Swap já existe"
fi

# ── Clonar repositório ───────────────────────────────────────

step "Configurando repositório"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  cd "$INSTALL_DIR"
  git pull
  log "Repositório atualizado"
else
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  log "Repositório clonado"
fi

cd "$INSTALL_DIR/infra/vps"

# ── Gerar secrets ─────────────────────────────────────────────

step "Gerando credenciais"

mkdir -p secrets

if [[ ! -f .env ]]; then
  cp .env.example .env

  # Gerar senhas automaticamente
  POSTGRES_PW=$(openssl rand -base64 24 | tr -d '=/+' | head -c 32)
  JWT=$(openssl rand -base64 32)
  N8N_PW=$(openssl rand -base64 16 | tr -d '=/+' | head -c 20)
  N8N_ENC=$(openssl rand -hex 16)
  SB_PW=$(openssl rand -base64 16 | tr -d '=/+' | head -c 20)

  sed -i "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$POSTGRES_PW/" .env
  sed -i "s/JWT_SECRET=.*/JWT_SECRET=$JWT/" .env
  sed -i "s/N8N_PASSWORD=.*/N8N_PASSWORD=$N8N_PW/" .env
  sed -i "s/N8N_ENCRYPTION_KEY=.*/N8N_ENCRYPTION_KEY=$N8N_ENC/" .env
  sed -i "s/SB_PASSWORD=.*/SB_PASSWORD=$SB_PW/" .env

  log "Senhas geradas automaticamente"

  # Gerar JWT keys para Supabase
  ANON_KEY=$(docker run --rm -e JWT_SECRET="$JWT" ghcr.io/supabase/gotrue:v2.158.1 \
    sh -c 'echo "{\"role\":\"anon\",\"iss\":\"supabase\"}" | base64 -w0' 2>/dev/null || echo "GERAR_MANUALMENTE")
  SERVICE_KEY=$(docker run --rm -e JWT_SECRET="$JWT" ghcr.io/supabase/gotrue:v2.158.1 \
    sh -c 'echo "{\"role\":\"service_role\",\"iss\":\"supabase\"}" | base64 -w0' 2>/dev/null || echo "GERAR_MANUALMENTE")

  warn "Supabase JWT keys precisam ser geradas manualmente."
  warn "Use https://supabase.com/docs/guides/self-hosting#api-keys"
  warn "JWT_SECRET no .env: $JWT"
else
  log ".env já existe — mantendo"
fi

# ── Configurar API keys (de forma segura) ─────────────────────

step "Configurando API keys"

echo ""
echo -e "${YELLOW}═══════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}  CONFIGURAÇÃO OBRIGATÓRIA                        ${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════${NC}"
echo ""
echo "  1. Edite:  $INSTALL_DIR/infra/vps/.env"
echo "     - DOMAIN (seu domínio)"
echo "     - SUPABASE_ANON_KEY"
echo "     - SUPABASE_SERVICE_ROLE_KEY"
echo ""
echo "  2. As API keys serão solicitadas de forma segura"
echo "     (não ficam no bash_history nem aparecem na tela)"
echo ""

read -rp "  Deseja configurar as API keys agora? (S/n): " configure_keys
if [[ "$configure_keys" != "n" && "$configure_keys" != "N" ]]; then
  chmod +x "$INSTALL_DIR/infra/vps/secrets/manage-keys.sh"
  "$INSTALL_DIR/infra/vps/secrets/manage-keys.sh" setup
fi

echo ""
echo "  Edite o .env com seu domínio e Supabase keys:"
echo "     nano $INSTALL_DIR/infra/vps/.env"
echo "     echo 'sk-...'     > $INSTALL_DIR/infra/vps/secrets/openai_key.txt"
echo "     chmod 600 $INSTALL_DIR/infra/vps/secrets/*.txt"
echo ""
echo "  3. Configure DNS: aponte seu domínio para o IP desta VPS"
echo ""
echo -e "${YELLOW}═══════════════════════════════════════════════════${NC}"
echo ""
read -rp "  Pressione ENTER após configurar..." _

# ── SSL via Let's Encrypt ─────────────────────────────────────

step "Configurando SSL"

source .env

# Primeira execução do certbot (HTTP challenge)
docker compose -f docker-compose.vps.yml run --rm certbot \
  certonly --webroot -w /var/www/certbot \
  --email "${SMTP_USER:-admin@$DOMAIN}" \
  -d "$DOMAIN" \
  --agree-tos --no-eff-email \
  || warn "SSL falhou — verifique DNS e tente novamente com: docker compose run certbot certonly ..."

# ── Aplicar migrations ────────────────────────────────────────

step "Iniciando PostgreSQL e aplicando migrations"

docker compose -f docker-compose.vps.yml up -d postgres
sleep 5

# Aplicar todas as migrations em ordem
for migration in "$INSTALL_DIR/infra/supabase/migrations"/*.sql; do
  echo "  Aplicando: $(basename "$migration")"
  docker compose -f docker-compose.vps.yml exec -T postgres \
    psql -U postgres -d "ethra-nexus" -f "/dev/stdin" < "$migration"
done

log "Migrations aplicadas"

# ── Subir todos os serviços ───────────────────────────────────

step "Iniciando todos os serviços"

docker compose -f docker-compose.vps.yml up -d

# ── Health check ──────────────────────────────────────────────

step "Verificando saúde dos serviços"

sleep 10

services=("postgres:5432" "api:3000" "n8n:5678" "silverbullet:3002")
for svc in "${services[@]}"; do
  name="${svc%%:*}"
  port="${svc##*:}"
  if curl -sf "http://localhost:$port" &>/dev/null || \
     docker compose -f docker-compose.vps.yml exec -T "$name" echo ok &>/dev/null; then
    log "$name respondendo"
  else
    warn "$name não respondeu — verifique: docker compose logs $name"
  fi
done

# ── Resultado ─────────────────────────────────────────────────

IP=$(hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}"
echo "╔══════════════════════════════════════════════════╗"
echo "║       Ethra Nexus instalado com sucesso!         ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║                                                  ║"
echo "║  App:          https://$DOMAIN              ║"
echo "║  N8N:          https://$DOMAIN/n8n/         ║"
echo "║  Wiki:         https://$DOMAIN/wiki/        ║"
echo "║  API:          https://$DOMAIN/rest/v1/     ║"
echo "║  Auth:         https://$DOMAIN/auth/v1/     ║"
echo "║                                                  ║"
echo "║  IP:           $IP                       ║"
echo "║  PostgreSQL:   localhost:5432 (só local)         ║"
echo "║                                                  ║"
echo "║  RAM usada:                                      ║"
echo "║  $(docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}' 2>/dev/null | head -8)"
echo "║                                                  ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo "Próximos passos:"
echo "  1. Acesse https://$DOMAIN e verifique o app"
echo "  2. Acesse https://$DOMAIN/n8n/ e importe os workflows"
echo "  3. Crie seu primeiro agente via API"
echo ""
echo "Logs: cd $INSTALL_DIR/infra/vps && docker compose -f docker-compose.vps.yml logs -f"
