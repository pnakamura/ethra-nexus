#!/usr/bin/env bash
#
# verify-copilot-setup.sh
#
# Valida toda a pipeline de setup do AIOS Master Agent (Spec #1) antes de testar.
#
# Uso:
#   # Modo 1 — psql direto (precisa DATABASE_URL definida):
#   export DATABASE_URL=postgres://postgres:senha@host:5432/postgres
#   ./scripts/verify-copilot-setup.sh
#
#   # Modo 2 — docker exec no container postgres do VPS:
#   PG_CONTAINER=easypanel-supabase-db-1 ./scripts/verify-copilot-setup.sh
#
# Exit code:
#   0 = tudo OK, pronto pra testar
#   1 = falha crítica
#   2 = warnings, talvez funcione

set -uo pipefail

# ── Cores ──────────────────────────────────────────────────
if [[ -t 1 ]]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
  CYAN=$'\033[36m'; BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; CYAN=''; BOLD=''; DIM=''; RESET=''
fi

CRITICAL=0
WARNINGS=0

ok()    { echo "  ${GREEN}✓${RESET} $1"; }
fail()  { echo "  ${RED}✗${RESET} $1"; CRITICAL=$((CRITICAL+1)); }
warn()  { echo "  ${YELLOW}⚠${RESET} $1"; WARNINGS=$((WARNINGS+1)); }
head()  { echo; echo "${BOLD}${CYAN}$1${RESET}"; }
note()  { echo "  ${DIM}$1${RESET}"; }

# ── Detectar modo de conexão ───────────────────────────────
PG_QUERY=""

