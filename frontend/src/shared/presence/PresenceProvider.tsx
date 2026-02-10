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
  children: ReactNode
}

export function PresenceProvider({ user, children }: ProviderProps) {
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [guestCount, setGuestCount] = useState(0)
  const presenceUrl = useMemo(() => {
    const base = `${getWebSocketBase()}/ws/presence/`
    return `${base}?auth=${user ? '1' : '0'}`
  }, [user])

  const handlePresence = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data)
      if (Array.isArray(data?.online)) {
        setOnlineUsers(data.online)
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
  }, [])

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
