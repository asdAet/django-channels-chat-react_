import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Message } from '../entities/message/types'
import type { UserProfile } from '../entities/user/types'
import { useChatRoom } from '../hooks/useChatRoom'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useReconnectingWebSocket } from '../hooks/useReconnectingWebSocket'
import { invalidateDirectChats, invalidateRoomMessages } from '../shared/cache/cacheManager'
import { useDirectInbox } from '../shared/directInbox'
import { formatDayLabel, formatLastSeen, formatTimestamp } from '../shared/lib/format'
import { debugLog } from '../shared/lib/debug'
import { sanitizeText } from '../shared/lib/sanitize'
import { getWebSocketBase } from '../shared/lib/ws'
import { usePresence } from '../shared/presence'
import { Avatar, Button, Panel, Toast } from '../shared/ui'
import styles from '../styles/pages/ChatRoomPage.module.css'

type Props = {
  slug: string
  user: UserProfile | null
  onNavigate: (path: string) => void
}

const MAX_MESSAGE_LENGTH = 1000
const RATE_LIMIT_COOLDOWN_MS = 10_000

/**
 * Страница комнаты чата (публичной или direct).
 * @param props Слаг комнаты, текущий пользователь и навигация.
 * @returns JSX-контент комнаты.
 */
export function ChatRoomPage({ slug, user, onNavigate }: Props) {
  const {
    details,
    messages,
    loading,
    loadingMore,
    hasMore,
    error,
    loadMore,
    setMessages,
  } = useChatRoom(slug, user)
  const isPublicRoom = slug === 'public'
  const isOnline = useOnlineStatus()
  const { setActiveRoom, markRead } = useDirectInbox()
  const { online: presenceOnline, status: presenceStatus } = usePresence()
  const onlineUsernames = useMemo(
    () =>
      new Set(
        presenceStatus === 'online'
          ? presenceOnline.map((entry) => entry.username)
          : [],
      ),
    [presenceOnline, presenceStatus],
  )
  const [draft, setDraft] = useState('')
  const [roomError, setRoomError] = useState<string | null>(null)
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const listRef = useRef<HTMLDivElement | null>(null)
  const isAtBottomRef = useRef(true)
  const prependingRef = useRef(false)
  const prevScrollHeightRef = useRef(0)
  const tempIdRef = useRef(0)

  const openUserProfile = useCallback(
    (username: string) => {
      if (!username) return
      onNavigate(`/users/${encodeURIComponent(username)}`)
    },
    [onNavigate],
  )

  const wsUrl = useMemo(() => {
    if (!user && !isPublicRoom) return null
    return `${getWebSocketBase()}/ws/chat/${encodeURIComponent(slug)}/`
  }, [slug, user, isPublicRoom])

  const applyRateLimit = useCallback((cooldownMs: number) => {
    const until = Date.now() + cooldownMs
    setRateLimitUntil((prev) => (prev && prev > until ? prev : until))
    setNow(Date.now())
  }, [])

  const handleMessage = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data)
      if (data?.error === 'rate_limited') {
        const retryAfter = Number(data.retry_after ?? data.retryAfter ?? data.retry ?? Number.NaN)
        const cooldownMs = Number.isFinite(retryAfter)
          ? Math.max(1, retryAfter) * 1000
          : RATE_LIMIT_COOLDOWN_MS
        applyRateLimit(cooldownMs)
        return
      }

      if (data?.error === 'message_too_long') {
        setRoomError(`Сообщение слишком длинное (макс ${MAX_MESSAGE_LENGTH} символов)`)
        return
      }

      if (!data.message) return
      const content = sanitizeText(String(data.message), MAX_MESSAGE_LENGTH)
      if (!content) return
      tempIdRef.current += 1

      invalidateRoomMessages(slug)
      if (details?.kind === 'direct') {
        invalidateDirectChats()
      }

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() * 1000 + tempIdRef.current,
          username: data.username,
          content,
          profilePic: data.profile_pic || null,
          createdAt: new Date().toISOString(),
        },
      ])
    } catch (parseError) {
      debugLog('WS payload parse failed', parseError)
    }
  }

  useEffect(() => {
    if (!user || details?.kind !== 'direct') return

    setActiveRoom(slug)
    markRead(slug)

    return () => {
      setActiveRoom(null)
    }
  }, [details?.kind, markRead, setActiveRoom, slug, user])

  const { status, lastError, send } = useReconnectingWebSocket({
    url: wsUrl,
    onMessage: handleMessage,
    onOpen: () => setRoomError(null),
    onClose: (event) => {
      if (event.code !== 1000 && event.code !== 1001) {
        setRoomError('Соединение потеряно. Пытаемся восстановить...')
      }
    },
    onError: () => setRoomError('Ошибка соединения'),
  })

  useEffect(() => {
    if (!rateLimitUntil) return
    const intervalId = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= rateLimitUntil) {
        window.clearInterval(intervalId)
      }
    }, 250)
    return () => window.clearInterval(intervalId)
  }, [rateLimitUntil])

  useEffect(() => {
    if (!user) return
    const nextProfile = user.profileImage || null
    const username = user.username

    setMessages((prev) => {
      let changed = false
      const updated = prev.map((msg) => {
        if (msg.username !== username) return msg
        if (msg.profilePic === nextProfile) return msg
        changed = true
        return { ...msg, profilePic: nextProfile }
      })
      return changed ? updated : prev
    })
  }, [user, setMessages])

  const handleScroll = useCallback(() => {
    const list = listRef.current
    if (!list) return
    const { scrollTop, scrollHeight, clientHeight } = list
    const nearBottom = scrollHeight - scrollTop - clientHeight < 80
    isAtBottomRef.current = nearBottom

    if (scrollTop < 120 && hasMore && !loadingMore && !loading) {
      prependingRef.current = true
      prevScrollHeightRef.current = scrollHeight
      loadMore()
    }
  }, [hasMore, loadingMore, loading, loadMore])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    if (prependingRef.current) {
      const delta = list.scrollHeight - prevScrollHeightRef.current
      list.scrollTop += delta
      prependingRef.current = false
      return
    }
    if (isAtBottomRef.current) {
      list.scrollTop = list.scrollHeight
    }
  }, [messages])

  const rateLimitRemainingMs = rateLimitUntil ? Math.max(0, rateLimitUntil - now) : 0
  const rateLimitActive = rateLimitRemainingMs > 0
  const rateLimitSeconds = Math.ceil(rateLimitRemainingMs / 1000)

  const sendMessage = () => {
    if (!user) {
      setRoomError('Авторизуйтесь, чтобы отправлять сообщения')
      return
    }
    const raw = draft
    if (!raw.trim()) return
    if (rateLimitActive) {
      setRoomError(`Слишком часто. Подождите ${rateLimitSeconds} сек.`)
      return
    }
    if (raw.length > MAX_MESSAGE_LENGTH) {
      setRoomError(`Сообщение слишком длинное (макс ${MAX_MESSAGE_LENGTH} символов)`)
      return
    }
    if (!isOnline || status !== 'online') {
      setRoomError('Нет соединения с сервером')
      return
    }

    const cleaned = sanitizeText(raw, MAX_MESSAGE_LENGTH)
    const payload = JSON.stringify({
      message: cleaned,
      username: user.username,
      profile_pic: user.profileImage,
      room: slug,
    })

    if (!send(payload)) {
      setRoomError('Не удалось отправить сообщение')
      return
    }
    setDraft('')
  }

  const loadError = error ? 'Не удалось загрузить комнату' : null
  const visibleError = roomError || loadError

  // const statusLabel = (() => {
  //   switch (status) {
  //     case 'online':
  //       return 'Подключено'
  //     case 'connecting':
  //       return 'Подключаемся...'
  //     case 'offline':
  //       return 'Офлайн'
  //     case 'error':
  //       return 'Ошибка соединения'
  //     case 'closed':
  //       return 'Соединение потеряно'
  //     default:
  //       return 'Соединение...'
  //   }
  // })()

  // const statusClass =
  //   status === 'online'
  //     ? styles.pillSuccess
  //     : status === 'connecting'
  //       ? styles.pillWarning
  //       : styles.pillMuted

  const timeline = useMemo(() => {
    const items: Array<
      | { type: 'day'; key: string; label: string }
      | { type: 'message'; message: Message }
    > = []
    const nowDate = new Date()
    let lastKey: string | null = null

    for (const msg of messages) {
      const date = new Date(msg.createdAt)
      if (!Number.isNaN(date.getTime())) {
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
          date.getDate(),
        ).padStart(2, '0')}`
        if (key !== lastKey) {
          const label = formatDayLabel(date, nowDate)
          if (label) {
            items.push({ type: 'day', key, label })
            lastKey = key
          }
        }
      }
      items.push({ type: 'message', message: msg })
    }

    return items
  }, [messages])

  if (!user && !isPublicRoom) {
    return (
      <Panel>
        <p>Чтобы войти в комнату, авторизуйтесь.</p>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => onNavigate('/login')}>
            Войти
          </Button>
          <Button variant="ghost" onClick={() => onNavigate('/register')}>
            Регистрация
          </Button>
        </div>
      </Panel>
    )
  }

  return (
    <div className={styles.chat}>
      {!isOnline && (
        <Toast variant="warning" role="status">
          Нет подключения к интернету. Мы восстановим соединение автоматически.
        </Toast>
      )}
      {lastError && status === 'error' && (
        <Toast variant="danger" role="alert">
          Проблемы с соединением. Проверьте сеть и попробуйте еще раз.
        </Toast>
      )}

      <div className={styles.chatHeader}>
        <div>
          {/* <h2>{(details?.kind === 'direct' && details?.peer?.username) || details?.createdBy || details?.name || slug}</h2> */}
          {details?.kind === 'direct' && (
            <p className={styles.muted}>
              {details?.peer?.username && onlineUsernames.has(details.peer.username)
                ? 'В сети'
                : `Последний раз в сети: ${formatLastSeen(details?.peer?.lastSeen ?? null) || '—'}`}
            </p>
          )}
          {details?.kind !== 'direct' && details?.createdBy && (
            <p className={styles.muted}>Создатель: {details.createdBy}</p>
          )}
        </div>
        {/* <span className={[styles.pill, statusClass].join(' ')} aria-live="polite">
          <span className={styles.statusPill}>
            {status === 'connecting' && <span className={styles.spinner} aria-hidden="true" />}
            {statusLabel}
          </span>
        </span> */}
      </div>

      {visibleError && <Toast variant="danger">{visibleError}</Toast>}
      {loading ? (
        <Panel muted busy>
          Загружаем историю...
        </Panel>
      ) : (
        <div className={styles.chatBox}>
          {rateLimitActive && (
            <div className={styles.rateLimitBanner} role="status" aria-live="polite">
              Слишком много сообщений. Подождите{' '}
              <span className={styles.rateLimitTimer}>{rateLimitSeconds} сек</span>
            </div>
          )}
          <div className={styles.chatLog} ref={listRef} aria-live="polite" onScroll={handleScroll}>
            {loadingMore && (
              <Panel muted busy>
                Загружаем ранние сообщения...
              </Panel>
            )}
            {!hasMore && (
              <Panel muted>Это начало истории.</Panel>
            )}
            {timeline.map((item) =>
              item.type === 'day' ? (
                <div
                  className={styles.daySeparator}
                  role="separator"
                  aria-label={item.label}
                  key={`day-${item.key}`}
                >
                  <span>{item.label}</span>
                </div>
              ) : (
                <article className={styles.message} key={`${item.message.id}-${item.message.createdAt}`}>
                  <button
                    type="button"
                    className={styles.avatarLink}
                    aria-label={`Открыть профиль пользователя ${item.message.username}`}
                    onClick={() => openUserProfile(item.message.username)}
                  >
                    <Avatar
                      username={item.message.username}
                      profileImage={item.message.profilePic}
                      size="small"
                      online={onlineUsernames.has(item.message.username)}
                    />
                  </button>
                  <div className={styles.messageBody}>
                    <div className={styles.messageMeta}>
                      <strong>{item.message.username}</strong>
                      <span className={styles.muted}>{formatTimestamp(item.message.createdAt)}</span>
                    </div>
                    <p>{item.message.content}</p>
                  </div>
                </article>
              ),
            )}
          </div>
          {!user && isPublicRoom && (
            <div className={styles.authCallout} data-testid="chat-auth-callout">
              <div className={styles.authCalloutText}>
                <p className={styles.muted}>
                  Чтобы писать в публичном чате, войдите или зарегистрируйтесь.
                </p>
              </div>
            </div>
          )}
          {user && (
            <div className={[styles.chatInput, rateLimitActive ? styles.blocked : ''].filter(Boolean).join(' ')}>
              <input
                type="text"
                value={draft}
                aria-label="Сообщение"
                data-testid="chat-message-input"
                placeholder="Сообщение"
                disabled={rateLimitActive}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    sendMessage()
                  }
                }}
              />
              <Button
                variant="primary"
                aria-label="Отправить сообщение"
                data-testid="chat-send-button"
                onClick={sendMessage}
                disabled={!draft.trim() || status !== 'online' || !isOnline || rateLimitActive}
              >
                Отправить
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
