import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface UploadResponse {
  id: string
  sha256: string
  size_bytes: number
  mime_type: string
  original_filename: string
  expires_at: string | null
  download_url: string
}

const TTL_MS = 30 * 24 * 60 * 60 * 1000

export function useUploadFile() {
  return useMutation<UploadResponse, Error, File>({
    mutationFn: async (file) => {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('expires_at', new Date(Date.now() + TTL_MS).toISOString())
      const res = await api.post<UploadResponse>('/files', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return res.data
    },
  })
}
