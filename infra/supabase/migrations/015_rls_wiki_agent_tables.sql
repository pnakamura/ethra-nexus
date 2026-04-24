-- Migration 015: RLS para wiki_agent_pages e wiki_agent_writes
-- Safe: tabelas já existem — apenas habilita RLS e adiciona políticas

ALTER TABLE wiki_agent_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON wiki_agent_pages
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "tenant_members_read" ON wiki_agent_pages
  FOR SELECT USING (tenant_id = ANY(user_tenant_ids()));

CREATE POLICY "tenant_admins_write" ON wiki_agent_pages
  FOR ALL USING (user_is_tenant_admin(tenant_id));

ALTER TABLE wiki_agent_writes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON wiki_agent_writes
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "tenant_members_read" ON wiki_agent_writes
  FOR SELECT USING (tenant_id = ANY(user_tenant_ids()));

CREATE POLICY "tenant_admins_write" ON wiki_agent_writes
  FOR ALL USING (user_is_tenant_admin(tenant_id));
