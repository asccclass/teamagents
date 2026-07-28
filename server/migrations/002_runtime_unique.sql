-- Migration 002: Runtime unique constraint
-- 同一 workspace 的同一個 user 在同一台 hostname 只能有一筆 runtime
ALTER TABLE runtimes
    ADD CONSTRAINT uq_runtimes_workspace_user_hostname
    UNIQUE (workspace_id, user_id, hostname);
