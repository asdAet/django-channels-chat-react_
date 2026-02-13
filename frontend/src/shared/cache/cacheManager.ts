type InvalidateMessage =
  | { type: 'invalidate'; key: 'roomMessages'; slug: string }
  | { type: 'invalidate'; key: 'roomDetails'; slug: string }
  | { type: 'invalidate'; key: 'directChats' }
  | { type: 'invalidate'; key: 'userProfile'; username: string }
  | { type: 'invalidate'; key: 'selfProfile' }

type ClearMessage = { type: 'clearUserCaches' }

const postMessage = (message: InvalidateMessage | ClearMessage) => {
  if (typeof navigator === 'undefined') return
  if (!navigator.serviceWorker) return

  const controller = navigator.serviceWorker.controller
  if (controller) {
    controller.postMessage(message)
    return
  }

  navigator.serviceWorker.ready
    .then((registration) => {
      registration.active?.postMessage(message)
    })
    .catch(() => {})
}

export const invalidateRoomMessages = (slug: string) => {
  if (!slug) return
  postMessage({ type: 'invalidate', key: 'roomMessages', slug })
}

export const invalidateRoomDetails = (slug: string) => {
  if (!slug) return
  postMessage({ type: 'invalidate', key: 'roomDetails', slug })
}

export const invalidateDirectChats = () => {
  postMessage({ type: 'invalidate', key: 'directChats' })
}

export const invalidateUserProfile = (username: string) => {
  if (!username) return
  postMessage({ type: 'invalidate', key: 'userProfile', username })
}

export const invalidateSelfProfile = () => {
  postMessage({ type: 'invalidate', key: 'selfProfile' })
}

export const clearAllUserCaches = () => {
  postMessage({ type: 'clearUserCaches' })
}
