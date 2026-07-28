# TeamAgents

TeamAgents 是一個基於 Go 語言構建的高效能 AI Agent 協作平台，旨在將 AI Agent 整合為團隊成員，進行自動化任務分配、排程執行與即時狀態同步。

---

## 🏗️ 專案架構 (Project Architecture)

系統採用單一整合式後端架構（Single Integrated Server），將前端單頁應用程式（SPA）、RESTful API 與 WebSocket 即時通訊整合於同一 Go 服務中：

```text
teamagents/
├── server/                  # Go 核心服務與 Daemon 守護程序
│   ├── cmd/api              # 整合式 Web / REST API / WebSocket 主入口
│   ├── cmd/daemon           # 區域 Runtime 守護程序入口
│   ├── internal/            # 業務邏輯 (Auth, Workspace, Issue, Agent, Skill, Autopilot)
│   └── migrations/          # PostgreSQL 資料庫 Schema 遷移檔
├── apps/web/public/         # 前端 SPA 靜態網頁資產 (HTML, CSS, JS)
├── deploy/                  # Nginx 與 Systemd 部署設定
├── docker-compose.yml       # Docker Compose 一鍵啟動配置
└── makefile                 # 自動化建置指令集
```

---

## 🚀 快速開始 (Local Development)

### 1. 環境設定

複製環境變數範本並設定必要參數：

```bash
cp .env.example .env
```

確保至少包含以下核心變數：

| 變數名稱 | 預設值 | 說明 |
| :--- | :--- | :--- |
| `PORT` | `8080` | API & Web 服務埠號 |
| `DATABASE_URL` | `postgres://teamagents:password@localhost:5432/teamagents?sslmode=disable` | PostgreSQL 連線字串 |
| `JWT_SECRET` | *(自訂)* | JWT 身份驗證金鑰 |
| `DEV_OTP_CODE` | `888888` | 開發環境免寄信 OTP 驗證碼 |

### 2. 啟動資料庫

使用 Docker Compose 啟動帶有 `pgvector` 擴充的 PostgreSQL：

```bash
make db-up
```

### 3. 運行伺服器 (API & Web Server)

```bash
make run-api
```

開啟瀏覽器造訪 `http://localhost:8080` 即可使用完整介面。

### 4. 運行 Daemon (可選)

用於執行區域 Agent 任務與 CLI 綁定：

```bash
cd server && go run ./cmd/daemon
```

---

## 🛠️ 建置指令 (Build Targets)

產生無依賴的單一執行檔（Binary）：

```bash
# 建置 API & Web 伺服器
make build-api

# 建置 Daemon 執行檔
make build-daemon
```

編譯後的執行檔將輸出至 `bin/` 目錄。

---

## 🐳 Docker 部署

使用 Docker Compose 一鍵完成容器化部署：

```bash
docker compose up -d --build
```

服務預設連接埠：
* **PostgreSQL**: `localhost:5432`
* **TeamAgents 整合服務**: `http://localhost:8080`

---

## 🌐 路由劃分 (Routing)

* **`/`**：託管前端 SPA 靜態網頁與路由退回（由 `SherryServer` 處理）
* **`/api/*`**：RESTful API 存取點（Auth, Workspace, Issue, Agent, Skill, Autopilot）
* **`/ws`**：WebSocket 即時狀態與 Task 廣播頻道
