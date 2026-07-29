package main

import (
	"context"
	"log"
	"os"
	"os/signal"
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
		log.Fatalf("daemon initialization failed: %v", err)
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
