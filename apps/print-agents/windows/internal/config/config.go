// Package config persists the agent's pairing and last known printer set.
package config

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/api"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/secret"
)

type Config struct {
	// APIBase is the Core the token belongs to; a token is never sent elsewhere.
	APIBase   string        `json:"apiBase"`
	Token     string        `json:"-"`
	StoreName string        `json:"storeName,omitempty"`
	Printers  []api.Printer `json:"printers,omitempty"`
}

type file struct {
	Config
	SealedToken string `json:"token,omitempty"`
}

type Store struct {
	path string
	prot secret.Protector
	mu   sync.Mutex
}

func NewStore(path string, prot secret.Protector) *Store {
	return &Store{path: path, prot: prot}
}

// Load returns the stored config for apiBase. exists is false on first run.
// A token that cannot be unsealed (profile copied to another user, say) or
// that belongs to another Core is dropped rather than failing startup.
func (s *Store) Load(apiBase string) (cfg Config, exists bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	raw, err := os.ReadFile(s.path)
	if errors.Is(err, fs.ErrNotExist) {
		return Config{APIBase: apiBase}, false, nil
	}
	if err != nil {
		return Config{APIBase: apiBase}, false, err
	}
	var f file
	if err := json.Unmarshal(raw, &f); err != nil {
		return Config{APIBase: apiBase}, true, fmt.Errorf("config: %w", err)
	}
	cfg = f.Config
	if cfg.APIBase != apiBase {
		return Config{APIBase: apiBase}, true, nil
	}
	if f.SealedToken != "" {
		sealed, err := base64.StdEncoding.DecodeString(f.SealedToken)
		if err != nil {
			return cfg, true, fmt.Errorf("config: token: %w", err)
		}
		plain, err := s.prot.Unprotect(sealed)
		if err != nil {
			return cfg, true, fmt.Errorf("config: unseal token: %w", err)
		}
		cfg.Token = string(plain)
	}
	return cfg, true, nil
}

func (s *Store) Save(cfg Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	f := file{Config: cfg}
	if cfg.Token != "" {
		sealed, err := s.prot.Protect([]byte(cfg.Token))
		if err != nil {
			return fmt.Errorf("config: seal token: %w", err)
		}
		f.SealedToken = base64.StdEncoding.EncodeToString(sealed)
	}
	raw, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	return WriteFileAtomic(s.path, raw)
}

// WriteFileAtomic replaces path so a crash never leaves a half-written file.
func WriteFileAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	// CreateTemp creates the file 0600, which the rename keeps.
	tmp, err := os.CreateTemp(dir, filepath.Base(path)+".tmp*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
