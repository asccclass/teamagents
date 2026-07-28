package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/teamagents/server/internal/config"
	"github.com/teamagents/server/internal/daemon"
)

func main() {
	config.Load()
	log.Println("🤖 TeamAgents Daemon 啟動中...")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	d, err := daemon.New(ctx)
	if err != nil {
		log.Fatalf("Daemon 初始化失敗: %v", err)
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		if err := d.Run(ctx); err != nil {
			log.Printf("Daemon 執行錯誤: %v", err)
			quit <- syscall.SIGTERM
		}
	}()

	<-quit
	log.Println("🛑 Daemon 正在關閉...")
	cancel()
	d.Shutdown()
	log.Println("✅ Daemon 已停止")
}
