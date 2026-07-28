-- ============================================================
-- TeamAgents — 初始 Schema
-- Migration 001: 核心資料表
-- ============================================================

-- pgvector 擴充（用於 Skills 向量搜尋）
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 1. USERS — 帳號
-- ============================================================
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email       TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    avatar_url  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. OTP_CODES — Email 一次性驗證碼
-- ============================================================
CREATE TABLE otp_codes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email       TEXT NOT NULL,
    code        TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    used        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_otp_email ON otp_codes(email);

-- ============================================================
-- 3. WORKSPACES — 工作區（多租戶隔離單位）
-- ============================================================
CREATE TABLE workspaces (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug        TEXT UNIQUE NOT NULL,          -- URL-friendly 名稱
    name        TEXT NOT NULL,
    owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);

-- ============================================================
-- 4. WORKSPACE_MEMBERS — 工作區成員
-- ============================================================
CREATE TABLE workspace_members (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'member', -- 'owner' | 'admin' | 'member'
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);

-- ============================================================
-- 5. RUNTIMES — Agent 執行環境（每台機器的 Daemon）
-- ============================================================
CREATE TABLE runtimes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    name            TEXT NOT NULL,
    hostname        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'offline', -- 'online' | 'offline'
    available_clis  TEXT[] NOT NULL DEFAULT '{}',    -- ['claude','codex','cursor-agent']
    last_ping_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_runtimes_workspace ON runtimes(workspace_id);

-- ============================================================
-- 6. AGENTS — AI Agent 定義（跨 Runtime 的邏輯實體）
-- ============================================================
CREATE TABLE agents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    runtime_id      UUID REFERENCES runtimes(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    provider        TEXT NOT NULL,    -- 'claude' | 'codex' | 'cursor-agent' | ...
    avatar_url      TEXT,
    system_prompt   TEXT,             -- 覆寫預設系統提示
    status          TEXT NOT NULL DEFAULT 'idle', -- 'idle' | 'busy' | 'offline'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agents_workspace ON agents(workspace_id);
CREATE INDEX idx_agents_runtime ON agents(runtime_id);

-- ============================================================
-- 7. ISSUES — 任務工單（類似 GitHub Issues）
-- ============================================================
CREATE TABLE issues (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    number          SERIAL,           -- 工作區內的序號
    title           TEXT NOT NULL,
    body            TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'open', -- 'open' | 'in_progress' | 'done' | 'cancelled'
    priority        TEXT NOT NULL DEFAULT 'medium', -- 'low' | 'medium' | 'high' | 'urgent'
    assignee_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    assignee_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    creator_id      UUID NOT NULL REFERENCES users(id),
    labels          TEXT[] NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at       TIMESTAMPTZ
);
CREATE INDEX idx_issues_workspace ON issues(workspace_id);
CREATE INDEX idx_issues_status ON issues(workspace_id, status);
CREATE INDEX idx_issues_agent ON issues(assignee_agent_id);

-- ============================================================
-- 8. ISSUE_COMMENTS — 工單留言（含 Agent 回覆）
-- ============================================================
CREATE TABLE issue_comments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    issue_id        UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    author_user_id  UUID REFERENCES users(id),
    author_agent_id UUID REFERENCES agents(id),
    body            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_comments_issue ON issue_comments(issue_id);

-- ============================================================
-- 9. TASKS — Agent 執行任務（一個 Issue 可有多個 Tasks）
-- ============================================================
CREATE TABLE tasks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    issue_id        UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    agent_id        UUID NOT NULL REFERENCES agents(id),
    runtime_id      UUID REFERENCES runtimes(id),
    status          TEXT NOT NULL DEFAULT 'queued',
                    -- 'queued' | 'claimed' | 'running' | 'done' | 'failed' | 'cancelled'
    exit_code       INT,
    stdout_log      TEXT,
    error_msg       TEXT,
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tasks_issue ON tasks(issue_id);
CREATE INDEX idx_tasks_agent ON tasks(agent_id);
CREATE INDEX idx_tasks_status ON tasks(status);

-- ============================================================
-- 10. SKILLS — 可重用技能庫
-- ============================================================
CREATE TABLE skills (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    content         TEXT NOT NULL,           -- SKILL.md 內容
    embedding       vector(1536),            -- OpenAI text-embedding-3-small 維度
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_skills_workspace ON skills(workspace_id);
-- 向量相似度索引（需 pgvector）
CREATE INDEX idx_skills_embedding ON skills USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- ============================================================
-- 11. AUTOPILOTS — 自動排程任務
-- ============================================================
CREATE TABLE autopilots (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    agent_id        UUID NOT NULL REFERENCES agents(id),
    cron_expr       TEXT,            -- cron 表達式，null 表示 webhook-only
    issue_template  JSONB NOT NULL DEFAULT '{}', -- 自動建立 Issue 的模板
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_autopilots_workspace ON autopilots(workspace_id);

-- ============================================================
-- 12. 更新時間觸發器
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_workspaces_updated_at
    BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_agents_updated_at
    BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_issues_updated_at
    BEFORE UPDATE ON issues FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_tasks_updated_at
    BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_skills_updated_at
    BEFORE UPDATE ON skills FOR EACH ROW EXECUTE FUNCTION update_updated_at();
