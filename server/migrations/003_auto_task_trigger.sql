-- Migration 003: 自動建立 Task 觸發器
-- 當 Issue 指派給 Agent 時，自動建立一筆 queued Task

CREATE OR REPLACE FUNCTION auto_create_task_on_assign()
RETURNS TRIGGER AS $$
BEGIN
    -- 只在 assignee_agent_id 從 NULL 變成有值時觸發
    IF NEW.assignee_agent_id IS NOT NULL
       AND (OLD.assignee_agent_id IS NULL OR OLD.assignee_agent_id != NEW.assignee_agent_id)
    THEN
        -- 取消先前未完成的任務
        UPDATE tasks
           SET status = 'cancelled'
         WHERE issue_id = NEW.id
           AND status IN ('queued', 'claimed');

        -- 找出 agent 對應的 runtime
        INSERT INTO tasks (issue_id, agent_id, runtime_id, status)
        SELECT NEW.id,
               NEW.assignee_agent_id,
               a.runtime_id,
               'queued'
          FROM agents a
         WHERE a.id = NEW.assignee_agent_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_task_on_assign
    AFTER UPDATE ON issues
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_task_on_assign();

-- 也處理 INSERT（建立 Issue 時直接指派）
CREATE OR REPLACE FUNCTION auto_create_task_on_insert()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.assignee_agent_id IS NOT NULL THEN
        INSERT INTO tasks (issue_id, agent_id, runtime_id, status)
        SELECT NEW.id,
               NEW.assignee_agent_id,
               a.runtime_id,
               'queued'
          FROM agents a
         WHERE a.id = NEW.assignee_agent_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_task_on_insert
    AFTER INSERT ON issues
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_task_on_insert();
