import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'

export interface Schedule {
  id: string
  agent_id: string
  skill_id: string
  cron_expression: string
  timezone: string
  input: Record<string, unknown>
  output_channel: string
  enabled: boolean
  next_run_at: string | null
  last_run_at: string | null
  created_at: string
}

export interface CreateScheduleBody {
  agent_id: string
  skill_id: string
  cron_expression: string
  timezone?: string
  input?: Record<string, unknown>
  output_channel?: string
}

export function useSchedules(agentId: string) {
  return useQuery({
    queryKey: ['schedules', agentId],
    queryFn: () =>
      api.get<{ data: Schedule[] }>('/schedules', { params: { agent_id: agentId } })
        .then(r => r.data.data),
    enabled: !!agentId,
  })
}

export function useCreateSchedule(agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateScheduleBody) =>
      api.post<{ data: Schedule }>('/schedules', body).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules', agentId] })
      toast.success('Schedule criado')
    },
    onError: () => toast.error('Erro ao criar schedule'),
  })
}

export function useDeleteSchedule(agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (scheduleId: string) => api.delete(`/schedules/${scheduleId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules', agentId] })
      toast.success('Schedule removido')
    },
    onError: () => toast.error('Erro ao remover schedule'),
  })
}

export function useToggleSchedule(agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ scheduleId, enabled }: { scheduleId: string; enabled: boolean }) =>
      api.patch(`/schedules/${scheduleId}/${enabled ? 'enable' : 'disable'}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules', agentId] }),
    onError: () => toast.error('Erro ao alterar schedule'),
  })
}
