import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { useCreateAgent } from '@/hooks/useAgents'
import { createAgentSchema, type CreateAgentInput } from '@/lib/schemas/agent.schema'

export function AgentNewPage() {
  const navigate = useNavigate()
  const createAgent = useCreateAgent()
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CreateAgentInput>({
    resolver: zodResolver(createAgentSchema),
  })

  const onSubmit = async (data: CreateAgentInput) => {
    const agent = await createAgent.mutateAsync(data)
    navigate(`/agents/${agent.id}`)
  }

  return (
    <div className="mist-in max-w-2xl">
      <button onClick={() => navigate('/agents')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft size={14} /> Voltar para agentes
      </button>
      <h1 className="font-serif text-2xl font-semibold text-foreground mb-6">Novo agente</h1>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Nome</label>
                <Input {...register('name')} placeholder="Suporte ao Cliente" autoFocus />
                {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Slug</label>
                <Input {...register('slug')} placeholder="suporte-ao-cliente" />
                {errors.slug && <p className="text-xs text-destructive mt-1">{errors.slug.message}</p>}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Papel (role)</label>
              <Input {...register('role')} placeholder="support" />
              {errors.role && <p className="text-xs text-destructive mt-1">{errors.role.message}</p>}
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">System Prompt</label>
              <Textarea {...register('system_prompt')} rows={4} placeholder="Você é um assistente de suporte..." />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => navigate('/agents')}>Cancelar</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Criando...' : 'Criar agente'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
