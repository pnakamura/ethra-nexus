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

export function useWikiSearch(query: string) {
  return useQuery({
    queryKey: ['wiki', 'search', query],
    queryFn: () =>
      api.post<{ data: WikiSearchResult[] }>('/wiki/search', { query, limit: 10 })
        .then(r => r.data.data),
    enabled: query.trim().length >= 3,
  })
}

export function useWikiIngest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { content_base64: string; file_type: string; source_name: string }) =>
      api.post<IngestResult>('/wiki/ingest', { ...body, source_origin: 'api' }).then(r => r.data),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['wiki', 'index'] })
      toast.success(`Ingestão concluída: ${result.pages_persisted} página(s) salvas`)
    },
    onError: () => toast.error('Erro na ingestão'),
  })
}
