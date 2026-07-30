package ws

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Message struct {
	Type    string `json:"type"`
	Payload any    `json:"payload"`
}

const (
	TypeTaskProgress = "task:progress"
	TypeTaskStatus   = "task:status"
	TypeAgentStatus  = "agent:status"
	TypeRuntimePing  = "runtime:ping"
	TypeIssueUpdated = "issue:updated"
	TypeChatUpdated  = "chat:updated"
)

type Client struct {
	hub         *Hub
	conn        *websocket.Conn
	send        chan []byte
	userID      string
	workspaceID string
	runtimeID   string
	isDaemon    bool
}

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 64 * 1024
)

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
				log.Printf("WebSocket read error: %v", err)
			}
			break
		}

		if c.isDaemon {
			c.hub.daemonMsg <- daemonMessage{client: c, data: msg}
		}
	}
}

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

func (h *Hub) Run() {
	for {
		select {
		case c := <-h.register:
			h.mu.Lock()
			h.clients[c] = true
			h.mu.Unlock()
			log.Printf("WS connected: user=%s workspace=%s daemon=%v", c.userID, c.workspaceID, c.isDaemon)

		case c := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				close(c.send)
			}
			h.mu.Unlock()
			log.Printf("WS disconnected: user=%s", c.userID)

		case bm := <-h.broadcast:
			h.mu.RLock()
			for c := range h.clients {
				if c.workspaceID != bm.workspaceID {
					continue
				}
				select {
				case c.send <- bm.msg:
				default:
					close(c.send)
					delete(h.clients, c)
				}
			}
			h.mu.RUnlock()

		case dm := <-h.daemonMsg:
			var incoming Message
			if err := json.Unmarshal(dm.data, &incoming); err != nil {
				continue
			}
			h.BroadcastToWorkspace(dm.client.workspaceID, incoming)
		}
	}
}

func (h *Hub) BroadcastToWorkspace(workspaceID string, msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.broadcast <- broadcastMsg{workspaceID: workspaceID, msg: data}
}

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
