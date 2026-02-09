import { useContext } from 'react'

import { PresenceContext } from './context'

export const usePresence = () => useContext(PresenceContext)
