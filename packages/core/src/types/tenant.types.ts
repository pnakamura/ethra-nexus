// ============================================================
// Tenant — unidade de isolamento multi-tenant
// Em self-hosted: sempre um único tenant (o instalador)
// Em cloud: múltiplos tenants, isolados por RLS
// ============================================================

export type TenantPlan = 'self-hosted' | 'cloud-free' | 'cloud-pro' | 'enterprise'

export interface TenantFeatures {
  whatsapp: boolean
  email: boolean
  webhook_api: boolean
  custom_providers: boolean
  sso: boolean
  audit_log: boolean
}

export interface TenantLimits {
  max_agents: number
  max_wiki_pages: number
  max_raw_sources_mb: number
  max_monthly_ai_calls: number
}

export interface TenantConfig {
  features: TenantFeatures
  limits: TenantLimits
  default_provider: string
  default_model: string
  timezone: string
  locale: string
}

export interface Tenant {
  id: string
  name: string
  slug: string             // subdomain em cloud mode: {slug}.ethranexus.com
  plan: TenantPlan
  config: TenantConfig
  is_active: boolean
  created_at: string
  updated_at: string
}

export const DEFAULT_SELF_HOSTED_CONFIG: TenantConfig = {
  features: {
    whatsapp: true,
    email: true,
    webhook_api: true,
    custom_providers: true,
    sso: false,
    audit_log: true,
  },
  limits: {
    max_agents: 999,
    max_wiki_pages: 99999,
    max_raw_sources_mb: 10240,
    max_monthly_ai_calls: 999999,
  },
  default_provider: 'anthropic',
  default_model: 'claude-sonnet-4-6',
  timezone: 'America/Sao_Paulo',
  locale: 'pt-BR',
}
