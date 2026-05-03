import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { MessageInput } from '../MessageInput'

const uploadMock = vi.fn()
vi.mock('@/hooks/useUploadFile', () => ({
  useUploadFile: () => ({
    mutateAsync: uploadMock,
    isPending: false,
  }),
}))
const toastMock = vi.fn()
vi.mock('sonner', () => ({ toast: { error: toastMock, success: toastMock } }))

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>
}

beforeEach(() => { uploadMock.mockReset(); toastMock.mockReset() })

describe('MessageInput attachments', () => {
  it('opens file picker when paperclip clicked', () => {
    const onSend = vi.fn()
    render(wrap(<MessageInput onSend={onSend} />))
    const input = screen.getByLabelText(/anexar arquivo/i) as HTMLInputElement
    expect(input.type).toBe('file')
  })

  it('shows chip with uploading state then ready', async () => {
    uploadMock.mockResolvedValueOnce({
      id: 'f-1', sha256: 'a'.repeat(64), size_bytes: 100, mime_type: 'application/pdf',
      original_filename: 'a.pdf', expires_at: null, download_url: '/x',
    })
    render(wrap(<MessageInput onSend={vi.fn()} />))
    const input = screen.getByLabelText(/anexar arquivo/i) as HTMLInputElement
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(await screen.findByText(/a\.pdf/)).toBeInTheDocument()
    await waitFor(() => expect(uploadMock).toHaveBeenCalled())
  })

  it('blocks file >50MB with toast and no upload', async () => {
    render(wrap(<MessageInput onSend={vi.fn()} />))
    const input = screen.getByLabelText(/anexar arquivo/i) as HTMLInputElement
    const big = new File([new Uint8Array(51 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [big] } })
    expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/50\s*MB/))
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('blocks unsupported mime with toast', async () => {
    render(wrap(<MessageInput onSend={vi.fn()} />))
    const input = screen.getByLabelText(/anexar arquivo/i) as HTMLInputElement
    const exe = new File(['x'], 'a.exe', { type: 'application/octet-stream' })
    fireEvent.change(input, { target: { files: [exe] } })
    expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/formato/))
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('blocks 4th attachment with toast', async () => {
    uploadMock.mockResolvedValue({ id: 'x', sha256: 'a'.repeat(64), size_bytes: 1, mime_type: 'application/pdf', original_filename: 'x.pdf', expires_at: null, download_url: '/x' })
    render(wrap(<MessageInput onSend={vi.fn()} />))
    const input = screen.getByLabelText(/anexar arquivo/i) as HTMLInputElement
    for (let i = 0; i < 3; i++) {
      const f = new File(['x'], `f${i}.pdf`, { type: 'application/pdf' })
      fireEvent.change(input, { target: { files: [f] } })
    }
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(3))
    const fourth = new File(['x'], 'f4.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [fourth] } })
    expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/máximo 3/i))
  })

  it('disables send while any chip is uploading', async () => {
    let resolve!: (v: unknown) => void
    uploadMock.mockReturnValueOnce(new Promise(r => { resolve = r as (v: unknown) => void }))
    render(wrap(<MessageInput onSend={vi.fn()} />))
    const input = screen.getByLabelText(/anexar arquivo/i) as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] } })
    const textarea = screen.getByPlaceholderText(/pergunte/i)
    fireEvent.change(textarea, { target: { value: 'oi' } })
    const send = screen.getByRole('button', { name: /enviar|send/i })
    expect(send).toBeDisabled()
    resolve({ id: 'f-1', sha256: 'a'.repeat(64), size_bytes: 1, mime_type: 'application/pdf', original_filename: 'a.pdf', expires_at: null, download_url: '/x' })
    await waitFor(() => expect(send).not.toBeDisabled())
  })

  it('submits with attachments and resets state', async () => {
    uploadMock.mockResolvedValueOnce({ id: 'f-1', sha256: 'a'.repeat(64), size_bytes: 1, mime_type: 'application/pdf', original_filename: 'a.pdf', expires_at: null, download_url: '/x' })
    const onSend = vi.fn()
    render(wrap(<MessageInput onSend={onSend} />))
    const input = screen.getByLabelText(/anexar arquivo/i) as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] } })
    await waitFor(() => expect(uploadMock).toHaveBeenCalled())
    const textarea = screen.getByPlaceholderText(/pergunte/i)
    fireEvent.change(textarea, { target: { value: 'descreva' } })
    fireEvent.click(screen.getByRole('button', { name: /enviar|send/i }))
    expect(onSend).toHaveBeenCalledWith('descreva', [{ file_id: 'f-1', filename: 'a.pdf' }])
    await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toBe(''))
    expect(screen.queryByText(/a\.pdf/)).not.toBeInTheDocument()
  })
})
