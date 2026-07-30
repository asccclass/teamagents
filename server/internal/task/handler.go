package task

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/teamagents/server/internal/db"
	"github.com/teamagents/server/internal/middleware"
	"github.com/teamagents/server/internal/respond"
	"github.com/teamagents/server/internal/ws"
)

type Task struct {
	ID                string     `json:"id"`
	IssueID           string     `json:"issue_id"`
	AgentID           string     `json:"agent_id"`
	RuntimeID         *string    `json:"runtime_id"`
	Provider          string     `json:"provider"`
	Title             string     `json:"title"`
	Body              string     `json:"body"`
	Status            string     `json:"status"`
	ExitCode          *int       `json:"exit_code"`
	StdoutLog         *string    `json:"stdout_log"`
	ErrorMsg          *string    `json:"error_msg"`
	StartedAt         *time.Time `json:"started_at"`
	FinishedAt        *time.Time `json:"finished_at"`
	CreatedAt         time.Time  `json:"created_at"`
	SourceCommentID   *string    `json:"source_comment_id"`
	ResponseCommentID *string    `json:"response_comment_id"`
}

func HandleList(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	status := r.URL.Query().Get("status")
	runtimeID := r.URL.Query().Get("runtime_id")

	query := `
		SELECT t.id, t.issue_id, t.agent_id, t.runtime_id,
		       a.provider, i.title, i.body,
		       t.status, t.exit_code, t.stdout_log, t.error_msg,
		       t.started_at, t.finished_at, t.created_at,
		       t.source_comment_id, t.response_comment_id
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
	query += " ORDER BY t.created_at ASC LIMIT 100"

	rows, err := db.Pool.Query(r.Context(), query, args...)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to list tasks")
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
			&t.SourceCommentID, &t.ResponseCommentID,
		)
		if err != nil {
			continue
		}
		if t.SourceCommentID != nil {
			if prompt, err := buildChatPrompt(r.Context(), t.ID, *t.SourceCommentID); err == nil {
				t.Body = prompt
			}
		}
		list = append(list, t)
	}
	if list == nil {
		list = []Task{}
	}
	respond.JSON(w, http.StatusOK, list)
}

func HandleCreate(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())

	var body struct {
		IssueID   string  `json:"issue_id"`
		AgentID   string  `json:"agent_id"`
		RuntimeID *string `json:"runtime_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	var issueExists bool
	db.Pool.QueryRow(r.Context(),
		"SELECT EXISTS(SELECT 1 FROM issues WHERE id=$1 AND workspace_id=$2)",
		body.IssueID, wsID,
	).Scan(&issueExists)
	if !issueExists {
		respond.Error(w, http.StatusNotFound, "issue not found")
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
		respond.Error(w, http.StatusInternalServerError, "failed to create task: "+err.Error())
		return
	}

	ws.DefaultHub.BroadcastToWorkspace(wsID, ws.Message{
		Type:    ws.TypeTaskStatus,
		Payload: map[string]any{"task_id": t.ID, "status": "queued"},
	})

	respond.JSON(w, http.StatusCreated, t)
}

