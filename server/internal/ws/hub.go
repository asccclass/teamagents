package ws

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ──────────────────────────────────────────
// 訊息格式
// ──────────────────────────────────────────

type Message struct {
	Type    string `json:"type"`
	Payload any    `json:"payload"`
}

// 常用 Type 常數
const (
	TypeTaskProgress = "task:progress" // Agent 執行進度（stdout 行）
	TypeTaskStatus   = "task:status"   // 任務狀態變更
	TypeAgentStatus  = "agent:status"  // Agent 狀態更新
	TypeRuntimePing  = "runtime:ping"  // Daemon 心跳
	TypeIssueUpdated = "issue:updated" // Issue 狀態更新
)

// ──────────────────────────────────────────
// Client — 代表一個 WebSocket 連線
// ──────────────────────────────────────────

type Client struct {
	hub         *Hub
	conn        *websocket.Conn
	send        chan []byte
	userID      string
	workspaceID string
	runtimeID   string // 若是 Daemon 連線，此欄位非空
	isDaemon    bool
}

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 64 * 1024 // 64KB
)

// writePump 將 send channel 的訊息寫到 WebSocket
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// readPump 讀取 WebSocket 訊息（目前主要用於維持連線）
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err,
				websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket 異常關閉: %v", err)
			}
			break
		}

		// 處理來自 Daemon 的訊息
		if c.isDaemon {
			c.hub.daemonMsg <- daemonMessage{client: c, data: msg}
		}
	}
}

// ──────────────────────────────────────────
// Hub — 管理所有連線
// ──────────────────────────────────────────

type daemonMessage struct {
	client *Client
	data   []byte
}

type Hub struct {
	mu         sync.RWMutex
	clients    map[*Client]bool
	register   chan *Client
	unregister chan *Client
	broadcast  chan broadcastMsg
	daemonMsg  chan daemonMessage
}

type broadcastMsg struct {
	workspaceID string
	msg         []byte
}

var DefaultHub = NewHub()

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		register:   make(chan *Client, 64),
		unregister: make(chan *Client, 64),
		broadcast:  make(chan broadcastMsg, 256),
		daemonMsg:  make(chan daemonMessage, 256),
	}
}

// Run 啟動 Hub 事件迴圈
func (h *Hub) Run() {
	for {
		select {
		case c := <-h.register:
			h.mu.Lock()
			h.clients[c] = true
			h.mu.Unlock()
			log.Printf("🔌 WS 連線: user=%s workspace=%s daemon=%v",
				c.userID, c.workspaceID, c.isDaemon)

		case c := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				close(c.send)
			}
			h.mu.Unlock()
			log.Printf("🔌 WS 斷線: user=%s", c.userID)

		case bm := <-h.broadcast:
			h.mu.RLock()
			for c := range h.clients {
				if c.workspaceID != bm.workspaceID {
					continue
				}
				select {
				case c.send <- bm.msg:
				default:
					// send buffer 滿了，關閉此連線
					close(c.send)
					delete(h.clients, c)
				}
			}
			h.mu.RUnlock()

		case dm := <-h.daemonMsg:
			// Daemon 傳來的訊息，轉發給同 workspace 的前端客戶端
			var incoming Message
			if err := json.Unmarshal(dm.data, &incoming); err != nil {
				continue
			}
			h.BroadcastToWorkspace(dm.client.workspaceID, incoming)
		}
	}
}

// BroadcastToWorkspace 廣播訊息給工作區所有前端連線
func (h *Hub) BroadcastToWorkspace(workspaceID string, msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.broadcast <- broadcastMsg{workspaceID: workspaceID, msg: data}
}

// SendToClient 傳送訊息給特定 Client
func SendToClient(c *Client, msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	select {
	case c.send <- data:
	default:
	}
}
