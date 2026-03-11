import type { UserProfile } from '../entities/user/types'
import { Button } from '../shared/ui'
import styles from '../styles/pages/HomePage.module.css'

type Props = {
  user: UserProfile | null
  onNavigate: (path: string) => void
}

export function HomePage({ user, onNavigate }: Props) {
  return (
    <div className={styles.welcome}>
      <div className={styles.welcomeContent}>
        <div className={styles.illustration}>
          <svg width="160" height="160" viewBox="0 0 160 160" fill="none">
            <circle cx="80" cy="80" r="78" stroke="rgba(47,179,163,0.15)" strokeWidth="2" />
            <circle cx="80" cy="80" r="56" stroke="rgba(47,179,163,0.1)" strokeWidth="1.5" />
            <rect x="44" y="48" width="72" height="44" rx="12" fill="rgba(47,179,163,0.15)" />
            <rect x="52" y="60" width="40" height="4" rx="2" fill="rgba(47,179,163,0.35)" />
            <rect x="52" y="70" width="28" height="4" rx="2" fill="rgba(47,179,163,0.25)" />
            <rect x="52" y="80" width="20" height="3" rx="1.5" fill="rgba(47,179,163,0.15)" />
            <circle cx="104" cy="112" r="16" fill="#2fb3a3" />
            <path d="M98 112L108 106V118L98 112Z" fill="#fff" />
          </svg>
        </div>

        <h2 className={styles.welcomeTitle}>Devil</h2>
        <p className={styles.welcomeText}>Выберите чат, чтобы начать общение</p>

        {!user && (
          <div className={styles.welcomeActions}>
            <Button variant="primary" onClick={() => onNavigate('/login')}>
              Войти
            </Button>
            <Button variant="ghost" onClick={() => onNavigate('/register')}>
              Регистрация
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
