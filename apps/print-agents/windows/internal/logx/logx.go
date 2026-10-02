// Package logx is a size-capped log file: agent.log plus one agent.log.1.
package logx

import (
	"os"
	"path/filepath"
	"sync"
)

type RotatingFile struct {
	path string
	max  int64

	mu   sync.Mutex
	f    *os.File
	size int64
}

func Open(path string, max int64) (*RotatingFile, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	r := &RotatingFile{path: path, max: max}
	if err := r.open(); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *RotatingFile) open() error {
	f, err := os.OpenFile(r.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	fi, err := f.Stat()
	if err != nil {
		f.Close()
		return err
	}
	r.f, r.size = f, fi.Size()
	return nil
}

func (r *RotatingFile) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.f == nil {
		return 0, os.ErrClosed
	}
	if r.size > 0 && r.size+int64(len(p)) > r.max {
		r.rotate()
	}
	n, err := r.f.Write(p)
	r.size += int64(n)
	return n, err
}

// rotate keeps logging to the current file if the rename fails (another
// process holding agent.log open on Windows, say).
func (r *RotatingFile) rotate() {
	r.f.Close()
	old := r.path + ".1"
	_ = os.Remove(old)
	_ = os.Rename(r.path, old)
	if err := r.open(); err != nil {
		r.f = nil
	}
}

func (r *RotatingFile) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.f == nil {
		return nil
	}
	err := r.f.Close()
	r.f = nil
	return err
}