func HandleUpdate(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	taskID := chi.URLParam(r, "id")

	var body struct {
		Status   string `json:"status"`
		Stdout   string `json:"stdout"`
		ErrorMsg string `json:"error_msg"`
		ExitCode int    `json:"exit_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	query := `
		UPDATE tasks SET
			status = $1,
			stdout_log = COALESCE(NULLIF($2,''), stdout_log),
			error_msg = NULLIF($3,''),
			exit_code = CASE WHEN $4 != 0 THEN $4 ELSE exit_code END,
			started_at = CASE WHEN $1 = 'running' AND started_at IS NULL THEN NOW() ELSE started_at END,
			finished_at = CASE WHEN $1 IN ('done','failed','cancelled') THEN NOW() ELSE finished_at END
		WHERE id = $5
		  AND issue_id IN (SELECT id FROM issues WHERE workspace_id = $6)`

	ct, err := db.Pool.Exec(r.Context(), query,
		body.Status, body.Stdout, body.ErrorMsg, body.ExitCode, taskID, wsID,
	)
	if err != nil || ct.RowsAffected() == 0 {
		respond.Error(w, http.StatusNotFound, "task not found")
		return
	}

	if body.Status == "done" || body.Status == "failed" || body.Status == "cancelled" {
		_ = syncTaskChatReply(r.Context(), wsID, taskID, body.Status, body.Stdout, body.ErrorMsg)
	}

	ws.DefaultHub.BroadcastToWorkspace(wsID, ws.Message{
		Type:    ws.TypeTaskStatus,
		Payload: map[string]any{"task_id": taskID, "status": body.Status},
	})

	respond.NoContent(w)
}

func HandleProgress(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	taskID := chi.URLParam(r, "id")

	var body struct {
		Line string `json:"line"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	ws.DefaultHub.BroadcastToWorkspace(wsID, ws.Message{
		Type: ws.TypeTaskProgress,
		Payload: map[string]string{
			"task_id": taskID,
			"line":    body.Line,
		},
	})

	respond.NoContent(w)
}

func HandleRuntimePing(w http.ResponseWriter, r *http.Request) {
	runtimeID := chi.URLParam(r, "id")
	db.Pool.Exec(r.Context(),
		"UPDATE runtimes SET last_ping_at=NOW(), status='online' WHERE id=$1",
		runtimeID,
	)
	respond.NoContent(w)
}

func buildChatPrompt(ctx context.Context, taskID, sourceCommentID string) (string, error) {
	type meta struct {
		Title        string
		IssueBody    string
		SystemPrompt string
	}

	var m meta
	err := db.Pool.QueryRow(ctx, `
		SELECT i.title, COALESCE(i.body, ''), COALESCE(a.system_prompt, '')
		  FROM tasks t
		  JOIN issues i ON i.id = t.issue_id
		  JOIN agents a ON a.id = t.agent_id
		 WHERE t.id = $1
	`, taskID).Scan(&m.Title, &m.IssueBody, &m.SystemPrompt)
	if err != nil {
		return "", err
	}

	rows, err := db.Pool.Query(ctx, `
		SELECT ic.author_user_id, ic.author_agent_id, ic.body, ic.created_at
		  FROM issue_comments ic
		 WHERE ic.issue_id = (SELECT issue_id FROM tasks WHERE id = $1)
		   AND ic.created_at <= (SELECT created_at FROM issue_comments WHERE id = $2)
		 ORDER BY ic.created_at ASC
		 LIMIT 100
	`, taskID, sourceCommentID)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	var transcript strings.Builder
	for rows.Next() {
		var authorUserID, authorAgentID *string
		var body string
		var createdAt time.Time
		if err := rows.Scan(&authorUserID, &authorAgentID, &body, &createdAt); err != nil {
			return "", err
		}
		role := "User"
		if authorAgentID != nil {
			role = "Assistant"
		}
		transcript.WriteString(role)
		transcript.WriteString(": ")
		transcript.WriteString(strings.TrimSpace(body))
		transcript.WriteString("\n\n")
	}

	var prompt strings.Builder
	if strings.TrimSpace(m.SystemPrompt) != "" {
		prompt.WriteString("System instructions:\n")
		prompt.WriteString(strings.TrimSpace(m.SystemPrompt))
		prompt.WriteString("\n\n")
	}
	prompt.WriteString("You are continuing an ongoing chat with the user. Reply naturally to the most recent user message.\n")
	prompt.WriteString("Chat thread title: ")
	prompt.WriteString(strings.TrimSpace(m.Title))
	prompt.WriteString("\n")
	if strings.TrimSpace(m.IssueBody) != "" {
		prompt.WriteString("Thread note: ")
		prompt.WriteString(strings.TrimSpace(m.IssueBody))
		prompt.WriteString("\n")
	}
	prompt.WriteString("\nConversation so far:\n")
	prompt.WriteString(transcript.String())
	return prompt.String(), nil
}

func syncTaskChatReply(ctx context.Context, wsID, taskID, status, stdout, errMsg string) error {
	type meta struct {
		IssueID           string
		AgentID           string
		SourceCommentID   *string
		ResponseCommentID *string
	}

	var m meta
	err := db.Pool.QueryRow(ctx, `
		SELECT issue_id, agent_id, source_comment_id, response_comment_id
		  FROM tasks
		 WHERE id = $1
	`, taskID).Scan(&m.IssueID, &m.AgentID, &m.SourceCommentID, &m.ResponseCommentID)
	if err != nil || m.SourceCommentID == nil {
		return err
	}

	reply := strings.TrimSpace(stdout)
	if reply == "" {
		reply = strings.TrimSpace(errMsg)
	}
	if reply == "" {
		reply = fmt.Sprintf("Task finished with status: %s", status)
	}
	if status == "failed" && strings.TrimSpace(errMsg) != "" && !strings.Contains(reply, strings.TrimSpace(errMsg)) {
		reply = reply + "\n\nError: " + strings.TrimSpace(errMsg)
	}

	if m.ResponseCommentID != nil {
		_, err = db.Pool.Exec(ctx, `
			UPDATE issue_comments
			   SET body = $1
			 WHERE id = $2
		`, reply, *m.ResponseCommentID)
	} else {
		var responseCommentID string
		err = db.Pool.QueryRow(ctx, `
			INSERT INTO issue_comments (issue_id, author_agent_id, body)
			VALUES ($1, $2, $3)
			RETURNING id
		`, m.IssueID, m.AgentID, reply).Scan(&responseCommentID)
		if err == nil {
			_, err = db.Pool.Exec(ctx, `
				UPDATE tasks
				   SET response_comment_id = $1
				 WHERE id = $2
			`, responseCommentID, taskID)
		}
	}
	if err != nil {
		return err
	}

	issueStatus := "open"
	if status == "failed" {
		issueStatus = "open"
	}
	_, _ = db.Pool.Exec(ctx, `
		UPDATE issues
		   SET status = $1,
		       updated_at = NOW()
		 WHERE id = $2
	`, issueStatus, m.IssueID)

	ws.DefaultHub.BroadcastToWorkspace(wsID, ws.Message{
		Type: ws.TypeChatUpdated,
		Payload: map[string]string{
			"task_id":  taskID,
			"issue_id": m.IssueID,
			"agent_id": m.AgentID,
		},
	})
	return nil
}

func itoa(n int) string {
	return fmt.Sprintf("%d", n)
}
