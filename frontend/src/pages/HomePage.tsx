import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { decodeChatWsEvent } from '../dto'
import type { Message } from '../entities/message/types'
import type { UserProfile } from '../entities/user/types'
import type { ApiError } from '../shared/api/types'
import { useChatActions } from '../hooks/useChatActions'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { usePublicRoom } from '../hooks/usePublicRoom'
import { useReconnectingWebSocket } from '../hooks/useReconnectingWebSocket'
import { usePresence } from '../shared/presence'
import { debugLog } from '../shared/lib/debug'
import { sanitizeText } from '../shared/lib/sanitize'
import { getWebSocketBase } from '../shared/lib/ws'
import { Avatar, Button, Card, Toast } from '../shared/ui'
import styles from '../styles/pages/HomePage.module.css'

type Props = {
  user: UserProfile | null
  onNavigate: (path: string) => void
}

const buildTempId = (seed: number) => Date.now() * 1000 + seed

/**
 * Главная страница приложения с публичным эфиром и списком онлайн.
 * @param props Текущий пользователь и навигация.
 * @returns JSX главной страницы.
 */
export function HomePage({ user, onNavigate }: Props) {
  const { publicRoom, loading } = usePublicRoom(user)
  const { getRoomDetails, getRoomMessages } = useChatActions()
  const isOnline = useOnlineStatus()
  const [liveMessages, setLiveMessages] = useState<Message[]>([])
  const [creatingRoom, setCreatingRoom] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const tempIdRef = useRef(0)
  const { online, guests, status } = usePresence()

  const presenceLoading = Boolean(user && status !== 'online')
  const onlineUsernames = useMemo(
    () =>
      new Set(
        status === 'online' ? online.map((entry) => entry.username) : [],
      ),
    [online, status],
  )

  const visiblePublicRoom = useMemo(() => publicRoom, [publicRoom])
  const isLoading = useMemo(() => loading, [loading])
  const publicRoomLabel = visiblePublicRoom?.name || 'Комната для всех'

  const openUserProfile = useCallback(
    (username: string) => {
      if (!username) return
      onNavigate(`/users/${encodeURIComponent(username)}`)
    },
    [onNavigate],
  )

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
    return `${getWebSocketBase()}/ws/chat/${encodeURIComponent(visiblePublicRoom.slug)}/`
  }, [visiblePublicRoom])

  const handleLiveMessage = useCallback((event: MessageEvent) => {
    const decoded = decodeChatWsEvent(event.data)
    if (decoded.type !== 'chat_message') {
      return
    }

    try {
      tempIdRef.current += 1
      const next: Message = {
        id: buildTempId(tempIdRef.current),
        username: decoded.message.username,
        content: sanitizeText(decoded.message.content, 200),
        profilePic: decoded.message.profilePic || null,
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
    for (let index = 0; index < length; index += 1) {
      fallback += alphabet[Math.floor(Math.random() * alphabet.length)]
    }
    return fallback
  }


  return (
    <div className={styles.stack}>
      {!isOnline && (
        <Toast variant="warning" role="status">
          Нет подключения к интернету. Мы восстановим соединение автоматически.
        </Toast>
      )}

      <section className={styles.border}>
        <div className={styles.hero}>
          <div className={styles.heroContent}>
            <div>
              <p className={styles.eyebrow}>Django Channels + React</p>
              <h1 className={styles.heroTitle}>Чат в реальном времени.</h1>
              <p className={styles.lead}>
                Быстрые комнаты, живые обсуждения и приватные чаты без лишних шагов.
              </p>
            </div>
            <ul className={styles.ticks}>
              <li>Создавайте приватные комнаты за секунды</li>
              <li>История сообщений сохраняется</li>
              <li>Онлайн-статус участников в реальном времени</li>
            </ul>
          </div>
        </div>
        <div className={styles.heroRight}>
          {/* Убрали лишние <div> без классов */}
          <p className={styles.eyebrow}>Django Channels + React</p>
          <h1 className={styles.heroTitle}>Чат в реальном времени.</h1>
          <p className={styles.lead}>
            Быстрые комнаты, живые обсуждения и приватные чаты без лишних шагов.
          </p>
          <ul className={styles.ticks}>
            <li>Создавайте приватные комнаты за секунды</li>
            <li>История сообщений сохраняется</li>
            <li>Онлайн-статус участников в реальном времени</li>
          </ul>
        </div>
      </section>


      <footer className={styles.footer}>
        <div className={styles.footerContent}>
          <div className={styles.footerColumn}>
            <h3 className={styles.footerTitle}>О проекте</h3>
            <ul className={styles.footerList}>
              <li><a href="#about">О нас</a></li>
              <li><a href="#features">Возможности</a></li>
              <li><a href="#pricing">Тарифы</a></li>
              <li><a href="#faq">FAQ</a></li>
            </ul>
          </div>

          <div className={styles.footerColumn}>
            <h3 className={styles.footerTitle}>Разработчикам</h3>
            <ul className={styles.footerList}>
              <li><a href="#api">API Документация</a></li>
              <li><a href="#github">GitHub</a></li>
              <li><a href="#sdk">SDK</a></li>
              <li><a href="#status">Статус системы</a></li>
            </ul>
          </div>

          <div className={styles.footerColumn}>
            <h3 className={styles.footerTitle}>Поддержка</h3>
            <ul className={styles.footerList}>
              <li><a href="#help">Центр помощи</a></li>
              <li><a href="#contact">Связаться с нами</a></li>
              <li><a href="#privacy">Политика конфиденциальности</a></li>
              <li><a href="#terms">Условия использования</a></li>
            </ul>
          </div>

          <div className={styles.footerColumn}>
            <h3 className={styles.footerTitle}>Контакты</h3>
            <ul className={styles.footerList}>
              <li>support@django-chat.ru</li>
              <li>+7 (999) 123-45-67</li>
              <li>Telegram: @django_chat</li>
              <li>Discord: django-chat</li>
            </ul>
          </div>
        </div>

        <div className={styles.footerBottom}>
          <p>© 2026 Django Chat. Все права защищены.</p>
          <p className={styles.footerTech}>Django Channels + React</p>
        </div>
      </footer>
    </div>


  )

}



