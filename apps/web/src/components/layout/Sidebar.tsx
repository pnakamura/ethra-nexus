import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Bot, BookOpen, Settings, LogOut, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useAuth } from '@/contexts/AuthContext'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/agents',    icon: Bot,             label: 'Agentes'   },
  { to: '/wiki',      icon: BookOpen,        label: 'Wiki'      },
  { to: '/settings',  icon: Settings,        label: 'Configurações' },
]

export function Sidebar() {
  const [expanded, setExpanded] = useState(false)
  const { logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          'fixed left-0 top-0 h-screen flex flex-col bg-card border-r border-border z-40',
          'transition-[width] duration-200 ease-in-out overflow-hidden',
          expanded ? 'w-[200px]' : 'w-[56px]',
        )}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-[14px] py-4 min-h-[60px] border-b border-border">
          <div className="w-7 h-7 min-w-[28px] bg-accent rounded-lg flex items-center justify-center">
            <span className="text-accent-foreground text-xs font-bold">EN</span>
          </div>
          {expanded && (
            <span className="font-serif text-[15px] font-semibold text-foreground whitespace-nowrap phantom">
              Ethra Nexus
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 flex flex-col gap-0.5 p-2 pt-3">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <Tooltip key={to}>
              <TooltipTrigger asChild>
                <NavLink
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 px-2 py-2.5 rounded-md transition-colors relative',
                      'text-muted-foreground hover:text-foreground hover:bg-accent/8',
                      isActive && 'text-accent bg-accent/10 cobalt-underline font-medium',
                    )
                  }
                >
                  <Icon size={18} className="min-w-[18px]" />
                  {expanded && <span className="text-[13px] whitespace-nowrap">{label}</span>}
                </NavLink>
              </TooltipTrigger>
              {!expanded && <TooltipContent side="right">{label}</TooltipContent>}
            </Tooltip>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-border p-2 flex flex-col gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="flex items-center gap-3 px-2 py-2.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/8 w-full transition-colors"
              >
                {theme === 'dark' ? <Sun size={18} className="min-w-[18px]" /> : <Moon size={18} className="min-w-[18px]" />}
                {expanded && <span className="text-[13px] whitespace-nowrap">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
              </button>
            </TooltipTrigger>
            {!expanded && <TooltipContent side="right">Alternar tema</TooltipContent>}
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 px-2 py-2.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/8 w-full transition-colors"
              >
                <LogOut size={18} className="min-w-[18px]" />
                {expanded && <span className="text-[13px] whitespace-nowrap">Sair</span>}
              </button>
            </TooltipTrigger>
            {!expanded && <TooltipContent side="right">Sair</TooltipContent>}
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  )
}
