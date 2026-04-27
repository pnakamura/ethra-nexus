import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'

export interface WikiSearchResult {
  id: string
  slug: string
  title: string
  type: string
  confidence: string
  similarity: number
}

export interface WikiPageItem {
  id: string
  slug: string
  title: string
  type: string
  confidence: string
  status: string
  author_type?: string
  origin?: string
  updated_at: string
}

export interface WikiApproval {
  id: string
  agent_id: string
  slug: string
  title: string
  content: string
  type: string
  target_wiki: string
  status: string
  created_at: string
}

export interface IngestResult {
  source_id: string
  pages_extracted: number
  pages_persisted: number
  pages_embedded: number
  pages_failed: number
}

export function useWikiIndex() {
  return useQuery({
    queryKey: ['wiki', 'index'],
    queryFn: () => api.get<string>('/wiki/index/strategic').then(r => r.data),
    staleTime: 30_000,
  })
}

export function useWikiPages() {
  return useQuery({
    queryKey: ['wiki', 'pages', 'strategic'],
    queryFn: () => api.get<{ data: WikiPageItem[] }>('/wiki/pages').then(r => r.data.data),
    staleTime: 15_000,
  })
}

export function useWikiAgentPages(agentId: string | null) {
  return useQuery({
    queryKey: ['wiki', 'pages', 'agent', agentId],
    queryFn: () =>
      api.get<{ data: WikiPageItem[] }>(`/wiki/agent-pages/${agentId!}`).then(r => r.data.data),
    enabled: agentId !== null,
    staleTime: 15_000,
  })
}

export function useWikiSearch(query: string) {
  return useQuery({
    queryKey: ['wiki', 'search', query],
    queryFn: () =>
      api.post<{ data: WikiSearchResult[] }>('/wiki/search', { query, limit: 10 })
        .then(r => r.data.data),
    enabled: query.trim().length >= 3,
  })
}

export function useWikiApprovals() {
  return useQuery({
    queryKey: ['wiki', 'approvals'],
    queryFn: () =>
      api.get<{ data: WikiApproval[] }>('/wiki/agent-writes/pending').then(r => r.data.data),
    staleTime: 10_000,
  })
}

export function useApproveWrite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post(`/wiki/agent-writes/${id}/approve`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki', 'approvals'] })
      qc.invalidateQueries({ queryKey: ['wiki', 'pages'] })
      toast.success('Proposta aprovada e promovida para a wiki')
    },
    onError: () => toast.error('Erro ao aprovar proposta'),
  })
}

export function useRejectWrite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post(`/wiki/agent-writes/${id}/reject`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki', 'approvals'] })
      toast.success('Proposta rejeitada')
    },
    onError: () => toast.error('Erro ao rejeitar proposta'),
  })
}

export function useWikiIngest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { content_base64: string; file_type: string; source_name: string }) =>
      api.post<IngestResult>('/wiki/ingest', { ...body, source_origin: 'api' }).then(r => r.data),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['wiki', 'index'] })
      qc.invalidateQueries({ queryKey: ['wiki', 'pages'] })
      toast.success(`Ingestão concluída: ${result.pages_persisted} página(s) salvas`)
    },
    onError: () => toast.error('Erro na ingestão'),
  })
}
