import { useState, type KeyboardEvent } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  onSend: (content: string) => void
  disabled?: boolean
}

const MAX_CHARS = 50000

export function MessageInput({ onSend, disabled = false }: Props) {
  const [value, setValue] = useState('')

  function handleSend() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    if (trimmed.length > MAX_CHARS) return
    onSend(trimmed)
    setValue('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const tooLong = value.length > MAX_CHARS

  return (
    <div className="border-t-hairline bg-background px-4 py-3 flex-shrink-0">
      <div className="flex gap-2 items-end">
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
          disabled={disabled || !value.trim() || tooLong}
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
