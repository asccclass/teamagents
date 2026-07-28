package db

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

var Pool *pgxpool.Pool

// Connect 建立連線池
func Connect(ctx context.Context, url string) error {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return fmt.Errorf("解析 DATABASE_URL 失敗: %w", err)
	}
	cfg.MaxConns = 20
	cfg.MinConns = 2

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return fmt.Errorf("建立連線池失敗: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("資料庫 ping 失敗: %w", err)
	}

	Pool = pool
	log.Println("✅ 資料庫連線成功")
	return nil
}

// Migrate 執行所有未套用的 migration
func Migrate(ctx context.Context) error {
	// 建立 migration 追蹤表
	_, err := Pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("建立 schema_migrations 失敗: %w", err)
	}

	// 取得已套用的 migrations
	rows, err := Pool.Query(ctx, "SELECT version FROM schema_migrations ORDER BY version")
	if err != nil {
		return fmt.Errorf("查詢 migrations 失敗: %w", err)
	}
	defer rows.Close()

	applied := map[string]bool{}
	for rows.Next() {
		var v string
		_ = rows.Scan(&v)
		applied[v] = true
	}

	// 讀取 migration 檔案
	migrationsDir := "migrations"
	entries, err := readMigrationFiles(migrationsDir)
	if err != nil {
		return err
	}

	// 依序套用
	for _, entry := range entries {
		version := strings.TrimSuffix(filepath.Base(entry), ".sql")
		if applied[version] {
			continue
		}

		content, err := os.ReadFile(entry)
		if err != nil {
			return fmt.Errorf("讀取 migration %s 失敗: %w", version, err)
		}

		log.Printf("🔄 套用 migration: %s", version)
		if _, err := Pool.Exec(ctx, string(content)); err != nil {
			return fmt.Errorf("執行 migration %s 失敗: %w", version, err)
		}

		if _, err := Pool.Exec(ctx,
			"INSERT INTO schema_migrations (version) VALUES ($1)", version,
		); err != nil {
			return fmt.Errorf("記錄 migration %s 失敗: %w", version, err)
		}
		log.Printf("✅ Migration %s 完成", version)
	}

	return nil
}

// readMigrationFiles 搜尋多個可能的 migrations 目錄位置
func readMigrationFiles(dir string) ([]string, error) {
	// 候選路徑：依序嘗試，找到有 .sql 的就用
	candidates := []string{
		dir,                                    // 直接傳入的路徑（e.g. "migrations"）
		filepath.Join("..", dir),               // 上一層
		filepath.Join("..", "..", dir),         // 再上一層（從 internal/db/ 往上）
	}

	// 也支援透過環境變數覆寫
	if envDir := os.Getenv("MIGRATIONS_DIR"); envDir != "" {
		candidates = append([]string{envDir}, candidates...)
	}

	for _, candidate := range candidates {
		entries, err := filepath.Glob(filepath.Join(candidate, "*.sql"))
		if err == nil && len(entries) > 0 {
			sort.Strings(entries)
			log.Printf("📁 使用 migrations 目錄: %s", candidate)
			return entries, nil
		}
	}

	return nil, fmt.Errorf(
		"找不到 migrations 目錄，嘗試過: %v\n"+
			"請設定環境變數 MIGRATIONS_DIR 指向正確路徑",
		candidates,
	)
}

// Close 關閉連線池
func Close() {
	if Pool != nil {
		Pool.Close()
	}
}
