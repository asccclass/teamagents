package auth

import (
	"context"
	"crypto/rand"
	"fmt"
	"log"
	"math/big"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/teamagents/server/internal/config"
	"github.com/teamagents/server/internal/db"
)

// ──────────────────────────────────────────
// JWT
// ──────────────────────────────────────────

type Claims struct {
	UserID string `json:"user_id"`
	Email  string `json:"email"`
	jwt.RegisteredClaims
}

// GenerateToken 產生 JWT
func GenerateToken(userID, email string) (string, error) {
	exp := time.Duration(config.C.JWTExpireHour) * time.Hour
	claims := Claims{
		UserID: userID,
		Email:  email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(exp)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(config.C.JWTSecret))
}

// ParseToken 解析並驗證 JWT
func ParseToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{},
		func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("非預期的簽名方法: %v", t.Header["alg"])
			}
			return []byte(config.C.JWTSecret), nil
		},
	)
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("token 無效")
	}
	return claims, nil
}

// ──────────────────────────────────────────
// OTP（Email 驗證碼）
// ──────────────────────────────────────────

// SendOTP 產生 6 位數驗證碼並儲存（開發模式印到 log）
func SendOTP(ctx context.Context, email string) error {
	code, err := generateOTP()
	if err != nil {
		return err
	}

	// 開發模式：使用固定驗證碼或印到 log
	if config.IsDev() {
		if config.C.DevOTPCode != "" {
			code = config.C.DevOTPCode
		}
		log.Printf("🔐 [DEV] OTP for %s: %s", email, code)
	}

	// 將舊的未使用 OTP 作廢
	_, _ = db.Pool.Exec(ctx,
		"UPDATE otp_codes SET used=TRUE WHERE email=$1 AND used=FALSE",
		email,
	)

	// 儲存新 OTP（5 分鐘有效）
	_, err = db.Pool.Exec(ctx,
		`INSERT INTO otp_codes (email, code, expires_at)
		 VALUES ($1, $2, NOW() + INTERVAL '5 minutes')`,
		email, code,
	)
	if err != nil {
		return fmt.Errorf("儲存 OTP 失敗: %w", err)
	}

	// Production：透過 Resend 發送 Email
	if !config.IsDev() && config.C.ResendAPIKey != "" {
		if err := sendEmail(email, code); err != nil {
			log.Printf("⚠️ Email 發送失敗: %v", err)
			// 不阻斷流程，讓用戶從 log 取得驗證碼
		}
	}

	return nil
}

// VerifyOTP 驗證 OTP 並返回（或建立）User
func VerifyOTP(ctx context.Context, email, code string) (userID string, token string, err error) {
	var otpID uuid.UUID
	err = db.Pool.QueryRow(ctx,
		`SELECT id FROM otp_codes
		 WHERE email=$1 AND code=$2 AND used=FALSE AND expires_at > NOW()
		 ORDER BY created_at DESC LIMIT 1`,
		email, code,
	).Scan(&otpID)
	if err == pgx.ErrNoRows {
		return "", "", fmt.Errorf("驗證碼錯誤或已過期")
	}
	if err != nil {
		return "", "", fmt.Errorf("查詢 OTP 失敗: %w", err)
	}

	// 標記已使用
	_, _ = db.Pool.Exec(ctx,
		"UPDATE otp_codes SET used=TRUE WHERE id=$1", otpID,
	)

	// Upsert user（第一次登入自動建帳）
	var uid uuid.UUID
	err = db.Pool.QueryRow(ctx,
		`INSERT INTO users (email, name)
		 VALUES ($1, $2)
		 ON CONFLICT (email) DO UPDATE SET updated_at=NOW()
		 RETURNING id`,
		email, emailToName(email),
	).Scan(&uid)
	if err != nil {
		return "", "", fmt.Errorf("建立帳號失敗: %w", err)
	}

	t, err := GenerateToken(uid.String(), email)
	if err != nil {
		return "", "", fmt.Errorf("產生 token 失敗: %w", err)
	}

	return uid.String(), t, nil
}

// ──────────────────────────────────────────
// 內部工具
// ──────────────────────────────────────────

func generateOTP() (string, error) {
	digits := ""
	for i := 0; i < 6; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", err
		}
		digits += n.String()
	}
	return digits, nil
}

func emailToName(email string) string {
	for i, c := range email {
		if c == '@' {
			return email[:i]
		}
	}
	return email
}

// sendEmail 透過 Resend API 發送驗證信
func sendEmail(to, code string) error {
	// TODO: 實作 Resend API 呼叫
	// POST https://api.resend.com/emails
	// Header: Authorization: Bearer {RESEND_API_KEY}
	log.Printf("📧 [TODO] 發送 OTP Email 到 %s, code: %s", to, code)
	return nil
}
