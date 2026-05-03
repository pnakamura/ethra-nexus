import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useUploadFile } from '../useUploadFile'

const apiPostMock = vi.fn()
vi.mock('@/lib/api', () => ({
  api: { post: (...args: unknown[]) => apiPostMock(...args) },
}))

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => apiPostMock.mockReset())

describe('useUploadFile', () => {
  it('POSTs FormData with file + 30d expires_at', async () => {
    apiPostMock.mockResolvedValueOnce({
      data: { id: 'file-1', sha256: 'a'.repeat(64), size_bytes: 100, mime_type: 'text/plain', original_filename: 'a.txt', expires_at: null, download_url: '/x' },
    })
    const { result } = renderHook(() => useUploadFile(), { wrapper })

    const file = new File(['hello'], 'a.txt', { type: 'text/plain' })
    result.current.mutate(file)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiPostMock).toHaveBeenCalledTimes(1)
    const [url, body] = apiPostMock.mock.calls[0]!
    expect(url).toBe('/files')
    expect(body).toBeInstanceOf(FormData)
    const fd = body as FormData
    expect(fd.get('file')).toBeInstanceOf(File)
    const exp = fd.get('expires_at')
    expect(typeof exp).toBe('string')
    const expDate = new Date(exp as string).getTime()
    const expectedDate = Date.now() + 30 * 24 * 60 * 60 * 1000
    expect(Math.abs(expDate - expectedDate)).toBeLessThan(60_000)
  })

  it('mutation.error fires on 413', async () => {
    apiPostMock.mockRejectedValueOnce(new Error('413'))
    const { result } = renderHook(() => useUploadFile(), { wrapper })
    result.current.mutate(new File(['x'], 'a.txt', { type: 'text/plain' }))
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
