import { X, FileText, FileSpreadsheet, FileType, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ChipStatus = 'uploading' | 'ready' | 'error'

interface Props {
  filename: string
  mime_type?: string
  size_bytes?: number
  status: ChipStatus
  error_message?: string
  onRemove: () => void
}

export function AttachmentChip({ filename, mime_type, size_bytes, status, error_message, onRemove }: Props) {
  const icon = pickIcon(mime_type)
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 px-2 py-1 border-hairline bg-muted text-[11px] font-mono max-w-[260px]',
        status === 'error' && 'border-destructive bg-destructive/10 text-destructive',
      )}
    >
      <span data-icon={icon.dataKey} className="flex-shrink-0">{icon.node}</span>
      <span className="truncate flex-1" title={filename}>{filename}</span>
      {status === 'ready' && typeof size_bytes === 'number' && (
        <span className="text-muted-foreground flex-shrink-0">{formatBytes(size_bytes)}</span>
      )}
      {status === 'error' && error_message && (
        <span className="text-destructive flex-shrink-0">{error_message}</span>
      )}
      {status === 'uploading' && (
        <Loader2 size={12} className="animate-spin flex-shrink-0" data-testid="chip-spinner" />
      )}
      {(status === 'ready' || status === 'error') && (
        <button
          type="button"
          aria-label="remover anexo"
          onClick={onRemove}
          className="flex-shrink-0 hover:text-destructive"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}

function pickIcon(mime?: string): { node: JSX.Element; dataKey: string } {
  if (!mime) return { node: <FileText size={12} />, dataKey: 'unknown' }
  if (mime.includes('spreadsheet')) return { node: <FileSpreadsheet size={12} />, dataKey: 'xlsx' }
  if (mime === 'application/pdf')   return { node: <FileType size={12} />, dataKey: 'pdf' }
  if (mime.includes('word'))        return { node: <FileText size={12} />, dataKey: 'docx' }
  if (mime.startsWith('text/csv'))  return { node: <FileSpreadsheet size={12} />, dataKey: 'csv' }
  return { node: <FileText size={12} />, dataKey: 'text' }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
