import type { Message } from '../../entities/message/types'
import type { RoomDetails } from '../../entities/room/types'
import type { UserProfile } from '../../entities/user/types'
import type { SessionResponse } from '../../shared/api/types'

export type UpdateProfileInput = {
  username: string
  email: string
  image?: File | null
  bio?: string
}

export type RoomMessagesResponse = {
  messages: Message[]
  pagination?: {
    limit: number
    hasMore: boolean
    nextBefore: number | null
  }
}

export interface IApiService {
  ensureCsrf(): Promise<{ csrfToken: string }>
  getSession(): Promise<SessionResponse>
  login(username: string, password: string): Promise<SessionResponse>
  register(username: string, password1: string, password2: string): Promise<SessionResponse>
  getPasswordRules(): Promise<{ rules: string[] }>
  logout(): Promise<{ ok: boolean }>
  updateProfile(fields: UpdateProfileInput): Promise<{ user: UserProfile }>
  getPublicRoom(): Promise<RoomDetails>
  getRoomDetails(slug: string): Promise<RoomDetails>
  getRoomMessages(
    slug: string,
    params?: { limit?: number; beforeId?: number },
  ): Promise<RoomMessagesResponse>
  getUserProfile(username: string): Promise<{ user: UserProfile }>
}
