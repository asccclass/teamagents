package workspace

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/teamagents/server/internal/db"
	"github.com/teamagents/server/internal/middleware"
	"github.com/teamagents/server/internal/respond"
)

var slugRe = regexp.MustCompile(`^[a-z0-9-]{3,50}$`)

type Workspace struct {
	ID        string `json:"id"`
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	OwnerID   string `json:"owner_id"`
	CreatedAt string `json:"created_at"`
}

// GET /api/workspaces — 列出我的工作區
func HandleList(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	rows, err := db.Pool.Query(r.Context(),
		`SELECT w.id, w.slug, w.name, w.owner_id, w.created_at
		 FROM workspaces w
		 LEFT JOIN workspace_members wm
		   ON wm.workspace_id = w.id
		  AND wm.user_id = $1
		 WHERE w.owner_id = $1 OR wm.user_id IS NOT NULL
		 ORDER BY w.created_at DESC`,
		userID,
	)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "查詢失敗")
		return
	}
	defer rows.Close()

	var list []Workspace
	for rows.Next() {
		var ws Workspace
		if err := rows.Scan(&ws.ID, &ws.Slug, &ws.Name, &ws.OwnerID, &ws.CreatedAt); err != nil {
			continue
		}
		list = append(list, ws)
	}
	if list == nil {
		list = []Workspace{}
	}
	respond.JSON(w, http.StatusOK, list)
}

// POST /api/workspaces — 建立工作區
func HandleCreate(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	var body struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "JSON 格式錯誤")
		return
	}

	body.Name = strings.TrimSpace(body.Name)
	body.Slug = strings.TrimSpace(strings.ToLower(body.Slug))

	if body.Name == "" {
		respond.Error(w, http.StatusBadRequest, "name 為必填")
		return
	}
	if !slugRe.MatchString(body.Slug) {
		respond.Error(w, http.StatusBadRequest, "slug 只能包含小寫字母、數字和連字號（3-50字元）")
		return
	}

	// 建立工作區 + 加入 owner 為成員（Transaction）
	tx, err := db.Pool.Begin(r.Context())
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "交易開始失敗")
		return
	}
	defer tx.Rollback(r.Context())

	var wsID uuid.UUID
	err = tx.QueryRow(r.Context(),
		`INSERT INTO workspaces (slug, name, owner_id)
		 VALUES ($1, $2, $3) RETURNING id`,
		body.Slug, body.Name, userID,
	).Scan(&wsID)
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			respond.Error(w, http.StatusConflict, "此 slug 已被使用")
			return
		}
		respond.Error(w, http.StatusInternalServerError, "建立工作區失敗")
		return
	}

	// 加入 owner 為成員
	_, err = tx.Exec(r.Context(),
		`INSERT INTO workspace_members (workspace_id, user_id, role)
		 VALUES ($1, $2, 'owner')`,
		wsID, userID,
	)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "加入成員失敗")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		respond.Error(w, http.StatusInternalServerError, "交易提交失敗")
		return
	}

	respond.JSON(w, http.StatusCreated, map[string]any{
		"id":   wsID.String(),
		"slug": body.Slug,
		"name": body.Name,
	})
}
