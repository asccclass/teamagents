package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/joho/godotenv"
	"github.com/teamagents/server/internal/daemon"
)

func main() {
	// Load daemon env file if present without requiring server-only variables.
	_ = godotenv.Load()
	log.Println("TeamAgents Daemon starting...")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	d, err := daemon.New(ctx)
	if err != nil {
		log.Fatalf("daemon initialization failed:\n%s", formatStartupError(err))
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		if err := d.Run(ctx); err != nil {
			log.Printf("daemon run error: %v", err)
			quit <- syscall.SIGTERM
		}
	}()

	<-quit
	log.Println("Daemon shutting down...")
	cancel()
	d.Shutdown()
	log.Println("Daemon stopped")
}

func formatStartupError(err error) string {
	msg := err.Error()

	switch {
	case strings.Contains(msg, "missing DAEMON_TOKEN"), strings.Contains(msg, "DAEMON_TOKEN"):
		return "  - Missing DAEMON_TOKEN\n  - Open TeamAgents Web UI -> Workspace -> Settings -> Copy Daemon Env\n  - Copy the latest token into your .env file"
	case strings.Contains(msg, "missing WORKSPACE_SLUG"), strings.Contains(msg, "WORKSPACE_SLUG"):
		return "  - Missing WORKSPACE_SLUG\n  - Check your .env file and confirm the workspace slug is correct"
	case strings.Contains(msg, "runtime registration failed [HTTP 401]"):
		return "  - Runtime registration was rejected with HTTP 401\n  - Your DAEMON_TOKEN is invalid, expired, or belongs to another workspace\n  - Copy a fresh daemon env from TeamAgents and try again"
	case strings.Contains(msg, "runtime registration failed [HTTP 403]"):
		return "  - Runtime registration was rejected with HTTP 403\n  - Your account/token does not have access to this workspace\n  - Check WORKSPACE_SLUG and make sure you are a member of that workspace"
	case strings.Contains(msg, "runtime registration failed [HTTP 404]"):
		return "  - Runtime registration returned HTTP 404\n  - API_BASE or WORKSPACE_SLUG is likely wrong\n  - Confirm API_BASE points to the TeamAgents server and the workspace slug exists"
	case strings.Contains(msg, "empty runtime id"):
		return "  - Runtime registration succeeded unexpectedly without a runtime id\n  - Check the API response format or server logs"
	case strings.Contains(msg, "connectex"), strings.Contains(msg, "connection refused"), strings.Contains(msg, "no such host"):
		return "  - Cannot reach TeamAgents server\n  - Check API_BASE / WS_URL and verify the server is online\n  - Also confirm local firewall or proxy settings are not blocking the connection"
	default:
		return "  - " + msg
	}
}
