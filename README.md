# TeamAgents

TeamAgents is a Go-based system for coordinating AI agents as teammates.

## Layout

```text
teamagents/
├── server/                  # Go API server and daemon
│   ├── cmd/api              # API entrypoint
│   ├── cmd/daemon           # daemon entrypoint
│   ├── internal/            # handlers, auth, workspace, websocket, skills, autopilots
│   └── migrations/          # PostgreSQL schema
├── apps/web/                # Go web frontend + static SPA assets
│   ├── cmd/web              # frontend server entrypoint
│   └── public/              # HTML, CSS, JS
├── deploy/                  # nginx and systemd units
└── docker-compose.yml
```

## Local Development

1. Copy `.env.example` to `.env` and set at least `DATABASE_URL` and `JWT_SECRET`.
2. Start PostgreSQL:

```bash
make db-up
```

3. Start the API server:

```bash
make run-api
```

4. Start the Go web frontend:

```bash
cp apps/web/.env.local.example apps/web/.env.web
make web-dev
```

5. Start the daemon when needed:

```bash
go run ./server/cmd/daemon
```

## Build Targets

```bash
make build-api
make build-daemon
make build-web
```

## Docker Compose

```bash
docker compose up -d --build
```

This starts:

- PostgreSQL on `localhost:5432`
- API on `http://localhost:8080`
- Web frontend on `http://localhost:3000`

## Routing

- `/` is served by the Go frontend on port `3000`
- `/api/*` is served by the Go API on port `8080`
- `/ws` is served by the Go API websocket handler on port `8080`
