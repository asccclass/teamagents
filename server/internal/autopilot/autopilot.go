package autopilot

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/teamagents/server/internal/db"
	"github.com/teamagents/server/internal/middleware"
	"github.com/teamagents/server/internal/respond"
)

type Autopilot struct {
	ID            string          `json:"id"`
	WorkspaceID   string          `json:"workspace_id"`
	Name          string          `json:"name"`
	AgentID       string          `json:"agent_id"`
	CronExpr      *string         `json:"cron_expr"`
	IssueTemplate json.RawMessage `json:"issue_template"`
	Enabled       bool            `json:"enabled"`
	LastRunAt     *time.Time      `json:"last_run_at"`
	CreatedAt     time.Time       `json:"created_at"`
}

// GET /api/w/{workspace}/autopilots
func HandleList(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())

	rows, err := db.Pool.Query(r.Context(),
		`SELECT id, workspace_id, name, agent_id, cron_expr,
		        issue_template, enabled, last_run_at, created_at
		 FROM autopilots WHERE workspace_id=$1 ORDER BY created_at DESC`,
		wsID,
	)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "查詢失敗")
		return
	}
	defer rows.Close()

	var list []Autopilot
	for rows.Next() {
		var ap Autopilot
		if err := rows.Scan(&ap.ID, &ap.WorkspaceID, &ap.Name, &ap.AgentID,
			&ap.CronExpr, &ap.IssueTemplate, &ap.Enabled, &ap.LastRunAt, &ap.CreatedAt,
		); err != nil {
			continue
		}
		list = append(list, ap)
	}
	if list == nil {
		list = []Autopilot{}
	}
	respond.JSON(w, http.StatusOK, list)
}

