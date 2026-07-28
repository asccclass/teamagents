package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	staticfileserver "github.com/asccclass/staticfileserver"
)

type webConfig struct {
	APIBase string `json:"apiBase"`
	WSURL   string `json:"wsUrl"`
}

func main() {
	port := getenv("PORT", "3000")
	staticRoot := getenv("WEB_STATIC_ROOT", filepath.Join("apps", "web", "public"))
	apiBase := getenv("API_BASE", "http://localhost:8080")
	wsURL := getenv("WS_URL", strings.Replace(apiBase, "http", "ws", 1)+"/ws")

	root, err := filepath.Abs(staticRoot)
	if err != nil {
		log.Fatalf("resolve static root: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/config.js", func(w http.ResponseWriter, _ *http.Request) {
		cfg := webConfig{APIBase: apiBase, WSURL: wsURL}
		body, err := json.Marshal(cfg)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		_, _ = fmt.Fprintf(w, "window.__TEAMAGENTS_CONFIG__ = %s;\n", body)
	})
	mux.Handle("/", staticfileserver.StaticFileServer{
		StaticPath: root,
		IndexPath:  "index.html",
	})

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           requestLogger(mux),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	log.Printf("teamagents web listening on http://0.0.0.0:%s", port)
	log.Printf("serving %s", root)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("web server failed: %v", err)
	}
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
	})
}
