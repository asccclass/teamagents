package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"


	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	sherryserver "github.com/asccclass/sherryserver"
	"github.com/teamagents/server/internal/agent"
	"github.com/teamagents/server/internal/auth"
	"github.com/teamagents/server/internal/autopilot"
	"github.com/teamagents/server/internal/config"
	"github.com/teamagents/server/internal/db"
	"github.com/teamagents/server/internal/issue"
	mw "github.com/teamagents/server/internal/middleware"
	"github.com/teamagents/server/internal/runtime"
	"github.com/teamagents/server/internal/skill"
	"github.com/teamagents/server/internal/task"
	"github.com/teamagents/server/internal/workspace"
	"github.com/teamagents/server/internal/ws"
)

func main() {
	// 載入設定
	config.Load()
	log.Printf("🚀 TeamAgents API Server 啟動中 (env=%s)", config.C.AppEnv)

	// 連接資料庫
	ctx := context.Background()
	if err := db.Connect(ctx, config.C.DatabaseURL); err != nil {
		log.Fatalf("資料庫連線失敗: %v", err)
	}
	defer db.Close()

	// 執行 Migrations
	if err := db.Migrate(ctx); err != nil {
		log.Fatalf("Migration 失敗: %v", err)
	}

	// 啟動 WebSocket Hub
	go ws.DefaultHub.Run()

	// 啟動 Autopilot 排程器（從 DB 載入所有啟用的排程）
	go autopilot.StartAll(ctx)

	// 建立 Router
	r := chi.NewRouter()

	// ── 全域 Middleware ────────────────────────
	r.Use(chiMiddleware.Logger)
	r.Use(chiMiddleware.Recoverer)
	r.Use(chiMiddleware.RequestID)
	r.Use(chiMiddleware.RealIP)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: []string{
			config.C.AppURL,
			"http://localhost:3000",
		},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// ── 健康檢查 ────────────────────────────────
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	// ── WebSocket ────────────────────────────────
	r.Get("/ws", ws.HandleConnect)

	// ── API 路由 ─────────────────────────────────
	r.Route("/api", func(r chi.Router) {

		// 公開路由（不需要 JWT）
		r.Post("/auth/send-otp", auth.HandleSendOTP)
		r.Post("/auth/verify-otp", auth.HandleVerifyOTP)

		// 需要認證的路由
		r.Group(func(r chi.Router) {
			r.Use(mw.Authenticate)

			// 我的資訊
			r.Get("/auth/me", auth.HandleMe)

			// 工作區（不需要指定 workspace）
			r.Get("/workspaces", workspace.HandleList)
			r.Post("/workspaces", workspace.HandleCreate)

			// 工作區內的資源（需要 workspace 驗證）
			r.Route("/w/{workspace}", func(r chi.Router) {
				r.Use(mw.RequireWorkspace)

				// Agents
				r.Get("/agents", agent.HandleList)
				r.Post("/agents", agent.HandleCreate)
				r.Delete("/agents/{id}", agent.HandleDelete)

				// Issues
				r.Get("/issues", issue.HandleList)
				r.Post("/issues", issue.HandleCreate)
				r.Patch("/issues/{id}", issue.HandleUpdate)

				// Runtimes（Daemon 登記）
				r.Get("/runtimes", runtime.HandleList)
				r.Post("/runtimes", runtime.HandleRegister)
				r.Post("/runtimes/{id}/ping", task.HandleRuntimePing)

				// Tasks（Daemon 輪詢 + 前端查詢）
				r.Get("/tasks", task.HandleList)
				r.Post("/tasks", task.HandleCreate)
				r.Patch("/tasks/{id}", task.HandleUpdate)
				r.Post("/tasks/{id}/progress", task.HandleProgress)

				// Skills（可重用技能庫）
				r.Get("/skills", skill.HandleList)
				r.Post("/skills", skill.HandleCreate)
				r.Get("/skills/search", skill.HandleSearch)
				r.Get("/skills/{id}", skill.HandleGet)
				r.Put("/skills/{id}", skill.HandleUpdate)
				r.Delete("/skills/{id}", skill.HandleDelete)

				// Autopilots（排程 + Webhook 觸發）
				r.Get("/autopilots", autopilot.HandleList)
				r.Post("/autopilots", autopilot.HandleCreate)
				r.Patch("/autopilots/{id}", autopilot.HandleToggle)
				r.Delete("/autopilots/{id}", autopilot.HandleDelete)
				r.Post("/autopilots/{id}/trigger", autopilot.HandleTrigger)
			})
		})
	})

	// ── 前端動態設定 ──────────────────────────────
	r.Get("/config.js", func(w http.ResponseWriter, r *http.Request) {
		apiBase := os.Getenv("API_BASE")
		wsURL := os.Getenv("WS_URL")
		body, err := json.Marshal(map[string]string{
			"apiBase": apiBase,
			"wsUrl":   wsURL,
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		_, _ = fmt.Fprintf(w, "window.__TEAMAGENTS_CONFIG__ = %s;\n", body)
	})

	// ── 靜態網頁伺服器 (SPA Fallback) ─────────────
	staticRoot := os.Getenv("WEB_STATIC_ROOT")
	if staticRoot == "" {
		staticRoot = filepath.Join("apps", "web", "public")
	}
	root, err := filepath.Abs(staticRoot)
	if err == nil {
		if _, statErr := os.Stat(root); statErr == nil {
			log.Printf("📦 載入靜態網頁資產: %s", root)
			staticServer := sherryserver.StaticFileServer{
				StaticPath: root,
				IndexPath:  "index.html",
			}
			r.NotFound(func(w http.ResponseWriter, req *http.Request) {
				staticServer.ServeHTTP(w, req)
			})
		}
	}

	// ── 啟動 Server ──────────────────────────────
	if _, err := os.Stat("envfile"); os.IsNotExist(err) {
		_ = os.WriteFile("envfile", []byte("SystemName=TeamAgents-API\n"), 0644)
	}
	sryServer, err := sherryserver.NewServer(":"+config.C.Port, "", "")
	if err != nil {
		log.Fatalf("SherryServer 初始化失敗: %v", err)
	}
	sryServer.Server.Handler = r
	log.Printf("✅ TeamAgents API Server (SherryServer) 運行於 http://0.0.0.0:%s", config.C.Port)
	sryServer.Start()
}
