import type { UserProfile } from '../../entities/user/types'
import { useDirectInbox } from '../../shared/directInbox'
import { usePresence } from '../../shared/presence'
import { Avatar, Button } from '../../shared/ui'
import styles from './TopBar.module.css'

type Props = {
  user: UserProfile | null
  onNavigate: (path: string) => void
  onLogout: () => void
}

/**
 * Верхняя панель навигации приложения.
 * @param props Текущий пользователь и обработчики навигации.
 * @returns JSX-разметка верхней панели.
 */
export function TopBar({ user, onNavigate }: Props) {
  const { unreadDialogsCount } = useDirectInbox()
  const { online: presenceOnline, status: presenceStatus } = usePresence()
  const isCurrentUserOnline =
    Boolean(user) &&
    presenceStatus === 'online' &&
    presenceOnline.some((entry) => entry.username === user?.username)

  return (
    <header className={styles.root} data-testid="topbar">
      <button className={styles.brand} onClick={() => onNavigate('/')} type="button" aria-label="На главную">
        <img src="/Devil.svg" alt="Devil" className={styles.brandLogo} />
      </button>

      <nav className={styles.nav} aria-label="Главная навигация">
        <Button variant="link" className={styles.navLink} onClick={() => onNavigate('/rooms/public')}>
          Публичный чат
        </Button>

        {user && (
          <Button
            variant="link"
            className={[styles.navLink, styles.linkWithBadge].join(' ')}
            onClick={() => onNavigate('/direct')}
            data-testid="direct-nav-button"
          >
            <span>Личные чаты</span>
            {unreadDialogsCount > 0 && (
              <span className={styles.badge} aria-label={`Unread dialogs: ${unreadDialogsCount}`} data-testid="direct-unread-badge">
                {unreadDialogsCount}
              </span>
            )}
          </Button>
        )}

        {user && (
          <Button
            variant="link"
            className={styles.navLink}
            onClick={() => onNavigate(`/users/${encodeURIComponent(user.username)}`)}
          >
            Профиль
          </Button>
        )}
      </nav>

      <div className={styles.navActions}>
        {user ? (
          <button
            className={styles.avatarLink}
            aria-label="Открыть профиль"
            onClick={() => onNavigate(`/users/${encodeURIComponent(user.username)}`)}
            type="button"
          >
            <Avatar
              username={user.username}
              profileImage={user.profileImage}
              avatarCrop={user.avatarCrop}
              size="tiny"
              online={isCurrentUserOnline}
              className={styles.avatar}
              loading="eager"
            />
          </button>
        ) : (
          <>
            <Button variant="link" className={styles.navLink} onClick={() => onNavigate('/login')}>
              Войти
            </Button>
            <Button variant="link" className={styles.navLink} onClick={() => onNavigate('/register')}>
              Регистрация
            </Button>
          </>
        )}
      </div>
    </header>
  )
}

