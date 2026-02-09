import hashlib
import json
import time
from asgiref.sync import sync_to_async
from django.core.exceptions import ObjectDoesNotExist
from django.utils.text import slugify
from django.conf import settings
from django.core.cache import cache

from channels.generic.websocket import AsyncWebsocketConsumer

from .constants import PUBLIC_ROOM_SLUG
from .models import Message
from .utils import build_profile_url


class ChatConsumer(AsyncWebsocketConsumer):
    """
    A consumer does three things:
    1. Accepts connections.
    2. Receives messages from client.
    3. Disconnects when the job is done.
    """

    async def connect(self):
        """
        Connect to a room
        """
        user = self.scope['user']
        self.room_name = self.scope['url_route']['kwargs']['room_name']

        is_public = self.room_name == PUBLIC_ROOM_SLUG
        if not user.is_authenticated and not is_public:
            await self.send({"close": True})
            return

        # Channels группа должна содержать только ASCII. Сначала пробуем безопасный slug,
        # если он пустой (например, на полностью юникодных названиях) — используем sha1-хэш.
        normalized = slugify(self.room_name)
        if not normalized:
            normalized = hashlib.sha1(self.room_name.encode("utf-8")).hexdigest()
        normalized = normalized[:80]  # ограничим длину чтобы пройти валидацию Channels
        self.room_group_name = f"chat_{normalized}"

        # Join room group
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        await self.accept()

    async def disconnect(self, close_code):
        """
        Disconnect from channel

        :param close_code: optional
        """
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    async def receive(self, text_data):
        """
        Receive messages from WebSocket

        :param text_data: message
        """

        try:
            text_data_json = json.loads(text_data)
        except json.JSONDecodeError:
            return

        message = text_data_json.get("message", "")
        if not isinstance(message, str):
            return
        message = message.strip()
        if not message:
            return

        max_len = int(getattr(settings, "CHAT_MESSAGE_MAX_LENGTH", 1000))
        if len(message) > max_len:
            await self.send(text_data=json.dumps({"error": "message_too_long"}))
            return

        user = self.scope['user']
        if not user.is_authenticated:
            # Запрещаем постинг для неавторизованных, но соединение остаётся для чтения.
            return

        if await self._rate_limited(user):
            await self.send(text_data=json.dumps({"error": "rate_limited"}))
            return

        username = user.username
        room = self.room_name

        profile_name = await self._get_profile_image_name(user)
        profile_url = build_profile_url(self.scope, profile_name)

        # Save message to DB
        await self.save_message(message, username, profile_name, room)

        # Send message to room group
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_message',
                'message': message,
                'username': username,
                'profile_pic': profile_url,
                'room': room,
            }
        )

    async def chat_message(self, event):
        """
        Receive messages from room group

        :param event: Events to pick up
        """
        message = event['message']
        username = event['username']
        profile_pic = event['profile_pic']
        room = event['room']

        # Send message to WebSocket
        await self.send(text_data=json.dumps({
            'message': message,
            'username': username,
            'profile_pic': profile_pic,
            'room': room,
        }))

    @sync_to_async
    def save_message(self, message, username, profile_pic, room):
        Message.objects.create(
            message_content=message,
            username=username,
            profile_pic=profile_pic,
            room=room,
        )

    @sync_to_async
    def _get_profile_image_name(self, user) -> str:
        try:
            profile = user.profile
            name = getattr(profile.image, "name", "")
            return name or ""
        except (AttributeError, ObjectDoesNotExist):
            return ""

    @sync_to_async
    def _rate_limited(self, user) -> bool:
        limit = int(getattr(settings, "CHAT_MESSAGE_RATE_LIMIT", 20))
        window = int(getattr(settings, "CHAT_MESSAGE_RATE_WINDOW", 10))
        key = f"rl:chat:{user.id}"
        now = time.time()
        data = cache.get(key)
        if not data or data.get("reset", 0) <= now:
            cache.set(key, {"count": 1, "reset": now + window}, timeout=window)
            return False
        if data.get("count", 0) >= limit:
            return True
        data["count"] = data.get("count", 0) + 1
        cache.set(key, data, timeout=max(1, int(data["reset"] - now)))
        return False


class PresenceConsumer(AsyncWebsocketConsumer):
    group_name_auth = "presence_auth"
    group_name_guest = "presence_guest"
    cache_key = "presence:online"
    guest_cache_key = "presence:guests"

    async def connect(self):
        user = self.scope.get("user")
        self.is_guest = not user or not user.is_authenticated
        self.group_name = (
            self.group_name_guest if self.is_guest else self.group_name_auth
        )

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        if self.is_guest:
            await self._add_guest()
        else:
            await self._add_user(user)
        await self._broadcast()

    async def disconnect(self, close_code):
        user = self.scope.get("user")
        if self.is_guest:
            await self._remove_guest()
        elif user and user.is_authenticated:
            await self._remove_user(user)

        await self._broadcast()
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def _broadcast(self):
        online = await self._get_online()
        guests = await self._get_guest_count()
        await self.channel_layer.group_send(
            self.group_name_guest,
            {"type": "presence.update", "guests": guests},
        )
        await self.channel_layer.group_send(
            self.group_name_auth,
            {"type": "presence.update", "online": online, "guests": guests},
        )

    async def presence_update(self, event):
        payload = {}
        if "online" in event:
            payload["online"] = event["online"]
        if "guests" in event:
            payload["guests"] = event["guests"]
        if payload:
            await self.send(text_data=json.dumps(payload))

    @sync_to_async
    def _add_user(self, user):
        data = cache.get(self.cache_key, {})
        current = data.get(user.username, {})
        count = current.get("count", 0) + 1
        image_name = getattr(getattr(user, "profile", None), "image", None)
        image_name = image_name.name if image_name else ""
        image_url = build_profile_url(self.scope, image_name) if image_name else None
        data[user.username] = {"count": count, "profileImage": image_url}
        cache.set(self.cache_key, data, timeout=60 * 60)

    @sync_to_async
    def _remove_user(self, user):
        data = cache.get(self.cache_key, {})
        if user.username in data:
            count = data[user.username].get("count", 1) - 1
            if count <= 0:
                data.pop(user.username, None)
            else:
                data[user.username]["count"] = count
            cache.set(self.cache_key, data, timeout=60 * 60)

    @sync_to_async
    def _get_online(self):
        data = cache.get(self.cache_key, {})
        cleaned = {k: v for k, v in data.items() if v.get("count", 0) > 0}
        if cleaned != data:
            cache.set(self.cache_key, cleaned, timeout=60 * 60)
        return [
            {"username": username, "profileImage": info.get("profileImage")}
            for username, info in cleaned.items()
        ]

    @sync_to_async
    def _add_guest(self):
        count = cache.get(self.guest_cache_key, 0) or 0
        try:
            count = int(count)
        except (TypeError, ValueError):
            count = 0
        count += 1
        cache.set(self.guest_cache_key, count, timeout=60 * 60)

    @sync_to_async
    def _remove_guest(self):
        count = cache.get(self.guest_cache_key, 0) or 0
        try:
            count = int(count)
        except (TypeError, ValueError):
            count = 0
        count -= 1
        if count <= 0:
            cache.delete(self.guest_cache_key)
        else:
            cache.set(self.guest_cache_key, count, timeout=60 * 60)

    @sync_to_async
    def _get_guest_count(self) -> int:
        count = cache.get(self.guest_cache_key, 0) or 0
        try:
            return max(0, int(count))
        except (TypeError, ValueError):
            return 0

    # build_profile_url moved to chat.utils to avoid duplication
