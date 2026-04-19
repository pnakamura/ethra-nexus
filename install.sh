#!/bin/bash
# ============================================================
# Ethra Nexus — VPS Installer
# Testado em: Ubuntu 22.04 LTS
#
# Uso:
#   curl -sSL https://raw.githubusercontent.com/pnakamura/ethra-nexus/main/install.sh | bash
#
# Ou localmente:
#   chmod +x install.sh && ./install.sh
# ============================================================

set -euo pipefail

NEXUS_VERSION="${NEXUS_VERSION:-latest}"
INSTALL_DIR="${INSTALL_DIR:-/opt/ethra-nexus}"
REPO_URL="https://github.com/pnakamura/ethra-nexus.git"
MIN_RAM_MB=2048
MIN_DISK_GB=20

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

banner() {
  echo -e "${BLUE}"
  echo "╔══════════════════════════════════════╗"
  echo "║           ETHRA NEXUS                ║"
  echo "║   AI Agent Orchestration Platform    ║"
  echo "║          v${NEXUS_VERSION}                  ║"
  echo "╚══════════════════════════════════════╝"
  echo -e "${NC}"
}

log()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()   { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()  { echo -e "${RED}[ERRO]${NC} $1"; exit 1; }
info()   { echo -e "${BLUE}[INFO]${NC} $1"; }
step()   { echo -e "\n${BLUE}▶${NC} $1"; }

# ── Verificações de pré-requisitos ────────────────────────────

check_os() {
  step "Verificando sistema operacional"
  if [[ "$(uname -s)" != "Linux" ]]; then
    error "Este installer requer Linux (Ubuntu 22.04 LTS recomendado)"
  fi
  log "Linux detectado"
}

check_ram() {
  step "Verificando memória RAM"
  local ram_mb
  ram_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  if [[ "$ram_mb" -lt "$MIN_RAM_MB" ]]; then
    warn "RAM disponível: ${ram_mb}MB (mínimo recomendado: ${MIN_RAM_MB}MB)"
    warn "O sistema pode ter performance reduzida"
  else
    log "RAM: ${ram_mb}MB"
  fi
}

check_disk() {
  step "Verificando espaço em disco"
  local disk_gb
  disk_gb=$(df -BG / | awk 'NR==2 {print int($4)}')
  if [[ "$disk_gb" -lt "$MIN_DISK_GB" ]]; then
    error "Espaço insuficiente: ${disk_gb}GB (mínimo: ${MIN_DISK_GB}GB)"
  fi
  log "Disco disponível: ${disk_gb}GB"
}

check_command() {
  command -v "$1" &>/dev/null || error "$1 não encontrado. Instale antes de continuar."
}

check_dependencies() {
  step "Verificando dependências"
  check_command "docker"
  check_command "git"
  check_command "curl"

  # Verifica docker compose (v2)
  if ! docker compose version &>/dev/null; then
    error "Docker Compose v2 não encontrado. Execute: apt install docker-compose-plugin"
  fi

  log "Docker: $(docker --version | cut -d' ' -f3 | tr -d ',')"
  log "Docker Compose: $(docker compose version --short)"
  log "Git: $(git --version | cut -d' ' -f3)"
}

# ── Instalação ────────────────────────────────────────────────

clone_or_update() {
  step "Configurando repositório"
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Repositório existente detectado em $INSTALL_DIR"
    info "Atualizando para versão $NEXUS_VERSION..."
    cd "$INSTALL_DIR"
    git fetch origin
    git checkout "$NEXUS_VERSION" 2>/dev/null || git checkout main
    git pull
    log "Repositório atualizado"
  else
    info "Clonando repositório em $INSTALL_DIR..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    if [[ "$NEXUS_VERSION" != "latest" ]]; then
      git checkout "v$NEXUS_VERSION" 2>/dev/null || true
    fi
    log "Repositório clonado"
  fi
}

configure_env() {
  step "Configurando variáveis de ambiente"
  cd "$INSTALL_DIR"

  if [[ -f ".env" ]]; then
    warn ".env já existe — mantendo configuração existente"
    return
  fi

  cp .env.example .env

  # Gera secrets automáticos
  local app_secret n8n_key n8n_pass
  app_secret=$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | tr -dc 'a-f0-9' | fold -w 64 | head -1)
  n8n_key=$(openssl rand -hex 16 2>/dev/null || cat /dev/urandom | tr -dc 'a-f0-9' | fold -w 32 | head -1)
  n8n_pass=$(openssl rand -base64 16 | tr -d '=/+' | head -c 20)

  sed -i "s/APP_SECRET=change-this-to-a-random-64-char-string/APP_SECRET=$app_secret/" .env
  sed -i "s/N8N_ENCRYPTION_KEY=change-this-to-a-random-32-char-string/N8N_ENCRYPTION_KEY=$n8n_key/" .env
  sed -i "s/N8N_BASIC_AUTH_PASSWORD=change-this-password/N8N_BASIC_AUTH_PASSWORD=$n8n_pass/" .env

  echo ""
  echo -e "${YELLOW}═══════════════════════════════════════════════════${NC}"
  echo -e "${YELLOW}  CONFIGURAÇÃO NECESSÁRIA${NC}"
  echo -e "${YELLOW}═══════════════════════════════════════════════════${NC}"
  echo ""
  echo "  Edite o arquivo: $INSTALL_DIR/.env"
  echo ""
  echo "  Obrigatório preencher:"
  echo "    ANTHROPIC_API_KEY    → https://console.anthropic.com"
  echo "    OPENROUTER_API_KEY   → https://openrouter.ai"
  echo "    SUPABASE_URL         → https://app.supabase.com"
  echo "    SUPABASE_ANON_KEY    → dashboard do seu projeto"
  echo "    SUPABASE_SERVICE_ROLE_KEY"
  echo ""
  echo "  N8N senha gerada automaticamente: $n8n_pass"
  echo "  (salva em .env — guarde em local seguro)"
  echo ""
  echo -e "${YELLOW}═══════════════════════════════════════════════════${NC}"
  echo ""
  read -rp "  Pressione ENTER após configurar o .env..." _
}

