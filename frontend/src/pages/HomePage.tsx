import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UserProfile } from '../entities/user/types'
import { debugLog } from '../shared/lib/debug'
import type { Message } from '../entities/message/types'
import type { ApiError } from '../shared/api/types'
import { usePublicRoom } from '../hooks/usePublicRoom'
import { useChatActions } from '../hooks/useChatActions'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useReconnectingWebSocket } from '../hooks/useReconnectingWebSocket'
import { sanitizeText } from '../shared/lib/sanitize'
import { getWebSocketBase } from '../shared/lib/ws'
import { usePresence } from '../shared/presence'

type Props = {
  user: UserProfile | null
  onNavigate: (path: string) => void
}

const buildTempId = (seed: number) => Date.now() * 1000 + seed

export function HomePage({ user, onNavigate }: Props) {
  const { publicRoom, loading } = usePublicRoom(user)
  const { getRoomDetails, getRoomMessages } = useChatActions()
  const isOnline = useOnlineStatus()
  const [liveMessages, setLiveMessages] = useState<Message[]>([])
  const [creatingRoom, setCreatingRoom] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const tempIdRef = useRef(0)
  const { online, guests } = usePresence()

  const visiblePublicRoom = useMemo(() => publicRoom, [publicRoom])
  const isLoading = useMemo(() => loading, [loading])
  const publicRoomLabel = visiblePublicRoom?.name || 'Комната для всех'

  useEffect(() => {
    let active = true

    if (!visiblePublicRoom) {
      queueMicrotask(() => {
        if (active) setLiveMessages([])
      })
      return () => {
        active = false
      }
    }

    const roomSlug = visiblePublicRoom.slug
    getRoomMessages(roomSlug, { limit: 4 })
      .then((payload) => {
        if (!active) return
        const sanitized = payload.messages.map((msg) => ({
          ...msg,
          content: sanitizeText(msg.content, 200),
        }))
        setLiveMessages(sanitized.slice(-4))
      })
      .catch((err) => debugLog('Live feed history failed', err))

    return () => {
      active = false
    }
  }, [visiblePublicRoom, getRoomMessages])

  const liveUrl = useMemo(() => {
    if (!visiblePublicRoom) return null
    return `${getWebSocketBase()}/ws/chat/${encodeURIComponent(
      visiblePublicRoom.slug,
    )}/`
  }, [visiblePublicRoom])

  const handleLiveMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data)
      if (!data.message) return
      tempIdRef.current += 1
      const next: Message = {
        id: buildTempId(tempIdRef.current),
        username: data.username,
        content: sanitizeText(String(data.message), 200),
        profilePic: data.profile_pic || null,
        createdAt: new Date().toISOString(),
      }
      setLiveMessages((prev) => {
        const updated = [...prev, next]
        return updated.slice(-4)
      })
    } catch (error) {
      debugLog('Live feed WS parse failed', error)
    }
  }, [])

  useReconnectingWebSocket({
    url: liveUrl,
    onMessage: handleLiveMessage,
    onError: (err) => debugLog('Live feed WS error', err),
  })

  const createRoomSlug = (length = 12) => {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, length)
    }
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    const values = new Uint8Array(length)
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(values)
      return Array.from(values, (value) => alphabet[value % alphabet.length]).join('')
    }
    let fallback = ''
    for (let i = 0; i < length; i += 1) {
      fallback += alphabet[Math.floor(Math.random() * alphabet.length)]
    }
    return fallback
  }

  const onCreateRoom = async () => {
    if (!user || creatingRoom) return
    setCreateError(null)
    setCreatingRoom(true)
    let navigated = false

    try {
      const maxAttempts = 3
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const slug = createRoomSlug()
        try {
          const details = await getRoomDetails(slug)
          if (details.created === false) {
            continue
          }
          navigated = true
          onNavigate(`/rooms/${encodeURIComponent(slug)}`)
          return
        } catch (err) {
          const apiErr = err as ApiError
          if (apiErr && typeof apiErr.status === 'number' && apiErr.status === 409) {
            continue
          }
          throw err
        }
      }
      setCreateError('Не удалось создать уникальную комнату. Попробуйте еще раз.')
    } catch (err) {
      debugLog('Room create failed', err)
      setCreateError('Не удалось создать комнату. Попробуйте еще раз.')
    } finally {
      if (!navigated) {
        setCreatingRoom(false)
      }
    }
  }

  return (
    <div className="stack">
      {!isOnline && (
        <div className="toast warning" role="status">
          Нет подключения к интернету. Мы восстановим соединение автоматически.
        </div>
      )}
      <section className="hero">
        <div className="hero-content">
          <div>
            <p className="eyebrow">Django Channels + React</p>
            <h1>Чат в реальном времени.</h1>
            <p className="lead">
              Быстрые комнаты, живые обсуждения и приватные чаты без лишних шагов.
            </p>
          </div>
          <ul className="ticks">
            <li>Создавайте приватные комнаты за секунды</li>
            <li>История сообщений сохраняется</li>
            <li>Онлайн-статус участников в реальном времени</li>
          </ul>
          <div className="actions hero-actions">
            <button className="btn primary" onClick={() => onNavigate('/rooms/public')}>
              Открыть публичный чат
            </button>
            {!user && (
              <button className="btn ghost" onClick={() => onNavigate('/register')}>
                Создать аккаунт
              </button>
            )}
          </div>
        </div>
        <div className="hero-card">
          <div className="hero-card-header">
            <div>
              <div className="badge">Прямой эфир</div>
              <p className="muted">Публичная комната • {publicRoomLabel}</p>
            </div>
            <span className={`pill ${visiblePublicRoom ? 'success' : 'muted'}`}>
              {visiblePublicRoom ? 'в эфире' : 'загрузка...'}
            </span>
          </div>
          {visiblePublicRoom ? (
            <div className="live-feed" aria-live="polite">
              {liveMessages.map((msg) => (
                <div className="live-item" key={`${msg.id}-${msg.createdAt}`}>
                  <span className="live-user">{msg.username}</span>
                  <span className="live-text">{msg.content}</span>
                </div>
              ))}
              {!liveMessages.length && (
                <p className="muted">Сообщений пока нет — будьте первым!</p>
              )}
            </div>
          ) : (
            <p className="muted">Загружаем публичный эфир...</p>
          )}
        </div>
      </section>

      <section className="grid two">
        <div className="grid-head">
          <h2>Выберите сценарий</h2>
          <p className="muted">
            Публичная комната для всех или своя приватная — подключайтесь в один клик.
          </p>
        </div>
        <div className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Публичная комната</p>
              <h3>{publicRoomLabel}</h3>
            </div>
            <span className="pill">{isLoading ? 'загрузка...' : 'онлайн'}</span>
          </div>
          <p className="muted">
            Доступна только авторизованным пользователям. Сообщения сохраняются
            в базе.
          </p>
          <button
            className="btn primary"
            disabled={!user || !visiblePublicRoom}
            onClick={() =>
              onNavigate(`/rooms/${encodeURIComponent(visiblePublicRoom?.slug || 'public')}`)
            }
          >
            Войти в комнату
          </button>
          {!user && <p className="note">Нужно войти, чтобы подключиться к чату.</p>}
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Своя комната</p>
              <h3>Создайте новую комнату</h3>
            </div>
          </div>
          <p className="muted">
            Нажмите кнопку, чтобы создать новую приватную комнату с уникальным именем. Мы
            проверим, что такой комнаты еще нет, и только после этого подключим вас.
          </p>
          <div className="form">
            <button
              className="btn outline"
              type="button"
              aria-label="Создать комнату"
              disabled={!user || creatingRoom || !isOnline}
              onClick={onCreateRoom}
            >
              {creatingRoom ? 'Создаем комнату...' : 'Создать комнату'}
            </button>
            {createError && <p className="note">{createError}</p>}
            {!user && <p className="note">Сначала войдите в аккаунт.</p>}
            {!isOnline && <p className="note">Нет сети — создание комнаты недоступно.</p>}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Кто онлайн</p>
            </div>
            <span className="pill">{user ? online.length : '—'}</span>
          </div>
          <p className="muted">Гостей онлайн — {guests}</p>
          {!user ? (
            <p className="muted">Войдите, чтобы видеть участников онлайн.</p>
          ) : online.length ? (
            <div className="online-list">
              {online.map((u) => (
                <div className="online-item" key={u.username}>
                  <div className="avatar tiny">
                    {u.profileImage ? (
                      <img src={u.profileImage} alt={u.username} />
                    ) : (
                      <span>{u.username[0]?.toUpperCase() || '?'}</span>
                    )}
                  </div>
                  <span>{u.username}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Пока никого нет в сети.</p>
          )}
        </div>

        {!user && (
          <div className="card">
            <div className="card-header">
              <div>
                <p className="eyebrow">Не авторизованы</p>
                <h3>Войдите, чтобы начать</h3>
              </div>
              <span className="pill muted">Гость</span>
            </div>
            <p className="muted">
              Авторизация нужна только для подключения к чату. Регистрация — по
              логину и паролю без email-подтверждения.
            </p>
            <div className="actions">
              <button className="btn primary" type="button" onClick={() => onNavigate('/login')}>
                Войти
              </button>
              <button className="btn ghost" type="button" onClick={() => onNavigate('/register')}>
                Зарегистрироваться
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
