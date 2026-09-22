package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/marsshare/api/internal/app"
	"github.com/marsshare/api/internal/worker"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	cfg, err := app.LoadConfig()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	deps, err := app.NewWorkerDependencies(ctx, cfg)
	if err != nil {
		log.Fatalf("init worker deps: %v", err)
	}
	defer deps.Close()

	runner := worker.New(deps.Store, cfg.WorkerInterval)
	log.Printf("worker started with interval %s", cfg.WorkerInterval)
	if err := runner.Run(ctx); err != nil && ctx.Err() == nil {
		log.Fatalf("worker stopped: %v", err)
	}
	log.Println("worker shut down")
}
