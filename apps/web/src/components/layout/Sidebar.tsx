import { useState, useEffect, useRef } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Bot, BookOpen, Settings, LogOut, Moon, Sun, PanelLeftClose, PanelLeft } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useAuth } from '@/contexts/AuthContext'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Mission Control', group: 'SISTEMA' },
  { to: '/agents',    icon: Bot,             label: 'Agentes',         group: 'SISTEMA' },
  { to: '/wiki',      icon: BookOpen,        label: 'Wiki',            group: 'MEMÓRIA' },
  { to: '/settings',  icon: Settings,        label: 'Configurações',   group: 'SISTEMA' },
]

const COOKIE_KEY = 'ethra.sidebar.expanded'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 days
const KEYBOARD_SHORTCUT = 'b'

function readCookie(): boolean {
  if (typeof document === 'undefined') return false
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_KEY}=([^;]*)`))
  return match?.[1] === 'true'
}

function writeCookie(expanded: boolean): void {
  document.cookie = `${COOKIE_KEY}=${expanded}; path=/; max-age=${COOKIE_MAX_AGE}`
}

export function Sidebar() {
  const [expanded, setExpanded] = useState(false)
  const initializedRef = useRef(false)
  const { logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()

  // Hydrate state from cookie on mount
  useEffect(() => {
    setExpanded(readCookie())
    initializedRef.current = true
  }, [])

  // Persist expansion to cookie (skip first hydration render)
  useEffect(() => {
    if (initializedRef.current) writeCookie(expanded)
  }, [expanded])

  // Keyboard shortcut: Cmd/Ctrl+B
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === KEYBOARD_SHORTCUT) {
        e.preventDefault()
        setExpanded((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const isDark = theme === 'dark'

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          'fixed left-0 top-0 h-screen flex flex-col bg-background border-r-hairline z-40',
          'transition-[width] duration-200 ease-out overflow-hidden',
          expanded ? 'w-[220px]' : 'w-[60px]',
        )}
      >
        {/* Header — wordmark + collapse toggle */}
        <div className="flex items-center px-3 py-4 min-h-[56px] border-b-hairline">
          {expanded ? (
            <>
              <span className="flex-1 font-mono uppercase tracking-[0.2em] text-[11px] font-semibold text-foreground whitespace-nowrap">
                ETHRA NEXUS
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setExpanded(false)}
                    className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Recolher sidebar (Ctrl+B)"
                  >
                    <PanelLeftClose size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Recolher (Ctrl+B)</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setExpanded(true)}
                  className="w-full flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Expandir sidebar (Ctrl+B)"
                >
                  <PanelLeft size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Expandir (Ctrl+B)</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Nav — agrupado por seção */}
        <nav className="flex-1 flex flex-col p-2 pt-3 overflow-y-auto scrollbar-minimal">
          {Object.entries(
            NAV_ITEMS.reduce<Record<string, typeof NAV_ITEMS>>((acc, item) => {
              acc[item.group] = acc[item.group] ?? []
              acc[item.group]!.push(item)
              return acc
            }, {})
          ).map(([group, items]) => (
            <div key={group} className="mb-3">
              {expanded && (
                <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-muted-foreground px-2 pb-1.5">
                  {group}
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                {items.map(({ to, icon: Icon, label }) => (
                  <Tooltip key={to}>
                    <TooltipTrigger asChild>
                      <NavLink
                        to={to}
                        className={({ isActive }) =>
                          cn(
                            'flex items-center gap-3 h-9 transition-colors relative border-l-2',
                            expanded ? 'pl-3 pr-2' : 'pl-[14px]',
                            isActive
                              ? 'border-l-primary bg-secondary text-foreground font-medium'
                              : 'border-l-transparent text-muted-foreground hover:text-foreground hover:bg-secondary',
                          )
                        }
                      >
                        <Icon size={16} strokeWidth={1.25} className="min-w-[16px]" />
                        {expanded && <span className="text-[13px] whitespace-nowrap">{label}</span>}
                      </NavLink>
                    </TooltipTrigger>
                    {!expanded && <TooltipContent side="right">{label}</TooltipContent>}
                  </Tooltip>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer — theme toggle + logout + system status */}
        <div className="border-t-hairline p-2 flex flex-col gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setTheme(isDark ? 'light' : 'dark')}
                className={cn(
                  'flex items-center gap-3 h-9 transition-colors border-l-2 border-l-transparent text-muted-foreground hover:text-foreground hover:bg-secondary w-full',
                  expanded ? 'pl-3 pr-2' : 'pl-[14px]',
                )}
                aria-label={isDark ? 'Trocar para tema claro' : 'Trocar para tema escuro'}
              >
                {isDark
                  ? <Sun size={16} strokeWidth={1.25} className="min-w-[16px]" />
                  : <Moon size={16} strokeWidth={1.25} className="min-w-[16px]" />}
                {expanded && (
                  <span className="text-[13px] whitespace-nowrap">
                    {isDark ? 'Light mode' : 'Dark mode'}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            {!expanded && <TooltipContent side="right">Alternar tema</TooltipContent>}
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleLogout}
                className={cn(
                  'flex items-center gap-3 h-9 transition-colors border-l-2 border-l-transparent text-muted-foreground hover:text-destructive hover:bg-secondary w-full',
                  expanded ? 'pl-3 pr-2' : 'pl-[14px]',
                )}
              >
                <LogOut size={16} strokeWidth={1.25} className="min-w-[16px]" />
                {expanded && <span className="text-[13px] whitespace-nowrap">Sair</span>}
              </button>
            </TooltipTrigger>
            {!expanded && <TooltipContent side="right">Sair</TooltipContent>}
          </Tooltip>

          {/* Status footer — dot pulsante + label mono */}
          <div className={cn('flex items-center gap-2 mt-1 px-3 py-2', !expanded && 'justify-center px-0')}>
            <span
              className="size-1.5 rounded-full filament-pulse flex-shrink-0"
              style={{ background: 'hsl(var(--status-active))' }}
            />
            {expanded && (
              <span className="font-mono uppercase tracking-[0.1em] text-[9px] text-muted-foreground whitespace-nowrap">
                SYS OPERATIONAL
              </span>
            )}
          </div>
        </div>
      </aside>
    </TooltipProvider>
  )
}
