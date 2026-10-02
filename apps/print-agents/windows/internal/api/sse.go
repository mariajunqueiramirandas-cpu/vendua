package api

import (
	"bufio"
	"bytes"
	"errors"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Event is one Server-Sent Event.
type Event struct {
	Name string
	Data string
}

// MaxLine bounds a single SSE line; a job carries a whole ticket as base64.
const MaxLine = 8 << 20

var ErrLineTooLong = errors.New("sse: line too long")

// SSEReader parses a text/event-stream (WHATWG HTML §9.2.6).
type SSEReader struct {
	r      *bufio.Reader
	skipLF bool
	line   []byte
}

func NewSSEReader(r io.Reader) *SSEReader {
	return &SSEReader{r: bufio.NewReaderSize(r, 32<<10)}
}

// Next returns the next dispatched event. Fields other than event and data
// are ignored, as are events that carry no data.
func (s *SSEReader) Next() (Event, error) {
	var name string
	var data strings.Builder
	hasData := false
	for {
		line, err := s.readLine()
		if err != nil {
			return Event{}, err
		}
		if len(line) == 0 {
			if hasData {
				if name == "" {
					name = "message"
				}
				return Event{Name: name, Data: data.String()}, nil
			}
			name = ""
			continue
		}
		if line[0] == ':' {
			continue
		}
		field, value := line, []byte(nil)
		if i := bytes.IndexByte(line, ':'); i >= 0 {
			field, value = line[:i], line[i+1:]
			value = bytes.TrimPrefix(value, []byte{' '})
		}
		switch string(field) {
		case "event":
			name = string(value)
		case "data":
			if hasData {
				data.WriteByte('\n')
			}
			data.Write(value)
			hasData = true
		}
	}
}

// readLine accepts LF, CRLF and lone CR terminators. A CR is resolved without
// peeking ahead, so a line ending in CR never waits for the next chunk.
func (s *SSEReader) readLine() ([]byte, error) {
	s.line = s.line[:0]
	for {
		b, err := s.r.ReadByte()
		if err != nil {
			return nil, err
		}
		if s.skipLF {
			s.skipLF = false
			if b == '\n' {
				continue
			}
		}
		switch b {
		case '\n':
			return s.line, nil
		case '\r':
			s.skipLF = true
			return s.line, nil
		}
		if len(s.line) >= MaxLine {
			return nil, ErrLineTooLong
		}
		s.line = append(s.line, b)
	}
}

// ErrIdle is returned by an IdleReader once nothing arrived for its timeout.
var ErrIdle = errors.New("sse: no data received within the idle timeout")

// IdleReader closes the underlying stream when no bytes arrive for d, which
// unblocks a Read stuck on a half-open connection.
type IdleReader struct {
	rc    io.ReadCloser
	d     time.Duration
	timer *time.Timer
	fired atomic.Bool
	once  sync.Once
}

func NewIdleReader(rc io.ReadCloser, d time.Duration) *IdleReader {
	ir := &IdleReader{rc: rc, d: d}
	ir.timer = time.AfterFunc(d, func() {
		ir.fired.Store(true)
		ir.Close()
	})
	return ir
}

func (ir *IdleReader) Read(p []byte) (int, error) {
	n, err := ir.rc.Read(p)
	if ir.fired.Load() {
		return n, ErrIdle
	}
	if n > 0 {
		ir.timer.Reset(ir.d)
	}
	return n, err
}

func (ir *IdleReader) Close() error {
	var err error
	ir.once.Do(func() {
		ir.timer.Stop()
		err = ir.rc.Close()
	})
	return err
}