start_services() {
  step "Iniciando serviços"
  cd "$INSTALL_DIR"

  docker compose -f infra/docker/docker-compose.prod.yml pull
  docker compose -f infra/docker/docker-compose.prod.yml up -d

  log "Serviços iniciados"
}

health_check() {
  step "Verificando saúde dos serviços"
  local max_attempts=30
  local attempt=0

  info "Aguardando serviços inicializarem (até 60s)..."

  while [[ $attempt -lt $max_attempts ]]; do
    if curl -sf http://localhost:3000/health &>/dev/null; then
      break
    fi
    attempt=$((attempt + 1))
    sleep 2
  done

  if [[ $attempt -eq $max_attempts ]]; then
    warn "App não respondeu em 60s. Verifique os logs:"
    warn "  docker compose -f $INSTALL_DIR/infra/docker/docker-compose.prod.yml logs app"
  else
    log "App respondendo (${attempt} tentativas)"
  fi

  # N8N
  if curl -sf http://localhost:5678/healthz &>/dev/null; then
    log "N8N respondendo"
  else
    warn "N8N não respondeu — pode demorar mais para inicializar"
  fi
}

print_success() {
  local ip
  ip=$(hostname -I | awk '{print $1}')

  echo ""
  echo -e "${GREEN}"
  echo "╔══════════════════════════════════════════════════╗"
  echo "║        Instalação concluída com sucesso!         ║"
  echo "╠══════════════════════════════════════════════════╣"
  echo "║                                                  ║"
  echo "║  App:          http://$ip:3000           ║"
  echo "║  N8N:          http://$ip:5678           ║"
  echo "║  SilverBullet: http://$ip:3001           ║"
  echo "║                                                  ║"
  echo "║  Logs:                                           ║"
  echo "║  docker compose -f \\                             ║"
  echo "║    /opt/ethra-nexus/infra/docker/               ║"
  echo "║    docker-compose.prod.yml logs -f              ║"
  echo "║                                                  ║"
  echo "╚══════════════════════════════════════════════════╝"
  echo -e "${NC}"
}

# ── Main ──────────────────────────────────────────────────────

main() {
  banner
  check_os
  check_ram
  check_disk
  check_dependencies
  clone_or_update
  configure_env
  start_services
  health_check
  print_success
}

main "$@"
