import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HardLimitBanner } from '../HardLimitBanner'

describe('HardLimitBanner', () => {
  it('renders nothing when alerts is empty', () => {
    const { container } = render(<HardLimitBanner alerts={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders banner when there is at least one alert', () => {
    render(<HardLimitBanner alerts={[
      { id: 'a1', category: 'storage', code: 'hard_limit', severity: 'critical',
        message: 'Storage at 96%', fired_at: '2026-04-29T10:00:00Z' },
    ]} />)
    expect(screen.getByText(/Storage at 96%/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