// POST /api/w/{workspace}/autopilots
func HandleCreate(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())

	var body struct {
		Name          string          `json:"name"`
		AgentID       string          `json:"agent_id"`
		CronExpr      *string         `json:"cron_expr"`
		IssueTemplate json.RawMessage `json:"issue_template"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "JSON 格式錯誤")
		return
	}

	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" || body.AgentID == "" {
		respond.Error(w, http.StatusBadRequest, "name 和 agent_id 為必填")
		return
	}
	if body.CronExpr != nil {
		if err := validateCron(*body.CronExpr); err != nil {
			respond.Error(w, http.StatusBadRequest, "cron_expr 格式錯誤: "+err.Error())
			return
		}
	}
	if body.IssueTemplate == nil {
		body.IssueTemplate = json.RawMessage(`{}`)
	}

	var ap Autopilot
	err := db.Pool.QueryRow(r.Context(),
		`INSERT INTO autopilots (workspace_id, name, agent_id, cron_expr, issue_template)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, workspace_id, name, agent_id, cron_expr,
		           issue_template, enabled, last_run_at, created_at`,
		wsID, body.Name, body.AgentID, body.CronExpr, body.IssueTemplate,
	).Scan(&ap.ID, &ap.WorkspaceID, &ap.Name, &ap.AgentID, &ap.CronExpr,
		&ap.IssueTemplate, &ap.Enabled, &ap.LastRunAt, &ap.CreatedAt,
	)
	if err != nil {
		respond.Error(w, http.StatusInternalServerError, "建立 Autopilot 失敗: "+err.Error())
		return
	}

	// 若有 cron，立即加入排程器
	if ap.CronExpr != nil {
		DefaultScheduler.Add(ap)
	}

	respond.JSON(w, http.StatusCreated, ap)
}

// PATCH /api/w/{workspace}/autopilots/{id} — 啟用/停用
func HandleToggle(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	id := chi.URLParam(r, "id")

	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "JSON 格式錯誤")
		return
	}

	ct, err := db.Pool.Exec(r.Context(),
		"UPDATE autopilots SET enabled=$1 WHERE id=$2 AND workspace_id=$3",
		body.Enabled, id, wsID,
	)
	if err != nil || ct.RowsAffected() == 0 {
		respond.Error(w, http.StatusNotFound, "Autopilot 不存在")
		return
	}
	respond.NoContent(w)
}

// DELETE /api/w/{workspace}/autopilots/{id}
func HandleDelete(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	id := chi.URLParam(r, "id")

	ct, err := db.Pool.Exec(r.Context(),
		"DELETE FROM autopilots WHERE id=$1 AND workspace_id=$2", id, wsID,
	)
	if err != nil || ct.RowsAffected() == 0 {
		respond.Error(w, http.StatusNotFound, "Autopilot 不存在")
		return
	}
	DefaultScheduler.Remove(id)
	respond.NoContent(w)
}

// POST /api/w/{workspace}/autopilots/{id}/trigger — Webhook 手動觸發
func HandleTrigger(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.GetWorkspaceID(r.Context())
	id := chi.URLParam(r, "id")

	var ap Autopilot
	err := db.Pool.QueryRow(r.Context(),
		`SELECT id, workspace_id, name, agent_id, cron_expr,
		        issue_template, enabled, last_run_at, created_at
		 FROM autopilots WHERE id=$1 AND workspace_id=$2`,
		id, wsID,
	).Scan(&ap.ID, &ap.WorkspaceID, &ap.Name, &ap.AgentID, &ap.CronExpr,
		&ap.IssueTemplate, &ap.Enabled, &ap.LastRunAt, &ap.CreatedAt,
	)
	if err != nil {
		respond.Error(w, http.StatusNotFound, "Autopilot 不存在")
		return
	}

	go fireAutopilot(context.Background(), ap)
	respond.JSON(w, http.StatusOK, map[string]string{"message": "已觸發"})
}

// ──────────────────────────────────────────
// Cron 排程器
// ──────────────────────────────────────────

type Scheduler struct {
	mu      sync.Mutex
	entries map[string]*schedEntry
}

type schedEntry struct {
	ap     Autopilot
	cancel context.CancelFunc
}

var DefaultScheduler = &Scheduler{
	entries: make(map[string]*schedEntry),
}

// StartAll 從資料庫載入所有啟用的 Autopilot 並啟動排程
func StartAll(ctx context.Context) {
	rows, err := db.Pool.Query(ctx,
		`SELECT id, workspace_id, name, agent_id, cron_expr,
		        issue_template, enabled, last_run_at, created_at
		 FROM autopilots WHERE enabled=TRUE AND cron_expr IS NOT NULL`,
	)
	if err != nil {
		log.Printf("⚠️  載入 Autopilots 失敗: %v", err)
		return
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var ap Autopilot
		if err := rows.Scan(&ap.ID, &ap.WorkspaceID, &ap.Name, &ap.AgentID, &ap.CronExpr,
			&ap.IssueTemplate, &ap.Enabled, &ap.LastRunAt, &ap.CreatedAt,
		); err != nil {
			continue
		}
		DefaultScheduler.Add(ap)
		count++
	}
	log.Printf("⏰ 已啟動 %d 個 Autopilot 排程", count)
}

func (s *Scheduler) Add(ap Autopilot) {
	if ap.CronExpr == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	// 若已存在，先停止舊的
	if old, ok := s.entries[ap.ID]; ok {
		old.cancel()
	}

	ctx, cancel := context.WithCancel(context.Background())
	s.entries[ap.ID] = &schedEntry{ap: ap, cancel: cancel}
	go s.runLoop(ctx, ap)
	log.Printf("⏰ 排程啟動: %s (cron=%s)", ap.Name, *ap.CronExpr)
}

func (s *Scheduler) Remove(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e, ok := s.entries[id]; ok {
		e.cancel()
		delete(s.entries, id)
	}
}

// runLoop 簡易 cron 迴圈（解析 @every Xs / @daily 格式）
func (s *Scheduler) runLoop(ctx context.Context, ap Autopilot) {
	interval := parseCronInterval(*ap.CronExpr)
	if interval <= 0 {
		log.Printf("⚠️  無法解析 cron: %s，使用 1 小時間隔", *ap.CronExpr)
		interval = time.Hour
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// 確認仍啟用
			var enabled bool
			db.Pool.QueryRow(ctx,
				"SELECT enabled FROM autopilots WHERE id=$1", ap.ID,
			).Scan(&enabled)
			if !enabled {
				return
			}
			fireAutopilot(ctx, ap)
		}
	}
}

// fireAutopilot 根據 issue_template 建立 Issue 並觸發任務
func fireAutopilot(ctx context.Context, ap Autopilot) {
	log.Printf("🚀 Autopilot 觸發: %s", ap.Name)

	// 解析 issue_template
	var tmpl struct {
		Title    string   `json:"title"`
		Body     string   `json:"body"`
		Priority string   `json:"priority"`
		Labels   []string `json:"labels"`
	}
	_ = json.Unmarshal(ap.IssueTemplate, &tmpl)

	if tmpl.Title == "" {
		tmpl.Title = ap.Name + " — 自動觸發 " + time.Now().Format("2006-01-02 15:04")
	}
	if tmpl.Priority == "" {
		tmpl.Priority = "medium"
	}

	// 建立 Issue
	var issueID string
	err := db.Pool.QueryRow(ctx,
		`INSERT INTO issues (workspace_id, title, body, priority, assignee_agent_id, creator_id, labels)
		 SELECT $1, $2, $3, $4, $5, owner_id, $6 FROM workspaces WHERE id=$1
		 RETURNING id`,
		ap.WorkspaceID, tmpl.Title, tmpl.Body, tmpl.Priority,
		ap.AgentID, tmpl.Labels,
	).Scan(&issueID)
	if err != nil {
		log.Printf("❌ Autopilot 建立 Issue 失敗: %v", err)
		return
	}

	// 建立 Task
	_, err = db.Pool.Exec(ctx,
		`INSERT INTO tasks (issue_id, agent_id, status)
		 VALUES ($1, $2, 'queued')`,
		issueID, ap.AgentID,
	)
	if err != nil {
		log.Printf("❌ Autopilot 建立 Task 失敗: %v", err)
		return
	}

	// 更新 last_run_at
	db.Pool.Exec(ctx,
		"UPDATE autopilots SET last_run_at=NOW() WHERE id=$1", ap.ID,
	)
	log.Printf("✅ Autopilot 完成: issue=%s", issueID)
}

// ──────────────────────────────────────────
// Cron 解析工具
// ──────────────────────────────────────────

func parseCronInterval(expr string) time.Duration {
	expr = strings.TrimSpace(strings.ToLower(expr))
	switch expr {
	case "@hourly":
		return time.Hour
	case "@daily", "@midnight":
		return 24 * time.Hour
	case "@weekly":
		return 7 * 24 * time.Hour
	}
	// @every 30m, @every 2h, @every 1h30m
	if strings.HasPrefix(expr, "@every ") {
		d, err := time.ParseDuration(strings.TrimPrefix(expr, "@every "))
		if err == nil {
			return d
		}
	}
	return 0
}

func validateCron(expr string) error {
	expr = strings.TrimSpace(strings.ToLower(expr))
	validPrefixes := []string{"@hourly", "@daily", "@midnight", "@weekly", "@every "}
	for _, p := range validPrefixes {
		if strings.HasPrefix(expr, p) {
			if p == "@every " {
				rest := strings.TrimPrefix(expr, p)
				if _, err := time.ParseDuration(rest); err != nil {
					return err
				}
			}
			return nil
		}
	}
	return nil // 允許其他格式（未來擴充標準 5-field cron）
}
