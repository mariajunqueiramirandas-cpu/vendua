// Package jobs runs print jobs: one FIFO worker per printer, at-most-once
// printing per job id, and result reporting with retries.
package jobs

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"sync"
	"time"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/config"
)

type Result struct {
	ID    string    `json:"id"`
	OK    bool      `json:"ok"`
	Error string    `json:"error,omitempty"`
	At    time.Time `json:"at"`
}

// Finished remembers the last N finished jobs on disk, so a job Core
// redelivers (it is at-least-once) is acknowledged instead of printed again.
type Finished struct {
	path string
	max  int

	mu   sync.Mutex
	list []Result
}

// OpenFinished loads the store at path; an empty path keeps it in memory.
// A corrupt file is discarded: losing dedupe history is better than not starting.
func OpenFinished(path string, max int) (*Finished, error) {
	f := &Finished{path: path, max: max}
	if path == "" {
		return f, nil
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return f, nil
	}
	if err != nil {
		return f, err
	}
	if err := json.Unmarshal(raw, &f.list); err != nil {
		f.list = nil
		return f, err
	}
	if len(f.list) > max {
		f.list = f.list[len(f.list)-max:]
	}
	return f, nil
}

func (f *Finished) Get(id string) (Result, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := len(f.list) - 1; i >= 0; i-- {
		if f.list[i].ID == id {
			return f.list[i], true
		}
	}
	return Result{}, false
}

func (f *Finished) Add(r Result) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.list = append(f.list, r)
	if over := len(f.list) - f.max; over > 0 {
		f.list = append(f.list[:0:0], f.list[over:]...)
	}
	if f.path == "" {
		return nil
	}
	raw, err := json.Marshal(f.list)
	if err != nil {
		return err
	}
	return config.WriteFileAtomic(f.path, raw)
}
