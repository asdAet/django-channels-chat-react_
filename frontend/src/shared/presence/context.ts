import { createContext } from 'react'

import type { OnlineUser } from '../api/users'
import type { WebSocketStatus } from '../../hooks/useReconnectingWebSocket'

export type PresenceContextValue = {
  online: OnlineUser[]
  status: WebSocketStatus
  lastError: string | null
}

export const FALLBACK_PRESENCE: PresenceContextValue = {
  online: [],
  status: 'idle',
  lastError: null,
}

export const PresenceContext = createContext<PresenceContextValue>(FALLBACK_PRESENCE)
