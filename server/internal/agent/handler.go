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

type agentPayload struct {
	Name         string  `json:"name"`
	Provider     string  `json:"provider"`
	RuntimeID    *string `json:"runtime_id"`
	SystemPrompt *string `json:"system_prompt"`
	AvatarURL    *string `json:"avatar_url"`
}

func normalizePayload(body *agentPayload) {
	body.Name = strings.TrimSpace(body.Name)
	body.Provider = strings.TrimSpace(strings.ToLower(body.Provider))

	if body.RuntimeID != nil && strings.TrimSpace(*body.RuntimeID) == "" {
		body.RuntimeID = nil
	}
	if body.SystemPrompt != nil {
		value := strings.TrimSpace(*body.SystemPrompt)
		body.SystemPrompt = &value
	}
	if body.AvatarURL != nil {
		value := strings.TrimSpace(*body.AvatarURL)
		if value == "" {
			body.AvatarURL = nil
		} else {
			body.AvatarURL = &value
		}
	}
}

func validatePayload(body agentPayload) string {
	if body.Name == "" {
		return "name is required"
	}
	if !ValidProviders[body.Provider] {
		return "invalid provider: " + body.Provider
	}
	return ""
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
		respond.Error(w, http.StatusInternalServerError, "failed to list agents")
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

	var body agentPayload
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	normalizePayload(&body)
	if msg := validatePayload(body); msg != "" {
		respond.Error(w, http.StatusBadRequest, msg)
		return
	}

	var a Agent
	err := db.Pool.QueryRow(r.Context(),
		`INSERT INTO agents (workspace_id, runtime_id, name, provider, avatar_url, system_prompt)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, workspace_id, runtime_id, name, provider,
		           avatar_url, system_prompt, status, created_at`,
		wsID, body.RuntimeID, body.Name, body.Provider, body.AvatarURL, body.SystemPrompt,
	).Scan(&a.ID, &a.WorkspaceID, &a.RuntimeID, &a.Name, &a.Provider,
		&a.AvatarURL, &a.SystemPrompt, &a.Status, &a.CreatedAt,
	)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to create agent: "+err.Error())
		return
	}
	respond.JSON(w, http.StatusCreated, a)
}

// PUT /api/w/{workspace}/agents/{id}
func HandleUpdate(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	agentID := chi.URLParam(r, "id")

	var body agentPayload
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	normalizePayload(&body)
	if msg := validatePayload(body); msg != "" {
		respond.Error(w, http.StatusBadRequest, msg)
		return
	}

	var a Agent
	err := db.Pool.QueryRow(r.Context(),
		`UPDATE agents
		 SET runtime_id=$1,
		     name=$2,
		     provider=$3,
		     avatar_url=$4,
		     system_prompt=$5
		 WHERE id=$6 AND workspace_id=$7
		 RETURNING id, workspace_id, runtime_id, name, provider,
		           avatar_url, system_prompt, status, created_at`,
		body.RuntimeID, body.Name, body.Provider, body.AvatarURL, body.SystemPrompt, agentID, wsID,
	).Scan(&a.ID, &a.WorkspaceID, &a.RuntimeID, &a.Name, &a.Provider,
		&a.AvatarURL, &a.SystemPrompt, &a.Status, &a.CreatedAt,
	)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "agent not found")
		return
	}
	respond.JSON(w, http.StatusOK, a)
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
		respond.Error(w, http.StatusNotFound, "agent not found")
		return
	}
	respond.NoContent(w)
}
