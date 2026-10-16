//go:build !windows && !linux

package discovery

import (
	"context"
	"errors"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/api"
)

func Local(context.Context, func(string) bool) ([]api.Discovered, error) {
	return nil, errors.New("local printer discovery is not supported on this OS")
}
