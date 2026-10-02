package config

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/api"
)

type xorProtector struct{}

func (xorProtector) Protect(b []byte) ([]byte, error)   { return xor(b), nil }
func (xorProtector) Unprotect(b []byte) ([]byte, error) { return xor(b), nil }

func xor(b []byte) []byte {
	out := bytes.Clone(b)
	for i := range out {
		out[i] ^= 0x5a
	}
	return out
}

func TestRoundTripSealsToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "config.json")
	s := NewStore(path, xorProtector{})

	cfg, exists, err := s.Load("https://core")
	if err != nil || exists || cfg.APIBase != "https://core" {
		t.Fatalf("first load = %+v, %v, %v", cfg, exists, err)
	}
	cfg.Token = "secret-token"
	cfg.StoreName = "Quero Pudim"
	cfg.Printers = []api.Printer{{ID: "p1", Kind: "tcp", Address: "10.0.0.9:9100"}}
	if err := s.Save(cfg); err != nil {
		t.Fatal(err)
	}

	raw, _ := os.ReadFile(path)
	if strings.Contains(string(raw), "secret-token") {
		t.Fatal("token stored unsealed")
	}
	if runtime.GOOS != "windows" {
		fi, _ := os.Stat(path)
		if fi.Mode().Perm() != 0o600 {
			t.Fatalf("mode = %v", fi.Mode().Perm())
		}
	}

	got, exists, err := s.Load("https://core")
	if err != nil || !exists {
		t.Fatal(exists, err)
	}
	if got.Token != "secret-token" || got.StoreName != "Quero Pudim" || len(got.Printers) != 1 {
		t.Fatalf("reload = %+v", got)
	}
}

func TestTokenForAnotherCoreIsDropped(t *testing.T) {
	s := NewStore(filepath.Join(t.TempDir(), "config.json"), xorProtector{})
	if err := s.Save(Config{APIBase: "https://prod", Token: "t", StoreName: "Loja"}); err != nil {
		t.Fatal(err)
	}
	got, exists, err := s.Load("http://localhost:8787")
	if err != nil || !exists {
		t.Fatal(exists, err)
	}
	if got.Token != "" || got.StoreName != "" || got.APIBase != "http://localhost:8787" {
		t.Fatalf("got %+v", got)
	}
}
