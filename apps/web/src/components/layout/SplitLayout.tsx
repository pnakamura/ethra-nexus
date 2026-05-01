import { useRef, useEffect, useCallback, useState, type ReactNode } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PanelTab {
  id: string
  label: string
  content: ReactNode
}

interface SplitLayoutProps {
  children: ReactNode
  tabs: PanelTab[]
  defaultTab?: string
  storageKey: string
  defaultPanelWidth?: number
  minPanelWidth?: number
  maxPanelWidth?: number
}

const COLLAPSED_KEY_SUFFIX = '.collapsed'
const WIDTH_KEY_SUFFIX = '.width'

export function SplitLayout({
  children,
  tabs,
  defaultTab,
  storageKey,
  defaultPanelWidth = 360,
  minPanelWidth = 240,
  maxPanelWidth = 640,
}: SplitLayoutProps) {
  const collapsedKey = storageKey + COLLAPSED_KEY_SUFFIX
  const widthKey = storageKey + WIDTH_KEY_SUFFIX

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(collapsedKey) === 'true' } catch { return false }
  })
  const [panelWidth, setPanelWidth] = useState(() => {
    try { return Number(localStorage.getItem(widthKey)) || defaultPanelWidth } catch { return defaultPanelWidth }
  })
  const [activeTab, setActiveTab] = useState(defaultTab ?? tabs[0]?.id ?? '')

  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    startX.current = e.clientX
    startWidth.current = panelWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [panelWidth])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const delta = startX.current - e.clientX
      const next = Math.min(maxPanelWidth, Math.max(minPanelWidth, startWidth.current + delta))
      setPanelWidth(next)
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setPanelWidth(w => {
        try { localStorage.setItem(widthKey, String(w)) } catch { /* localStorage may be disabled */ }
        return w
      })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [widthKey, minPanelWidth, maxPanelWidth])

  const toggleCollapsed = () => {
    setCollapsed(v => {
      const next = !v
      try { localStorage.setItem(collapsedKey, String(next)) } catch { /* localStorage may be disabled */ }
      return next
    })
  }

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
      {/* Main */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {children}
      </div>

      {/* Drag handle */}
      {!collapsed && (
        <div
          onMouseDown={onMouseDown}
          className="w-1 flex-shrink-0 hover:bg-primary/30 active:bg-primary/50 cursor-col-resize transition-colors relative group"
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>
      )}

      {/* Panel */}
      <div
        className={cn(
          'flex-shrink-0 border-l-hairline flex flex-col bg-background',
          'transition-[width] duration-200 ease-out overflow-hidden',
          collapsed ? 'w-[36px]' : '',
        )}
        style={collapsed ? undefined : { width: panelWidth }}
      >
        {collapsed ? (
          /* Collapsed strip — just toggle button */
          <button
            onClick={toggleCollapsed}
            className="flex items-center justify-center h-10 w-full text-muted-foreground hover:text-foreground transition-colors"
            title="Abrir painel"
          >
            <PanelRightOpen size={14} />
          </button>
        ) : (
          <>
            {/* Tab bar */}
            <div className="flex items-center border-b-hairline min-h-[40px] flex-shrink-0">
              <div className="flex flex-1 overflow-x-auto scrollbar-minimal">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'font-mono uppercase tracking-[0.1em] text-[10px] px-4 py-2.5 whitespace-nowrap border-b-2 transition-colors',
                      activeTab === tab.id
                        ? 'border-b-primary text-foreground'
                        : 'border-b-transparent text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <button
                onClick={toggleCollapsed}
                className="flex-shrink-0 flex items-center justify-center w-9 h-full text-muted-foreground hover:text-foreground transition-colors"
                title="Fechar painel"
              >
                <PanelRightClose size={13} />
              </button>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto scrollbar-minimal">
              {tabs.find(t => t.id === activeTab)?.content}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