if [[ -n "${PG_CONTAINER:-}" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "${RED}docker não encontrado mas PG_CONTAINER=$PG_CONTAINER foi setado${RESET}"
    exit 1
  fi
  PG_QUERY="docker exec -i $PG_CONTAINER psql -U postgres -d postgres -At -c"
  echo "${DIM}Modo: docker exec via container ${PG_CONTAINER}${RESET}"
elif [[ -n "${DATABASE_URL:-}" ]]; then
  if ! command -v psql >/dev/null 2>&1; then
    echo "${RED}psql não encontrado e DATABASE_URL setado.${RESET}"
    echo "${DIM}Alternativas: setar PG_CONTAINER=<nome-do-container> ou instalar psql.${RESET}"
    exit 1
  fi
  PG_QUERY="psql $DATABASE_URL -At -c"
  masked=$(echo "$DATABASE_URL" | sed -E 's|://[^:]+:[^@]+@|://***:***@|')
  echo "${DIM}Modo: psql direto (${masked})${RESET}"
else
  echo "${RED}Defina DATABASE_URL ou PG_CONTAINER antes de rodar.${RESET}"
  echo
  echo "Exemplos:"
  echo "  DATABASE_URL=postgres://postgres:senha@host:5432/postgres ./$(basename "$0")"
  echo "  PG_CONTAINER=easypanel-supabase-db-1 ./$(basename "$0")"
  exit 1
fi

# ── Wrapper que executa SQL e captura output ───────────────
q() {
  $PG_QUERY "$1" 2>/dev/null
}

# ── 1. Conexão ─────────────────────────────────────────────
head "1. Conexão com Postgres"

VERSION=$(q "SELECT version();" | head -1)
if [[ -z "$VERSION" ]]; then
  fail "Falha ao conectar"
  echo "${RED}${BOLD}Bloqueio: não consigo conectar ao DB.${RESET}"
  exit 1
fi
ok "Conectado: $(echo "$VERSION" | awk '{print $1, $2}')"

# ── 2. Helper functions ────────────────────────────────────
head "2. Helper functions (migration 001)"

for fn in update_updated_at user_tenant_ids; do
  count=$(q "SELECT COUNT(*) FROM pg_proc WHERE proname = '$fn';")
  if [[ "$count" == "1" || "$count" -gt 0 ]]; then
    ok "Função ${fn}() existe"
  else
    fail "Função ${fn}() AUSENTE — migration 001 não aplicada"
  fi
done

# ── 3. Base tables ─────────────────────────────────────────
head "3. Base tables (migrations existentes)"

for tbl in tenants agents aios_events budgets provider_usage_log wiki_strategic_pages wiki_agent_writes; do
  count=$(q "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = '$tbl';")
  if [[ "$count" -ge 1 ]]; then
    ok "Tabela $tbl"
  else
    fail "Tabela $tbl AUSENTE"
  fi
done

# ── 4. Copilot tables (migration 021) ──────────────────────
head "4. Copilot tables (migration 021)"

for tbl in copilot_conversations copilot_messages copilot_tool_calls; do
  result=$(q "SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = '$tbl';")
  if [[ -z "$result" ]]; then
    fail "Tabela $tbl AUSENTE — migration 021 não aplicada"
  elif [[ "$result" == "t" ]]; then
    ok "Tabela $tbl (RLS ✓)"
  else
    fail "Tabela $tbl existe MAS RLS desabilitada"
  fi
done

# ── 5. RLS policies ────────────────────────────────────────
head "5. RLS policies em copilot_*"

declare -a EXPECTED_POLICIES=(
  "copilot_conversations|service_role_full_access"
  "copilot_conversations|members_read_own_conversations"
  "copilot_messages|service_role_full_access"
  "copilot_messages|members_read_own_messages"
  "copilot_tool_calls|service_role_full_access"
  "copilot_tool_calls|members_read_own_tool_calls"
)

for entry in "${EXPECTED_POLICIES[@]}"; do
  IFS='|' read -r tbl pol <<< "$entry"
  count=$(q "SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = '$tbl' AND policyname = '$pol';")
  if [[ "$count" -ge 1 ]]; then
    ok "${tbl}.${pol}"
  else
    fail "Policy ${tbl}.${pol} AUSENTE"
  fi
done

# ── 6. CHECK constraints ───────────────────────────────────
head "6. CHECK constraints"

# copilot_conversations.status
def=$(q "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE contype = 'c' AND conrelid = 'copilot_conversations'::regclass;")
if echo "$def" | grep -q "status.*active.*archived"; then
  ok "copilot_conversations: status ∈ ('active','archived')"
else
  fail "CHECK copilot_conversations.status AUSENTE"
fi

# copilot_messages.role
def=$(q "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE contype = 'c' AND conrelid = 'copilot_messages'::regclass;")
if echo "$def" | grep -q "role.*user.*assistant"; then
  ok "copilot_messages: role ∈ ('user','assistant')"
else
  fail "CHECK copilot_messages.role AUSENTE"
fi

# copilot_tool_calls.status
def=$(q "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE contype = 'c' AND conrelid = 'copilot_tool_calls'::regclass;")
if echo "$def" | grep -q "status.*completed.*error"; then
  ok "copilot_tool_calls: status ∈ ('completed','error')"
else
  fail "CHECK copilot_tool_calls.status AUSENTE"
fi

# ── 7. updated_at trigger ──────────────────────────────────
head "7. Trigger updated_at em copilot_conversations"

count=$(q "SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'copilot_conversations_updated_at' AND NOT tgisinternal;")
if [[ "$count" -ge 1 ]]; then
  ok "Trigger copilot_conversations_updated_at existe"
else
  fail "Trigger AUSENTE — updated_at não vai atualizar"
fi

# ── 8. Audit K2: tenant_members.copilot_enabled ausente ────
head "8. Audit K2: tenant_members.copilot_enabled NÃO foi adicionado"

count=$(q "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tenant_members' AND column_name = 'copilot_enabled';")
if [[ "$count" == "0" ]]; then
  ok "tenant_members.copilot_enabled ausente (correto)"
else
  warn "tenant_members.copilot_enabled existe — sobra de migration anterior"
  note "Drop: ALTER TABLE tenant_members DROP COLUMN copilot_enabled;"
fi

# ── 9. Aios-master agent seed (migration 022) ──────────────
head "9. Seed do aios-master agent (migration 022)"

seed_count=$(q "SELECT COUNT(*) FROM agents WHERE slug = 'aios-master';")
if [[ "$seed_count" == "0" || -z "$seed_count" ]]; then
  fail "Nenhum aios-master encontrado — migration 022 não aplicada"
else
  ok "$seed_count agent(s) aios-master cadastrado(s)"
  details=$(q "SELECT t.slug || '|' || substr(a.id::text, 1, 8) || '|' || a.model || '|' || a.budget_monthly || '|' || a.status FROM agents a JOIN tenants t ON t.id = a.tenant_id WHERE a.slug = 'aios-master';")
  while IFS='|' read -r tslug aid model budget status; do
    [[ -z "$tslug" ]] && continue
    note "tenant=$tslug  id=${aid}…  model=$model  budget=\$$budget  status=$status"
    if [[ "$model" != "claude-sonnet-4-6" ]]; then
      warn "Model esperado claude-sonnet-4-6, encontrado $model"
    fi
    if [[ "$status" != "active" ]]; then
      warn "Status esperado active, encontrado $status"
    fi
  done <<< "$details"
fi

# ── 10. Indexes ────────────────────────────────────────────
head "10. Indexes em copilot_*"

declare -a EXPECTED_INDEXES=(
  cc_tenant_user_recent_idx cc_tenant_status_idx
  cm_conv_time_idx
  ctc_tenant_tool_time_idx ctc_message_idx ctc_status_idx
)

for idx in "${EXPECTED_INDEXES[@]}"; do
  count=$(q "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = '$idx';")
  if [[ "$count" -ge 1 ]]; then
    ok "Index $idx"
  else
    fail "Index $idx AUSENTE"
  fi
done

# Audit-removed index
count=$(q "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'cm_tenant_role_idx';")
if [[ "$count" == "0" || -z "$count" ]]; then
  ok "cm_tenant_role_idx ausente (correto — removido por audit)"
else
  warn "cm_tenant_role_idx existe — deveria ter sido removido"
fi

# ── 11. Tenants e admins ───────────────────────────────────
head "11. Tenants e admin users"

tcount=$(q "SELECT COUNT(*) FROM tenants;")
if [[ "$tcount" -ge 1 ]]; then
  ok "$tcount tenant(s) cadastrado(s)"
else
  fail "Nenhum tenant — não vai dar pra logar"
fi

acount=$(q "SELECT COUNT(*) FROM tenant_members WHERE role = 'admin';" || echo "")
if [[ -z "$acount" ]]; then
  warn "Não consegui ler tenant_members (RLS pode estar bloqueando)"
elif [[ "$acount" -ge 1 ]]; then
  ok "$acount admin(s) em tenant_members"
else
  warn "Nenhum admin em tenant_members — middleware /copilot vai bloquear acesso"
fi

# ── Resumo ──────────────────────────────────────────────────
head "Resumo"

if [[ "$CRITICAL" -eq 0 && "$WARNINGS" -eq 0 ]]; then
  echo "${GREEN}${BOLD}✓ Setup completo. Pronto pra testar /copilot end-to-end.${RESET}"
  echo "${DIM}Próximos passos:${RESET}"
  echo "  1. cd .worktrees/copilot-shell"
  echo "  2. .env apontando pra esse DB + ANTHROPIC_API_KEY + JWT_SECRET"
  echo "  3. npm run dev"
  echo "  4. http://localhost:5173/login → admin → /copilot → testar"
  exit 0
elif [[ "$CRITICAL" -eq 0 ]]; then
  echo "${YELLOW}${BOLD}⚠ ${WARNINGS} warning(s) — provavelmente vai funcionar, mas revisa.${RESET}"
  exit 2
else
  echo "${RED}${BOLD}✗ ${CRITICAL} bloqueio(s) crítico(s) + ${WARNINGS} warning(s).${RESET}"
  echo "${DIM}Resolve os ✗ acima antes de testar.${RESET}"
  exit 1
fi
