import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Agent } from '@/lib/schemas/agent.schema'

export function useAgent(id: string) {
  return useQuery({
    queryKey: ['agents', id],
    queryFn: () => api.get<{ data: Agent }>(`/agents/${id}`).then((r) => r.data.data),
    enabled: !!id,
  })
}

export function useUpdateAgent(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<Agent>) => api.patch(`/agents/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents', id] })
      qc.invalidateQueries({ queryKey: ['agents'] })
      toast.success('Salvo')
    },
    onError: () => toast.error('Erro ao salvar'),
  })
}

export function useAgentSkills(id: string) {
  return useQuery({
    queryKey: ['agents', id, 'skills'],
    queryFn: () =>
      api.get<{ data: Array<{ id: string; skill_name: string; enabled: boolean }> }>(`/agents/${id}/skills`)
        .then((r) => r.data.data),
    enabled: !!id,
  })
}

export function useUpdateAgentSkill(agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ skillName, enabled }: { skillName: string; enabled: boolean }) =>
      api.patch(`/agents/${agentId}/skills/${skillName}`, { enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents', agentId, 'skills'] })
      toast.success('Skill atualizada')
    },
    onError: () => toast.error('Erro ao atualizar skill'),
  })
}

export function useAddAgentSkill(agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (skill_id: string) =>
      api.post(`/agents/${agentId}/skills`, { skill_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents', agentId, 'skills'] })
      toast.success('Skill adicionada')
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Erro ao adicionar skill'
      toast.error(msg)
    },
  })
}
