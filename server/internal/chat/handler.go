package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/teamagents/server/internal/db"
	"github.com/teamagents/server/internal/middleware"
	"github.com/teamagents/server/internal/respond"
	"github.com/teamagents/server/internal/ws"
)

const (
	labelChatThread = "chat-thread"
	labelChatActive = "chat-active"
)

type Thread struct {
	Issue        *ThreadIssue    `json:"issue"`
	Comments     []ThreadComment `json:"comments"`
	PendingTasks []PendingTask   `json:"pending_tasks"`
}

type ThreadIssue struct {
	ID        string    `json:"id"`
	Number    int       `json:"number"`
	Title     string    `json:"title"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ThreadComment struct {
	ID            string    `json:"id"`
	Body          string    `json:"body"`
	AuthorUserID  *string   `json:"author_user_id"`
	AuthorAgentID *string   `json:"author_agent_id"`
	CreatedAt     time.Time `json:"created_at"`
}

type PendingTask struct {
	ID              string     `json:"id"`
	Status          string     `json:"status"`
	CreatedAt       time.Time  `json:"created_at"`
	StartedAt       *time.Time `json:"started_at"`
	FinishedAt      *time.Time `json:"finished_at"`
	SourceCommentID *string    `json:"source_comment_id"`
}

func HandleGetThread(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	userID := middleware.GetUserID(r.Context())
	agentID := chi.URLParam(r, "id")

	thread, err := loadThread(r.Context(), wsID, userID, agentID)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to load chat thread")
		return
	}
	respond.JSON(w, http.StatusOK, thread)
}

func HandleSendMessage(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	userID := middleware.GetUserID(r.Context())
	agentID := chi.URLParam(r, "id")

	var body struct {
		Message string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	message := strings.TrimSpace(body.Message)
	if message == "" {
		respond.Error(w, http.StatusBadRequest, "message is required")
		return
	}

	tx, err := db.Pool.Begin(r.Context())
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to start chat transaction")
		return
	}
	defer tx.Rollback(r.Context())

	issueID, err := ensureThread(r.Context(), tx, wsID, userID, agentID, false)
	if err != nil {
		handleThreadError(w, err)
		return
	}

	var commentID string
	if err := tx.QueryRow(r.Context(), `
		INSERT INTO issue_comments (issue_id, author_user_id, body)
		VALUES ($1, $2, $3)
		RETURNING id
	`, issueID, userID, message).Scan(&commentID); err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to save chat message")
		return
	}

	var runtimeID *string
	if err := tx.QueryRow(r.Context(), "SELECT runtime_id FROM agents WHERE id=$1 AND workspace_id=$2", agentID, wsID).Scan(&runtimeID); err != nil {
		respond.Error(w, http.StatusNotFound, "agent not found")
		return
	}

	var taskID string
	if err := tx.QueryRow(r.Context(), `
		INSERT INTO tasks (issue_id, agent_id, runtime_id, status, source_comment_id)
		VALUES ($1, $2, $3, 'queued', $4)
		RETURNING id
	`, issueID, agentID, runtimeID, commentID).Scan(&taskID); err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to queue chat task")
		return
	}

	if _, err := tx.Exec(r.Context(), `
		UPDATE issues
		   SET status='in_progress',
		       updated_at=NOW()
		 WHERE id=$1
	`, issueID); err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to update chat thread")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to commit chat message")
		return
	}

	broadcastThreadUpdate(wsID, agentID, issueID, taskID)

	thread, err := loadThread(r.Context(), wsID, userID, agentID)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "chat message queued but thread reload failed")
		return
	}
	respond.JSON(w, http.StatusCreated, thread)
}

func HandleClearThread(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	userID := middleware.GetUserID(r.Context())
	agentID := chi.URLParam(r, "id")

	threadInfo, err := findThreadMeta(r.Context(), wsID, userID, agentID)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to find chat thread")
		return
	}
	if threadInfo == nil {
		respond.JSON(w, http.StatusOK, Thread{Comments: []ThreadComment{}, PendingTasks: []PendingTask{}})
		return
	}

	if _, err := db.Pool.Exec(r.Context(), `
		DELETE FROM issues
		 WHERE id = $1
		   AND workspace_id = $2
	`, threadInfo.ID, wsID); err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to clear chat thread")
		return
	}

	broadcastThreadUpdate(wsID, agentID, "", "")
	respond.JSON(w, http.StatusOK, Thread{Comments: []ThreadComment{}, PendingTasks: []PendingTask{}})
}

func HandleNewThread(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	userID := middleware.GetUserID(r.Context())
	agentID := chi.URLParam(r, "id")

	tx, err := db.Pool.Begin(r.Context())
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to start chat transaction")
		return
	}
	defer tx.Rollback(r.Context())

	issueID, err := ensureThread(r.Context(), tx, wsID, userID, agentID, true)
	if err != nil {
		handleThreadError(w, err)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		respond.Error(w, http.StatusInternalServerError, "failed to create new thread")
		return
	}

	broadcastThreadUpdate(wsID, agentID, issueID, "")

	thread, err := loadThread(r.Context(), wsID, userID, agentID)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "new thread created but reload failed")
		return
	}
	respond.JSON(w, http.StatusCreated, thread)
}

type threadMeta struct {
	ID       string
	IsActive bool
}

func loadThread(ctx context.Context, wsID, userID, agentID string) (Thread, error) {
	var thread Thread

	threadInfo, err := findThreadMeta(ctx, wsID, userID, agentID)
	if err != nil {
		return thread, err
	}
	if threadInfo == nil {
		thread.Comments = []ThreadComment{}
		thread.PendingTasks = []PendingTask{}
		return thread, nil
	}

	var issue ThreadIssue
	err = db.Pool.QueryRow(ctx, `
		SELECT id, number, title, status, created_at, updated_at
		  FROM issues
		 WHERE id = $1
	`, threadInfo.ID).Scan(
		&issue.ID, &issue.Number, &issue.Title, &issue.Status, &issue.CreatedAt, &issue.UpdatedAt,
	)
	if err != nil {
		return thread, err
	}
	thread.Issue = &issue

	commentRows, err := db.Pool.Query(ctx, `
		SELECT id, body, author_user_id, author_agent_id, created_at
		  FROM issue_comments
		 WHERE issue_id = $1
		 ORDER BY created_at ASC
	`, issue.ID)
	if err != nil {
		return thread, err
	}
	defer commentRows.Close()

	for commentRows.Next() {
		var item ThreadComment
		if err := commentRows.Scan(&item.ID, &item.Body, &item.AuthorUserID, &item.AuthorAgentID, &item.CreatedAt); err != nil {
			return thread, err
		}
		thread.Comments = append(thread.Comments, item)
	}
	if thread.Comments == nil {
		thread.Comments = []ThreadComment{}
	}

	taskRows, err := db.Pool.Query(ctx, `
		SELECT id, status, created_at, started_at, finished_at, source_comment_id
		  FROM tasks
		 WHERE issue_id = $1
		   AND status IN ('queued', 'claimed', 'running')
		 ORDER BY created_at ASC
	`, issue.ID)
	if err != nil {
		return thread, err
	}
	defer taskRows.Close()

	for taskRows.Next() {
		var item PendingTask
		if err := taskRows.Scan(&item.ID, &item.Status, &item.CreatedAt, &item.StartedAt, &item.FinishedAt, &item.SourceCommentID); err != nil {
			return thread, err
		}
		thread.PendingTasks = append(thread.PendingTasks, item)
	}
	if thread.PendingTasks == nil {
		thread.PendingTasks = []PendingTask{}
	}

	return thread, nil
}

func findThreadMeta(ctx context.Context, wsID, userID, agentID string) (*threadMeta, error) {
	var active threadMeta
	err := db.Pool.QueryRow(ctx, `
		SELECT id, TRUE
		  FROM issues
		 WHERE workspace_id = $1
		   AND creator_id = $2
		   AND assignee_agent_id = $3
		   AND labels @> ARRAY[$4, $5, $6]::text[]
		 ORDER BY updated_at DESC
		 LIMIT 1
	`, wsID, userID, agentID, labelChatThread, labelChatActive, "chat-agent:"+agentID).Scan(&active.ID, &active.IsActive)
	if err == nil {
		return &active, nil
	}
	if err != pgx.ErrNoRows {
		return nil, err
	}

	var latest threadMeta
	err = db.Pool.QueryRow(ctx, `
		SELECT id, FALSE
		  FROM issues
		 WHERE workspace_id = $1
		   AND creator_id = $2
		   AND assignee_agent_id = $3
		   AND labels @> ARRAY[$4, $5]::text[]
		 ORDER BY updated_at DESC
		 LIMIT 1
	`, wsID, userID, agentID, labelChatThread, "chat-agent:"+agentID).Scan(&latest.ID, &latest.IsActive)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &latest, nil
}

func ensureThread(ctx context.Context, tx pgx.Tx, wsID, userID, agentID string, forceNew bool) (string, error) {
	if forceNew {
		if _, err := tx.Exec(ctx, `
			UPDATE issues
			   SET labels = array_remove(labels, $1),
			       status = CASE WHEN status IN ('open','in_progress') THEN 'done' ELSE status END,
			       updated_at = NOW()
			 WHERE workspace_id = $2
			   AND creator_id = $3
			   AND assignee_agent_id = $4
			   AND labels @> ARRAY[$1, $5, $6]::text[]
		`, labelChatActive, wsID, userID, agentID, labelChatThread, "chat-agent:"+agentID); err != nil {
			return "", err
		}
		return createThread(ctx, tx, wsID, userID, agentID)
	}

	var issueID string
	err := tx.QueryRow(ctx, `
		SELECT id
		  FROM issues
		 WHERE workspace_id = $1
		   AND creator_id = $2
		   AND assignee_agent_id = $3
		   AND labels @> ARRAY[$4, $5, $6]::text[]
		 ORDER BY updated_at DESC
		 LIMIT 1
	`, wsID, userID, agentID, labelChatThread, labelChatActive, "chat-agent:"+agentID).Scan(&issueID)
	if err == nil {
		return issueID, nil
	}
	if err != pgx.ErrNoRows {
		return "", err
	}

	err = tx.QueryRow(ctx, `
		SELECT id
		  FROM issues
		 WHERE workspace_id = $1
		   AND creator_id = $2
		   AND assignee_agent_id = $3
		   AND labels @> ARRAY[$4, $5]::text[]
		 ORDER BY updated_at DESC
		 LIMIT 1
	`, wsID, userID, agentID, labelChatThread, "chat-agent:"+agentID).Scan(&issueID)
	if err == nil {
		_, err = tx.Exec(ctx, `
			UPDATE issues
			   SET labels = CASE WHEN NOT labels @> ARRAY[$1]::text[] THEN array_append(labels, $1) ELSE labels END,
			       updated_at = NOW()
			 WHERE id = $2
		`, labelChatActive, issueID)
		return issueID, err
	}
	if err != pgx.ErrNoRows {
		return "", err
	}

	return createThread(ctx, tx, wsID, userID, agentID)
}

func createThread(ctx context.Context, tx pgx.Tx, wsID, userID, agentID string) (string, error) {
	var title string
	if err := tx.QueryRow(ctx, "SELECT name FROM agents WHERE id=$1 AND workspace_id=$2", agentID, wsID).Scan(&title); err != nil {
		return "", err
	}

	var issueID string
	err := tx.QueryRow(ctx, `
		INSERT INTO issues (workspace_id, title, body, priority, assignee_agent_id, creator_id, labels, status)
		VALUES ($1, $2, '', 'medium', $3, $4, $5, 'open')
		RETURNING id
	`, wsID, "Chat with "+title, agentID, userID, []string{labelChatThread, labelChatActive, "chat-agent:" + agentID}).Scan(&issueID)
	return issueID, err
}

func broadcastThreadUpdate(wsID, agentID, issueID, taskID string) {
	ws.DefaultHub.BroadcastToWorkspace(wsID, ws.Message{
		Type: ws.TypeChatUpdated,
		Payload: map[string]string{
			"agent_id": agentID,
			"issue_id": issueID,
			"task_id":  taskID,
		},
	})
	if taskID != "" {
		ws.DefaultHub.BroadcastToWorkspace(wsID, ws.Message{
			Type:    ws.TypeTaskStatus,
			Payload: map[string]any{"task_id": taskID, "status": "queued"},
		})
	}
}

func handleThreadError(w http.ResponseWriter, err error) {
	if err == pgx.ErrNoRows {
		respond.Error(w, http.StatusNotFound, "agent not found")
		return
	}
	respond.Error(w, http.StatusInternalServerError, "failed to prepare chat thread")
}
