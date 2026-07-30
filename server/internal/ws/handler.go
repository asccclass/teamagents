package ws

import (
	"log"
	"net/http"

	"github.com/gorilla/websocket"
	"github.com/teamagents/server/internal/auth"
	"github.com/teamagents/server/internal/db"
	"github.com/teamagents/server/internal/respond"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// TODO: Production 時限制 Origin
		return true
	},
}

// HandleConnect 升級 HTTP 為 WebSocket
// URL: /ws?token=<JWT>&workspace=<slug>
// Daemon 額外傳: &daemon=1&runtime_id=<UUID>
func HandleConnect(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		respond.Error(w, http.StatusUnauthorized, "缺少 token")
		return
	}

	claims, err := auth.ParseToken(token)
	if err != nil {
		respond.Error(w, http.StatusUnauthorized, "token 無效")
		return
	}

	userID, err := auth.EnsureUserExists(r.Context(), claims.Email)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "使用者身份同步失敗: "+err.Error())
		return
	}

	workspaceSlug := r.URL.Query().Get("workspace")
	isDaemon := r.URL.Query().Get("daemon") == "1"
	runtimeID := r.URL.Query().Get("runtime_id")

	// 驗證工作區存取權
	var workspaceID string
	err = db.Pool.QueryRow(r.Context(),
		`SELECT w.id FROM workspaces w
		 JOIN workspace_members wm ON wm.workspace_id = w.id
		 WHERE w.slug = $1 AND wm.user_id = $2`,
		workspaceSlug, userID,
	).Scan(&workspaceID)
	if err != nil {
		respond.Error(w, http.StatusForbidden, "無工作區存取權限")
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade 失敗: %v", err)
		return
	}

	client := &Client{
		hub:         DefaultHub,
		conn:        conn,
		send:        make(chan []byte, 256),
		userID:      userID,
		workspaceID: workspaceID,
		runtimeID:   runtimeID,
		isDaemon:    isDaemon,
	}

	DefaultHub.register <- client

	// 若是 Daemon 連線，更新 runtime 狀態
	if isDaemon && runtimeID != "" {
		_, _ = db.Pool.Exec(r.Context(),
			"UPDATE runtimes SET status='online', last_ping_at=NOW() WHERE id=$1",
			runtimeID,
		)
		DefaultHub.BroadcastToWorkspace(workspaceID, Message{
			Type:    TypeAgentStatus,
			Payload: map[string]string{"runtime_id": runtimeID, "status": "online"},
		})
	}

	go client.writePump()
	go client.readPump()
}
