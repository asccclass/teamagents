.PHONY: dev db-up db-down run-api run-web up down build-api build-daemon build-web db-shell db-reset test test-health test-otp gen-secret clean

PORT ?= 11053

dev: db-up
	@sleep 2
	@$(MAKE) run-api

db-up:
	docker compose up -d postgres
	@echo "PostgreSQL is running on localhost:5432"

db-down:
	docker compose down

run-api:
	@cd server && \
	export $$(grep -v '^#' ../.env | xargs) && \
	MIGRATIONS_DIR=migrations go run ./cmd/api

run-web:
	go run ./apps/web/cmd/web

web-dev:
	API_BASE=http://localhost:8080 WS_URL=ws://localhost:8080/ws go run ./apps/web/cmd/web

up:
	docker compose up -d --build

down:
	docker compose down

build-api:
	cd server && CGO_ENABLED=0 go build -o ../bin/api ./cmd/api

build-daemon:
	cd server && CGO_ENABLED=0 go build -o ../bin/daemon ./cmd/daemon

build-web:
	CGO_ENABLED=0 go build -o ./bin/web ./apps/web/cmd/web

db-shell:
	docker exec -it teamagents-db psql -U teamagents -d teamagents

db-reset:
	docker compose down -v
	docker compose up -d postgres

test:
	cd server && go test ./... -v

test-health:
	curl -s http://localhost:${PORT}/healthz | python3 -m json.tool

test-otp:
	@echo "=== 1. Send OTP ==="
	curl -s -X POST http://localhost:${PORT}/api/auth/send-otp \
		-H "Content-Type: application/json" \
		-d '{"email":"test@example.com"}' | python3 -m json.tool
	@echo "\n=== 2. Verify OTP (with DEV_OTP_CODE=888888) ==="
	curl -s -X POST http://localhost:${PORT}/api/auth/verify-otp \
		-H "Content-Type: application/json" \
		-d '{"email":"test@example.com","code":"888888"}' | python3 -m json.tool

gen-secret:
	openssl rand -hex 32

clean:
	rm -rf bin/
