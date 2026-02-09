import { useEffect, useState } from 'react'
import '../App.css'
import { navigate, parseRoute, type Route } from './router'
import { AuthPage } from '../pages/AuthPage'
import { HomePage } from '../pages/HomePage'
import { ProfilePage } from '../pages/ProfilePage'
import { ChatRoomPage } from '../pages/ChatRoomPage'
import { TopBar } from '../widgets/layout/TopBar'
import { useAuth } from '../hooks/useAuth'
import { usePasswordRules } from '../hooks/usePasswordRules'
import type { ApiError } from '../shared/api/types'
import { debugLog } from '../shared/lib/debug'
import { PresenceProvider } from '../shared/presence'

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname))
  const { auth, login, register, logout, updateProfile } = useAuth()
  const { rules: passwordRules } = usePasswordRules(route.name === 'register')
  const [banner, setBanner] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (!banner) return
    const t = window.setTimeout(() => setBanner(null), 4200)
    return () => window.clearTimeout(t)
  }, [banner])

  const extractMessage = (err: unknown) => {
    if (err && typeof err === 'object' && 'message' in err && typeof (err as ApiError).message === 'string') {
      const apiErr = err as ApiError
      const apiErrors = apiErr.data && (apiErr.data.errors as Record<string, string[]> | undefined)
      if (apiErrors) {
        return Object.values(apiErrors)
          .flat()
          .join(' ')
      }
      if (apiErr.status === 400 && apiErr.message?.includes('status code 400')) {
        return 'Проверьте введённые данные и попробуйте снова.'
      }
      return apiErr.message
    }
    return 'Не удалось выполнить запрос. Попробуйте еще раз.'
  }

  const extractAuthMessage = (err: unknown, fallback: string) => {
    if (err && typeof err === 'object' && 'message' in err) {
      const apiErr = err as ApiError
      const apiErrors = apiErr.data && (apiErr.data.errors as Record<string, string[]> | undefined)
      if (apiErrors) {
        return Object.values(apiErrors)
          .flat()
          .join(' ')
      }
      if (apiErr.status === 400) {
        return fallback
      }
      if (typeof apiErr.message === 'string') {
        return apiErr.message
      }
    }
    return fallback
  }

  const handleNavigate = (path: string) => navigate(path, setRoute)

  const handleLogin = async (username: string, password: string) => {
    setError(null)
    try {
      await login({ username, password })
      setBanner('Добро пожаловать обратно 👋')
      handleNavigate('/')
    } catch (err) {
      debugLog('Login failed', err)
      setError(extractAuthMessage(err, 'Неверный логин или пароль'))
    }
  }

  const handleRegister = async (username: string, password1: string, password2: string) => {
    setError(null)
    try {
      await register({ username, password1, password2 })
      setBanner('Аккаунт создан. Можно общаться!')
      handleNavigate('/')
    } catch (err) {
      debugLog('Registration failed', err)
      setError(extractAuthMessage(err, 'Проверьте данные регистрации'))
    }
  }

  const handleLogout = async () => {
    await logout()
    setBanner('Вы вышли из аккаунта')
    handleNavigate('/login')
  }

  const handleProfileSave = async (fields: {
    username: string
    email: string
    image?: File | null
  }) => {
    if (!auth.user) return
    setError(null)
    try {
      await updateProfile(fields)
      setBanner('Профиль обновлен')
    } catch (err) {
      debugLog('Profile update failed', err)
      const apiErr = err as ApiError
      if (apiErr && typeof apiErr.status === 'number' && apiErr.status === 401) {
        setError('Сессия истекла. Войдите снова.')
        handleNavigate('/login')
        return
      }
      setError(extractMessage(err))
    }
  }

  const renderRoute = () => {
    switch (route.name) {
      case 'login':
        return (
          <AuthPage
            title="Вход"
            submitLabel="Войти"
            onSubmit={(u, p) => handleLogin(u, p)}
            onNavigate={handleNavigate}
            error={error}
          />
        )
      case 'register':
        return (
          <AuthPage
            title="Регистрация"
            submitLabel="Создать аккаунт"
            onSubmit={(u, p, p2) => handleRegister(u, p, p2 ?? '')}
            requireConfirm
            onNavigate={handleNavigate}
            error={error}
            passwordRules={passwordRules}
          />
        )
      case 'profile':
        return (
          <ProfilePage
            key={auth.user?.username || 'guest'}
            user={auth.user}
            onSave={handleProfileSave}
            onNavigate={handleNavigate}
            onLogout={handleLogout}
          />
        )
      case 'room':
        return (
          <ChatRoomPage
            key={route.slug}
            slug={route.slug}
            user={auth.user}
            onNavigate={handleNavigate}
          />
        )
      default:
        return <HomePage user={auth.user} onNavigate={handleNavigate} />
    }
  }

  return (
    <PresenceProvider user={auth.user}>
      <div className="app-shell">
        <TopBar user={auth.user} onNavigate={handleNavigate} onLogout={handleLogout} />
        <main className="content">
          {auth.loading && <div className="panel muted">Проверяем сессию...</div>}
          {banner && (
            <div className="toast success" role="status">
              {banner}
            </div>
          )}
          {error && route.name !== 'login' && route.name !== 'register' && (
            <div className="toast danger" role="alert">
              {error}
            </div>
          )}
          {renderRoute()}
        </main>
      </div>
    </PresenceProvider>
  )
}

export default App

