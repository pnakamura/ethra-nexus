import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AttachmentChip } from '../AttachmentChip'

describe('AttachmentChip', () => {
  it('shows spinner and disables remove when uploading', () => {
    render(<AttachmentChip
      filename="vendas.xlsx"
      mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      status="uploading"
      onRemove={() => {}}
    />)
    expect(screen.getByText(/vendas\.xlsx/)).toBeInTheDocument()
    expect(screen.getByTestId('chip-spinner')).toBeInTheDocument()
    expect(screen.queryByLabelText(/remover anexo/i)).not.toBeInTheDocument()
  })

  it('calls onRemove when X clicked in ready state', () => {
    const onRemove = vi.fn()
    render(<AttachmentChip
      filename="contrato.pdf"
      mime_type="application/pdf"
      status="ready"
      size_bytes={123456}
      onRemove={onRemove}
    />)
    fireEvent.click(screen.getByLabelText(/remover anexo/i))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('shows error message in error state', () => {
    render(<AttachmentChip
      filename="bad.pdf"
      mime_type="application/pdf"
      status="error"
      error_message="upload failed"
      onRemove={() => {}}
    />)
    expect(screen.getByText(/upload failed/)).toBeInTheDocument()
  })

  it('chooses xlsx icon based on mime', () => {
    const { container } = render(<AttachmentChip
      filename="x.xlsx"
      mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      status="ready"
      onRemove={() => {}}
    />)
    expect(container.querySelector('[data-icon="xlsx"]')).toBeInTheDocument()
  })

  it('shows formatted size in KB/MB for ready state', () => {
    render(<AttachmentChip
      filename="x.xlsx"
      mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      status="ready"
      size_bytes={183_000}
      onRemove={() => {}}
    />)
    expect(screen.getByText(/179\s*KB|178\s*KB|180\s*KB/)).toBeInTheDocument()
  })
})
