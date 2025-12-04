import { useEffect, useState } from 'react'
import '../App.css'
import { navigate, parseRoute, type Route } from './router'
import { AuthPage } from '../pages/AuthPage'
import { HomePage } from '../pages/HomePage'
import { ProfilePage } from '../pages/ProfilePage'
import { ChatRoomPage } from '../pages/ChatRoomPage'
import { TopBar } from '../widgets/layout/TopBar'
import { ensureCsrf, getSession, login, logout, register, updateProfile } from '../shared/api/auth'
import type { ApiError } from '../shared/api/types'
import type { UserProfile } from '../entities/user/types'
import { debugLog } from '../shared/lib/debug'

type AuthState = {
  user: UserProfile | null
  loading: boolean
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname))
  const [auth, setAuth] = useState<AuthState>({ user: null, loading: true })
  const [banner, setBanner] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ensureCsrf()
      .catch((err) => debugLog('CSRF fetch failed', err))
      .finally(() => {
        getSession()
          .then((session) => {
            setAuth({ user: session.user, loading: false })
          })
          .catch((err) => {
            debugLog('Session fetch failed', err)
            setAuth({ user: null, loading: false })
          })
      })
  }, [])

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
      return apiErr.message
    }
    return 'Не удалось выполнить запрос. Попробуйте ещё раз.'
  }

  const handleNavigate = (path: string) => navigate(path, setRoute)

  const handleLogin = async (username: string, password: string) => {
    setError(null)
    try {
      await ensureCsrf()
      const session = await login(username, password)
      setAuth({ user: session.user, loading: false })
      setBanner('Добро пожаловать обратно 👋')
      handleNavigate('/')
    } catch (err) {
      debugLog('Login failed', err)
      setError(extractMessage(err))
    }
  }

  const handleRegister = async (username: string, password1: string, password2: string) => {
    setError(null)
    try {
      await ensureCsrf()
      const session = await register(username, password1, password2)
      setAuth({ user: session.user, loading: false })
      setBanner('Аккаунт создан. Можно общаться!')
      handleNavigate('/')
    } catch (err) {
      debugLog('Registration failed', err)
      setError(extractMessage(err))
    }
  }

  const handleLogout = async () => {
    await logout().catch(() => {})
    setAuth({ user: null, loading: false })
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
      const { user } = await updateProfile(fields)
      const bustedImage =
        user.profileImage && user.profileImage.length > 0
          ? `${user.profileImage}${user.profileImage.includes('?') ? '&' : '?'}t=${Date.now()}`
          : null
      setAuth((prev) => ({ ...prev, user: { ...user, profileImage: bustedImage } }))
      setBanner('Профиль обновлён')
    } catch (err) {
      debugLog('Profile update failed', err)
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
          />
        )
      case 'profile':
        return (
          <ProfilePage
            key={auth.user?.username || 'guest'}
            user={auth.user}
            onSave={handleProfileSave}
            onNavigate={handleNavigate}
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
    <div className="app-shell">
      <TopBar user={auth.user} onNavigate={handleNavigate} onLogout={handleLogout} />
      <main className="content">
        {auth.loading && <div className="panel muted">Проверяем сессию...</div>}
        {banner && (
          <div className="toast success" role="status">
            {banner}
          </div>
        )}
        {error && (
          <div className="toast danger" role="alert">
            {error}
          </div>
        )}
        {renderRoute()}
      </main>
    </div>
  )
}

export default App
