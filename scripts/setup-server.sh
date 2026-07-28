#!/bin/bash
# scripts/setup-server.sh
# 在全新 Ubuntu 24.04 伺服器上執行，完成所有初始化
set -e

echo "🚀 TeamAgents 伺服器初始化"
echo "=============================="

# ── 1. 系統套件 ─────────────────────────────
echo "📦 安裝系統套件..."
apt-get update -q
apt-get install -y -q \
    nginx certbot python3-certbot-nginx \
    postgresql postgresql-contrib \
    curl git make

# ── 2. Go ────────────────────────────────────
if ! command -v go &>/dev/null; then
    echo "🐹 安裝 Go 1.22..."
    curl -fsSL https://go.dev/dl/go1.22.4.linux-amd64.tar.gz | tar -C /usr/local -xz
    echo 'export PATH=$PATH:/usr/local/go/bin' > /etc/profile.d/go.sh
    export PATH=$PATH:/usr/local/go/bin
fi

# ── 3. PostgreSQL + pgvector ─────────────────
echo "🐘 設定 PostgreSQL..."
apt-get install -y postgresql-16-pgvector 2>/dev/null || \
    echo "⚠️  pgvector 需手動安裝，請參考 https://github.com/pgvector/pgvector"

# 建立資料庫和使用者
sudo -u postgres psql << 'PSQL'
CREATE USER teamagents WITH PASSWORD 'CHANGE_THIS_PASSWORD';
CREATE DATABASE teamagents OWNER teamagents;
PSQL

echo "✅ 資料庫建立完成"

# ── 4. 部署目錄 ──────────────────────────────
echo "📁 建立部署目錄..."
mkdir -p /opt/teamagents
cp -r . /opt/teamagents/
chown -R www-data:www-data /opt/teamagents

# ── 5. 編譯服務 (API & Web) ─────────────────
echo "🔨 編譯 API & Web Server..."
cd /opt/teamagents/server
export PATH=$PATH:/usr/local/go/bin
go mod download
go build -ldflags="-s -w" -o /opt/teamagents/bin/api ./cmd/api
go build -ldflags="-s -w" -o /opt/teamagents/bin/daemon ./cmd/daemon

# ── 6. systemd 服務 ─────────────────────────
echo "⚙️  安裝 systemd 服務..."
cp /opt/teamagents/deploy/teamagents-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable teamagents-api

# ── 7. Nginx ────────────────────────────────
echo "🌐 設定 Nginx..."
cp /opt/teamagents/deploy/nginx.conf /etc/nginx/sites-available/teamagents
ln -sf /etc/nginx/sites-available/teamagents /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# ── 8. SSL ─────────────────────────────────
echo "🔒 申請 SSL 憑證..."
certbot --nginx -d teamagents.justdrink.com.tw --non-interactive --agree-tos \
    --email admin@justdrink.com.tw || echo "⚠️  SSL 申請失敗，請手動執行 certbot"

echo ""
echo "✅ 初始化完成！"
echo ""
echo "接下來："
echo "  1. 編輯 /opt/teamagents/.env（填入正確的 DATABASE_URL、JWT_SECRET）"
echo "  2. systemctl start teamagents-api"
echo "  3. 開啟 https://teamagents.justdrink.com.tw"
