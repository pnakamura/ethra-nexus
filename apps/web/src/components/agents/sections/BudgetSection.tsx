import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useBudget, useUpdateBudget } from '@/hooks/useBudget'
import { cn } from '@/lib/utils'

interface BudgetSectionProps { agentId: string }

export function BudgetSection({ agentId }: BudgetSectionProps) {
  const { data: budget, isLoading } = useBudget(agentId)
  const updateBudget = useUpdateBudget(agentId)
  const [limitInput, setLimitInput] = useState<string>('')
  const [editing, setEditing] = useState(false)

  if (isLoading) {
    return <div className="flex flex-col gap-4"><Skeleton className="h-6 w-48" /><Skeleton className="h-3 w-full" /><Skeleton className="h-10 w-32" /></div>
  }

  const pct = budget?.percent_used ?? 0
  const progressColor = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-yellow-500' : 'bg-accent'

  const handleSave = () => {
    const val = parseFloat(limitInput)
    if (!isNaN(val) && val >= 0) {
      updateBudget.mutate(val)
      setEditing(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex justify-between items-baseline mb-2">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Gasto este mês</p>
          <p className="font-serif text-lg font-semibold text-accent">
            ${budget?.spent_usd.toFixed(2)}{' '}
            <span className="text-sm font-sans font-normal text-muted-foreground">
              / ${budget?.limit_usd === 0 ? '∞' : budget?.limit_usd.toFixed(2)}
            </span>
          </p>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden mb-1.5">
          <div className={cn('h-full rounded-full transition-all duration-700', progressColor)} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <p className="text-xs text-muted-foreground text-right">{pct.toFixed(1)}% utilizado</p>
      </div>

      <div className="p-3 border border-border rounded-lg text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Tokens:</span>{' '}
        {budget?.tokens_used.toLocaleString('pt-BR')} este mês
      </div>

      {budget?.throttled_at && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
          Budget esgotado em {new Date(budget.throttled_at).toLocaleDateString('pt-BR')}
        </div>
      )}

      <div>
        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Limite mensal (USD)</label>
        {editing
          ? (
            <div className="flex gap-2">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
                className="w-32"
                autoFocus
              />
              <Button onClick={handleSave} disabled={updateBudget.isPending}>Salvar</Button>
              <Button variant="outline" onClick={() => setEditing(false)}>Cancelar</Button>
            </div>
          )
          : (
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">${budget?.limit_usd === 0 ? 'Sem limite' : budget?.limit_usd.toFixed(2)}</span>
              <Button variant="outline" size="sm" onClick={() => { setLimitInput(String(budget?.limit_usd ?? 0)); setEditing(true) }}>
                Alterar
              </Button>
            </div>
          )
        }
      </div>
    </div>
  )
}
