// ============================================================
// Agent — especificação completa de um agente Ethra Nexus
//
// Um agente é definido por 5 dimensões:
//
//   1. IDENTIDADE  → quem é, system prompt, wiki, personalidade
//   2. SKILLS      → o que sabe fazer (capacidades discretas)
//   3. ATIVAÇÃO    → quando age (on-demand, schedule, evento)
//   4. CANAIS      → onde se comunica (WhatsApp, chat, email, webhook)
//   5. ORÇAMENTO   → quanto pode gastar (budget, tokens, alertas)
//
// O AIOS Master orquestra agentes via skills, não via tipos hardcoded.
// Um agente de "atendimento" é simplesmente um agente com as skills
// `wiki:query`, `channel:respond`, e canais WhatsApp/webchat habilitados.
// ============================================================

// ── 1. IDENTIDADE ────────────────────────────────────────────

export type AgentStatus =
  | 'setup'           // configuração inicial, não operacional
  | 'active'          // operacional, pronto para receber tasks
  | 'paused'          // pausado manualmente pelo operador
  | 'budget_exceeded' // pausado automaticamente por limite de orçamento
  | 'error'           // falha que requer intervenção
  | 'archived'        // desativado permanentemente (soft delete)

export interface AgentIdentity {
  system_prompt: string           // prompt base do agente — define personalidade e regras
  system_prompt_extra?: string    // adendo do operador (aplicado DEPOIS do base)
  response_language: string       // 'pt-BR' | 'en' | 'es' | etc.
  tone: AgentTone                 // tom de comunicação
  restrictions: string[]          // lista de coisas que o agente NÃO deve fazer/dizer
}

export type AgentTone =
  | 'formal'          // corporativo, objetivo
  | 'professional'    // profissional mas acessível
  | 'friendly'        // amigável, caloroso
  | 'technical'       // técnico, detalhado
  | 'custom'          // definido no system_prompt

// ── 2. SKILLS ────────────────────────────────────────────────
//
// Skill = capacidade discreta que o agente pode executar.
// O AIOS Master despacha tasks para skills, não para "tipos de agente".
//
// Skills built-in são fornecidas pelo Ethra Nexus.
// Skills custom são implementadas via N8N workflows.

export type BuiltinSkillId =
  | 'wiki:query'        // busca e responde usando a wiki do agente
  | 'wiki:ingest'       // processa novos documentos para a wiki
  | 'wiki:lint'         // audita saúde da wiki
  | 'channel:respond'   // responde em um canal de comunicação
  | 'channel:proactive' // envia mensagem proativa (notificação, alerta)
  | 'report:generate'   // gera relatório estruturado
  | 'monitor:health'    // verifica saúde de processos/sistemas
  | 'monitor:alert'     // avalia condições e dispara alertas
  | 'data:analyze'      // analisa dados estruturados (CSV, JSON, planilhas)
  | 'data:extract'      // extrai dados de documentos não-estruturados
  | 'a2a:call'          // delega task para agente externo via protocolo A2A

export type SkillId = BuiltinSkillId | `custom:${string}`

export interface SkillConfig {
  skill_id: SkillId
  enabled: boolean

  // Provider override para esta skill específica
  // Se não definido, usa o provider do agente; se nem esse, usa MODULE_PROVIDER_MAP
  provider_override?: ProviderOverride

  // Limites específicos desta skill
  max_tokens_per_call?: number    // máximo de tokens (input+output) por execução
  max_calls_per_hour?: number     // rate limit desta skill
  timeout_ms?: number             // timeout da execução (default: 30000)

  // Parâmetros específicos da skill (varia por skill_id)
  params?: Record<string, unknown>
}

export interface ProviderOverride {
  provider: 'anthropic' | 'openrouter'
  model: string
  temperature?: number
}

// ── 3. ATIVAÇÃO ──────────────────────────────────────────────
//
// Quando e como o agente é acionado.
// Um agente pode ter múltiplos modos de ativação simultâneos.

export type ActivationMode =
  | ActivationOnDemand
  | ActivationScheduled
  | ActivationEvent

export interface ActivationOnDemand {
  mode: 'on_demand'
  // Ativado por interação direta: mensagem em canal, chamada de API, ou UI
  // Nenhuma configuração extra — depende dos canais configurados
}

export interface ActivationScheduled {
  mode: 'scheduled'
  schedules: ScheduleEntry[]
}

export interface ScheduleEntry {
  id: string                      // identificador único do schedule
  name: string                    // nome descritivo: "Relatório diário", "Health check"
  cron: string                    // expressão cron: '0 9 * * 1-5'
  timezone: string                // 'America/Sao_Paulo'
  skill_id: SkillId               // qual skill executar
  payload: Record<string, unknown> // parâmetros passados para a skill
  enabled: boolean
  last_run_at?: string
  next_run_at?: string
}

