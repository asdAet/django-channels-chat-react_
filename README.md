# EchoChat

Онлайн-чат на `Django + Channels + React (Vite)` с публичной комнатой, приватными комнатами по slug, presence-статусами и профилями пользователей.

## Возможности
- Публичный чат: гости читают, авторизованные пользователи пишут.
- Приватные комнаты по slug с проверкой доступа.
- История сообщений с пагинацией (`limit`, `before`, `hasMore`, `nextBefore`).
- Онлайн-статусы: авторизованные + гости (WebSocket, heartbeat, TTL/grace).
- Профиль пользователя: аватар, поле «О себе», дата регистрации.
- Переход в профиль пользователя по клику на аватар.
- Rate-limit для auth и отправки сообщений.
- Health endpoints: `live` и `ready`.

## Стек
- Backend: `Django`, `Daphne`, `Channels`, `Redis` (prod).
- Frontend: `React`, `TypeScript`, `Vite`, `Axios`.
- Infra: `Nginx`, `PostgreSQL`, `Docker Compose`.

## Локальный запуск
### Backend
```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/macOS
source .venv/bin/activate

pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 127.0.0.1:8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

По умолчанию фронтенд работает на `http://127.0.0.1:5173`, backend API на `http://127.0.0.1:8000`.

## Тестирование

### Backend (coverage >= 90%)
```bash
cd backend
# один раз для dev-зависимостей
pip install -r requirements-dev.txt

coverage run --rcfile=.coveragerc manage.py test
coverage report --rcfile=.coveragerc --fail-under=90
```

### Frontend unit/integration (Vitest, coverage >= 80%)
```bash
cd frontend
npm ci
npm run test:unit
npm run test:coverage
```

### E2E (Playwright)
```bash
cd frontend
# локально один раз
npx playwright install chromium

npm run test:e2e
```

## CI
GitHub Actions workflow: `.github/workflows/test.yml`

Jobs:
- `backend-tests` — Django tests + coverage gate `>= 90%`.
- `frontend-unit` — Vitest coverage gate `>= 80%`.
- `e2e` — Playwright smoke-сценарии.

## API
### REST
- `GET /api/health/live/`
- `GET /api/health/ready/`
- `GET /api/auth/csrf/`
- `GET /api/auth/session/`
- `POST /api/auth/login/`
- `POST /api/auth/logout/`
- `POST /api/auth/register/`
- `GET /api/auth/password-rules/`
- `GET/POST /api/auth/profile/`
- `GET /api/auth/users/<username>/`
- `GET /api/auth/media/<path:file_path>?exp=<unix>&sig=<hex>`
- `GET /api/chat/public-room/`
- `POST /api/chat/direct/start/`
- `GET /api/chat/direct/chats/`
- `GET /api/chat/rooms/<slug>/`
- `GET /api/chat/rooms/<slug>/messages/?limit=&before=`

### WebSocket
- `ws://<host>/ws/chat/<room_slug>/`
- `ws://<host>/ws/presence/`
- `ws://<host>/ws/direct/inbox/`

## Docker (production)
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Перед запуском подготовьте `.env` на основе `example.env`.

Критичные security-переменные для production:
- `DJANGO_DEBUG=0`
- `DJANGO_RELAX_PASSWORDS=0`
- `DJANGO_MEDIA_URL_TTL_SECONDS=300`
- `DJANGO_MEDIA_SIGNING_KEY` (если пусто, используется `DJANGO_SECRET_KEY`)
- `CHAT_DIRECT_SLUG_SALT` (если пусто, используется `DJANGO_SECRET_KEY`)
- `WS_CONNECT_RATE_LIMIT=60`
- `WS_CONNECT_RATE_WINDOW=60`

