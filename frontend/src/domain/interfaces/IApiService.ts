import type { Message } from "../../entities/message/types";
import type {
  DirectChatListItem,
  RoomDetails,
  RoomKind,
  RoomPeer,
} from "../../entities/room/types";
import type { UserProfile } from "../../entities/user/types";

export type UpdateProfileInput = {
  username: string;
  email: string;
  image?: File | null;
  bio?: string;
};

export type SessionResponse = {
  authenticated: boolean;
  user: UserProfile | null;
};

export type RoomMessagesResponse = {
  messages: Message[];
  pagination?: {
    limit: number;
    hasMore: boolean;
    nextBefore: number | null;
  };
};

export type DirectStartResponse = {
  slug: string;
  kind: RoomKind;
  peer: RoomPeer;
};

export type DirectChatsResponse = {
  items: DirectChatListItem[];
};

export type ClientRuntimeConfig = {
  usernameMaxLength: number;
  chatMessageMaxLength: number;
  chatRoomSlugRegex: string;
  mediaUrlTtlSeconds: number;
  mediaMode: "signed_only";
};

/**
 * Контракт API-слоя, который возвращает только доменные типы.
 */
export interface IApiService {
  ensureCsrf(): Promise<{ csrfToken: string }>;

  ensurePresenceSession(): Promise<{ ok: boolean }>;

  getClientConfig(): Promise<ClientRuntimeConfig>;

  getSession(): Promise<SessionResponse>;

  login(username: string, password: string): Promise<SessionResponse>;

  register(
    username: string,
    password1: string,
    password2: string,
  ): Promise<SessionResponse>;

  getPasswordRules(): Promise<{ rules: string[] }>;

  logout(): Promise<{ ok: boolean }>;

  updateProfile(fields: UpdateProfileInput): Promise<{ user: UserProfile }>;

  getPublicRoom(): Promise<RoomDetails>;

  getRoomDetails(slug: string): Promise<RoomDetails>;

  getRoomMessages(
    slug: string,
    params?: { limit?: number; beforeId?: number },
  ): Promise<RoomMessagesResponse>;

  startDirectChat(username: string): Promise<DirectStartResponse>;

  getDirectChats(): Promise<DirectChatsResponse>;

  getUserProfile(username: string): Promise<{ user: UserProfile }>;
}