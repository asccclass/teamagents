package agent

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/teamagents/server/internal/db"
	"github.com/teamagents/server/internal/middleware"
	"github.com/teamagents/server/internal/respond"
)

// 支援的 AI Provider
var ValidProviders = map[string]bool{
	"claude":       true,
	"codex":        true,
	"cursor-agent": true,
	"copilot":      true,
	"llama":        true,
	"llama.cpp":    true,
	"opencode":     true,
	"gemini":       true,
	"kimi":         true,
}

type Agent struct {
	ID           string    `json:"id"`
	WorkspaceID  string    `json:"workspace_id"`
	RuntimeID    *string   `json:"runtime_id"`
	Name         string    `json:"name"`
	Provider     string    `json:"provider"`
	AvatarURL    *string   `json:"avatar_url"`
	SystemPrompt *string   `json:"system_prompt"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
}

// GET /api/w/{workspace}/agents
func HandleList(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())

	rows, err := db.Pool.Query(r.Context(),
		`SELECT id, workspace_id, runtime_id, name, provider,
		        avatar_url, system_prompt, status, created_at
		 FROM agents WHERE workspace_id = $1 ORDER BY created_at ASC`,
		wsID,
	)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "查詢失敗")
		return
	}
	defer rows.Close()

	var list []Agent
	for rows.Next() {
		var a Agent
		if err := rows.Scan(&a.ID, &a.WorkspaceID, &a.RuntimeID, &a.Name,
			&a.Provider, &a.AvatarURL, &a.SystemPrompt, &a.Status, &a.CreatedAt,
		); err != nil {
			continue
		}
		list = append(list, a)
	}
	if list == nil {
		list = []Agent{}
	}
	respond.JSON(w, http.StatusOK, list)
}

// POST /api/w/{workspace}/agents
func HandleCreate(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())

	var body struct {
		Name         string  `json:"name"`
		Provider     string  `json:"provider"`
		RuntimeID    *string `json:"runtime_id"`
		SystemPrompt *string `json:"system_prompt"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "JSON 格式錯誤")
		return
	}

	body.Name = strings.TrimSpace(body.Name)
	body.Provider = strings.TrimSpace(strings.ToLower(body.Provider))

	if body.Name == "" {
		respond.Error(w, http.StatusBadRequest, "name 為必填")
		return
	}
	if !ValidProviders[body.Provider] {
		respond.Error(w, http.StatusBadRequest, "不支援的 provider: "+body.Provider)
		return
	}

	var a Agent
	err := db.Pool.QueryRow(r.Context(),
		`INSERT INTO agents (workspace_id, runtime_id, name, provider, system_prompt)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, workspace_id, runtime_id, name, provider,
		           avatar_url, system_prompt, status, created_at`,
		wsID, body.RuntimeID, body.Name, body.Provider, body.SystemPrompt,
	).Scan(&a.ID, &a.WorkspaceID, &a.RuntimeID, &a.Name, &a.Provider,
		&a.AvatarURL, &a.SystemPrompt, &a.Status, &a.CreatedAt,
	)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "建立 Agent 失敗: "+err.Error())
		return
	}
	respond.JSON(w, http.StatusCreated, a)
}

// DELETE /api/w/{workspace}/agents/{id}
func HandleDelete(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	agentID := chi.URLParam(r, "id")

	ct, err := db.Pool.Exec(r.Context(),
		"DELETE FROM agents WHERE id=$1 AND workspace_id=$2",
		agentID, wsID,
	)
	if err != nil || ct.RowsAffected() == 0 {
		respond.Error(w, http.StatusNotFound, "Agent 不存在")
		return
	}
	respond.NoContent(w)
}
