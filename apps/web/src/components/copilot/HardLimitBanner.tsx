import { AlertTriangle } from 'lucide-react'

export interface BannerAlert {
  id: string
  category: string
  code: string
  severity: string
  message: string
  fired_at: string
}

interface Props {
  alerts: BannerAlert[]
}

export function HardLimitBanner({ alerts }: Props) {
  if (alerts.length === 0) return null

  return (
    <div role="alert" className="bg-red-50 border-b border-red-200 px-5 py-3 flex items-start gap-3">
      <AlertTriangle size={18} strokeWidth={1.5} className="text-red-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-red-800">
          {alerts.length === 1 ? 'Alerta crítico ativo' : `${alerts.length} alertas críticos ativos`}
        </div>
        <ul className="mt-1 space-y-0.5 text-[12px] text-red-700">
          {alerts.map(a => (
            <li key={a.id}>{a.message}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
