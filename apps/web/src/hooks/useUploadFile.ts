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
      // IMPORTANT: do NOT set Content-Type manually. Axios + browser need to
      // build "multipart/form-data; boundary=----..." together, including the
      // boundary parameter. If we set Content-Type ourselves the boundary is
      // missing and the server rejects the malformed body (often with 413).
      // We override the api instance default 'application/json' by passing
      // `Content-Type: undefined` which Axios treats as "let the engine pick".
      const res = await api.post<UploadResponse>('/files', fd, {
        headers: { 'Content-Type': undefined as unknown as string },
      })
      return res.data
    },
  })
}
