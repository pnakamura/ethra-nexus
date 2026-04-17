import { Routes, Route, Navigate } from 'react-router-dom'

// Pages (to be implemented)
// import { DashboardPage } from '@/pages/DashboardPage'
// import { AgentsPage } from '@/pages/AgentsPage'
// import { WikiPage } from '@/pages/WikiPage'
// import { SettingsPage } from '@/pages/SettingsPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route
        path="/dashboard"
        element={
          <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
            <h1>Ethra Nexus</h1>
            <p>AI Agent Orchestration Platform</p>
            <p style={{ color: '#888' }}>v0.1.0 — Scaffolding complete. Modules loading...</p>
          </div>
        }
      />
    </Routes>
  )
}
