package issue

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/teamagents/server/internal/db"
	"github.com/teamagents/server/internal/middleware"
	"github.com/teamagents/server/internal/respond"
	"github.com/teamagents/server/internal/ws"
)

type Issue struct {
	ID               string     `json:"id"`
	Number           int        `json:"number"`
	Title            string     `json:"title"`
	Body             string     `json:"body"`
	Status           string     `json:"status"`
	Priority         string     `json:"priority"`
	AssigneeAgentID  *string    `json:"assignee_agent_id"`
	AssigneeUserID   *string    `json:"assignee_user_id"`
	Labels           []string   `json:"labels"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	ClosedAt         *time.Time `json:"closed_at"`
}

// GET /api/w/{workspace}/issues
func HandleList(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())

	status := r.URL.Query().Get("status") // 可選篩選

	query := `SELECT id, number, title, body, status, priority,
		         assignee_agent_id, assignee_user_id, labels, created_at, updated_at, closed_at
		         FROM issues WHERE workspace_id = $1`
	args := []any{wsID}

	if status != "" {
		query += " AND status = $2"
		args = append(args, status)
	}
	query += " ORDER BY created_at DESC LIMIT 100"

	rows, err := db.Pool.Query(r.Context(), query, args...)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "查詢失敗")
		return
	}
	defer rows.Close()

	var list []Issue
	for rows.Next() {
		var iss Issue
		err := rows.Scan(
			&iss.ID, &iss.Number, &iss.Title, &iss.Body,
			&iss.Status, &iss.Priority,
			&iss.AssigneeAgentID, &iss.AssigneeUserID,
			&iss.Labels, &iss.CreatedAt, &iss.UpdatedAt, &iss.ClosedAt,
		)
		if err != nil {
			continue
		}
		list = append(list, iss)
	}
	if list == nil {
		list = []Issue{}
	}
	respond.JSON(w, http.StatusOK, list)
}

// POST /api/w/{workspace}/issues
func HandleCreate(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	userID := middleware.GetUserID(r.Context())

	var body struct {
		Title           string   `json:"title"`
		Body            string   `json:"body"`
		Priority        string   `json:"priority"`
		AssigneeAgentID *string  `json:"assignee_agent_id"`
		Labels          []string `json:"labels"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "JSON 格式錯誤")
		return
	}

	body.Title = strings.TrimSpace(body.Title)
	if body.Title == "" {
		respond.Error(w, http.StatusBadRequest, "title 為必填")
		return
	}
	if body.Priority == "" {
		body.Priority = "medium"
	}
	if body.Labels == nil {
		body.Labels = []string{}
	}

	var iss Issue
	err := db.Pool.QueryRow(r.Context(),
		`INSERT INTO issues
		 (workspace_id, title, body, priority, assignee_agent_id, creator_id, labels)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id, number, title, body, status, priority,
		           assignee_agent_id, assignee_user_id, labels, created_at, updated_at, closed_at`,
		wsID, body.Title, body.Body, body.Priority,
		body.AssigneeAgentID, userID, body.Labels,
	).Scan(
		&iss.ID, &iss.Number, &iss.Title, &iss.Body,
		&iss.Status, &iss.Priority,
		&iss.AssigneeAgentID, &iss.AssigneeUserID,
		&iss.Labels, &iss.CreatedAt, &iss.UpdatedAt, &iss.ClosedAt,
	)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "建立 Issue 失敗")
		return
	}

	// 若有指派 Agent，廣播通知
	if iss.AssigneeAgentID != nil {
		ws.DefaultHub.BroadcastToWorkspace(wsID, ws.Message{
			Type:    ws.TypeIssueUpdated,
			Payload: iss,
		})
	}

	respond.JSON(w, http.StatusCreated, iss)
}

// PATCH /api/w/{workspace}/issues/{id}
// 支援更新 status、priority、assignee_agent_id 等欄位
func HandleUpdate(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	issueID := chi.URLParam(r, "id")

	var body struct {
		Status          *string  `json:"status"`
		Priority        *string  `json:"priority"`
		AssigneeAgentID *string  `json:"assignee_agent_id"`
		Title           *string  `json:"title"`
		Labels          []string `json:"labels"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "JSON 格式錯誤")
		return
	}

	// 動態組建 UPDATE（只更新有傳入的欄位）
	setClauses := []string{}
	args := []any{}
	argIdx := 1

	if body.Status != nil {
		setClauses = append(setClauses, "status=$"+itoa(argIdx))
		args = append(args, *body.Status)
		argIdx++
	}
	if body.Priority != nil {
		setClauses = append(setClauses, "priority=$"+itoa(argIdx))
		args = append(args, *body.Priority)
		argIdx++
	}
	if body.AssigneeAgentID != nil {
		setClauses = append(setClauses, "assignee_agent_id=$"+itoa(argIdx))
		args = append(args, *body.AssigneeAgentID)
		argIdx++
	}
	if body.Title != nil {
		setClauses = append(setClauses, "title=$"+itoa(argIdx))
		args = append(args, *body.Title)
		argIdx++
	}
	if body.Labels != nil {
		setClauses = append(setClauses, "labels=$"+itoa(argIdx))
		args = append(args, body.Labels)
		argIdx++
	}

	if len(setClauses) == 0 {
		respond.Error(w, http.StatusBadRequest, "沒有可更新的欄位")
		return
	}

	args = append(args, issueID, wsID)
	query := "UPDATE issues SET " + strings.Join(setClauses, ", ") +
		" WHERE id=$" + itoa(argIdx) +
		" AND workspace_id=$" + itoa(argIdx+1)

	ct, err := db.Pool.Exec(r.Context(), query, args...)
	if err != nil || ct.RowsAffected() == 0 {
		respond.Error(w, http.StatusNotFound, "Issue 不存在或無權限")
		return
	}

	// 廣播更新
	ws.DefaultHub.BroadcastToWorkspace(wsID, ws.Message{
		Type:    ws.TypeIssueUpdated,
		Payload: map[string]string{"id": issueID},
	})

	respond.NoContent(w)
}

func itoa(n int) string {
	return string(rune('0' + n)) // 僅適用 1-9
}
