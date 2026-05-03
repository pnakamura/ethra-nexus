import { useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { Send, Paperclip } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useUploadFile, type UploadResponse } from '@/hooks/useUploadFile'
import { AttachmentChip } from './AttachmentChip'

interface ChipState {
  temp_id: string
  file_id?: string
  filename: string
  mime_type: string
  size_bytes?: number
  status: 'uploading' | 'ready' | 'error'
  error_message?: string
}

interface Props {
  onSend: (content: string, attachments?: Array<{ file_id: string; filename: string }>) => void
  disabled?: boolean
}

const MAX_CHARS = 50000
const MAX_BYTES = 50 * 1024 * 1024
const MAX_CHIPS = 3
const SUPPORTED_MIMES: ReadonlySet<string> = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
  'text/plain',
  'text/markdown',
])

function isSupported(mime: string): boolean {
  if (SUPPORTED_MIMES.has(mime)) return true
  return [...SUPPORTED_MIMES].some(m => mime.startsWith(m + ';'))
}

export function MessageInput({ onSend, disabled = false }: Props) {
  const [value, setValue] = useState('')
  const [chips, setChips] = useState<ChipState[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const upload = useUploadFile()
  const inputId = useId()

  function ingestFile(file: File) {
    if (chips.length >= MAX_CHIPS) {
      toast.error('máximo 3 anexos por mensagem')
      return
    }
    if (file.size > MAX_BYTES) {
      toast.error('arquivo excede 50MB')
      return
    }
    if (!isSupported(file.type)) {
      toast.error(`formato não suportado: ${file.type || 'desconhecido'}`)
      return
    }
    const temp_id = crypto.randomUUID()
    setChips(prev => [...prev, { temp_id, filename: file.name, mime_type: file.type, status: 'uploading' }])

    upload.mutateAsync(file).then((res: UploadResponse) => {
      setChips(prev => prev.map(c => c.temp_id === temp_id
        ? { ...c, file_id: res.id, size_bytes: res.size_bytes, status: 'ready' }
        : c))
    }).catch((err: Error) => {
      setChips(prev => prev.map(c => c.temp_id === temp_id
        ? { ...c, status: 'error', error_message: err.message.slice(0, 60) }
        : c))
      setTimeout(() => setChips(prev => prev.filter(c => c.temp_id !== temp_id)), 3000)
    })
  }

  function onPaperclipChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (files) for (const f of Array.from(files)) ingestFile(f)
    e.target.value = ''
  }

  function removeChip(temp_id: string) {
    setChips(prev => prev.filter(c => c.temp_id !== temp_id))
  }

  function handleSend() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    if (trimmed.length > MAX_CHARS) return
    if (chips.some(c => c.status === 'uploading')) return
    const ready = chips.filter(c => c.status === 'ready' && c.file_id)
    const payload = ready.length > 0
      ? ready.map(c => ({ file_id: c.file_id!, filename: c.filename }))
      : undefined
    onSend(trimmed, payload)
    setValue('')
    setChips([])
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const tooLong = value.length > MAX_CHARS
  const anyUploading = chips.some(c => c.status === 'uploading')
  const sendDisabled = disabled || !value.trim() || tooLong || anyUploading

  return (
    <div className="border-t-hairline bg-background px-4 py-3 flex-shrink-0">
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {chips.map(c => (
            <AttachmentChip
              key={c.temp_id}
              filename={c.filename}
              mime_type={c.mime_type}
              size_bytes={c.size_bytes}
              status={c.status}
              error_message={c.error_message}
              onRemove={() => removeChip(c.temp_id)}
            />
          ))}
        </div>
      )}
      <div className="flex gap-2 items-end">
        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          accept=".xlsx,.pdf,.docx,.csv,.txt,.md,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv,text/plain,text/markdown"
          aria-label="anexar arquivo"
          onChange={onPaperclipChange}
          className="sr-only"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || chips.length >= MAX_CHIPS}
          className="h-9 flex-shrink-0"
          title="Anexar arquivo (xlsx, PDF, DOCX, CSV, TXT, MD; até 3 arquivos / 50MB cada)"
        >
          <Paperclip size={12} />
        </Button>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Pergunte algo sobre o sistema..."
          rows={2}
          disabled={disabled}
          className={cn(
            'flex-1 font-mono text-[12px] bg-background border-hairline px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary',
            tooLong && 'border-destructive',
          )}
        />
        <Button
          onClick={handleSend}
          disabled={sendDisabled}
          aria-label="enviar"
          className="h-9 flex-shrink-0"
        >
          <Send size={12} />
        </Button>
      </div>
      {tooLong && (
        <p className="font-mono text-[10px] text-destructive mt-1 text-right">
          {value.length} / {MAX_CHARS} chars
        </p>
      )}
    </div>
  )
}
