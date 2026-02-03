export const formatTimestamp = (iso: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

export const avatarFallback = (username: string) =>
  username ? username[0].toUpperCase() : '?'
