import { avatarFallback } from '../../shared/lib/format'
import type { UserProfile } from '../../entities/user/types'

type Props = {
  user: UserProfile | null
  onNavigate: (path: string) => void
  onLogout: () => void
}

export function TopBar({ user, onNavigate, onLogout }: Props) {
  return (
    <header className="topbar">
      <button className="brand" onClick={() => onNavigate('/')}>
        EchoChat
      </button>
      <nav>
        <button className="link" onClick={() => onNavigate('/rooms/public')}>
          Публичный чат
        </button>
        {user && (
          <button className="link" onClick={() => onNavigate('/profile')}>
            Профиль
          </button>
        )}
      </nav>
      <div className="nav-actions">
        {user ? (
          <>
            <div className="chip">
              <div className="avatar tiny">
                {user.profileImage ? (
                  <img src={user.profileImage} alt={user.username} />
                ) : (
                  <span>{avatarFallback(user.username)}</span>
                )}
              </div>
              <span>{user.username}</span>
            </div>
            <button className="btn ghost" onClick={onLogout}>
              Выйти
            </button>
          </>
        ) : (
          <>
            <button className="btn ghost" onClick={() => onNavigate('/login')}>
              Войти
            </button>
            <button className="btn primary" onClick={() => onNavigate('/register')}>
              Регистрация
            </button>
          </>
        )}
      </div>
    </header>
  )
}
