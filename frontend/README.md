# Devil frontend

Одностраничный интерфейс на React + TypeScript для Django-чата. Вся работа с сессиями и профилями идёт через JSON API, а WebSocket-подключения остаются совместимыми с Channels.

## Локальный запуск
```bash
npm install
npm run dev
```

Vite проксирует `/api` и `/ws` на `http://localhost:8000`, поэтому бэкенд должен быть запущен на этом адресе. Для продакшена соберите статику:
```bash
npm run build
```

## Структура (микроархитектура)
- `src/shared/api` — низкоуровневый http-клиент и сервисы `auth.ts`, `chat.ts`.
- `src/entities/*` — типы домена (пользователь, комната, сообщение).
- `src/shared/lib` — утилиты форматирования/фоллбеков.
- `src/widgets` — общие виджеты (шапка).
- `src/pages` — экранные компоненты (home/auth/profile/chat-room).
- `src/app` — маршрутизация и композиция приложения.

## API ожидания
- CSRF-cookie выдаётся через `GET /api/auth/csrf/`.
- Сессия: `GET /api/auth/session/`.
- Вход/регистрация: `POST /api/auth/login/`, `POST /api/auth/register/`.
- Профиль: `GET/POST /api/auth/profile/`.
- Чаты: `GET /api/chat/public-room/`, `GET /api/chat/rooms/<room>/`, `GET /api/chat/rooms/<room>/messages/`.
