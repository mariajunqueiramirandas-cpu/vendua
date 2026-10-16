package usbprint

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

// A FIFO stands in for /dev/usb/lp0: a reader that stops reading is a printer
// that stopped taking data.
func fifo(t *testing.T) (string, *os.File) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "lp0")
	if err := syscall.Mkfifo(path, 0o600); err != nil {
		t.Skip("mkfifo:", err)
	}
	r, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { r.Close() })
	return path, r
}

func TestWriteDeliversEverything(t *testing.T) {
	path, r := fifo(t)
	data := bytes.Repeat([]byte("ESC/POS "), 10_000)
	got := make(chan []byte)
	go func() {
		var buf bytes.Buffer
		for buf.Len() < len(data) {
			_ = r.SetReadDeadline(time.Now().Add(5 * time.Second))
			if _, err := io.CopyN(&buf, r, int64(len(data)-buf.Len())); err != nil && !errors.Is(err, io.EOF) {
				break
			}
		}
		got <- buf.Bytes()
	}()
	if err := Write(context.Background(), Device{Path: path}, 2*time.Second, data); err != nil {
		t.Fatal(err)
	}
	if b := <-got; !bytes.Equal(b, data) {
		t.Fatalf("read %d bytes, want %d", len(b), len(data))
	}
}

func TestWriteTimesOutOnAStalledPrinter(t *testing.T) {
	path, _ := fifo(t)
	start := time.Now()
	err := Write(context.Background(), Device{Path: path}, 100*time.Millisecond, make([]byte, 1<<20))
	if !errors.Is(err, ErrTimeout) {
		t.Fatalf("err = %v, want ErrTimeout", err)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatalf("took %v", time.Since(start))
	}
}

func TestWriteMissingDevice(t *testing.T) {
	err := Write(context.Background(), Device{Path: filepath.Join(t.TempDir(), "lp9")}, time.Second, []byte("x"))
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}
