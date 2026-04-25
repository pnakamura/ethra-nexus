import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { AuthProvider, useAuth } from '../AuthContext'

function TestComponent() {
  const { token, isAuthenticated, login, logout } = useAuth()
  return (
    <div>
      <span data-testid="auth">{isAuthenticated ? 'yes' : 'no'}</span>
      <span data-testid="token">{token ?? 'none'}</span>
      <button onClick={() => login('test-token')}>login</button>
      <button onClick={logout}>logout</button>
    </div>
  )
}

describe('AuthContext', () => {
  beforeEach(() => localStorage.clear())

  it('starts unauthenticated when localStorage empty', () => {
    render(<AuthProvider><TestComponent /></AuthProvider>)
    expect(screen.getByTestId('auth').textContent).toBe('no')
  })

  it('login sets token and isAuthenticated', () => {
    render(<AuthProvider><TestComponent /></AuthProvider>)
    act(() => screen.getByText('login').click())
    expect(screen.getByTestId('auth').textContent).toBe('yes')
    expect(screen.getByTestId('token').textContent).toBe('test-token')
    expect(localStorage.getItem('ethra_token')).toBe('test-token')
  })

  it('logout clears token', () => {
    localStorage.setItem('ethra_token', 'existing')
    render(<AuthProvider><TestComponent /></AuthProvider>)
    act(() => screen.getByText('logout').click())
    expect(screen.getByTestId('auth').textContent).toBe('no')
    expect(localStorage.getItem('ethra_token')).toBeNull()
  })

  it('reads existing token from localStorage on mount', () => {
    localStorage.setItem('ethra_token', 'persisted')
    render(<AuthProvider><TestComponent /></AuthProvider>)
    expect(screen.getByTestId('auth').textContent).toBe('yes')
  })
})
