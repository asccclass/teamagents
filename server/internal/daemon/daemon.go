package daemon

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ──────────────────────────────────────────
// 支援的 AI CLI 定義
// ──────────────────────────────────────────

type CLIProvider struct {
	Name    string   // provider ID（對應 agents.provider 欄位）
	Bins    []string // 可能的 binary 名稱
	TestArg string   // 用來測試是否安裝的參數
}

var knownCLIs = []CLIProvider{
	{Name: "claude", Bins: []string{"claude"}, TestArg: "--version"},
	{Name: "codex", Bins: []string{"codex"}, TestArg: "--version"},
	{Name: "cursor-agent", Bins: []string{"cursor-agent", "cursor"}, TestArg: "--version"},
	{Name: "copilot", Bins: []string{"gh"}, TestArg: "copilot --version"},
	{Name: "llama", Bins: []string{"llama-server", "llama-server.exe"}, TestArg: "--version"},
	{Name: "llama.cpp", Bins: []string{"llama-cli", "llama-cli.exe"}, TestArg: "--version"},
	{Name: "opencode", Bins: []string{"opencode"}, TestArg: "--version"},
	{Name: "gemini", Bins: []string{"gemini"}, TestArg: "--version"},
	{Name: "kimi", Bins: []string{"kimi"}, TestArg: "--version"},
}

// ──────────────────────────────────────────
// Daemon 結構
// ──────────────────────────────────────────

type Daemon struct {
	mu            sync.Mutex
	apiBase       string
	wsURL         string
	token         string
	workspaceSlug string
	runtimeID     string
	hostname      string
	availableCLIs []string
	wsConn        *websocket.Conn
	activeTasks   map[string]*runningTask // taskID -> 執行中的任務
}

type runningTask struct {
	cancel context.CancelFunc
	taskID string
}

// ──────────────────────────────────────────
// 初始化
// ──────────────────────────────────────────

func New(ctx context.Context) (*Daemon, error) {
	hostname, _ := os.Hostname()

	d := &Daemon{
		apiBase:       mustEnv("API_BASE", "http://localhost:8080"),
		wsURL:         mustEnv("WS_URL", "ws://localhost:8080/ws"),
		token:         mustEnv("DAEMON_TOKEN", ""),
		workspaceSlug: mustEnv("WORKSPACE_SLUG", ""),
		hostname:      hostname,
		activeTasks:   make(map[string]*runningTask),
	}

	if d.token == "" {
		return nil, fmt.Errorf("DAEMON_TOKEN 未設定，請先從 Web UI 取得 token")
	}
	if d.workspaceSlug == "" {
		return nil, fmt.Errorf("WORKSPACE_SLUG 未設定")
	}

	// 偵測已安裝的 CLI
	d.availableCLIs = detectCLIs()
	log.Printf("🔍 偵測到 CLI: %v", d.availableCLIs)

	// 向 Server 登記 Runtime
	if err := d.registerRuntime(ctx); err != nil {
		return nil, fmt.Errorf("Runtime 登記失敗: %w", err)
	}

	return d, nil
}

// ──────────────────────────────────────────
// 主執行迴圈
// ──────────────────────────────────────────

func (d *Daemon) Run(ctx context.Context) error {
	// 建立 WebSocket 連線
	if err := d.connectWS(ctx); err != nil {
		log.Printf("⚠️  WebSocket 連線失敗，改用輪詢模式: %v", err)
	}

	// 任務輪詢（每 5 秒）
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	// 心跳（每 30 秒）
	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()

	log.Printf("✅ Daemon 運行中 (runtime_id=%s)", d.runtimeID)

	for {
		select {
		case <-ctx.Done():
			return nil

		case <-ticker.C:
			d.pollAndExecuteTasks(ctx)

		case <-heartbeat.C:
			d.sendHeartbeat(ctx)
		}
	}
}

func (d *Daemon) Shutdown() {
	d.mu.Lock()
	defer d.mu.Unlock()

	// 取消所有執行中的任務
	for _, rt := range d.activeTasks {
		rt.cancel()
	}

	if d.wsConn != nil {
		d.wsConn.Close()
	}
}

