import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { HomePage } from './HomePage'

const user = {
  username: 'demo',
  email: 'demo@example.com',
  profileImage: null,
  bio: '',
  lastSeen: null,
  registeredAt: null,
}

describe('HomePage', () => {
  it('shows welcome text', () => {
    render(<HomePage user={user} onNavigate={vi.fn()} />)
    expect(screen.getByText('Выберите чат, чтобы начать общение')).toBeInTheDocument()
    expect(screen.getByText('Devil')).toBeInTheDocument()
  })

  it('shows auth buttons for unauthenticated user', () => {
    render(<HomePage user={null} onNavigate={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Регистрация' })).toBeInTheDocument()
  })

  it('hides auth buttons for authenticated user', () => {
    render(<HomePage user={user} onNavigate={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Войти' })).not.toBeInTheDocument()
  })
})
