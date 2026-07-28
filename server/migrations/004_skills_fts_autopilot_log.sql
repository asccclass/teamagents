-- Migration 004: Skills 全文索引 + Autopilot 輔助欄位

-- Skills 全文搜尋索引（PostgreSQL 內建 tsvector）
ALTER TABLE skills ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(description,'') || ' ' || coalesce(content,''))
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_skills_fts ON skills USING GIN(fts);

-- Autopilot webhook_secret（用於外部 Webhook 驗證）
ALTER TABLE autopilots ADD COLUMN IF NOT EXISTS webhook_secret TEXT;

-- Autopilot run log
CREATE TABLE IF NOT EXISTS autopilot_runs (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    autopilot_id UUID NOT NULL REFERENCES autopilots(id) ON DELETE CASCADE,
    issue_id     UUID REFERENCES issues(id),
    triggered_by TEXT NOT NULL DEFAULT 'cron', -- 'cron' | 'webhook' | 'manual'
    status       TEXT NOT NULL DEFAULT 'ok',   -- 'ok' | 'error'
    error_msg    TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_autopilot_runs_ap ON autopilot_runs(autopilot_id);
