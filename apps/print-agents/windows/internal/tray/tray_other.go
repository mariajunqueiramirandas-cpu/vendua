//go:build !windows && !linux

package tray

import (
	"context"
	"log/slog"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/agent"
)

type Options struct {
	Agent    *agent.Agent
	AdminURL string
	Log      *slog.Logger
	Quit     <-chan struct{}
}

// Run is unavailable here: the tray library needs cgo on this OS. Use -headless.
func Run(ctx context.Context, o Options) {
	o.Log.Error("tray not supported on this OS; run with -headless")
}
