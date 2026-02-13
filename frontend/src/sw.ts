/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { ExpirationPlugin } from 'workbox-expiration'
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst, NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies'
import { CACHE_LIMITS, CACHE_NAMES, CACHE_TTLS } from './shared/cache/cacheConfig'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)

const isSameOrigin = (url: URL) => url.origin === self.location.origin

registerRoute(
  ({ request, url }) =>
    isSameOrigin(url) &&
    request.method === 'GET' &&
    (url.pathname.startsWith('/assets/') ||
      url.pathname.startsWith('/static/') ||
      ['script', 'style', 'font'].includes(request.destination)),
  new CacheFirst({
    cacheName: CACHE_NAMES.assets,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: CACHE_LIMITS.assets,
        maxAgeSeconds: CACHE_TTLS.assets,
        purgeOnQuotaError: true,
      }),
    ],
  }),
)

registerRoute(
  ({ request, url }) =>
    isSameOrigin(url) &&
    request.method === 'GET' &&
    (url.pathname.startsWith('/media/') || request.destination === 'image'),
  new CacheFirst({
    cacheName: CACHE_NAMES.media,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: CACHE_LIMITS.media,
        maxAgeSeconds: CACHE_TTLS.media,
        purgeOnQuotaError: true,
      }),
    ],
  }),
)

const matchRoomMessages = (url: URL) =>
  url.pathname.startsWith('/api/chat/rooms/') && url.pathname.endsWith('/messages/')

const matchRoomDetails = (url: URL) =>
  url.pathname.startsWith('/api/chat/rooms/') && !url.pathname.endsWith('/messages/')

const matchPublicRoom = (url: URL) => url.pathname === '/api/chat/public-room/'

const matchDirectChats = (url: URL) => url.pathname === '/api/chat/direct/chats/'

const matchUserProfile = (url: URL) => url.pathname.startsWith('/api/auth/users/')

const matchSelfProfile = (url: URL) => url.pathname === '/api/auth/profile/'

const matchAuthNoCache = (url: URL) =>
  url.pathname === '/api/auth/login/' ||
  url.pathname === '/api/auth/register/' ||
  url.pathname === '/api/auth/logout/' ||
  url.pathname === '/api/auth/csrf/'

registerRoute(
  ({ url, request }) => isSameOrigin(url) && request.method === 'GET' && matchAuthNoCache(url),
  new NetworkOnly(),
)

registerRoute(
  ({ url, request }) => isSameOrigin(url) && request.method === 'GET' && matchRoomMessages(url),
  new NetworkFirst({
    cacheName: CACHE_NAMES.apiMessages,
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: CACHE_LIMITS.messages,
        maxAgeSeconds: CACHE_TTLS.messages,
        purgeOnQuotaError: true,
      }),
    ],
  }),
)

registerRoute(
  ({ url, request }) =>
    isSameOrigin(url) && request.method === 'GET' && (matchRoomDetails(url) || matchPublicRoom(url)),
  new StaleWhileRevalidate({
    cacheName: CACHE_NAMES.apiRooms,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: CACHE_LIMITS.rooms,
        maxAgeSeconds: CACHE_TTLS.rooms,
        purgeOnQuotaError: true,
      }),
    ],
  }),
)

registerRoute(
  ({ url, request }) => isSameOrigin(url) && request.method === 'GET' && matchDirectChats(url),
  new StaleWhileRevalidate({
    cacheName: CACHE_NAMES.apiDirect,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: CACHE_LIMITS.direct,
        maxAgeSeconds: CACHE_TTLS.direct,
        purgeOnQuotaError: true,
      }),
    ],
  }),
)

registerRoute(
  ({ url, request }) => isSameOrigin(url) && request.method === 'GET' && (matchUserProfile(url) || matchSelfProfile(url)),
  new StaleWhileRevalidate({
    cacheName: CACHE_NAMES.apiProfiles,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: CACHE_LIMITS.profiles,
        maxAgeSeconds: CACHE_TTLS.profiles,
        purgeOnQuotaError: true,
      }),
    ],
  }),
)

const deleteMatching = async (cacheName: string, predicate: (url: URL) => boolean) => {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  await Promise.all(
    keys.map((request) => {
      const url = new URL(request.url)
      if (!predicate(url)) return Promise.resolve(false)
      return cache.delete(request)
    }),
  )
}

const clearUserCaches = async () => {
  await Promise.all([
    caches.delete(CACHE_NAMES.apiMessages),
    caches.delete(CACHE_NAMES.apiRooms),
    caches.delete(CACHE_NAMES.apiDirect),
    caches.delete(CACHE_NAMES.apiProfiles),
  ])
}

self.addEventListener('message', (event) => {
  const payload = event.data as
    | { type: 'invalidate'; key: string; slug?: string; username?: string }
    | { type: 'clearUserCaches' }

  if (!payload || typeof payload !== 'object') return

  if (payload.type === 'clearUserCaches') {
    event.waitUntil(clearUserCaches())
    return
  }

  if (payload.type !== 'invalidate') return

  switch (payload.key) {
    case 'roomMessages': {
      const slug = payload.slug?.trim()
      if (!slug) return
      event.waitUntil(
        deleteMatching(CACHE_NAMES.apiMessages, (url) => url.pathname === `/api/chat/rooms/${slug}/messages/`),
      )
      return
    }
    case 'roomDetails': {
      const slug = payload.slug?.trim()
      if (!slug) return
      event.waitUntil(
        deleteMatching(CACHE_NAMES.apiRooms, (url) => url.pathname === `/api/chat/rooms/${slug}/`),
      )
      return
    }
    case 'directChats': {
      event.waitUntil(
        deleteMatching(CACHE_NAMES.apiDirect, (url) => url.pathname === '/api/chat/direct/chats/'),
      )
      return
    }
    case 'userProfile': {
      const username = payload.username?.trim()
      if (!username) return
      event.waitUntil(
        deleteMatching(CACHE_NAMES.apiProfiles, (url) => url.pathname === `/api/auth/users/${username}/`),
      )
      return
    }
    case 'selfProfile': {
      event.waitUntil(
        deleteMatching(CACHE_NAMES.apiProfiles, (url) => url.pathname === '/api/auth/profile/'),
      )
      return
    }
    default:
      return
  }
})
