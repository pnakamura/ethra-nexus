import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { AgentActivityList } from '@/components/dashboard/AgentActivityList'

interface DashboardData {
  agents_active: number
  executions_month: number
  cost_usd_month: number
  recent_agents: Array<{ id: string; name: string; role: string; status: string; skills: string[] }>
}

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<{ data: DashboardData }>('/dashboard').then((r) => r.data.data),
  })

  const month = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  return (
    <div className="mist-in">
      <div className="mb-7">
        <h1 className="font-serif text-2xl font-semibold text-foreground mb-1">Dashboard</h1>
        <p className="text-sm text-muted-foreground capitalize">{month}</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <KpiCard
          label="Agentes ativos"
          value={data?.agents_active ?? 0}
          accent
          loading={isLoading}
        />
        <KpiCard
          label="Execuções"
          value={data?.executions_month.toLocaleString('pt-BR') ?? 0}
          subtitle="Este mês"
          loading={isLoading}
        />
        <KpiCard
          label="Custo USD"
          value={`$${(data?.cost_usd_month ?? 0).toFixed(2)}`}
          subtitle="Este mês"
          loading={isLoading}
        />
      </div>

      <AgentActivityList agents={data?.recent_agents ?? []} loading={isLoading} />
    </div>
  )
}
