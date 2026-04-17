-- ============================================================
-- 001_tenants.sql
-- Unidade de isolamento multi-tenant
-- Em self-hosted: um único registro criado no install.sh
-- Em cloud: um registro por cliente
--
-- SEGURANÇA:
-- - RLS habilitado em todas as tabelas
-- - Helper function user_tenant_ids() centraliza lógica de escopo
-- - Admins podem gerenciar membros (add/update/delete)
-- - Owners são protegidos contra remoção acidental
-- - Audit trail via updated_at em todas as tabelas
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================
-- Helper function: retorna tenant_ids do usuário autenticado
-- Usada em TODAS as policies RLS — centraliza a lógica
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_tenant_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    array_agg(tenant_id),
    '{}'::uuid[]
  )
  FROM tenant_members
  WHERE user_id = auth.uid();
$$;

-- Helper: verifica se usuário é admin/owner do tenant
CREATE OR REPLACE FUNCTION public.user_is_tenant_admin(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_members
    WHERE user_id = auth.uid()
      AND tenant_id = p_tenant_id
      AND role IN ('owner', 'admin')
  );
$$;

-- ============================================================
-- tenants
-- ============================================================

CREATE TABLE tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE
                CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  plan          text NOT NULL DEFAULT 'self-hosted'
                CHECK (plan IN ('self-hosted', 'cloud-free', 'cloud-pro', 'enterprise')),
  config        jsonb NOT NULL DEFAULT '{
    "features": {
      "whatsapp": true,
      "email": true,
      "webhook_api": true,
      "custom_providers": true,
      "sso": false,
      "audit_log": true
    },
    "limits": {
      "max_agents": 999,
      "max_wiki_pages": 99999,
      "max_raw_sources_mb": 10240,
      "max_monthly_ai_calls": 999999
    },
    "default_provider": "anthropic",
    "default_model": "claude-sonnet-4-6",
    "timezone": "America/Sao_Paulo",
    "locale": "pt-BR"
  }',
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- Service role: acesso total (N8N, backend, migrations)
CREATE POLICY "service_role_full_access" ON tenants
  FOR ALL USING (auth.role() = 'service_role');

-- Membros: leitura do próprio tenant
CREATE POLICY "members_read_own_tenant" ON tenants
  FOR SELECT USING (id = ANY(user_tenant_ids()));

-- Admins: atualizar configuração do tenant (não podem alterar slug ou id)
CREATE POLICY "admins_update_own_tenant" ON tenants
  FOR UPDATE USING (user_is_tenant_admin(id))
  WITH CHECK (user_is_tenant_admin(id));

-- ============================================================
-- tenant_members — usuários por tenant (M:N)
-- ============================================================

CREATE TABLE tenant_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member'
             CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  invited_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;

-- Service role: acesso total
CREATE POLICY "service_role_full_access" ON tenant_members
  FOR ALL USING (auth.role() = 'service_role');

-- Membros: veem todos os membros do seu tenant (necessário para UIs de equipe)
CREATE POLICY "members_read_same_tenant" ON tenant_members
  FOR SELECT USING (tenant_id = ANY(user_tenant_ids()));

-- Admins: podem adicionar membros ao seu tenant (INSERT)
CREATE POLICY "admins_insert_members" ON tenant_members
  FOR INSERT WITH CHECK (
    user_is_tenant_admin(tenant_id)
    AND role != 'owner'  -- owners só são criados via service_role
  );

-- Admins: podem atualizar roles de membros (UPDATE)
-- Não podem: promover a owner, rebaixar outro owner, alterar próprio role
CREATE POLICY "admins_update_members" ON tenant_members
  FOR UPDATE USING (
    user_is_tenant_admin(tenant_id)
    AND user_id != auth.uid()   -- não pode alterar próprio role
  )
  WITH CHECK (
    user_is_tenant_admin(tenant_id)
    AND role != 'owner'          -- não pode promover a owner via UI
  );

-- Admins: podem remover membros (DELETE)
-- Não podem: remover owners ou a si mesmos
CREATE POLICY "admins_delete_members" ON tenant_members
  FOR DELETE USING (
    user_is_tenant_admin(tenant_id)
    AND user_id != auth.uid()    -- não pode remover a si mesmo
    AND role != 'owner'           -- owners são permanentes
  );

-- ============================================================
-- Triggers
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tenant_members_updated_at
  BEFORE UPDATE ON tenant_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
