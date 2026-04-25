import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface KpiCardProps {
  label: string
  value: string | number
  subtitle?: string
  accent?: boolean
  loading?: boolean
}

export function KpiCard({ label, value, subtitle, accent, loading }: KpiCardProps) {
  if (loading) {
    return (
      <Card className="p-5">
        <Skeleton className="h-3 w-24 mb-3" />
        <Skeleton className="h-8 w-16 mb-2" />
        <Skeleton className="h-3 w-20" />
      </Card>
    )
  }
  return (
    <Card className="p-5">
      <CardContent className="p-0">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">{label}</p>
        <p className={cn('font-serif text-3xl font-semibold leading-none mb-1.5', accent ? 'text-accent' : 'text-foreground')}>
          {value}
        </p>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardContent>
    </Card>
  )
}
