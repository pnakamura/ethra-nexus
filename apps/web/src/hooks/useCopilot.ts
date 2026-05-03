import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { streamCopilotMessage, type SSEEvent, type AttachmentRef } from '@/lib/copilot-stream'
import { STORAGE_KEY } from '@/contexts/AuthContext'

export interface CopilotConversation {
  id: string
  title: string | null
  status: 'active' | 'archived'
  message_count: number
  total_cost_usd: string
  last_message_at: string
  created_at: string
}

export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant'
  content: Array<{ type: string; [k: string]: unknown }>
  model: string | null
  tokens_in: number
  tokens_out: number
  cost_usd: string
  stop_reason: string | null
  error_code: string | null
  created_at: string
}

export interface CopilotConversationDetail {
  conversation: CopilotConversation
  messages: CopilotMessage[]
}

// HEALTH / BANNER ALERTS ─────────────────────────────────────

export interface CopilotHealthResponse {
  ok: boolean
  user_slug: string
  role: string
  banner_alerts: Array<{
    id: string
    category: string
    code: string
    severity: string
    message: string
    fired_at: string
  }>
}

export function useCopilotHealth() {
  return useQuery({
    queryKey: ['copilot', 'health'],
    queryFn: () => api.get<CopilotHealthResponse>('/copilot/health').then(r => r.data),
    staleTime: 30_000,        // 30s — refetch on focus or after this
    refetchInterval: 60_000,  // poll every 60s for banner updates
  })
}

// LISTING ────────────────────────────────────────────────────

export function useCopilotConversations(filter?: { status?: 'active' | 'archived' }) {
  return useQuery({
    queryKey: ['copilot', 'conversations', filter ?? {}],
    queryFn: () => api.get<{ data: CopilotConversation[] }>('/copilot/conversations', { params: filter }).then(r => r.data.data),
    staleTime: 10_000,
  })
}

export function useCopilotConversation(id: string | null) {
  return useQuery({
    queryKey: ['copilot', 'conversation', id],
    queryFn: () => api.get<{ data: CopilotConversationDetail }>(`/copilot/conversations/${id}`).then(r => r.data.data),
    enabled: !!id,
    staleTime: 5_000,
  })
}

// MUTATIONS ──────────────────────────────────────────────────

export function useCreateCopilotConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ data: CopilotConversation }>('/copilot/conversations', {}).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copilot', 'conversations'] }),
    onError: (e: unknown) => {
      const m = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Erro ao criar conversa'
      toast.error(m)
    },
  })
}

export function useUpdateCopilotConversation(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { title?: string; status?: 'active' | 'archived' }) =>
      api.patch<{ data: CopilotConversation }>(`/copilot/conversations/${id}`, body).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['copilot', 'conversations'] })
      qc.invalidateQueries({ queryKey: ['copilot', 'conversation', id] })
    },
  })
}

export function useDeleteCopilotConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/copilot/conversations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copilot', 'conversations'] }),
  })
}

// STREAMING ──────────────────────────────────────────────────

export interface ToolCallInProgress {
  tool_use_id: string
  tool_name: string
  status: 'running' | 'completed' | 'error'
  duration_ms?: number
}

export interface SendCopilotMessageState {
  isStreaming: boolean
  currentText: string
  currentToolCalls: ToolCallInProgress[]
  error: string | null
}

export function useSendCopilotMessage(conversationId: string | null) {
  const qc = useQueryClient()
  const [state, setState] = useState<SendCopilotMessageState>({
    isStreaming: false,
    currentText: '',
    currentToolCalls: [],
    error: null,
  })
  const abortRef = useRef<AbortController | null>(null)

  const send = useCallback(
    async (content: string, attachments?: AttachmentRef[]) => {
      if (!conversationId) return
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac

      setState({ isStreaming: true, currentText: '', currentToolCalls: [], error: null })

      try {
        await streamCopilotMessage(
          conversationId,
          content,
          (event: SSEEvent) => {
            if (event.type === 'text_delta') {
              setState(s => ({ ...s, currentText: s.currentText + (event.delta as string) }))
            } else if (event.type === 'tool_use_start') {
              setState(s => ({
                ...s,
                currentToolCalls: [
                  ...s.currentToolCalls,
                  {
                    tool_use_id: event.tool_use_id as string,
                    tool_name: event.tool_name as string,
                    status: 'running',
                  },
                ],
              }))
            } else if (event.type === 'tool_use_complete') {
              setState(s => ({
                ...s,
                currentToolCalls: s.currentToolCalls.map(t =>
                  t.tool_use_id === event.tool_use_id
                    ? {
                        ...t,
                        status: event.status as 'completed' | 'error',
                        duration_ms: event.duration_ms as number,
                      }
                    : t,
                ),
              }))
            } else if (event.type === 'error') {
              setState(s => ({ ...s, error: event.code as string }))
            }
          },
          ac.signal,
          () => localStorage.getItem(STORAGE_KEY),
          attachments,
        )
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setState(s => ({ ...s, error: (e as Error).message }))
          toast.error('Erro ao enviar mensagem')
        }
      } finally {
        setState(s => ({ ...s, isStreaming: false }))
        qc.invalidateQueries({ queryKey: ['copilot', 'conversation', conversationId] })
        qc.invalidateQueries({ queryKey: ['copilot', 'conversations'] })
      }
    },
    [conversationId, qc],
  )

  const cancel = useCallback(() => abortRef.current?.abort(), [])

  return { ...state, send, cancel }
}
