import { useState } from 'react'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useAgentSkills } from '@/hooks/useAgent'
import { useAiosExecute } from '@/hooks/useAios'

interface ExecuteSectionProps { agentId: string }

export function ExecuteSection({ agentId }: ExecuteSectionProps) {
  const { data: skills = [] } = useAgentSkills(agentId)
  const execute = useAiosExecute()

  const [skillId, setSkillId] = useState('')
  const [inputJson, setInputJson] = useState('{\n  "query": ""\n}')
  const [jsonError, setJsonError] = useState<string | null>(null)

  const enabledSkills = skills.filter(s => s.enabled)

  const handleExecute = (e: React.FormEvent) => {
    e.preventDefault()
    setJsonError(null)

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(inputJson) as Record<string, unknown>
    } catch (_e) {
      setJsonError('JSON inválido')
      return
    }

    execute.mutate({ agent_id: agentId, skill_id: skillId, input: parsed, activation_mode: 'on_demand' })
  }

  return (
    <form onSubmit={handleExecute} className="flex flex-col gap-5 max-w-xl">
      <div>
        <label className="font-mono text-[10px] font-medium text-muted-foreground uppercase tracking-[0.12em] block mb-1.5">
          Skill
        </label>
        {enabledSkills.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma skill habilitada. Habilite skills na aba Skills.
          </p>
        ) : (
          <Select value={skillId} onValueChange={setSkillId}>
            <SelectTrigger className="font-mono text-[11px]">
              <SelectValue placeholder="Selecionar skill..." />
            </SelectTrigger>
            <SelectContent>
              {enabledSkills.map(s => (
                <SelectItem key={s.id} value={s.skill_name}>{s.skill_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div>
        <label className="font-mono text-[10px] font-medium text-muted-foreground uppercase tracking-[0.12em] block mb-1.5">
          Input (JSON)
        </label>
        <textarea
          value={inputJson}
          onChange={e => { setInputJson(e.target.value); setJsonError(null) }}
          rows={8}
          className={cn(
            'w-full font-mono text-[11px] bg-background border-hairline p-3 resize-y focus:outline-none focus:ring-1 focus:ring-primary',
            jsonError && 'border-destructive',
          )}
          spellCheck={false}
        />
        {jsonError && (
          <p className="font-mono text-[10px] text-destructive mt-1">{jsonError}</p>
        )}
      </div>

      <div>
        <Button
          type="submit"
          disabled={execute.isPending || !skillId}
          className="font-mono uppercase tracking-[0.08em]"
        >
          <Play size={13} className="mr-1.5" />
          {execute.isPending ? 'Executando…' : 'Executar skill'}
        </Button>
      </div>

      {execute.error && (
        <div className="border-hairline border-destructive/30 bg-destructive/5 p-4">
          <p className="font-mono text-[10px] font-medium text-destructive uppercase tracking-[0.1em] mb-1">
            Erro na execução
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {(execute.error as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Erro desconhecido'}
          </p>
        </div>
      )}

      {execute.data && (
        <div className="border-hairline p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] font-medium text-muted-foreground uppercase tracking-[0.1em]">
              Resultado
            </p>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[9px] text-muted-foreground">
                {execute.data.tokens_used.toLocaleString('pt-BR')} tokens
              </span>
              <span className="font-mono text-[9px] text-muted-foreground">
                ${execute.data.cost_usd.toFixed(4)}
              </span>
            </div>
          </div>
          <pre className="font-mono text-[10px] text-foreground bg-secondary p-3 overflow-auto max-h-[300px] whitespace-pre-wrap">
            {JSON.stringify(execute.data.data, null, 2)}
          </pre>
        </div>
      )}
    </form>
  )
}
