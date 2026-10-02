package printer

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/api"
)

func TestTCPAddress(t *testing.T) {
	for in, want := range map[string]string{
		"192.168.0.50":      "192.168.0.50:9100",
		"192.168.0.50:9101": "192.168.0.50:9101",
		" printer.local ":   "printer.local:9100",
		"fe80::1":           "[fe80::1]:9100",
		"[fe80::1]":         "[fe80::1]:9100",
		"[fe80::1]:515":     "[fe80::1]:515",
	} {
		if got := TCPAddress(in); got != want {
			t.Errorf("TCPAddress(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseSerialAddress(t *testing.T) {
	if p, b, err := ParseSerialAddress("COM3"); p != "COM3" || b != 9600 || err != nil {
		t.Fatalf("COM3 = %q %d %v", p, b, err)
	}
	if p, b, err := ParseSerialAddress("COM12@115200"); p != "COM12" || b != 115200 || err != nil {
		t.Fatalf("COM12@115200 = %q %d %v", p, b, err)
	}
	if _, _, err := ParseSerialAddress("COM3@fast"); !IsPermanent(err) || Message(err) != "Velocidade inválida para COM3" {
		t.Fatalf("bad baud err = %v", err)
	}
}

func TestAddressFallsBackToKey(t *testing.T) {
	if got := Address(api.Printer{Key: "tcp:10.0.0.9:9100"}); got != "10.0.0.9:9100" {
		t.Fatalf("got %q", got)
	}
	if got := Address(api.Printer{Key: "spooler:EPSON TM-T20X", Address: "EPSON TM-T20X"}); got != "EPSON TM-T20X" {
		t.Fatalf("got %q", got)
	}
}

func TestSendErrors(t *testing.T) {
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	addr := ln.Addr().String()
	ln.Close()
	s := &Sender{DialTimeout: time.Second, WriteTimeout: time.Second}
	err := s.Send(context.Background(), api.Printer{Kind: "tcp", Address: addr}, []byte("x"))
	if Message(err) != "Sem resposta da impressora ("+addr+")" || IsPermanent(err) {
		t.Fatalf("tcp err = %v", err)
	}
	err = s.Send(context.Background(), api.Printer{Kind: "bluetooth", Address: "AA:BB"}, []byte("x"))
	if !IsPermanent(err) {
		t.Fatalf("bluetooth err = %v", err)
	}
	if Message(errors.New("boom")) != "Falha ao imprimir" {
		t.Fatal("generic message")
	}
}
