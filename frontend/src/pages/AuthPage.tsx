import type { FormEvent } from 'react'
import { useState } from 'react'

type Props = {
  title: string
  submitLabel: string
  onSubmit: (username: string, password: string, confirm?: string) => void
  onNavigate: (path: string) => void
  requireConfirm?: boolean
  error?: string | null
  passwordRules?: string[]
}

export function AuthPage({
  title,
  submitLabel,
  onSubmit,
  onNavigate,
  requireConfirm = false,
  error = null,
  passwordRules = [],
}: Props) {
  const USERNAME_MAX_LENGTH = 13
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!username.trim() || !password) return
    onSubmit(username.trim(), password, confirm)
  }

  return (
    <div className="auth">
      <div className="card wide">
        <p className="eyebrow">{title}</p>
        <h2 className="mb-1">{submitLabel}</h2>
        {error && (
          <div className="toast danger" role="alert">
            {error}
          </div>
        )}
        <form className="form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Имя пользователя</span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              maxLength={USERNAME_MAX_LENGTH}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Пароль</span>
            <input
              type="password"
              autoComplete={requireConfirm ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {requireConfirm && (
            <label className="field">
              <span>Повторите пароль</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
          )}
          {requireConfirm && passwordRules.length > 0 && (
            <div className="password-rules">
              <p className="note">Пароль должен соответствовать требованиям:</p>
              <ul className="ticks">
                {passwordRules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </div>
          )}
          <button className="btn primary" type="submit">
            {submitLabel}
          </button>
        </form>
        <div className="auth-switch">
          {title === 'Вход' ? (
            <p>
              Нет аккаунта?{' '}
              <button className="link" onClick={() => onNavigate('/register')}>
                Зарегистрироваться
              </button>
            </p>
          ) : (
            <p>
              Уже есть аккаунт?{' '}
              <button className="link" onClick={() => onNavigate('/login')}>
                Войти
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

