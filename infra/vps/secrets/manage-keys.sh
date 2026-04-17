#!/bin/bash
# ============================================================
# Ethra Nexus — Gerenciamento seguro de API keys
#
# NUNCA digite keys diretamente na linha de comando.
# Este script lê de forma segura (sem salvar no bash_history).
#
# Uso:
#   chmod +x manage-keys.sh
#   ./manage-keys.sh setup      ← primeira configuração
#   ./manage-keys.sh rotate     ← rotacionar uma key
#   ./manage-keys.sh verify     ← verificar que keys existem
#   ./manage-keys.sh encrypt    ← criptografar com senha
#   ./manage-keys.sh decrypt    ← descriptografar para uso
# ============================================================

set -euo pipefail

SECRETS_DIR="$(cd "$(dirname "$0")" && pwd)"
ENCRYPTED_DIR="${SECRETS_DIR}/encrypted"
KEY_FILES=("anthropic_key" "openrouter_key" "openai_key")

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ── Helpers ───────────────────────────────────────────────────

read_secret() {
  local prompt="$1"
  local var_name="$2"
  local value

  # Desabilita echo para não mostrar a key na tela
  echo -n "$prompt"
  read -rs value
  echo ""

  if [[ -z "$value" ]]; then
    echo -e "${RED}Valor vazio. Abortando.${NC}"
    return 1
  fi

  eval "$var_name='$value'"
}

write_key_file() {
  local name="$1"
  local value="$2"
  local file="${SECRETS_DIR}/${name}.txt"

  # Escreve com umask restritivo (apenas owner pode ler)
  (umask 077; echo -n "$value" > "$file")

  # Verifica permissões
  chmod 600 "$file"
  chown root:root "$file" 2>/dev/null || true

  echo -e "${GREEN}[OK]${NC} ${name}.txt criado (600, root:root)"
}

# ── Setup ─────────────────────────────────────────────────────

cmd_setup() {
  echo "═══════════════════════════════════════════════════"
  echo "  Ethra Nexus — Configuração de API Keys"
  echo "  As keys NÃO aparecerão na tela nem no history"
  echo "═══════════════════════════════════════════════════"
  echo ""

  # Desabilita history para este script
  set +o history 2>/dev/null || true

  for key_name in "${KEY_FILES[@]}"; do
    local human_name
    case "$key_name" in
      anthropic_key)  human_name="Anthropic API Key (sk-ant-...)" ;;
      openrouter_key) human_name="OpenRouter API Key (sk-or-...)" ;;
      openai_key)     human_name="OpenAI API Key para embeddings (sk-...)" ;;
    esac

    if [[ -f "${SECRETS_DIR}/${key_name}.txt" ]]; then
      echo -e "${YELLOW}${key_name}.txt já existe.${NC} Sobrescrever? (s/N)"
      read -r confirm
      if [[ "$confirm" != "s" && "$confirm" != "S" ]]; then
        echo "  Mantendo ${key_name}.txt existente"
        continue
      fi
    fi

    local key_value
    read_secret "  Digite ${human_name}: " key_value
    write_key_file "$key_name" "$key_value"

    # Limpa variável da memória
    unset key_value
  done

  # Reativar history
  set -o history 2>/dev/null || true

  echo ""
  echo -e "${GREEN}Keys configuradas com sucesso.${NC}"
  echo ""
  echo "Próximo: reinicie os containers para aplicar:"
  echo "  cd /opt/ethra-nexus/infra/vps"
  echo "  docker compose -f docker-compose.vps.yml restart api"
}

# ── Rotate ────────────────────────────────────────────────────

cmd_rotate() {
  echo "Qual key deseja rotacionar?"
  echo "  1) anthropic_key"
  echo "  2) openrouter_key"
  echo "  3) openai_key"
  read -rp "Escolha (1-3): " choice

  local key_name
  case "$choice" in
    1) key_name="anthropic_key" ;;
    2) key_name="openrouter_key" ;;
    3) key_name="openai_key" ;;
    *) echo "Opção inválida"; exit 1 ;;
  esac

  # Backup da key anterior
  if [[ -f "${SECRETS_DIR}/${key_name}.txt" ]]; then
    cp "${SECRETS_DIR}/${key_name}.txt" "${SECRETS_DIR}/${key_name}.txt.bak"
    chmod 600 "${SECRETS_DIR}/${key_name}.txt.bak"
    echo -e "${YELLOW}Backup salvo em ${key_name}.txt.bak${NC}"
  fi

  set +o history 2>/dev/null || true
  local new_value
  read_secret "Nova key para ${key_name}: " new_value
  write_key_file "$key_name" "$new_value"
  unset new_value
  set -o history 2>/dev/null || true

  echo ""
  echo "Reinicie o container para aplicar:"
  echo "  docker compose -f docker-compose.vps.yml restart api"
}

