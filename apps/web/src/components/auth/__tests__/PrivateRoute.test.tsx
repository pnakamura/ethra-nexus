import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '@/contexts/AuthContext'
import { PrivateRoute } from '../PrivateRoute'

describe('PrivateRoute', () => {
  it('renders children when authenticated', () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true, token: 't', login: vi.fn(), logout: vi.fn() })
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<PrivateRoute />}>
            <Route path="/dashboard" element={<div>Protected</div>} />
          </Route>
          <Route path="/login" element={<div>Login</div>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('Protected')).toBeTruthy()
  })

  it('redirects to /login when not authenticated', () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: false, token: null, login: vi.fn(), logout: vi.fn() })
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<PrivateRoute />}>
            <Route path="/dashboard" element={<div>Protected</div>} />
          </Route>
          <Route path="/login" element={<div>Login</div>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('Login')).toBeTruthy()
    expect(screen.queryByText('Protected')).toBeNull()
  })
})
