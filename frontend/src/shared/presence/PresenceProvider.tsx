import { useCallback, useMemo, useState } from 'react'
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
  const presenceUrl = useMemo(() => (user ? `${getWebSocketBase()}/ws/presence/` : null), [user])

  const handlePresence = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data)
      if (Array.isArray(data?.online)) {
        setOnlineUsers(data.online)
      }
    } catch (err) {
      debugLog('Presence WS parse failed', err)
    }
  }, [])

  const { status, lastError } = useReconnectingWebSocket({
    url: presenceUrl,
    onMessage: handlePresence,
    onError: (err) => debugLog('Presence WS error', err),
  })

  const value = useMemo(
    () => ({
      online: user ? onlineUsers : [],
      status,
      lastError,
    }),
    [onlineUsers, status, lastError, user],
  )

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>
}
