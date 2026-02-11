import type { Message } from '../entities/message/types'
import type { RoomDetails } from '../entities/room/types'

export type RoomDetailsDto = RoomDetails

export type RoomMessagesPaginationDto = {
  limit: number
  hasMore: boolean
  nextBefore: number | null
}

export type RoomMessagesDto = {
  messages: Message[]
  pagination?: RoomMessagesPaginationDto
}

export type RoomMessagesParams = { limit?: number; beforeId?: number }