// ──────────────────────────────────────────
// CLI 偵測
// ──────────────────────────────────────────

func detectCLIs() []string {
	var found []string
	for _, cli := range knownCLIs {
		for _, bin := range cli.Bins {
			if path, err := exec.LookPath(bin); err == nil {
				log.Printf("  ✅ %s → %s", cli.Name, path)
				found = append(found, cli.Name)
				break
			}
		}
	}
	// 若已設定 LLAMA_SERVER_URL 或 LLAMA_API_BASE，視為 llama HTTP 服務可用
	if serverURL := mustEnv("LLAMA_SERVER_URL", os.Getenv("LLAMA_API_BASE")); serverURL != "" {
		hasLlama := false
		for _, name := range found {
			if name == "llama" {
				hasLlama = true
				break
			}
		}
		if !hasLlama {
			log.Printf("  ✅ llama → %s (HTTP)", serverURL)
			found = append(found, "llama")
		}
	}
	if len(found) == 0 {
		log.Println("  ⚠️  未偵測到任何 AI CLI")
	}
	return found
}

// ──────────────────────────────────────────
// Runtime 登記
// ──────────────────────────────────────────

func (d *Daemon) registerRuntime(ctx context.Context) error {
	body, _ := json.Marshal(map[string]any{
		"name":           d.hostname,
		"hostname":       d.hostname,
		"available_clis": d.availableCLIs,
	})

	url := fmt.Sprintf("%s/api/w/%s/runtimes", d.apiBase, d.workspaceSlug)
	req, _ := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+d.token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var result struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("解析回應失敗: %w", err)
	}

	d.runtimeID = result.Data.ID
	log.Printf("✅ Runtime 已登記: %s", d.runtimeID)
	return nil
}

// ──────────────────────────────────────────
// WebSocket 連線
// ──────────────────────────────────────────

func (d *Daemon) connectWS(ctx context.Context) error {
	wsURL := fmt.Sprintf("%s?token=%s&workspace=%s&daemon=1&runtime_id=%s",
		d.wsURL, d.token, d.workspaceSlug, d.runtimeID,
	)

	conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return err
	}

	d.wsConn = conn
	log.Println("✅ WebSocket 已連線")

	// 背景接收訊息
	go d.receiveWS(ctx)
	return nil
}

func (d *Daemon) receiveWS(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
			_, msg, err := d.wsConn.ReadMessage()
			if err != nil {
				log.Printf("⚠️  WebSocket 讀取錯誤: %v", err)
				return
			}
			log.Printf("📨 WS 收到: %s", string(msg))
		}
	}
}

// ──────────────────────────────────────────
// 任務輪詢與執行
// ──────────────────────────────────────────

type Task struct {
	ID       string `json:"id"`
	IssueID  string `json:"issue_id"`
	AgentID  string `json:"agent_id"`
	Provider string `json:"provider"`
	Title    string `json:"title"`
	Body     string `json:"body"`
	Status   string `json:"status"`
}

