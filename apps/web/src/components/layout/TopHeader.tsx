import { useLocation, useParams } from 'react-router-dom'
import { cn } from '@/lib/utils'

interface TopHeaderProps {
  expanded: boolean
}

const ROUTE_MAP: Record<string, string[]> = {
  '/dashboard': ['MISSION CONTROL'],
  '/agents':    ['AGENTES'],
  '/wiki':      ['WIKI'],
  '/settings':  ['CONFIGURAÇÕES'],
}

function useBreadcrumb(): string[] {
  const location = useLocation()
  const { id } = useParams<{ id?: string }>()

  if (location.pathname.startsWith('/agents/new')) return ['AGENTES', 'NOVO']
  if (id && location.pathname.startsWith('/agents/')) return ['AGENTES', id.slice(0, 8).toUpperCase()]

  return ROUTE_MAP[location.pathname] ?? [location.pathname.replace('/', '').toUpperCase()]
}

export function TopHeader({ expanded }: TopHeaderProps) {
  const crumbs = useBreadcrumb()

  return (
    <header
      className={cn(
        'fixed top-0 right-0 h-[56px] z-30',
        'flex items-center border-b-hairline bg-background',
        'transition-[left] duration-200 ease-out',
      )}
      style={{ left: expanded ? 220 : 60 }}
    >
      {/* Breadcrumb */}
      <div className="flex items-center gap-0 px-6 flex-1">
        <span className="font-mono uppercase tracking-[0.14em] text-[10px] text-muted-foreground">
          ETHRA
        </span>
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-0">
            <span className="font-mono text-[10px] text-muted-foreground mx-2 opacity-40">/</span>
            <span
              className={cn(
                'font-mono uppercase tracking-[0.14em] text-[10px]',
                i === crumbs.length - 1 ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {crumb}
            </span>
          </span>
        ))}
      </div>

      {/* Right slot — status dot */}
      <div className="flex items-center gap-2 px-6">
        <span
          className="size-1.5 rounded-full filament-pulse"
          style={{ background: 'hsl(var(--status-active))' }}
        />
        <span className="font-mono uppercase tracking-[0.12em] text-[9px] text-muted-foreground">
          ACTIVE
        </span>
      </div>
    </header>
  )
}
