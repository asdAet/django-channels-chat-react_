import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import type { UserProfile } from '../../entities/user/types'
import type { OnlineUser } from '../api/users'
import { debugLog } from '../lib/debug'
import { getWebSocketBase } from '../lib/ws'
import { useReconnectingWebSocket } from '../../hooks/useReconnectingWebSocket'
import { PresenceContext } from './context'

type ProviderProps = {
  user: UserProfile | null
  ready?: boolean
  children: ReactNode
}

export function PresenceProvider({ user, children, ready = true }: ProviderProps) {
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [guestCount, setGuestCount] = useState(0)
  const presenceUrl = useMemo(() => {
    if (!ready) return null
    const base = `${getWebSocketBase()}/ws/presence/`
    return `${base}?auth=${user ? '1' : '0'}`
  }, [user, ready])

  const handlePresence = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data)
      if (Array.isArray(data?.online)) {
        const incoming = data.online
        if (user) {
          const nextImage = user.profileImage || null
          setOnlineUsers(
            incoming.map((entry) =>
              entry.username === user.username
                ? { ...entry, profileImage: nextImage }
                : entry,
            ),
          )
        } else {
          setOnlineUsers(incoming)
        }
      }
      const rawGuests = data?.guests
      const parsedGuests =
        typeof rawGuests === 'number' ? rawGuests : Number.isFinite(Number(rawGuests)) ? Number(rawGuests) : null
      if (parsedGuests !== null) {
        setGuestCount(parsedGuests)
      }
    } catch (err) {
      debugLog('Presence WS parse failed', err)
    }
  }, [user])


  useEffect(() => {
    if (!ready) {
      setOnlineUsers([])
      setGuestCount(0)
    }
  }, [ready])
  useEffect(() => {
    if (!user) return
    setOnlineUsers((prev) => {
      let changed = false
      const updated = prev.map((entry) => {
        if (entry.username !== user.username) return entry
        const nextImage = user.profileImage || null
        if (entry.profileImage === nextImage) return entry
        changed = true
        return { ...entry, profileImage: nextImage }
      })
      return changed ? updated : prev
    })
  }, [user])

  const { status, lastError, send } = useReconnectingWebSocket({
    url: presenceUrl,
    onMessage: handlePresence,
    onError: (err) => debugLog('Presence WS error', err),
  })

  useEffect(() => {
    if (status !== 'online') return
    const sendPing = () => {
      send(JSON.stringify({ type: 'ping', ts: Date.now() }))
    }
    sendPing()
    const id = window.setInterval(sendPing, 20000)
    return () => window.clearInterval(id)
  }, [send, status])

  const value = useMemo(
    () => ({
      online: user ? onlineUsers : [],
      guests: guestCount,
      status,
      lastError,
    }),
    [onlineUsers, guestCount, status, lastError, user],
  )

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>
}
