import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface ExecuteResult {
  data: unknown
  tokens_used: number
  cost_usd: number
}

export interface ExecuteBody {
  agent_id: string
  skill_id: string
  input: Record<string, unknown>
  activation_mode?: 'on_demand' | 'scheduled' | 'event'
}

export function useAiosExecute() {
  return useMutation({
    mutationFn: (body: ExecuteBody) =>
      api.post<ExecuteResult>('/aios/execute', body).then(r => r.data),
  })
}
