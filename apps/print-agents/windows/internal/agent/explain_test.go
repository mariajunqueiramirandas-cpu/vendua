package agent

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"testing"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/api"
)

type timeoutErr struct{}

func (timeoutErr) Error() string   { return "i/o timeout" }
func (timeoutErr) Timeout() bool   { return true }
func (timeoutErr) Temporary() bool { return true }

func TestExplain(t *testing.T) {
	for _, c := range []struct {
		err  error
		want string
	}{
		{&net.DNSError{Err: "no such host", Name: "painel.vendua.com.br"}, "sem internet"},
		{fmt.Errorf("Get x: %w", &net.DNSError{Err: "no such host"}), "sem internet"},
		{&net.OpError{Op: "dial", Err: errors.New("refused")}, "não conseguiu falar com a Venduá"},
		{&net.OpError{Op: "read", Err: timeoutErr{}}, "a Venduá não respondeu a tempo"},
		{context.DeadlineExceeded, "a Venduá não respondeu a tempo"},
		{x509.UnknownAuthorityError{}, "certificado recusado — confira data e hora do PC"},
		{api.ErrIdle, "a conexão ficou parada"},
		{io.ErrUnexpectedEOF, "a conexão caiu"},
		{&api.Error{Status: 503}, "a Venduá está fora do ar (erro 503)"},
		{&api.Error{Status: 429}, "muitas tentativas seguidas"},
		{&api.Error{Status: 407}, "a rede exige login (proxy)"},
		{&api.Error{Status: 403, Code: "PLAN_REQUIRED"}, "o plano da loja não inclui impressão"},
		{&api.Error{Status: 404}, "a Venduá recusou o pedido (erro 404)"},
		{errNotPaired, "este computador não está conectado a uma loja"},
		{errors.New("something odd"), "erro de conexão"},
	} {
		if got := Explain(c.err); got != c.want {
			t.Errorf("Explain(%v) = %q, want %q", c.err, got, c.want)
		}
	}
	// Whatever the cause, the tray line has to fit a 127-character tooltip.
	for _, err := range []error{&net.DNSError{}, x509.UnknownAuthorityError{}, &api.Error{Status: 503}, &api.Error{Status: 403, Code: "PLAN_REQUIRED"}} {
		if n := len([]rune("Venduá Impressora — " + (Status{State: Offline, Reason: Explain(err)}).Text())); n > 127 {
			t.Errorf("tooltip for %v is %d characters", err, n)
		}
	}
}

func TestOfflineStatusSaysWhy(t *testing.T) {
	a := &Agent{state: Connecting}
	changes := a.Subscribe()

	a.setOffline(&net.DNSError{})
	if got := a.Status().Text(); got != "Sem conexão: sem internet — tentando de novo" {
		t.Fatalf("status = %q", got)
	}
	<-changes
	// Same state, new cause: still a change the tray has to hear about.
	a.setOffline(&api.Error{Status: 502})
	select {
	case <-changes:
	default:
		t.Fatal("a new cause did not notify")
	}
	if got := a.Status().Reason; got != "a Venduá está fora do ar (erro 502)" {
		t.Fatalf("reason = %q", got)
	}
	// Same cause again: nothing to say.
	a.setOffline(&api.Error{Status: 502})
	select {
	case <-changes:
		t.Fatal("notified without a change")
	default:
	}

	a.setState(Online)
	if s := a.Status(); s.Reason != "" || s.Text() != "Conectado" {
		t.Fatalf("online status = %+v / %q", s, s.Text())
	}
	if got := (Status{State: Offline}).Text(); got != "Sem conexão — tentando de novo" {
		t.Fatalf("no reason: %q", got)
	}
}

func TestTestFailureText(t *testing.T) {
	err := errors.Join(
		&printerError{name: "Cozinha", err: &api.Error{Status: 404, Code: "PRINTER_NOT_FOUND"}},
		&printerError{name: "Balcão", err: &net.DNSError{}},
	)
	got := TestFailure(err)
	for _, want := range []string{"Cozinha: impressora não encontrada na loja", "Balcão: sem internet", "Abrir log"} {
		if !strings.Contains(got, want) {
			t.Errorf("TestFailure missing %q in:\n%s", want, got)
		}
	}
	// Errors that are not about one printer still get a line.
	if got := TestFailure(&api.Error{Status: 401}); !strings.Contains(got, "não está mais conectado") {
		t.Errorf("401: %s", got)
	}
	if got := TestFailure(errNotPaired); !strings.Contains(got, "não está conectado a uma loja") {
		t.Errorf("not paired: %s", got)
	}
}
