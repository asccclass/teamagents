package auth

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/teamagents/server/internal/respond"
)

// ──────────────────────────────────────────
// POST /api/auth/send-otp
// Body: { "email": "user@example.com" }
// ──────────────────────────────────────────

func HandleSendOTP(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "JSON 格式錯誤")
		return
	}

	email := strings.TrimSpace(strings.ToLower(body.Email))
	if email == "" || !strings.Contains(email, "@") {
		respond.Error(w, http.StatusBadRequest, "Email 格式不正確")
		return
	}

	if err := SendOTP(r.Context(), email); err != nil {
		respond.Error(w, http.StatusInternalServerError, "發送驗證碼失敗")
		return
	}

	respond.JSON(w, http.StatusOK, map[string]string{
		"message": "驗證碼已發送至 " + email,
	})
}

// ──────────────────────────────────────────
// POST /api/auth/verify-otp
// Body: { "email": "...", "code": "123456" }
// Response: { "token": "...", "user_id": "..." }
// ──────────────────────────────────────────

func HandleVerifyOTP(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond.Error(w, http.StatusBadRequest, "JSON 格式錯誤")
		return
	}

	email := strings.TrimSpace(strings.ToLower(body.Email))
	code := strings.TrimSpace(body.Code)

	if email == "" || code == "" {
		respond.Error(w, http.StatusBadRequest, "email 和 code 為必填")
		return
	}

	userID, token, err := VerifyOTP(r.Context(), email, code)
	if err != nil {
		respond.Error(w, http.StatusUnauthorized, err.Error())
		return
	}

	respond.JSON(w, http.StatusOK, map[string]string{
		"token":   token,
		"user_id": userID,
	})
}

// ──────────────────────────────────────────
// GET /api/auth/me  (需要 JWT)
// ──────────────────────────────────────────

func HandleMe(w http.ResponseWriter, r *http.Request) {
	// user_id 和 email 已由 middleware 注入 context
	userID := r.Context().Value("user_id")
	email := r.Context().Value("email")

	respond.JSON(w, http.StatusOK, map[string]any{
		"user_id": userID,
		"email":   email,
	})
}
