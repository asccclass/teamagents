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

	var issueID string
	if err := tx.QueryRow(r.Context(), `
		SELECT id
		  FROM issues
		 WHERE workspace_id = $1
		   AND creator_id = $2
		   AND assignee_agent_id = $3
		   AND labels @> ARRAY[$4, $5]::text[]
		 ORDER BY updated_at DESC
		 LIMIT 1
	`, wsID, userID, agentID, "chat-thread", "chat-agent:"+agentID).Scan(&issueID); err != nil {
		if err != pgx.ErrNoRows {
			respond.Error(w, http.StatusInternalServerError, "failed to find chat thread")
			return
		}

		var title string
		if err := tx.QueryRow(r.Context(), "SELECT name FROM agents WHERE id=$1 AND workspace_id=$2", agentID, wsID).Scan(&title); err != nil {
			respond.Error(w, http.StatusNotFound, "agent not found")
			return
		}

		if err := tx.QueryRow(r.Context(), `
			INSERT INTO issues (workspace_id, title, body, priority, assignee_agent_id, creator_id, labels, status)
			VALUES ($1, $2, '', 'medium', $3, $4, $5, 'open')
			RETURNING id
		`, wsID, "Chat with "+title, agentID, userID, []string{"chat-thread", "chat-agent:" + agentID}).Scan(&issueID); err != nil {
			respond.Error(w, http.StatusInternalServerError, "failed to create chat thread")
			return
		}
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

	ws.DefaultHub.BroadcastToWorkspace(wsID, ws.Message{
		Type: ws.TypeChatUpdated,
		Payload: map[string]string{
			"agent_id": agentID,
			"issue_id": issueID,
			"task_id":  taskID,
		},
	})
	ws.DefaultHub.BroadcastToWorkspace(wsID, ws.Message{
		Type:    ws.TypeTaskStatus,
		Payload: map[string]any{"task_id": taskID, "status": "queued"},
	})

	thread, err := loadThread(r.Context(), wsID, userID, agentID)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "chat message queued but thread reload failed")
		return
	}
	respond.JSON(w, http.StatusCreated, thread)
}

func loadThread(ctx context.Context, wsID, userID, agentID string) (Thread, error) {
	var thread Thread

	var issue ThreadIssue
	err := db.Pool.QueryRow(ctx, `
		SELECT id, number, title, status, created_at, updated_at
		  FROM issues
		 WHERE workspace_id = $1
		   AND creator_id = $2
		   AND assignee_agent_id = $3
		   AND labels @> ARRAY[$4, $5]::text[]
		 ORDER BY updated_at DESC
		 LIMIT 1
	`, wsID, userID, agentID, "chat-thread", "chat-agent:"+agentID).Scan(
		&issue.ID, &issue.Number, &issue.Title, &issue.Status, &issue.CreatedAt, &issue.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		thread.Comments = []ThreadComment{}
		thread.PendingTasks = []PendingTask{}
		return thread, nil
	}
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
