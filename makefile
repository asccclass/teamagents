.PHONY: dev db-up db-down api run-api test clean
PORT?=11053

# ── 開發環境 ──────────────────────────────────────────────────

## 啟動完整開發環境（DB + API）
dev: db-up
	@sleep 2
	@$(MAKE) run-api

## 只啟動 PostgreSQL
db-up:
	docker compose up -d postgres
	@echo "✅ PostgreSQL 已啟動 (localhost:5432)"

## 停止 PostgreSQL
db-down:
	docker compose down

## 啟動 API Server（本地）
run-api:
	@cd server && \
	export $$(grep -v '^#' ../.env | xargs) && \
	MIGRATIONS_DIR=migrations go run ./cmd/api

## 用 Docker 啟動完整服務
up:
	docker compose up -d --build

## 停止所有服務
down:
	docker compose down

# ── 建置 ──────────────────────────────────────────────────────

## 編譯 API binary
build-api:
	cd server && CGO_ENABLED=0 go build -o ../bin/api ./cmd/api

## 編譯 Daemon binary
build-daemon:
	cd server && CGO_ENABLED=0 go build -o ../bin/daemon ./cmd/daemon

# ── 資料庫 ────────────────────────────────────────────────────

## 連接資料庫 shell
db-shell:
	docker exec -it teamagents-db psql -U teamagents -d teamagents

## 重置資料庫
db-reset:
	docker compose down -v
	docker compose up -d postgres

# ── 測試 ──────────────────────────────────────────────────────

test:
	cd server && go test ./... -v

## 快速測試 API 是否正常
test-health:
	curl -s http://localhost:${PORT}/healthz | python3 -m json.tool

## 測試 OTP 流程（開發模式）
test-otp:
	@echo "=== 1. 發送 OTP ==="
	curl -s -X POST http://localhost:${PORT}/api/auth/send-otp \
		-H "Content-Type: application/json" \
		-d '{"email":"test@example.com"}' | python3 -m json.tool
	@echo "\n=== 2. 驗證 OTP (使用 DEV_OTP_CODE=888888) ==="
	curl -s -X POST http://localhost:${PORT}/api/auth/verify-otp \
		-H "Content-Type: application/json" \
		-d '{"email":"test@example.com","code":"888888"}' | python3 -m json.tool

# ── 維護 ──────────────────────────────────────────────────────

## 產生 JWT Secret
gen-secret:
	openssl rand -hex 32

## 前端開發
web-install:
	cd apps/web && pnpm install

web-dev:
	cd apps/web && pnpm dev

web-build:
	cd apps/web && pnpm build

clean:
	rm -rf bin/ apps/web/.next apps/web/node_modules
