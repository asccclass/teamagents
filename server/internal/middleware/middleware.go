package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/teamagents/server/internal/auth"
	"github.com/teamagents/server/internal/db"
	"github.com/teamagents/server/internal/respond"
)

type contextKey string

const (
	CtxUserID      contextKey = "user_id"
	CtxEmail       contextKey = "email"
	CtxWorkspaceID contextKey = "workspace_id"
)

// Authenticate 驗證 JWT，將 user 資訊放入 context
func Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			respond.Error(w, http.StatusUnauthorized, "缺少 Authorization header")
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
			respond.Error(w, http.StatusUnauthorized, "Authorization header 格式錯誤")
			return
		}

		claims, err := auth.ParseToken(parts[1])
		if err != nil {
			respond.Error(w, http.StatusUnauthorized, "token 無效或已過期")
			return
		}

		userID, err := auth.EnsureUserExists(r.Context(), claims.Email)
		if err != nil {
			respond.Error(w, http.StatusInternalServerError, "使用者身份同步失敗: "+err.Error())
			return
		}

		ctx := context.WithValue(r.Context(), CtxUserID, userID)
		ctx = context.WithValue(ctx, CtxEmail, claims.Email)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireWorkspace 確認用戶是工作區成員，將 workspace_id 放入 context
func RequireWorkspace(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := r.Context().Value(CtxUserID).(string)
		workspaceSlug := chi.URLParam(r, "workspace")

		var workspaceID string
		err := db.Pool.QueryRow(r.Context(),
			`SELECT w.id FROM workspaces w
			 JOIN workspace_members wm ON wm.workspace_id = w.id
			 WHERE w.slug = $1 AND wm.user_id = $2`,
			workspaceSlug, userID,
		).Scan(&workspaceID)

		if err != nil {
			respond.Error(w, http.StatusForbidden, "無工作區存取權限")
			return
		}

		ctx := context.WithValue(r.Context(), CtxWorkspaceID, workspaceID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetUserID 從 context 取得 user_id
func GetUserID(ctx context.Context) string {
	v, _ := ctx.Value(CtxUserID).(string)
	return v
}

// GetWorkspaceID 從 context 取得 workspace_id
func GetWorkspaceID(ctx context.Context) string {
	v, _ := ctx.Value(CtxWorkspaceID).(string)
	return v
}
