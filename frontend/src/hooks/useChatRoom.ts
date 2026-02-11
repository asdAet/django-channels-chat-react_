import { useCallback, useEffect, useRef, useState } from 'react'

import { chatController } from '../controllers/ChatController'
import type { RoomDetailsDto, RoomMessagesDto } from '../dto/chat'
import type { Message } from '../entities/message/types'
import type { UserProfileDto } from '../dto/auth'
import { debugLog } from '../shared/lib/debug'
import { sanitizeText } from '../shared/lib/sanitize'

const PAGE_SIZE = 50
const MAX_MESSAGE_LENGTH = 1000

const sanitizeMessage = (message: Message): Message => ({
  ...message,
  content: sanitizeText(message.content, MAX_MESSAGE_LENGTH),
})

const messageKey = (message: Message) => `${message.id}-${message.createdAt}`

const dedupeMessages = (messages: Message[]) => {
  const seen = new Set<string>()
  const unique: Message[] = []
  for (const message of messages) {
    const key = messageKey(message)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(message)
  }
  return unique
}

const resolveHasMore = (payload: RoomMessagesDto, fetched: Message[]) => {
  if (typeof payload.pagination?.hasMore === 'boolean') {
    return payload.pagination.hasMore
  }
  return fetched.length >= PAGE_SIZE
}

const resolveNextBefore = (payload: RoomMessagesDto, fetched: Message[]) => {
  const nextBefore = payload.pagination?.nextBefore
  if (typeof nextBefore === 'number') return nextBefore
  if (nextBefore === null) return null
  return fetched.length > 0 ? fetched[0].id : null
}

export type ChatRoomState = {
  details: RoomDetailsDto | null
  messages: Message[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  nextBefore: number | null
  error: string | null
}

export const useChatRoom = (slug: string, user: UserProfileDto | null) => {
  const isPublicRoom = slug === 'public'
  const canView = Boolean(user) || isPublicRoom
  const [state, setState] = useState<ChatRoomState>({
    details: null,
    messages: [],
    loading: true,
    loadingMore: false,
    hasMore: true,
    nextBefore: null,
    error: null,
  })
  const requestIdRef = useRef(0)

  const loadInitial = useCallback(() => {
    if (!canView) return
    const requestId = ++requestIdRef.current
    setState((prev) => ({ ...prev, loading: true, error: null }))

    Promise.all([
      chatController.getRoomDetails(slug),
      chatController.getRoomMessages(slug, { limit: PAGE_SIZE }),
    ])
      .then(([info, payload]) => {
        if (requestId !== requestIdRef.current) return
        const sanitized = payload.messages.map(sanitizeMessage)
        const unique = dedupeMessages(sanitized)
        setState({
          details: info,
          messages: unique,
          loading: false,
          loadingMore: false,
          hasMore: resolveHasMore(payload, unique),
          nextBefore: resolveNextBefore(payload, unique),
          error: null,
        })
      })
      .catch((err) => {
        if (requestId !== requestIdRef.current) return
        debugLog('Room load failed', err)
        setState((prev) => ({ ...prev, loading: false, error: 'load_failed' }))
      })
  }, [slug, canView])

  useEffect(() => {
    queueMicrotask(() => loadInitial())
  }, [loadInitial])

  const loadMore = useCallback(async () => {
    if (!canView) return
    if (state.loadingMore || !state.hasMore) return

    const cursor = state.nextBefore
    if (!cursor) {
      setState((prev) => ({ ...prev, hasMore: false, nextBefore: null }))
      return
    }

    const requestId = ++requestIdRef.current
    setState((prev) => ({ ...prev, loadingMore: true }))
    try {
      const payload = await chatController.getRoomMessages(slug, {
        limit: PAGE_SIZE,
        beforeId: cursor,
      })
      if (requestId !== requestIdRef.current) return
      const sanitized = payload.messages.map(sanitizeMessage)
      setState((prev) => ({
        ...prev,
        messages: dedupeMessages([...sanitized, ...prev.messages]),
        loadingMore: false,
        hasMore: resolveHasMore(payload, sanitized),
        nextBefore: resolveNextBefore(payload, sanitized),
      }))
    } catch (err) {
      if (requestId !== requestIdRef.current) return
      debugLog('Room load more failed', err)
      setState((prev) => ({ ...prev, loadingMore: false }))
    }
  }, [slug, canView, state.hasMore, state.loadingMore, state.nextBefore])

  const setMessages = useCallback((updater: Message[] | ((prev: Message[]) => Message[])) => {
    setState((prev) => {
      const nextMessages = typeof updater === 'function' ? updater(prev.messages) : updater
      const sanitized = nextMessages.map(sanitizeMessage)
      return { ...prev, messages: dedupeMessages(sanitized) }
    })
  }, [])

  const setError = useCallback((error: string | null) => {
    setState((prev) => ({ ...prev, error }))
  }, [])

  return {
    details: state.details,
    messages: state.messages,
    loading: state.loading,
    loadingMore: state.loadingMore,
    hasMore: state.hasMore,
    error: state.error,
    loadMore,
    setMessages,
    setError,
  }
}
