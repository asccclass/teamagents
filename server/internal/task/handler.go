package task

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/teamagents/server/internal/db"
	"github.com/teamagents/server/internal/middleware"
	"github.com/teamagents/server/internal/respond"
	"github.com/teamagents/server/internal/ws"
)

type Task struct {
	ID         string     `json:"id"`
	IssueID    string     `json:"issue_id"`
	AgentID    string     `json:"agent_id"`
	RuntimeID  *string    `json:"runtime_id"`
	Provider   string     `json:"provider"`
	Title      string     `json:"title"`
	Body       string     `json:"body"`
	Status     string     `json:"status"`
	ExitCode   *int       `json:"exit_code"`
	StdoutLog  *string    `json:"stdout_log"`
	ErrorMsg   *string    `json:"error_msg"`
	StartedAt  *time.Time `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

// GET /api/w/{workspace}/tasks?status=queued&runtime_id=xxx
// Daemon 用來輪詢待執行任務
func HandleList(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	status := r.URL.Query().Get("status")
	runtimeID := r.URL.Query().Get("runtime_id")

	query := `
		SELECT t.id, t.issue_id, t.agent_id, t.runtime_id,
		       a.provider, i.title, i.body,
		       t.status, t.exit_code, t.stdout_log, t.error_msg,
		       t.started_at, t.finished_at, t.created_at
		FROM tasks t
		JOIN agents a ON a.id = t.agent_id
		JOIN issues i ON i.id = t.issue_id
		WHERE i.workspace_id = $1`
	args := []any{wsID}
	idx := 2

	if status != "" {
		query += " AND t.status = $" + itoa(idx)
		args = append(args, status)
		idx++
	}
	if runtimeID != "" {
		query += " AND t.runtime_id = $" + itoa(idx)
		args = append(args, runtimeID)
		idx++
	}
	query += " ORDER BY t.created_at ASC LIMIT 20"

	rows, err := db.Pool.Query(r.Context(), query, args...)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "查詢失敗")
		return
	}
	defer rows.Close()

	var list []Task
	for rows.Next() {
		var t Task
		err := rows.Scan(
			&t.ID, &t.IssueID, &t.AgentID, &t.RuntimeID,
			&t.Provider, &t.Title, &t.Body,
			&t.Status, &t.ExitCode, &t.StdoutLog, &t.ErrorMsg,
			&t.StartedAt, &t.FinishedAt, &t.CreatedAt,
		)
		if err != nil {
			continue
		}
		list = append(list, t)
	}
	if list == nil {
		list = []Task{}
	}
	respond.JSON(w, http.StatusOK, list)
}

// POST /api/w/{workspace}/tasks — 為 Issue 建立任務（指派後自動觸發）
func HandleCreate(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())

	var body struct {
		IssueID   string  `json:"issue_id"`
		AgentID   string  `json:"agent_id"`
		RuntimeID *string `json:"runtime_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "JSON 格式錯誤")
		return
	}

	// 驗證 Issue 和 Agent 都屬於此 workspace
	var issueExists bool
	db.Pool.QueryRow(r.Context(),
		"SELECT EXISTS(SELECT 1 FROM issues WHERE id=$1 AND workspace_id=$2)",
		body.IssueID, wsID,
	).Scan(&issueExists)
	if !issueExists {
		respond.Error(w, http.StatusNotFound, "Issue 不存在")
		return
	}

	var t Task
	err := db.Pool.QueryRow(r.Context(),
		`INSERT INTO tasks (issue_id, agent_id, runtime_id, status)
		 VALUES ($1, $2, $3, 'queued')
		 RETURNING id, issue_id, agent_id, runtime_id, status, created_at`,
		body.IssueID, body.AgentID, body.RuntimeID,
	).Scan(&t.ID, &t.IssueID, &t.AgentID, &t.RuntimeID, &t.Status, &t.CreatedAt)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "建立任務失敗: "+err.Error())
		return
	}

	// 廣播任務建立事件
	ws.DefaultHub.BroadcastToWorkspace(wsID, ws.Message{
		Type:    ws.TypeTaskStatus,
		Payload: map[string]any{"task_id": t.ID, "status": "queued"},
	})

	respond.JSON(w, http.StatusCreated, t)
}

// PATCH /api/w/{workspace}/tasks/{id} — Daemon 更新任務狀態
func HandleUpdate(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	taskID := chi.URLParam(r, "id")

	var body struct {
		Status   string  `json:"status"`
		Stdout   string  `json:"stdout"`
		ErrorMsg string  `json:"error_msg"`
		ExitCode int     `json:"exit_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "JSON 格式錯誤")
		return
	}

	query := `
		UPDATE tasks SET
			status    = $1,
			stdout_log = COALESCE(NULLIF($2,''), stdout_log),
			error_msg  = NULLIF($3,''),
			exit_code  = CASE WHEN $4 != 0 THEN $4 ELSE exit_code END,
			started_at  = CASE WHEN $1 = 'running' AND started_at IS NULL THEN NOW() ELSE started_at END,
			finished_at = CASE WHEN $1 IN ('done','failed','cancelled') THEN NOW() ELSE finished_at END
		WHERE id = $5
		AND issue_id IN (SELECT id FROM issues WHERE workspace_id = $6)`

	ct, err := db.Pool.Exec(r.Context(), query,
		body.Status, body.Stdout, body.ErrorMsg, body.ExitCode, taskID, wsID,
	)
	if err != nil || ct.RowsAffected() == 0 {
		respond.Error(w, http.StatusNotFound, "Task 不存在或無權限")
		return
	}

	// 廣播狀態更新
	ws.DefaultHub.BroadcastToWorkspace(wsID, ws.Message{
		Type:    ws.TypeTaskStatus,
		Payload: map[string]any{"task_id": taskID, "status": body.Status},
	})

	respond.NoContent(w)
}

// POST /api/w/{workspace}/tasks/{id}/progress — Daemon 串流單行輸出
func HandleProgress(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	taskID := chi.URLParam(r, "id")

	var body struct {
		Line string `json:"line"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "JSON 格式錯誤")
		return
	}

	// 廣播進度給前端
	ws.DefaultHub.BroadcastToWorkspace(wsID, ws.Message{
		Type: ws.TypeTaskProgress,
		Payload: map[string]string{
			"task_id": taskID,
			"line":    body.Line,
		},
	})

	respond.NoContent(w)
}

// POST /api/w/{workspace}/runtimes/{id}/ping — Daemon 心跳
func HandleRuntimePing(w http.ResponseWriter, r *http.Request) {
	runtimeID := chi.URLParam(r, "id")
	db.Pool.Exec(r.Context(),
		"UPDATE runtimes SET last_ping_at=NOW(), status='online' WHERE id=$1",
		runtimeID,
	)
	respond.NoContent(w)
}

func itoa(n int) string {
	return string([]byte{byte('0' + n)})
}
