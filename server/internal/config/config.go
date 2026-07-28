package config

import (
	"log"
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

type Config struct {
	// Server
	Port    string
	AppEnv  string
	AppURL  string
	APIBase string

	// Database
	DatabaseURL string

	// JWT
	JWTSecret     string
	JWTExpireHour int

	// Email (Resend)
	ResendAPIKey string
	FromEmail    string

	// OTP
	DevOTPCode string // 開發用固定驗證碼，production 忽略
}

var C Config

func Load() {
	// 嘗試載入 .env（不存在不報錯）
	_ = godotenv.Load()

	C = Config{
		Port:          getEnv("PORT", "8080"),
		AppEnv:        getEnv("APP_ENV", "development"),
		AppURL:        getEnv("APP_URL", "http://localhost:3000"),
		APIBase:       getEnv("API_BASE", "http://localhost:8080"),
		DatabaseURL:   mustGetEnv("DATABASE_URL"),
		JWTSecret:     mustGetEnv("JWT_SECRET"),
		JWTExpireHour: getEnvInt("JWT_EXPIRE_HOUR", 168), // 7 天
		ResendAPIKey:  getEnv("RESEND_API_KEY", ""),
		FromEmail:     getEnv("FROM_EMAIL", "noreply@teamagents.justdrink.com.tw"),
		DevOTPCode:    getEnv("DEV_OTP_CODE", ""),
	}
}

func IsDev() bool {
	return C.AppEnv == "development"
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func mustGetEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("環境變數 %s 未設定", key)
	}
	return v
}

func getEnvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	i, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return i
}
