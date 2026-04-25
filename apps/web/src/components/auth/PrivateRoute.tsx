import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

export function PrivateRoute() {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />
}
