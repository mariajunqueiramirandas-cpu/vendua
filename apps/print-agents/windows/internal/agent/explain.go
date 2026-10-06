package agent

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/api"
)

var errNotPaired = errors.New("not paired")

// Explain says in pt-BR, in a few words, why a call to Core failed, so the tray
// can show a cause instead of a bare "Sem conexão". It stays short: Windows cuts
// the tray tooltip at 127 characters.
func Explain(err error) string {
	var ae *api.Error
	if errors.As(err, &ae) {
		switch {
		case ae.Status == http.StatusProxyAuthRequired:
			return "a rede exige login (proxy)"
		case ae.Status == http.StatusTooManyRequests:
			return "muitas tentativas seguidas"
		case ae.Status == http.StatusForbidden && ae.Code == "PLAN_REQUIRED":
			return "o plano da loja não inclui impressão"
		case ae.Status == http.StatusUnauthorized:
			return "este computador não está mais conectado à loja"
		case ae.Status == http.StatusNotFound && ae.Code == "PRINTER_NOT_FOUND":
			return "impressora não encontrada na loja"
		case ae.Status >= 500:
			return fmt.Sprintf("a Venduá está fora do ar (erro %d)", ae.Status)
		}
		return fmt.Sprintf("a Venduá recusou o pedido (erro %d)", ae.Status)
	}
	var (
		dns     *net.DNSError
		certErr *tls.CertificateVerificationError
		unknown x509.UnknownAuthorityError
		invalid x509.CertificateInvalidError
		host    x509.HostnameError
		op      *net.OpError
		nerr    net.Error
	)
	switch {
	case errors.Is(err, errNotPaired):
		return "este computador não está conectado a uma loja"
	case errors.As(err, &dns):
		return "sem internet"
	case errors.As(err, &certErr), errors.As(err, &unknown), errors.As(err, &invalid), errors.As(err, &host):
		return "certificado recusado — confira data e hora do PC"
	case errors.Is(err, api.ErrIdle):
		return "a conexão ficou parada"
	case errors.Is(err, context.DeadlineExceeded), errors.As(err, &nerr) && nerr.Timeout():
		return "a Venduá não respondeu a tempo"
	case errors.As(err, &op):
		return "não conseguiu falar com a Venduá"
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF):
		return "a conexão caiu"
	}
	return "erro de conexão"
}

// TestFailure is the merchant-facing text of a failed "Imprimir teste": one line
// per printer Core would not queue a ticket for.
func TestFailure(err error) string {
	var lines []string
	collect(err, &lines)
	if len(lines) == 0 {
		lines = append(lines, Explain(err))
	}
	return "Não foi possível enviar o ticket de teste.\n\n" + strings.Join(lines, "\n") +
		"\n\nSe o problema continuar, use “Abrir log” no menu do ícone e envie ao suporte."
}

func collect(err error, lines *[]string) {
	if j, ok := err.(interface{ Unwrap() []error }); ok {
		for _, e := range j.Unwrap() {
			collect(e, lines)
		}
		return
	}
	var pe *printerError
	if errors.As(err, &pe) {
		name := pe.name
		if name == "" {
			name = "Impressora"
		}
		*lines = append(*lines, name+": "+Explain(pe.err))
	}
}

// printerError ties a failure of the test request to the printer it was for.
type printerError struct {
	name string
	err  error
}

func (e *printerError) Error() string { return e.name + ": " + e.err.Error() }
func (e *printerError) Unwrap() error { return e.err }
