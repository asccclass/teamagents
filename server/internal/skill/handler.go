package skill

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/teamagents/server/internal/db"
	"github.com/teamagents/server/internal/middleware"
	"github.com/teamagents/server/internal/respond"
)

type Skill struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspace_id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Content     string    `json:"content"`
	CreatedBy   *string   `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// GET /api/w/{workspace}/skills
func HandleList(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())

	rows, err := db.Pool.Query(r.Context(),
		`SELECT id, workspace_id, name, description, content, created_by, created_at, updated_at
		 FROM skills WHERE workspace_id=$1 ORDER BY created_at DESC`,
		wsID,
	)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "查詢失敗")
		return
	}
	defer rows.Close()

	var list []Skill
	for rows.Next() {
		var s Skill
		if err := rows.Scan(&s.ID, &s.WorkspaceID, &s.Name, &s.Description,
			&s.Content, &s.CreatedBy, &s.CreatedAt, &s.UpdatedAt); err != nil {
			continue
		}
		list = append(list, s)
	}
	if list == nil {
		list = []Skill{}
	}
	respond.JSON(w, http.StatusOK, list)
}

// GET /api/w/{workspace}/skills/{id}
func HandleGet(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	id := chi.URLParam(r, "id")

	var s Skill
	err := db.Pool.QueryRow(r.Context(),
		`SELECT id, workspace_id, name, description, content, created_by, created_at, updated_at
		 FROM skills WHERE id=$1 AND workspace_id=$2`,
		id, wsID,
	).Scan(&s.ID, &s.WorkspaceID, &s.Name, &s.Description,
		&s.Content, &s.CreatedBy, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "Skill 不存在")
		return
	}
	respond.JSON(w, http.StatusOK, s)
}

// POST /api/w/{workspace}/skills
func HandleCreate(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	userID := middleware.GetUserID(r.Context())

	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Content     string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "JSON 格式錯誤")
		return
	}

	body.Name = strings.TrimSpace(body.Name)
	body.Content = strings.TrimSpace(body.Content)
	if body.Name == "" || body.Content == "" {
		respond.Error(w, http.StatusBadRequest, "name 和 content 為必填")
		return
	}

	var s Skill
	err := db.Pool.QueryRow(r.Context(),
		`INSERT INTO skills (workspace_id, name, description, content, created_by)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, workspace_id, name, description, content, created_by, created_at, updated_at`,
		wsID, body.Name, body.Description, body.Content, userID,
	).Scan(&s.ID, &s.WorkspaceID, &s.Name, &s.Description,
		&s.Content, &s.CreatedBy, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "建立 Skill 失敗: "+err.Error())
		return
	}
	respond.JSON(w, http.StatusCreated, s)
}

// PUT /api/w/{workspace}/skills/{id}
func HandleUpdate(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	id := chi.URLParam(r, "id")

	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Content     string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "JSON 格式錯誤")
		return
	}

	ct, err := db.Pool.Exec(r.Context(),
		`UPDATE skills SET name=$1, description=$2, content=$3
		 WHERE id=$4 AND workspace_id=$5`,
		body.Name, body.Description, body.Content, id, wsID,
	)
	if err != nil || ct.RowsAffected() == 0 {
		respond.Error(w, http.StatusNotFound, "Skill 不存在")
		return
	}
	respond.NoContent(w)
}

// DELETE /api/w/{workspace}/skills/{id}
func HandleDelete(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	id := chi.URLParam(r, "id")

	ct, err := db.Pool.Exec(r.Context(),
		"DELETE FROM skills WHERE id=$1 AND workspace_id=$2", id, wsID,
	)
	if err != nil || ct.RowsAffected() == 0 {
		respond.Error(w, http.StatusNotFound, "Skill 不存在")
		return
	}
	respond.NoContent(w)
}

// GET /api/w/{workspace}/skills/search?q=關鍵字
// 純文字搜尋（未設定 embedding 時的 fallback）
func HandleSearch(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		respond.Error(w, http.StatusBadRequest, "缺少搜尋關鍵字 q")
		return
	}

	pattern := fmt.Sprintf("%%%s%%", q)
	rows, err := db.Pool.Query(r.Context(),
		`SELECT id, workspace_id, name, description, content, created_by, created_at, updated_at
		 FROM skills
		 WHERE workspace_id=$1
		   AND (name ILIKE $2 OR description ILIKE $2 OR content ILIKE $2)
		 ORDER BY created_at DESC LIMIT 10`,
		wsID, pattern,
	)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "搜尋失敗")
		return
	}
	defer rows.Close()

	var list []Skill
	for rows.Next() {
		var s Skill
		if err := rows.Scan(&s.ID, &s.WorkspaceID, &s.Name, &s.Description,
			&s.Content, &s.CreatedBy, &s.CreatedAt, &s.UpdatedAt); err != nil {
			continue
		}
		list = append(list, s)
	}
	if list == nil {
		list = []Skill{}
	}
	respond.JSON(w, http.StatusOK, list)
}
