ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS source_comment_id UUID REFERENCES issue_comments(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS response_comment_id UUID REFERENCES issue_comments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_source_comment ON tasks(source_comment_id);
CREATE INDEX IF NOT EXISTS idx_tasks_response_comment ON tasks(response_comment_id);
