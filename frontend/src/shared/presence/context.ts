import { createContext } from 'react'

import type { OnlineUser } from '../api/users'
import type { WebSocketStatus } from '../../hooks/useReconnectingWebSocket'

export type PresenceContextValue = {
  online: OnlineUser[]
  guests: number
  status: WebSocketStatus
  lastError: string | null
}

export const FALLBACK_PRESENCE: PresenceContextValue = {
  online: [],
  guests: 0,
  status: 'idle',
  lastError: null,
}

export const PresenceContext = createContext<PresenceContextValue>(FALLBACK_PRESENCE)
