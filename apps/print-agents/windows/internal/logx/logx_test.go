package logx

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestRotation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent.log")
	r, err := Open(path, 100)
	if err != nil {
		t.Fatal(err)
	}
	line := bytes.Repeat([]byte("a"), 39)
	line = append(line, '\n')
	for range 7 { // 280 bytes: two rotations
		if _, err := r.Write(line); err != nil {
			t.Fatal(err)
		}
	}
	r.Close()
	cur, _ := os.ReadFile(path)
	old, _ := os.ReadFile(path + ".1")
	if len(cur) != 40 || len(old) != 80 {
		t.Fatalf("current %d bytes, old %d bytes", len(cur), len(old))
	}
	if _, err := os.Stat(path + ".2"); !os.IsNotExist(err) {
		t.Fatal("kept more than one old file")
	}
}