func (d *Daemon) pollAndExecuteTasks(ctx context.Context) {
	url := fmt.Sprintf("%s/api/w/%s/tasks?status=queued&runtime_id=%s",
		d.apiBase, d.workspaceSlug, d.runtimeID,
	)

	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+d.token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	var result struct {
		Data []Task `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return
	}

	for _, task := range result.Data {
		d.mu.Lock()
		_, running := d.activeTasks[task.ID]
		d.mu.Unlock()

		if running {
			continue
		}

		go d.executeTask(ctx, task)
	}
}

// executeTask 認領並執行一個任務
func (d *Daemon) executeTask(ctx context.Context, task Task) {
	// 認領任務
	if err := d.updateTaskStatus(ctx, task.ID, "claimed", ""); err != nil {
		return
	}

	taskCtx, cancel := context.WithCancel(ctx)
	d.mu.Lock()
	d.activeTasks[task.ID] = &runningTask{cancel: cancel, taskID: task.ID}
	d.mu.Unlock()

	defer func() {
		d.mu.Lock()
		delete(d.activeTasks, task.ID)
		d.mu.Unlock()
		cancel()
	}()

	log.Printf("🚀 執行任務 %s (provider=%s)", task.ID, task.Provider)
	d.updateTaskStatus(ctx, task.ID, "running", "")

	// 組建 prompt
	prompt := fmt.Sprintf("Issue: %s\n\n%s", task.Title, task.Body)

	// 執行對應的 AI CLI
	output, exitCode, err := d.runCLI(taskCtx, task.Provider, prompt, task.ID)

	if err != nil {
		errMsg := err.Error()
		if exitCode != 0 {
			d.updateTaskStatusFull(ctx, task.ID, "failed", output, errMsg, exitCode)
		} else {
			d.updateTaskStatusFull(ctx, task.ID, "failed", output, errMsg, 1)
		}
		log.Printf("❌ 任務 %s 失敗: %v", task.ID, err)
		return
	}

	d.updateTaskStatusFull(ctx, task.ID, "done", output, "", exitCode)
	log.Printf("✅ 任務 %s 完成", task.ID)
}

// ──────────────────────────────────────────
// AI CLI 執行器
// ──────────────────────────────────────────

func (d *Daemon) runCLI(ctx context.Context, provider, prompt, taskID string) (string, int, error) {
	var cmd *exec.Cmd

	switch provider {
	case "llama":
		return d.runLlamaHTTP(ctx, prompt, taskID)
	case "claude":
		cmd = exec.CommandContext(ctx, "claude", "--print", prompt)
	case "codex":
		cmd = exec.CommandContext(ctx, "codex", "--quiet", prompt)
	case "cursor-agent":
		cmd = exec.CommandContext(ctx, "cursor-agent", "--prompt", prompt)
	case "opencode":
		cmd = exec.CommandContext(ctx, "opencode", "run", "--prompt", prompt)
	case "llama.cpp":
		var err error
		cmd, err = buildLlamaCommand(ctx, prompt)
		if err != nil {
			return "", 1, err
		}
	case "gemini":
		cmd = exec.CommandContext(ctx, "gemini", prompt)
	case "kimi":
		cmd = exec.CommandContext(ctx, "kimi", prompt)
	default:
		return "", 1, fmt.Errorf("不支援的 provider: %s", provider)
	}

	// 設定工作目錄（可由環境變數指定）
	if workdir := os.Getenv("AGENT_WORKDIR"); workdir != "" {
		cmd.Dir = workdir
	}

	// 逐行串流 stdout
	var outputBuf strings.Builder
	cmd.Stdout = &streamWriter{
		buf:     &outputBuf,
		taskID:  taskID,
		daemon:  d,
		ctx:     ctx,
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return outputBuf.String(), exitErr.ExitCode(), err
		}
		return outputBuf.String(), 1, err
	}

	return outputBuf.String(), 0, nil
}

// streamWriter 將 CLI 輸出即時串流到 Server
type streamWriter struct {
	buf    *strings.Builder
	taskID string
	daemon *Daemon
	ctx    context.Context
}

func (sw *streamWriter) Write(p []byte) (n int, err error) {
	line := string(p)
	sw.buf.WriteString(line)

	// 透過 API 串流進度
	go sw.daemon.streamProgress(sw.ctx, sw.taskID, line)

	return len(p), nil
}

// streamProgress 將單行輸出推送到 Server
func (d *Daemon) streamProgress(ctx context.Context, taskID, line string) {
	body, _ := json.Marshal(map[string]string{
		"line": line,
	})
	url := fmt.Sprintf("%s/api/w/%s/tasks/%s/progress",
		d.apiBase, d.workspaceSlug, taskID,
	)
	req, _ := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+d.token)
	resp, err := http.DefaultClient.Do(req)
	if err == nil {
		resp.Body.Close()
	}
}

// ──────────────────────────────────────────
// 任務狀態更新
// ──────────────────────────────────────────

func (d *Daemon) updateTaskStatus(ctx context.Context, taskID, status, errMsg string) error {
	return d.updateTaskStatusFull(ctx, taskID, status, "", errMsg, 0)
}

func (d *Daemon) updateTaskStatusFull(ctx context.Context, taskID, status, stdout, errMsg string, exitCode int) error {
	body, _ := json.Marshal(map[string]any{
		"status":    status,
		"stdout":    stdout,
		"error_msg": errMsg,
		"exit_code": exitCode,
	})
	url := fmt.Sprintf("%s/api/w/%s/tasks/%s",
		d.apiBase, d.workspaceSlug, taskID,
	)
	req, _ := http.NewRequestWithContext(ctx, "PATCH", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+d.token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// ──────────────────────────────────────────
// 心跳
// ──────────────────────────────────────────

func (d *Daemon) sendHeartbeat(ctx context.Context) {
	url := fmt.Sprintf("%s/api/w/%s/runtimes/%s/ping",
		d.apiBase, d.workspaceSlug, d.runtimeID,
	)
	req, _ := http.NewRequestWithContext(ctx, "POST", url, nil)
	req.Header.Set("Authorization", "Bearer "+d.token)
	resp, err := http.DefaultClient.Do(req)
	if err == nil {
		resp.Body.Close()
	}
}

// ──────────────────────────────────────────
// 工具函式
// ──────────────────────────────────────────

func mustEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func buildLlamaCommand(ctx context.Context, prompt string) (*exec.Cmd, error) {
	modelPath := strings.TrimSpace(os.Getenv("LLAMA_MODEL"))
	if modelPath == "" {
		return nil, fmt.Errorf("LLAMA_MODEL is required for llama.cpp provider")
	}

	args := []string{
		"-m", modelPath,
		"-c", mustEnv("LLAMA_CTX", "4096"),
		"-ngl", mustEnv("LLAMA_NGL", "999"),
		"-p", prompt,
	}

	if extra := strings.TrimSpace(os.Getenv("LLAMA_EXTRA_ARGS")); extra != "" {
		args = append(args, strings.Fields(extra)...)
	}

	return exec.CommandContext(ctx, "llama-cli", args...), nil
}

// ──────────────────────────────────────────
// llama-server HTTP 執行器 (/v1/chat/completions)
// ──────────────────────────────────────────

func (d *Daemon) runLlamaHTTP(ctx context.Context, prompt, taskID string) (string, int, error) {
	baseURL := mustEnv("LLAMA_SERVER_URL", os.Getenv("LLAMA_API_BASE"))
	if baseURL == "" {
		baseURL = "http://localhost:8080"
	}
	endpoint := strings.TrimRight(baseURL, "/") + "/v1/chat/completions"

	model := mustEnv("LLAMA_MODEL", "local")

	reqPayload := map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"stream": true,
	}

	bodyBytes, err := json.Marshal(reqPayload)
	if err != nil {
		return "", 1, fmt.Errorf("序列化 llama 請求失敗: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", 1, fmt.Errorf("建立 llama HTTP 請求失敗: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey := os.Getenv("LLAMA_API_KEY"); apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", 1, fmt.Errorf("llama-server 連線失敗 (%s): %w", endpoint, err)
	}
	defer resp.Body.Close()

	var outputBuf strings.Builder
	sw := &streamWriter{
		buf:    &outputBuf,
		taskID: taskID,
		daemon: d,
		ctx:    ctx,
	}

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		errMsg := fmt.Sprintf("llama-server 回應錯誤 [HTTP %d]: %s", resp.StatusCode, string(respBody))
		sw.Write([]byte(errMsg))
		return outputBuf.String(), 1, fmt.Errorf("%s", errMsg)
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		dataStr := strings.TrimPrefix(line, "data: ")
		if dataStr == "[DONE]" {
			break
		}

		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(dataStr), &chunk); err == nil {
			if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
				sw.Write([]byte(chunk.Choices[0].Delta.Content))
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return outputBuf.String(), 1, fmt.Errorf("讀取 llama 串流失敗: %w", err)
	}

	return outputBuf.String(), 0, nil
}
