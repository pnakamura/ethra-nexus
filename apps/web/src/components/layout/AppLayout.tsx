import { useState, useEffect, useRef } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopHeader } from './TopHeader'

const COOKIE_KEY = 'ethra.sidebar.expanded'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7

function readCookie(): boolean {
  if (typeof document === 'undefined') return false
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_KEY}=([^;]*)`))
  return match?.[1] === 'true'
}

function writeCookie(v: boolean) {
  document.cookie = `${COOKIE_KEY}=${v}; path=/; max-age=${COOKIE_MAX_AGE}`
}

export function AppLayout() {
  const [expanded, setExpanded] = useState(false)
  const initialized = useRef(false)

  useEffect(() => {
    setExpanded(readCookie())
    initialized.current = true
  }, [])

  useEffect(() => {
    if (initialized.current) writeCookie(expanded)
  }, [expanded])

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar expanded={expanded} onToggle={setExpanded} />
      <TopHeader expanded={expanded} />
      <main
        className="flex-1 min-w-0 p-8 pt-[calc(56px+2rem)] transition-[margin-left] duration-200 ease-out"
        style={{ marginLeft: expanded ? 220 : 60 }}
      >
        <Outlet />
      </main>
    </div>
  )
}
