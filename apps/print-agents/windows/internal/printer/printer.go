// Package printer writes raw ESC/POS bytes to a local printer.
package printer

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/api"
)

// Error carries the short pt-BR text the merchant sees in the admin.
type Error struct {
	Msg string
	Err error
	// Permanent errors are not retried: another attempt cannot succeed.
	Permanent bool
}

func (e *Error) Error() string {
	if e.Err == nil {
		return e.Msg
	}
	return e.Msg + ": " + e.Err.Error()
}

func (e *Error) Unwrap() error { return e.Err }

const genericFailure = "Falha ao imprimir"

// Message is the merchant-facing text for err.
func Message(err error) string {
	var pe *Error
	if errors.As(err, &pe) {
		return pe.Msg
	}
	return genericFailure
}

func IsPermanent(err error) bool {
	var pe *Error
	return errors.As(err, &pe) && pe.Permanent
}

const (
	DefaultTCPPort  = "9100"
	DefaultBaudRate = 9600
)

// Sender dispatches a job to the transport its printer kind names.
type Sender struct {
	DialTimeout  time.Duration
	WriteTimeout time.Duration
}

func NewSender() *Sender {
	return &Sender{DialTimeout: 5 * time.Second, WriteTimeout: 20 * time.Second}
}

func (s *Sender) Send(ctx context.Context, p api.Printer, data []byte) error {
	addr := Address(p)
	switch p.Kind {
	case "tcp":
		return s.sendTCP(ctx, TCPAddress(addr), data)
	case "spooler":
		return sendSpooler(ctx, addr, data)
	case "serial":
		port, baud, err := ParseSerialAddress(addr)
		if err != nil {
			return err
		}
		return sendSerial(ctx, port, baud, s.WriteTimeout, data)
	default:
		return &Error{Msg: "Tipo de impressora não suportado neste computador", Permanent: true}
	}
}

// Address falls back to the key's suffix for printers Core sent without one.
func Address(p api.Printer) string {
	if a := strings.TrimSpace(p.Address); a != "" {
		return a
	}
	_, rest, _ := strings.Cut(p.Key, ":")
	return rest
}

// TCPAddress adds the default raw-printing port when addr has none.
func TCPAddress(addr string) string {
	addr = strings.TrimSpace(addr)
	if _, _, err := net.SplitHostPort(addr); err == nil {
		return addr
	}
	return net.JoinHostPort(strings.Trim(addr, "[]"), DefaultTCPPort)
}

func (s *Sender) sendTCP(ctx context.Context, addr string, data []byte) error {
	noAnswer := "Sem resposta da impressora (" + addr + ")"
	d := net.Dialer{Timeout: s.DialTimeout}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return &Error{Msg: noAnswer, Err: err}
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { _ = conn.SetDeadline(time.Now()) })
	defer stop()
	_ = conn.SetWriteDeadline(time.Now().Add(s.WriteTimeout))
	if _, err := conn.Write(data); err != nil {
		return &Error{Msg: noAnswer, Err: err}
	}
	if tc, ok := conn.(*net.TCPConn); ok {
		// Half-close so the printer sees EOF only after every byte was sent.
		if err := tc.CloseWrite(); err != nil {
			return &Error{Msg: noAnswer, Err: err}
		}
	}
	return nil
}

// ParseSerialAddress splits "COM3" or "COM3@115200".
func ParseSerialAddress(addr string) (port string, baud int, err error) {
	port, rate, hasRate := strings.Cut(strings.TrimSpace(addr), "@")
	if port == "" {
		return "", 0, &Error{Msg: "Porta serial não informada", Permanent: true}
	}
	if !hasRate {
		return port, DefaultBaudRate, nil
	}
	baud, err = strconv.Atoi(rate)
	if err != nil || baud <= 0 {
		return "", 0, &Error{Msg: fmt.Sprintf("Velocidade inválida para %s", port), Permanent: true}
	}
	return port, baud, nil
}

// serialBudget allows for the line rate: at 9600 baud a 20 KB logo ticket
// alone takes about 21 s on the wire.
func serialBudget(base time.Duration, baud, n int) time.Duration {
	const bitsPerByte = 10 // 8N1: start + 8 data + stop
	wire := time.Duration(n) * bitsPerByte * time.Second / time.Duration(baud)
	return base + 2*wire
}
