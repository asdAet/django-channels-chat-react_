import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  DirectChatsResponseDto,
  DirectStartResponseDto,
  RoomDetailsDto,
  RoomMessagesDto,
} from '../dto/chat'

const apiMocks = vi.hoisted(() => ({
  getPublicRoom: vi.fn<() => Promise<RoomDetailsDto>>(),
  getRoomDetails: vi.fn<(slug: string) => Promise<RoomDetailsDto>>(),
  getRoomMessages: vi.fn<
    (slug: string, params?: { limit?: number; beforeId?: number }) => Promise<RoomMessagesDto>
  >(),
  startDirectChat: vi.fn<(username: string) => Promise<DirectStartResponseDto>>(),
  getDirectChats: vi.fn<() => Promise<DirectChatsResponseDto>>(),
}))

vi.mock('../adapters/ApiService', () => ({
  apiService: apiMocks,
}))

const loadController = async () => {
  vi.resetModules()
  const mod = await import('./ChatController')
  return mod.chatController
}

describe('ChatController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    apiMocks.getPublicRoom.mockReset()
    apiMocks.getRoomDetails.mockReset()
    apiMocks.getRoomMessages.mockReset()
    apiMocks.startDirectChat.mockReset()
    apiMocks.getDirectChats.mockReset()
  })

  it('does not cache public room between calls', async () => {
    const room: RoomDetailsDto = { slug: 'public', name: 'Public', kind: 'public', created: false, createdBy: null }
    apiMocks.getPublicRoom.mockResolvedValue(room)

    const chatController = await loadController()

    await chatController.getPublicRoom()
    await chatController.getPublicRoom()

    expect(apiMocks.getPublicRoom).toHaveBeenCalledTimes(2)
  })

  it('deduplicates in-flight public room request', async () => {
    let settle: (value: RoomDetailsDto) => void = () => undefined
    const pending = new Promise<RoomDetailsDto>((res) => {
      settle = res
    })
    apiMocks.getPublicRoom.mockReturnValue(pending)

    const chatController = await loadController()

    const firstPromise = chatController.getPublicRoom()
    const secondPromise = chatController.getPublicRoom()

    expect(apiMocks.getPublicRoom).toHaveBeenCalledTimes(1)

    settle({ slug: 'public', name: 'Public', kind: 'public', created: false, createdBy: null })
    const [first, second] = await Promise.all([firstPromise, secondPromise])

    expect(first.slug).toBe('public')
    expect(second.slug).toBe('public')
  })

  it('deduplicates in-flight room details by slug', async () => {
    let settle: (value: RoomDetailsDto) => void = () => undefined
    const pending = new Promise<RoomDetailsDto>((res) => {
      settle = res
    })
    apiMocks.getRoomDetails.mockReturnValue(pending)

    const chatController = await loadController()

    const firstPromise = chatController.getRoomDetails('abc')
    const secondPromise = chatController.getRoomDetails('abc')

    expect(apiMocks.getRoomDetails).toHaveBeenCalledTimes(1)

    settle({
      slug: 'abc',
      name: 'Room',
      kind: 'private',
      created: false,
      createdBy: null,
    })

    const [first, second] = await Promise.all([firstPromise, secondPromise])
    expect(first.slug).toBe('abc')
    expect(second.slug).toBe('abc')
  })

  it('does not cache room details after request completes', async () => {
    apiMocks.getRoomDetails.mockResolvedValue({
      slug: 'abc',
      name: 'Room',
      kind: 'private',
      created: false,
      createdBy: null,
    })

    const chatController = await loadController()

    await chatController.getRoomDetails('abc')
    await chatController.getRoomDetails('abc')

    expect(apiMocks.getRoomDetails).toHaveBeenCalledTimes(2)
    expect(apiMocks.getRoomDetails).toHaveBeenNthCalledWith(1, 'abc')
    expect(apiMocks.getRoomDetails).toHaveBeenNthCalledWith(2, 'abc')
  })

  it('deduplicates in-flight room messages by params', async () => {
    let settle: (value: RoomMessagesDto) => void = () => undefined
    const pending = new Promise<RoomMessagesDto>((res) => {
      settle = res
    })
    apiMocks.getRoomMessages.mockReturnValue(pending)

    const chatController = await loadController()

    const firstPromise = chatController.getRoomMessages('public', { limit: 50 })
    const secondPromise = chatController.getRoomMessages('public', { limit: 50 })

    expect(apiMocks.getRoomMessages).toHaveBeenCalledTimes(1)

    settle({
      messages: [],
      pagination: { limit: 50, hasMore: false, nextBefore: null },
    })

    await Promise.all([firstPromise, secondPromise])
  })

  it('does not cache room messages after request completes', async () => {
    apiMocks.getRoomMessages.mockResolvedValue({
      messages: [],
      pagination: { limit: 50, hasMore: false, nextBefore: null },
    })

    const chatController = await loadController()

    await chatController.getRoomMessages('public', { limit: 50 })
    await chatController.getRoomMessages('public', { limit: 50 })

    expect(apiMocks.getRoomMessages).toHaveBeenCalledTimes(2)
  })

  it('deduplicates in-flight direct chats request', async () => {
    let settle: (value: DirectChatsResponseDto) => void = () => undefined
    const pending = new Promise<DirectChatsResponseDto>((res) => {
      settle = res
    })
    apiMocks.getDirectChats.mockReturnValue(pending)

    const chatController = await loadController()

    const firstPromise = chatController.getDirectChats()
    const secondPromise = chatController.getDirectChats()

    expect(apiMocks.getDirectChats).toHaveBeenCalledTimes(1)

    settle({
      items: [
        {
          slug: 'dm_123',
          peer: { username: 'alice', profileImage: null },
          lastMessage: 'hello',
          lastMessageAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    await Promise.all([firstPromise, secondPromise])
  })

  it('does not cache direct chats after request completes', async () => {
    apiMocks.getDirectChats.mockResolvedValue({
      items: [
        {
          slug: 'dm_123',
          peer: { username: 'alice', profileImage: null },
          lastMessage: 'hello',
          lastMessageAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    const chatController = await loadController()

    await chatController.getDirectChats()
    await chatController.getDirectChats()
    expect(apiMocks.getDirectChats).toHaveBeenCalledTimes(2)
  })
})
