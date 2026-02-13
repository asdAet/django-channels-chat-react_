import { apiService } from '../adapters/ApiService'
import type {
  DirectChatsResponseDto,
  DirectStartResponseDto,
  RoomDetailsDto,
  RoomMessagesDto,
  RoomMessagesParams,
} from '../dto/chat'

let publicRoomInFlight: Promise<RoomDetailsDto> | null = null
let directChatsInFlight: Promise<DirectChatsResponseDto> | null = null

const roomDetailsInFlight = new Map<string, Promise<RoomDetailsDto>>()
const roomMessagesInFlight = new Map<string, Promise<RoomMessagesDto>>()

const buildRoomMessagesKey = (slug: string, params?: RoomMessagesParams) => {
  const limit = params?.limit ?? ''
  const beforeId = params?.beforeId ?? ''
  return `${slug}|limit=${limit}|before=${beforeId}`
}

class ChatController {
  public async getPublicRoom(): Promise<RoomDetailsDto> {
    if (publicRoomInFlight) {
      return publicRoomInFlight
    }

    publicRoomInFlight = apiService
      .getPublicRoom()
      .finally(() => {
        publicRoomInFlight = null
      })

    return publicRoomInFlight
  }

  public async getRoomDetails(slug: string): Promise<RoomDetailsDto> {
    const inFlight = roomDetailsInFlight.get(slug)
    if (inFlight) {
      return inFlight
    }

    const request = apiService
      .getRoomDetails(slug)
      .finally(() => {
        roomDetailsInFlight.delete(slug)
      })

    roomDetailsInFlight.set(slug, request)
    return request
  }

  public async getRoomMessages(slug: string, params?: RoomMessagesParams): Promise<RoomMessagesDto> {
    const cacheKey = buildRoomMessagesKey(slug, params)
    const inFlight = roomMessagesInFlight.get(cacheKey)
    if (inFlight) {
      return inFlight
    }

    const request = apiService
      .getRoomMessages(slug, params)
      .finally(() => {
        roomMessagesInFlight.delete(cacheKey)
      })

    roomMessagesInFlight.set(cacheKey, request)
    return request
  }

  public async startDirectChat(username: string): Promise<DirectStartResponseDto> {
    const response = await apiService.startDirectChat(username)
    return response
  }

  public async getDirectChats(): Promise<DirectChatsResponseDto> {
    if (directChatsInFlight) {
      return directChatsInFlight
    }

    directChatsInFlight = apiService
      .getDirectChats()
      .finally(() => {
        directChatsInFlight = null
      })

    return directChatsInFlight
  }
}

export const chatController = new ChatController()
