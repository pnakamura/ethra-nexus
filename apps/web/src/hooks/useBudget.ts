import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface BudgetData {
  limit_usd: number
  spent_usd: number
  tokens_used: number
  percent_used: number
  throttled_at: string | null
  alerts_fired: string[]
}

export function useBudget(agentId: string) {
  return useQuery({
    queryKey: ['agents', agentId, 'budget'],
    queryFn: () => api.get<{ data: BudgetData }>(`/agents/${agentId}/budget`).then((r) => r.data.data),
    enabled: !!agentId,
  })
}

export function useUpdateBudget(agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (monthly_limit_usd: number) =>
      api.patch<{ data: BudgetData }>(`/agents/${agentId}/budget`, { monthly_limit_usd }).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents', agentId, 'budget'] })
      toast.success('Budget atualizado')
    },
    onError: () => toast.error('Erro ao atualizar budget'),
  })
}
