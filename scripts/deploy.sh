#!/bin/bash
# deploy.sh — 一鍵部署到伺服器
# 使用方式: ./scripts/deploy.sh
set -e

echo "🚀 TeamAgents 部署腳本"
echo "========================"

# ── 1. 確認依賴 ─────────────────────────────────
echo "📦 確認依賴..."
command -v go     &>/dev/null || { echo "❌ 未安裝 Go";   exit 1; }
command -v node   &>/dev/null || { echo "❌ 未安裝 Node"; exit 1; }
command -v pnpm   &>/dev/null || npm install -g pnpm
command -v docker &>/dev/null || { echo "⚠️  未安裝 Docker（手動管理 PostgreSQL）"; }

# ── 2. 載入環境變數 ─────────────────────────────
if [ ! -f .env ]; then
  echo "⚠️  找不到 .env，複製範例..."
  cp .env.example .env
  echo "❗ 請先編輯 .env 填入正確設定，然後重新執行此腳本"
  exit 1
fi
export $(grep -v '^#' .env | xargs)

# ── 3. 啟動資料庫 ────────────────────────────────
echo "🐘 啟動 PostgreSQL..."
docker compose up -d postgres
sleep 3

# ── 4. 編譯後端 ─────────────────────────────────
echo "🔨 編譯 Go API Server..."
mkdir -p bin
cd server
go mod download
go build -ldflags="-s -w" -o ../bin/api ./cmd/api
go build -ldflags="-s -w" -o ../bin/daemon ./cmd/daemon
cd ..
echo "✅ 後端編譯完成"

# ── 5. 建置前端 ─────────────────────────────────
echo "⚛️  建置 Next.js 前端..."
cd apps/web
[ ! -f .env.local ] && cat > .env.local << EOF
NEXT_PUBLIC_API_BASE=https://teamagents.justdrink.com.tw
NEXT_PUBLIC_WS_URL=wss://teamagents.justdrink.com.tw/ws
EOF
pnpm install --frozen-lockfile
pnpm build
cd ../..
echo "✅ 前端建置完成"

# ── 6. 重啟服務 ─────────────────────────────────
if command -v systemctl &>/dev/null; then
  echo "🔄 重啟 systemd 服務..."
  systemctl restart teamagents-api  2>/dev/null || echo "  ⚠️  teamagents-api service 不存在"
  systemctl restart teamagents-web  2>/dev/null || echo "  ⚠️  teamagents-web service 不存在"
  systemctl restart nginx           2>/dev/null || echo "  ⚠️  nginx 未安裝"
fi

echo ""
echo "✅ 部署完成！"
echo "   API: http://localhost:8080/healthz"
echo "   Web: http://localhost:3000"
