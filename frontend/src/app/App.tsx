import { useEffect, useState } from 'react'
import '../App.css'
import { navigate, parseRoute, type Route } from './router'
import { AuthPage } from '../pages/AuthPage'
import { HomePage } from '../pages/HomePage'
import { ProfilePage } from '../pages/ProfilePage'
import { UserProfilePage } from '../pages/UserProfilePage'
import { ChatRoomPage } from '../pages/ChatRoomPage'
import { TopBar } from '../widgets/layout/TopBar'
import { useAuth } from '../hooks/useAuth'
import { usePasswordRules } from '../hooks/usePasswordRules'
import type { ApiError } from '../shared/api/types'
import { debugLog } from '../shared/lib/debug'
import { PresenceProvider } from '../shared/presence'

type ProfileFieldErrors = Record<string, string[]>
type ProfileSaveResult =
  | { ok: true }
  | { ok: false; errors?: ProfileFieldErrors; message?: string }

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
    const extractFromData = (data: unknown) => {
      if (!data || typeof data !== 'object') return null
      const record = data as Record<string, unknown>
      const errors = record.errors as Record<string, string[] | string> | undefined
      if (errors) {
        const parts = Object.values(errors)
          .flatMap((value) => (Array.isArray(value) ? value : [value]))
          .filter((value) => typeof value === 'string') as string[]
        if (parts.length) return parts.join(' ')
      }
      if (typeof record.error === 'string') return record.error
      if (typeof record.detail === 'string') return record.detail
      return null
    }

    if (err && typeof err === 'object') {
      const anyErr = err as ApiError & { response?: { data?: unknown } }
      const direct = extractFromData(anyErr.data) || extractFromData(anyErr.response?.data)
      if (direct) return direct

      if ('message' in anyErr) {
        const rawMessage = typeof anyErr.message === 'string' ? anyErr.message.trim() : ''
        if (rawMessage && !rawMessage.includes('status code 400')) {
          return rawMessage
        }
        if (anyErr.status === 400) {
          return fallback
        }
      }
    }
    return fallback
  }

  const extractProfileErrors = (err: unknown): ProfileFieldErrors | null => {
    if (!err || typeof err !== 'object') return null
    const anyErr = err as ApiError & { response?: { data?: unknown } }
    const data = (anyErr.data ?? anyErr.response?.data) as Record<string, unknown> | undefined
    const rawErrors = data && (data.errors as Record<string, unknown> | undefined)
    if (!rawErrors || typeof rawErrors !== 'object') return null
    const normalized: ProfileFieldErrors = {}
    for (const [field, value] of Object.entries(rawErrors)) {
      if (Array.isArray(value)) {
        const messages = value.filter((item) => typeof item === 'string') as string[]
        if (messages.length) normalized[field] = messages
      } else if (typeof value === 'string') {
        normalized[field] = [value]
      }
    }
    return Object.keys(normalized).length ? normalized : null
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
    bio?: string
  }): Promise<ProfileSaveResult> => {
    if (!auth.user) return { ok: false, message: 'Сначала войдите в аккаунт.' }
    setError(null)
    try {
      await updateProfile(fields)
      setBanner('Профиль обновлен')
      return { ok: true }
    } catch (err) {
      debugLog('Profile update failed', err)
      const apiErr = err as ApiError
      if (apiErr && typeof apiErr.status === 'number' && apiErr.status === 401) {
        setError('Сессия истекла. Войдите снова.')
        handleNavigate('/login')
        return { ok: false, message: 'Сессия истекла. Войдите снова.' }
      }
      const fieldErrors = extractProfileErrors(err)
      if (fieldErrors) {
        return { ok: false, errors: fieldErrors }
      }
      return { ok: false, message: extractMessage(err) }
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
      case 'user':
        return (
          <UserProfilePage
            key={route.username}
            user={auth.user}
            username={route.username}
            currentUser={auth.user}
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
    <PresenceProvider user={auth.user} ready={!auth.loading}>
      <div className="app-shell">
        <TopBar user={auth.user} onNavigate={handleNavigate} onLogout={handleLogout} />
        <main className="content">
          {/* {auth.loading && <div className="panel muted">Проверяем сессию...</div>} */}
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