# ── Verify ────────────────────────────────────────────────────

cmd_verify() {
  echo "Verificando keys..."
  local all_ok=true

  for key_name in "${KEY_FILES[@]}"; do
    local file="${SECRETS_DIR}/${key_name}.txt"
    if [[ ! -f "$file" ]]; then
      echo -e "  ${RED}✗${NC} ${key_name}.txt — NÃO ENCONTRADO"
      all_ok=false
      continue
    fi

    local perms
    perms=$(stat -c '%a' "$file" 2>/dev/null || stat -f '%Lp' "$file" 2>/dev/null)
    if [[ "$perms" != "600" ]]; then
      echo -e "  ${YELLOW}!${NC} ${key_name}.txt — permissões: $perms (deveria ser 600)"
      chmod 600 "$file"
      echo "     → Corrigido para 600"
    fi

    local size
    size=$(wc -c < "$file")
    if [[ "$size" -lt 10 ]]; then
      echo -e "  ${RED}✗${NC} ${key_name}.txt — muito curto (${size} bytes)"
      all_ok=false
    else
      # Mostra apenas os primeiros 8 caracteres
      local preview
      preview=$(head -c 8 "$file")
      echo -e "  ${GREEN}✓${NC} ${key_name}.txt — ${size} bytes (${preview}...)"
    fi
  done

  if $all_ok; then
    echo -e "\n${GREEN}Todas as keys estão configuradas.${NC}"
  else
    echo -e "\n${RED}Algumas keys precisam de atenção.${NC}"
    exit 1
  fi
}

# ── Encrypt ───────────────────────────────────────────────────

cmd_encrypt() {
  command -v openssl &>/dev/null || { echo "openssl necessário"; exit 1; }

  echo "Criptografar keys com senha (AES-256-CBC)"
  echo "Útil para backups seguros."
  echo ""

  mkdir -p "$ENCRYPTED_DIR"

  local passphrase
  read_secret "Senha de criptografia: " passphrase
  local passphrase2
  read_secret "Confirme a senha: " passphrase2

  if [[ "$passphrase" != "$passphrase2" ]]; then
    echo -e "${RED}Senhas não conferem.${NC}"
    exit 1
  fi

  for key_name in "${KEY_FILES[@]}"; do
    local file="${SECRETS_DIR}/${key_name}.txt"
    if [[ -f "$file" ]]; then
      openssl enc -aes-256-cbc -salt -pbkdf2 \
        -in "$file" \
        -out "${ENCRYPTED_DIR}/${key_name}.enc" \
        -pass "pass:${passphrase}"
      chmod 600 "${ENCRYPTED_DIR}/${key_name}.enc"
      echo -e "  ${GREEN}✓${NC} ${key_name}.enc"
    fi
  done

  unset passphrase passphrase2
  echo -e "\n${GREEN}Keys criptografadas em ${ENCRYPTED_DIR}/${NC}"
  echo "Estas podem ser armazenadas em backup com segurança."
}

# ── Decrypt ───────────────────────────────────────────────────

cmd_decrypt() {
  command -v openssl &>/dev/null || { echo "openssl necessário"; exit 1; }

  echo "Descriptografar keys de backup"

  local passphrase
  read_secret "Senha de criptografia: " passphrase

  for key_name in "${KEY_FILES[@]}"; do
    local enc_file="${ENCRYPTED_DIR}/${key_name}.enc"
    if [[ -f "$enc_file" ]]; then
      openssl enc -aes-256-cbc -d -pbkdf2 \
        -in "$enc_file" \
        -out "${SECRETS_DIR}/${key_name}.txt" \
        -pass "pass:${passphrase}" 2>/dev/null
      if [[ $? -eq 0 ]]; then
        chmod 600 "${SECRETS_DIR}/${key_name}.txt"
        echo -e "  ${GREEN}✓${NC} ${key_name}.txt restaurado"
      else
        echo -e "  ${RED}✗${NC} ${key_name} — senha incorreta ou arquivo corrompido"
      fi
    fi
  done

  unset passphrase
}

# ── Main ──────────────────────────────────────────────────────

case "${1:-help}" in
  setup)   cmd_setup ;;
  rotate)  cmd_rotate ;;
  verify)  cmd_verify ;;
  encrypt) cmd_encrypt ;;
  decrypt) cmd_decrypt ;;
  *)
    echo "Uso: $0 {setup|rotate|verify|encrypt|decrypt}"
    echo ""
    echo "  setup    — configurar keys pela primeira vez"
    echo "  rotate   — rotacionar uma key"
    echo "  verify   — verificar que keys existem e estão corretas"
    echo "  encrypt  — criptografar keys para backup seguro"
    echo "  decrypt  — restaurar keys de backup criptografado"
    ;;
esac
