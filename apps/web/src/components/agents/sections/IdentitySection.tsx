import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { useUpdateAgent } from '@/hooks/useAgent'
import type { Agent } from '@/lib/schemas/agent.schema'

const identitySchema = z.object({
  name: z.string().min(2),
  role: z.string().min(1),
  system_prompt: z.string().optional(),
})
type IdentityInput = z.infer<typeof identitySchema>

interface IdentitySectionProps { agent: Agent; loading?: boolean }

export function IdentitySection({ agent, loading }: IdentitySectionProps) {
  const updateAgent = useUpdateAgent(agent.id)
  const { register, handleSubmit, formState: { isDirty, isSubmitting } } = useForm<IdentityInput>({
    resolver: zodResolver(identitySchema),
    defaultValues: { name: agent.name, role: agent.role, system_prompt: agent.system_prompt ?? '' },
  })

  const onSubmit = async (data: IdentityInput) => {
    await updateAgent.mutateAsync(data)
  }

  const toggleStatus = () => {
    updateAgent.mutate({ status: agent.status === 'active' ? 'inactive' : 'active' })
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-4 w-32" /><Skeleton className="h-10 w-full" />
        <Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full" />
        <Skeleton className="h-4 w-28" /><Skeleton className="h-24 w-full" />
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
        <div>
          <p className="text-sm font-medium text-foreground">Status do agente</p>
          <p className="text-xs text-muted-foreground">{agent.status === 'active' ? 'Ativo — processando tarefas' : 'Inativo — não processa tarefas'}</p>
        </div>
        <Switch checked={agent.status === 'active'} onCheckedChange={toggleStatus} />
      </div>
      <div>
        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Nome</label>
        <Input {...register('name')} />
      </div>
      <div>
        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Papel (role)</label>
        <Input {...register('role')} placeholder="support, analyst, monitor..." />
      </div>
      <div>
        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">System Prompt</label>
        <Textarea {...register('system_prompt')} rows={5} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!isDirty || isSubmitting}>
          {isSubmitting ? 'Salvando...' : 'Salvar identidade'}
        </Button>
      </div>
    </form>
  )
}
