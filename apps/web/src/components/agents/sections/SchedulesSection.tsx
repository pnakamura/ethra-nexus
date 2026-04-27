import { useState } from 'react'
import { Plus, Trash2, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { useSchedules, useCreateSchedule, useDeleteSchedule, useToggleSchedule } from '@/hooks/useSchedules'

const AVAILABLE_SKILLS = [
  'wiki:query', 'wiki:ingest', 'wiki:lint',
  'channel:respond', 'channel:proactive',
  'report:generate', 'monitor:health', 'monitor:alert',
  'data:analyze', 'data:extract',
]

function formatNextRun(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

interface SchedulesSectionProps { agentId: string }

export function SchedulesSection({ agentId }: SchedulesSectionProps) {
  const { data: schedules = [], isLoading } = useSchedules(agentId)
  const createSchedule = useCreateSchedule(agentId)
  const deleteSchedule = useDeleteSchedule(agentId)
  const toggleSchedule = useToggleSchedule(agentId)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    skill_id: '',
    cron_expression: '',
    timezone: 'America/Sao_Paulo',
    output_channel: 'api',
  })

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.skill_id || !form.cron_expression) return
    createSchedule.mutate(
      {
        agent_id: agentId,
        skill_id: form.skill_id,
        cron_expression: form.cron_expression,
        timezone: form.timezone,
        output_channel: form.output_channel,
      },
      {
        onSuccess: () => {
          setShowForm(false)
          setForm({ skill_id: '', cron_expression: '', timezone: 'America/Sao_Paulo', output_channel: 'api' })
        },
      },
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {schedules.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Nenhum schedule configurado para este agente.
        </p>
      )}

      {schedules.map(schedule => (
        <div key={schedule.id} className="border-hairline p-4 flex items-start gap-3">
          <Clock size={14} className="mt-0.5 text-muted-foreground flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[11px] text-foreground font-medium">{schedule.skill_id}</p>
            <p className="font-mono text-[10px] text-muted-foreground">{schedule.cron_expression} · {schedule.timezone}</p>
            <p className="font-mono text-[9px] text-muted-foreground mt-0.5">
              Próxima execução: {formatNextRun(schedule.next_run_at)}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <Switch
              checked={schedule.enabled}
              onCheckedChange={(enabled) =>
                toggleSchedule.mutate({ scheduleId: schedule.id, enabled })
              }
            />
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => {
                if (confirm('Remover este schedule?')) deleteSchedule.mutate(schedule.id)
              }}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
      ))}

      {showForm ? (
        <form onSubmit={handleCreate} className="border-hairline p-4 flex flex-col gap-3">
          <p className="font-mono text-[10px] font-medium text-muted-foreground uppercase tracking-[0.12em]">
            Novo schedule
          </p>

          <div>
            <label className="font-mono text-[10px] text-muted-foreground block mb-1">Skill</label>
            <Select value={form.skill_id} onValueChange={v => setForm(f => ({ ...f, skill_id: v }))}>
              <SelectTrigger className="font-mono text-[11px]">
                <SelectValue placeholder="Selecionar skill..." />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_SKILLS.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="font-mono text-[10px] text-muted-foreground block mb-1">Cron expression</label>
            <Input
              value={form.cron_expression}
              onChange={e => setForm(f => ({ ...f, cron_expression: e.target.value }))}
              placeholder="0 9 * * 1-5  (seg–sex às 9h)"
              className="font-mono text-[11px]"
              required
            />
          </div>

          <div>
            <label className="font-mono text-[10px] text-muted-foreground block mb-1">Timezone</label>
            <Input
              value={form.timezone}
              onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
              className="font-mono text-[11px]"
            />
          </div>

          <div>
            <label className="font-mono text-[10px] text-muted-foreground block mb-1">Canal de saída</label>
            <Select value={form.output_channel} onValueChange={v => setForm(f => ({ ...f, output_channel: v }))}>
              <SelectTrigger className="font-mono text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="api">api</SelectItem>
                <SelectItem value="whatsapp">whatsapp</SelectItem>
                <SelectItem value="both">both</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={createSchedule.isPending || !form.skill_id || !form.cron_expression}>
              {createSchedule.isPending ? 'Criando…' : 'Criar schedule'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" onClick={() => setShowForm(true)} className="self-start font-mono text-[11px] uppercase tracking-[0.08em]">
          <Plus size={13} className="mr-1.5" /> Novo schedule
        </Button>
      )}
    </div>
  )
}
