// ============================================================
// Wiki — hierarquia de conhecimento por escopo
//
// Tier 0 (system): contexto estratégico global do tenant
// Tier 1 (agent-*): conhecimento específico de cada agente
//
// Padrão Karpathy: raw → wiki → embeddings (acumula, não redescobre)
// ============================================================

export type WikiScope = 'system' | string   // 'system' | 'agent-{slug}'

export type WikiPageType =
  | 'entidade'      // pessoa, organização, produto, contrato
  | 'conceito'      // definição, termo, domínio
  | 'procedimento'  // passo a passo, SOP, processo
  | 'faq'           // pergunta frequente + resposta canônica
  | 'resposta'      // resposta gerada e validada
  | 'alerta'        // regra de monitoramento, threshold
  | 'politica'      // regra de negócio, compliance, LGPD
  | 'log'           // entrada de log (append-only)

export type WikiConfidence = 'alta' | 'media' | 'baixa' | 'pendente'

export interface WikiPageFrontmatter {
  title: string
  type: WikiPageType
  confidence: WikiConfidence
  sources: string[]
  tags: string[]
  related: string[]         // paths de páginas relacionadas
  last_reviewed?: string
  reviewed_by?: string      // 'human' | 'agent:{id}'
}

export interface WikiPage {
  id: string
  tenant_id: string
  wiki_scope: WikiScope
  agent_id?: string         // null = system wiki
  path: string              // e.g. 'entidades/empresa-abc' | 'faqs/horario-funcionamento'
  title: string
  content: string           // markdown completo
  embedding?: number[]      // vector(768) — gerado pelo pipeline
  frontmatter: WikiPageFrontmatter
  created_at: string
  updated_at: string
}

export interface WikiRawSource {
  id: string
  tenant_id: string
  wiki_scope: WikiScope
  agent_id?: string
  filename: string
  file_path: string         // path relativo em wikis/{scope}/raw/
  file_type: 'pdf' | 'md' | 'txt' | 'docx' | 'url' | 'xlsx'
  file_size_bytes: number
  status: 'pending' | 'processing' | 'done' | 'error'
  pages_generated: number
  error_message?: string
  processed_at?: string
  created_at: string
}

// ============================================================
// Operações da wiki (padrão Karpathy)
// ============================================================

export interface IngestParams {
  tenant_id: string
  wiki_scope: WikiScope
  agent_id?: string
  source_id: string
  file_content: string
  file_type: WikiRawSource['file_type']
}

export interface IngestResult {
  pages_created: number
  pages_updated: number
  pages_in_index: number
  log_entry: string
}

export interface QueryParams {
  tenant_id: string
  scopes: WikiScope[]      // busca em múltiplos escopos (ex: ['system', 'agent-atendimento'])
  query: string
  embedding: number[]
  similarity_threshold?: number
  limit?: number
}

export interface QueryResult {
  pages: WikiSearchResult[]
  query_logged: boolean
}

export interface WikiSearchResult {
  wiki_scope: WikiScope
  path: string
  title: string
  content: string
  similarity: number
  page_type: WikiPageType
}

export interface LintReport {
  wiki_scope: WikiScope
  orphaned_pages: string[]        // no index mas existem no FS
  missing_from_index: string[]    // existem no FS mas sem index
  low_confidence_pages: string[]  // confidence === 'pendente' | 'baixa'
  broken_links: Array<{ page: string; broken_ref: string }>
  contradictions: Array<{ page_a: string; page_b: string; description: string }>
  total_pages: number
  health_score: number            // 0-100
}