export interface ActivationEvent {
  mode: 'event'
  listeners: EventListener[]
}

export interface EventListener {
  id: string
  name: string                    // "Novo documento", "Webhook recebido"
  event_type: EventType
  filter?: Record<string, unknown> // filtro opcional sobre o payload do evento
  skill_id: SkillId               // qual skill executar quando o evento ocorre
  payload_mapping?: Record<string, string> // mapeia campos do evento para params da skill
  enabled: boolean
  cooldown_ms?: number            // tempo mínimo entre ativações (debounce)
}

export type EventType =
  | 'wiki:source_added'       // novo arquivo em raw/
  | 'wiki:page_updated'       // página da wiki foi atualizada
  | 'wiki:lint_failed'        // lint detectou problema
  | 'channel:message_received' // mensagem recebida em um canal
  | 'webhook:received'        // webhook externo recebido
  | 'agent:error'             // outro agente falhou
  | 'budget:threshold'        // orçamento atingiu threshold
  | 'schedule:completed'      // schedule de outro agente completou
  | `custom:${string}`        // evento customizado via N8N

// ── 4. CANAIS ────────────────────────────────────────────────

export type ChannelType = 'whatsapp' | 'webchat' | 'email' | 'webhook' | 'slack' | 'api'

export interface WhatsAppChannel {
  type: 'whatsapp'
  phone_number: string
  evolution_instance: string
  webhook_url: string
  welcome_message?: string
}

export interface WebChatChannel {
  type: 'webchat'
  widget_key: string
  allowed_origins: string[]
  theme?: Record<string, string>  // cores, posição do widget
  welcome_message?: string
}

export interface EmailChannel {
  type: 'email'
  address: string
  imap_host?: string
  smtp_host?: string
  auto_reply?: boolean
}

export interface WebhookChannel {
  type: 'webhook'
  endpoint_url: string
  secret: string
  events: string[]
  retry_policy?: RetryPolicy
}

export interface SlackChannel {
  type: 'slack'
  bot_token: string
  channel_ids: string[]          // pode operar em múltiplos canais
}

export interface ApiChannel {
  type: 'api'
  api_key: string                // chave específica deste agente para chamadas diretas
  allowed_ips?: string[]         // whitelist de IPs (vazio = qualquer)
  rate_limit_per_minute: number
}

export type Channel =
  | WhatsAppChannel
  | WebChatChannel
  | EmailChannel
  | WebhookChannel
  | SlackChannel
  | ApiChannel

export interface RetryPolicy {
  max_retries: number
  backoff_ms: number             // intervalo base entre retries
  backoff_multiplier: number     // multiplicador exponencial
}

// ── 5. ORÇAMENTO ─────────────────────────────────────────────
//
// Controle granular de custo por agente.
// O AIOS Master verifica o budget ANTES de cada execução.
// Se o budget está excedido, a task é rejeitada (não enfileirada).

export interface AgentBudget {
  // ── Limites mensais ────────────────────────────────────
  monthly_limit_usd: number       // limite mensal em USD (0 = sem limite)
  monthly_token_limit: number     // limite de tokens (input+output) por mês (0 = sem limite)

  // ── Limites por chamada ────────────────────────────────
  max_tokens_per_call: number     // máximo tokens por chamada individual (default: 4096)
  max_input_tokens: number        // máximo tokens de input (previne prompts gigantes)

  // ── Alertas ────────────────────────────────────────────
  alert_thresholds: AlertThreshold[]

  // ── Ação ao atingir limite ─────────────────────────────
  on_limit_reached: BudgetLimitAction

  // ── Estado atual (calculado, não configurado) ──────────
  current_period_start: string    // início do período atual (ISO date)
  current_spend_usd: number       // gasto acumulado no período
  current_token_usage: number     // tokens usados no período
}

export interface AlertThreshold {
  percent: number                 // 50, 75, 90, 95, 100
  action: AlertAction
  notified_at?: string            // quando o alerta foi disparado (null = ainda não)
}

export type AlertAction =
  | 'notify_dashboard'            // mostra alerta no dashboard
  | 'notify_email'                // envia email para admins do tenant
  | 'notify_webhook'              // chama webhook configurado
  | 'notify_all'                  // todas as notificações acima

export type BudgetLimitAction =
  | 'pause_agent'                 // pausa o agente (status → budget_exceeded)
  | 'alert_only'                  // apenas notifica, continua operando
  | 'downgrade_model'             // muda para modelo mais barato (fallback)
  | 'reject_new_tasks'            // rejeita novas tasks mas completa as em andamento

