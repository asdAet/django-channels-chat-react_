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

    <div className={styles.stack}>

      {!isOnline && (

        <Toast variant="warning" role="status">

          Нет подключения к интернету. Мы восстановим соединение автоматически.

        </Toast>

      )}



      <section className={styles.hero}>

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

          <div className={[styles.actions, styles.heroActions].join(' ')}>

            <Button variant="outline" onClick={() => onNavigate('/rooms/public')}>

              Открыть публичный чат

            </Button>

            {!user && (

              <Button variant="ghost" onClick={() => onNavigate('/register')}>

                Создать аккаунт

              </Button>

            )}

          </div>

        </div>



        <div className={styles.heroCard}>

          <div className={styles.heroCardHeader}>

            <div>

              <p className={styles.muted}>Публичная комната • {publicRoomLabel}</p>

            </div>

            <span className={[styles.pill, visiblePublicRoom ? styles.success : styles.mutedPill].join(' ')}>

              {visiblePublicRoom ? 'в эфире' : 'загрузка...'}

            </span>

          </div>

          {visiblePublicRoom ? (

            <div className={styles.liveFeed} aria-live="polite">

              {liveMessages.map((msg) => (

                <div className={styles.liveItem} key={`${msg.id}-${msg.createdAt}`}>

                  <span className={styles.liveUser}>{msg.username}</span>

                  <span className={styles.liveText}>{msg.content}</span>

                </div>

              ))}

              {!liveMessages.length && (

                <p className={styles.muted}>Сообщений пока нет — будьте первым!</p>

              )}

            </div>

          ) : (

            <p className={styles.muted}>Загружаем публичный эфир...</p>

          )}

        </div>

      </section>

      <section className={styles.grid}>
        <div className={styles.gridHead}>
          <h2>Выберите сценарий</h2>
          <p className={styles.muted}>
            Публичная комната для всех или своя приватная — подключайтесь в один клик.
          </p>
        </div>
        <Card className={styles.sectionCard}>
          <div className={styles.cardHeader}>
            <div>
              <p className={styles.eyebrow}>Публичная комната</p>
              <h3>{publicRoomLabel}</h3>
            </div>
            <span className={styles.pill}>{isLoading ? 'загрузка...' : 'онлайн'}</span>
          </div>
          <p className={styles.muted}>
            Доступна только авторизованным пользователям. Сообщения сохраняются в базе.
          </p>
          <Button
            variant="outline"
            disabled={!user || !visiblePublicRoom}
            onClick={() => onNavigate(`/rooms/${encodeURIComponent(visiblePublicRoom?.slug || 'public')}`)}
          >
            Войти в комнату

          </Button>

          {!user && <p className={styles.note}>Нужно войти, чтобы подключиться к чату.</p>}

        </Card>



        <Card className={styles.sectionCard}>

          <div className={styles.cardHeader}>

            <div>

              <p className={styles.eyebrow}>Своя комната</p>

              <h3>Создайте новую комнату</h3>

            </div>

          </div>

          <p className={styles.muted}>

            Нажмите кнопку, чтобы создать новую приватную комнату с уникальным именем.

            Мы проверим, что такой комнаты еще нет, и только после этого подключим вас.

          </p>

          <div className={styles.form}>

            <Button

              variant="outline"

              aria-label="Создать комнату"

              disabled={!user || creatingRoom || !isOnline}

              onClick={onCreateRoom}

            >

              {creatingRoom ? 'Создаем комнату...' : 'Создать комнату'}

            </Button>

            {createError && <p className={styles.note}>{createError}</p>}

            {!user && <p className={styles.note}>Сначала войдите в аккаунт.</p>}

            {!isOnline && <p className={styles.note}>Нет сети — создание комнаты недоступно.</p>}

          </div>

        </Card>



        <Card className={styles.sectionCard}>

          <div className={styles.cardHeader}>

            <div>

              <p className={styles.eyebrow}>Гостей онлайн</p>

            </div>

            <span className={styles.pill}>{guests}</span>

          </div>



          <div className={styles.cardHeader}>

            <div>

              <p className={styles.eyebrow}>Кто онлайн</p>

            </div>

            <span className={styles.pill}>

              {user ? (presenceLoading ? '...' : online.length) : '—'}

            </span>

          </div>



          {!user ? (

            <p className={styles.muted}>Войдите, чтобы видеть участников онлайн.</p>

          ) : presenceLoading ? (

            <p className={styles.muted}>Загружаем список онлайн...</p>

          ) : online.length ? (

            <div className={styles.onlineList}>

              {online.map((entry) => (

                <div className={styles.onlineItem} key={entry.username}>

                  <button

                    type="button"

                    className={styles.avatarLink}

                    aria-label={`Открыть профиль пользователя ${entry.username}`}

                    onClick={() => openUserProfile(entry.username)}

                  >

                    <Avatar

                      username={entry.username}

                      profileImage={entry.profileImage}

                      size="tiny"

                      online={onlineUsernames.has(entry.username)}

                    />

                  </button>

                  <span>{entry.username}</span>

                </div>

              ))}

            </div>

          ) : (

            <p className={styles.muted}>Пока никого нет в сети.</p>

          )}

        </Card>

      </section>

    </div>

  )

}



