package runtime

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/teamagents/server/internal/db"
	"github.com/teamagents/server/internal/middleware"
	"github.com/teamagents/server/internal/respond"
)

type Runtime struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Hostname      string    `json:"hostname"`
	Status        string    `json:"status"`
	AvailableCLIs []string  `json:"available_clis"`
	LastPingAt    *time.Time `json:"last_ping_at"`
	CreatedAt     time.Time `json:"created_at"`
}

// GET /api/w/{workspace}/runtimes
func HandleList(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())

	rows, err := db.Pool.Query(r.Context(),
		`SELECT id, name, hostname, status, available_clis, last_ping_at, created_at
		 FROM runtimes WHERE workspace_id=$1 ORDER BY created_at DESC`,
		wsID,
	)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "查詢失敗")
		return
	}
	defer rows.Close()

	var list []Runtime
	for rows.Next() {
		var rt Runtime
		if err := rows.Scan(&rt.ID, &rt.Name, &rt.Hostname, &rt.Status,
			&rt.AvailableCLIs, &rt.LastPingAt, &rt.CreatedAt,
		); err != nil {
			continue
		}
		list = append(list, rt)
	}
	if list == nil {
		list = []Runtime{}
	}
	respond.JSON(w, http.StatusOK, list)
}

// POST /api/w/{workspace}/runtimes — Daemon 向 Server 登記
func HandleRegister(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	userID := middleware.GetUserID(r.Context())

	var body struct {
		Name          string   `json:"name"`
		Hostname      string   `json:"hostname"`
		AvailableCLIs []string `json:"available_clis"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "JSON 格式錯誤")
		return
	}

	if body.Hostname == "" {
		respond.Error(w, http.StatusBadRequest, "hostname 為必填")
		return
	}
	if body.AvailableCLIs == nil {
		body.AvailableCLIs = []string{}
	}
	if body.Name == "" {
		body.Name = body.Hostname
	}

	// Upsert：同一 user + hostname 只有一筆 runtime
	var rt Runtime
	err := db.Pool.QueryRow(r.Context(),
		`INSERT INTO runtimes (workspace_id, user_id, name, hostname, available_clis, status, last_ping_at)
		 VALUES ($1, $2, $3, $4, $5, 'online', NOW())
		 ON CONFLICT (workspace_id, user_id, hostname)
		 DO UPDATE SET status='online', available_clis=$5, last_ping_at=NOW(), name=$3
		 RETURNING id, name, hostname, status, available_clis, last_ping_at, created_at`,
		wsID, userID, body.Name, body.Hostname, body.AvailableCLIs,
	).Scan(&rt.ID, &rt.Name, &rt.Hostname, &rt.Status,
		&rt.AvailableCLIs, &rt.LastPingAt, &rt.CreatedAt,
	)
	if err != nil {
		// Fallback：若 unique constraint 不存在，改用普通 INSERT
		err = db.Pool.QueryRow(r.Context(),
			`INSERT INTO runtimes (workspace_id, user_id, name, hostname, available_clis, status, last_ping_at)
			 VALUES ($1, $2, $3, $4, $5, 'online', NOW())
			 RETURNING id, name, hostname, status, available_clis, last_ping_at, created_at`,
			wsID, userID, body.Name, body.Hostname, body.AvailableCLIs,
		).Scan(&rt.ID, &rt.Name, &rt.Hostname, &rt.Status,
			&rt.AvailableCLIs, &rt.LastPingAt, &rt.CreatedAt,
		)
		if err != nil {
			respond.Error(w, http.StatusInternalServerError, "登記 Runtime 失敗: "+err.Error())
			return
		}
	}
	respond.JSON(w, http.StatusOK, rt)
}
