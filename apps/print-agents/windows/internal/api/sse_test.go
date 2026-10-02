package api

import (
	"errors"
	"io"
	"strings"
	"testing"
	"time"
)

func TestSSEReader(t *testing.T) {
	stream := ": comment\n" +
		"event: hello\n" +
		"data: {\"a\":1}\n\n" +
		"event: job\r\n" +
		"data: line one\r\n" +
		"data:line two\r\n" +
		"data:  keeps one space\r\n\r\n" +
		"event: ignored-no-data\n\n" +
		"data: default name\r\r" +
		"event: ping\nid: 7\nretry: 100\ndata: {}\n\n" +
		"data\n\n" +
		"event: trailing\ndata: never dispatched"

	r := NewSSEReader(strings.NewReader(stream))
	want := []Event{
		{"hello", `{"a":1}`},
		{"job", "line one\nline two\n keeps one space"},
		{"message", "default name"},
		{"ping", "{}"},
		{"message", ""},
	}
	for i, w := range want {
		got, err := r.Next()
		if err != nil {
			t.Fatalf("event %d: %v", i, err)
		}
		if got != w {
			t.Fatalf("event %d = %+v, want %+v", i, got, w)
		}
	}
	if _, err := r.Next(); err != io.EOF {
		t.Fatalf("after last event err = %v, want EOF", err)
	}
}

func TestSSEReaderLineCap(t *testing.T) {
	r := NewSSEReader(strings.NewReader("data: " + strings.Repeat("x", MaxLine) + "\n\n"))
	if _, err := r.Next(); !errors.Is(err, ErrLineTooLong) {
		t.Fatalf("err = %v", err)
	}
}

func TestIdleReaderTimesOut(t *testing.T) {
	pr, pw := io.Pipe()
	ir := NewIdleReader(pr, 50*time.Millisecond)
	go func() { _, _ = pw.Write([]byte("abc")) }()
	buf := make([]byte, 8)
	if n, err := ir.Read(buf); err != nil || n != 3 {
		t.Fatalf("first read = %d, %v", n, err)
	}
	start := time.Now()
	if _, err := ir.Read(buf); !errors.Is(err, ErrIdle) {
		t.Fatalf("idle read err = %v", err)
	}
	if time.Since(start) < 40*time.Millisecond {
		t.Fatal("timed out too early")
	}
}
