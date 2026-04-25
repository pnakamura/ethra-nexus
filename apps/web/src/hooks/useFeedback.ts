import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface FeedbackItem {
  id: string
  rating: number
  comment: string | null
  created_by: string | null
  created_at: string
  aios_event_id: string
}

interface FeedbackMeta {
  total: number
  avg_rating: number
  count_by_rating: Record<string, number>
}

export function useFeedback(agentId: string) {
  return useQuery({
    queryKey: ['agents', agentId, 'feedback'],
    queryFn: () =>
      api.get<{ data: FeedbackItem[]; meta: FeedbackMeta }>(`/agents/${agentId}/feedback?limit=20`)
        .then((r) => r.data),
    enabled: !!agentId,
  })
}

export function usePostFeedback(agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { aios_event_id: string; rating: number; comment?: string }) =>
      api.post(`/agents/${agentId}/feedback`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents', agentId, 'feedback'] })
      toast.success('Feedback salvo')
    },
    onError: () => toast.error('Erro ao salvar feedback'),
  })
}
