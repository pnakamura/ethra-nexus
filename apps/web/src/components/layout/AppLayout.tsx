import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function AppLayout() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 ml-[56px] p-8 min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
