"""Chat application constants."""

PUBLIC_ROOM_SLUG = "public"
PUBLIC_ROOM_NAME = "Public Chat"

PRESENCE_GROUP_AUTH = "presence_auth"
PRESENCE_GROUP_GUEST = "presence_guest"
PRESENCE_CACHE_KEY_AUTH = "presence:online"
PRESENCE_CACHE_KEY_GUEST = "presence:guests"
PRESENCE_CACHE_TTL_SECONDS = 60 * 60

CHAT_CLOSE_IDLE_CODE = 4001
PRESENCE_CLOSE_IDLE_CODE = 4000
