//go:build !windows && !linux

package printer

import (
	"context"
	"time"
)

func sendSpooler(context.Context, string, []byte) error {
	return &Error{Msg: "Fila de impressão não suportada neste sistema", Permanent: true}
}

func sendSerial(context.Context, string, int, time.Duration, []byte) error {
	return &Error{Msg: "Porta serial não suportada neste sistema", Permanent: true}
}