// ── AGENT (estrutura completa) ───────────────────────────────

export interface AgentConfig {
  identity: AgentIdentity
  skills: SkillConfig[]
  activation: ActivationMode[]
  channels: Channel[]
  budget: AgentBudget
  wiki_inherit_system: boolean    // queries incluem system wiki
}

export interface Agent {
  id: string
  tenant_id: string
  name: string
  slug: string                    // identificador único dentro do tenant
  status: AgentStatus
  config: AgentConfig
  wiki_scope: string              // 'agent-{slug}' — namespace da wiki
  description?: string
  avatar_url?: string
  tags: string[]                  // tags para organização: ['atendimento', 'vendas', 'suporte']
  created_at: string
  updated_at: string
  last_active_at?: string         // última vez que o agente executou uma task
}

// ── DEFAULTS DE FÁBRICA ──────────────────────────────────────

export const DEFAULT_BUDGET: AgentBudget = {
  monthly_limit_usd: 50,
  monthly_token_limit: 0,         // sem limite de tokens (controlado pelo USD)
  max_tokens_per_call: 4096,
  max_input_tokens: 8192,
  alert_thresholds: [
    { percent: 50, action: 'notify_dashboard' },
    { percent: 75, action: 'notify_dashboard' },
    { percent: 90, action: 'notify_email' },
    { percent: 100, action: 'notify_all' },
  ],
  on_limit_reached: 'pause_agent',
  current_period_start: new Date().toISOString(),
  current_spend_usd: 0,
  current_token_usage: 0,
}

// Templates de agent prontos para uso
export const AGENT_TEMPLATES = {
  atendimento: {
    skills: ['wiki:query', 'channel:respond'] as SkillId[],
    activation: [{ mode: 'on_demand' as const }],
    tone: 'professional' as AgentTone,
    tags: ['atendimento', 'suporte'],
  },
  monitoramento: {
    skills: ['monitor:health', 'monitor:alert', 'channel:proactive'] as SkillId[],
    activation: [
      { mode: 'on_demand' as const },
      { mode: 'scheduled' as const, schedules: [] },
    ],
    tone: 'technical' as AgentTone,
    tags: ['monitoramento', 'infraestrutura'],
  },
  knowledge: {
    skills: ['wiki:ingest', 'wiki:query', 'wiki:lint', 'data:extract'] as SkillId[],
    activation: [
      { mode: 'on_demand' as const },
      { mode: 'event' as const, listeners: [] },
    ],
    tone: 'technical' as AgentTone,
    tags: ['conhecimento', 'documentos'],
  },
} as const

// ============================================================
// Task e Result — contrato de execução do AIOS Master
// ============================================================

export interface AgentContext {
  tenant_id: string
  agent_id: string
  user_id?: string
  session_id: string
  wiki_scope: string
  conversation_id?: string
  channel_type?: ChannelType
  timestamp: string

  // Orçamento restante — passado pelo AIOS Master para que skills possam respeitar
  budget_remaining_usd: number
  tokens_remaining: number
}

export type AgentResult<T> =
  | { ok: true; data: T; agent_id: string; skill_id: SkillId; timestamp: string; tokens_used: number; cost_usd: number }
  | { ok: false; error: AgentError; agent_id: string; skill_id: SkillId; timestamp: string }

export interface AgentError {
  code: AgentErrorCode
  message: string
  context?: Record<string, unknown>
  retryable: boolean
}

export type AgentErrorCode =
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'BUDGET_EXCEEDED'
  | 'TOKEN_LIMIT_EXCEEDED'
  | 'INVALID_INPUT'
  | 'SKILL_NOT_FOUND'
  | 'SKILL_DISABLED'
  | 'AGENT_NOT_FOUND'
  | 'AGENT_PAUSED'
  | 'MAX_DEPTH_EXCEEDED'
  | 'DB_ERROR'
  | 'AI_ERROR'
  | 'WIKI_ERROR'
  | 'CHANNEL_ERROR'
  | 'EXTERNAL_AGENT_ERROR'
  | 'UNKNOWN'

export interface AiosEvent {
  id: string
  tenant_id: string
  agent_id: string
  skill_id: SkillId
  activation_mode: 'on_demand' | 'scheduled' | 'event' | 'a2a'
  activation_source?: string      // schedule_id, event_type, ou channel_type
  payload: Record<string, unknown>
  result?: Record<string, unknown>
  status: 'pending' | 'running' | 'ok' | 'error'
  tokens_used: number
  cost_usd: number
  started_at: string
  completed_at?: string
  error_code?: string
  retryable: boolean
  triggered_by?: string           // user_id ou 'system'
  user_ip?: string
}
