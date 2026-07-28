# TeamAgents

TeamAgents is a Go-based system for coordinating AI agents as teammates.

## Layout

```text
teamagents/
├── server/                  # Go API server (integrated web frontend) and daemon
│   ├── cmd/api              # Integrated API & Web entrypoint
│   ├── cmd/daemon           # daemon entrypoint
│   ├── internal/            # handlers, auth, workspace, websocket, skills, autopilots
│   └── migrations/          # PostgreSQL schema
├── apps/web/public/         # HTML, CSS, JS static SPA assets
├── deploy/                  # nginx and systemd units
└── docker-compose.yml
```

## Local Development

1. Copy `.env.example` to `.env` and set at least `DATABASE_URL` and `JWT_SECRET`.
2. Start PostgreSQL:

```bash
make db-up
```

3. Start the Server (API & Web):

```bash
make run-api
```

4. Start the daemon when needed:

```bash
cd server && go run ./cmd/daemon
```

## Build Targets

```bash
make build-api
make build-daemon
```

## Docker Compose

```bash
docker compose up -d --build
```

This starts:

- PostgreSQL on `localhost:5432`
- Integrated Server (Web + API + WS) on `http://localhost:8080`

## Routing

- `/` and static assets are served by the integrated Server on port `8080`
- `/api/*` is served by the Go API on port `8080`
- `/ws` is served by the Go API websocket handler on port `8080`

