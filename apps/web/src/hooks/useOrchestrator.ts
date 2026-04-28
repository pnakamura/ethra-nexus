import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'

export interface AiosEvent {
  id: string
  agent_id: string | null
  skill_id: string
  status: string
  cost_usd: string
  tokens_used: number
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  error_code: string | null
  activation_mode: string
  started_at: string
  completed_at: string | null
  call_depth: number
  parent_event_id: string | null
}

export interface DashboardStats {
  agents_active: number
  executions_month: number
  cost_usd_month: number
}

export function useAiosEvents(filters?: { agent_id?: string; status?: string; limit?: number }) {
  return useQuery({
    queryKey: ['aios', 'events', filters ?? {}],
    queryFn: () =>
      api
        .get<{ data: AiosEvent[] }>('/aios/events', { params: filters })
        .then(r => r.data.data),
    refetchInterval: 8_000,
    staleTime: 4_000,
  })
}

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () =>
      api.get<{ data: DashboardStats }>('/dashboard').then(r => r.data.data),
    staleTime: 30_000,
  })
}

export function useOrchestratorExecute() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      agent_id: string
      skill_id: string
      input: Record<string, unknown>
      activation_mode?: string
    }) => api.post<{ data: unknown; tokens_used: number; cost_usd: number }>('/aios/execute', body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aios', 'events'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success('Execução iniciada')
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Erro ao iniciar execução'
      toast.error(msg)
    },
  })
}
