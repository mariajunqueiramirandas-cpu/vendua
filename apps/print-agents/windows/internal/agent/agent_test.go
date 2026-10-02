package agent

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/api"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/config"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/discovery"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/jobs"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/printer"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/secret"
)

const wait = 5 * time.Second

// fakeCore is just enough of Core's agent API to drive the agent.
type fakeCore struct {
	t   *testing.T
	srv *httptest.Server

	mu             sync.Mutex
	tokens         map[string]bool
	pendingPolls   int
	streamFailures int
	printers       []api.Printer

	pairCalls atomic.Int32
	opened    atomic.Int32
	streams   chan *streamConn
	results   chan result
	puts      chan []api.Discovered
	deletes   chan string
}

type result struct {
	ID, Key, Error string
	OK             bool
}

type streamConn struct {
	frames chan string
	close  chan struct{}
}

func (s *streamConn) send(event string, data any) {
	b, _ := json.Marshal(data)
	s.frames <- fmt.Sprintf("event: %s\ndata: %s\n\n", event, b)
}

func (s *streamConn) job(id, printerID string, payload []byte) {
	s.send("job", map[string]string{"id": id, "printerId": printerID, "createdAt": "2026-10-02T12:00:00Z", "data": base64.StdEncoding.EncodeToString(payload)})
}

func newFakeCore(t *testing.T) *fakeCore {
	c := &fakeCore{
		t:       t,
		tokens:  map[string]bool{},
		streams: make(chan *streamConn, 8),
		results: make(chan result, 32),
		puts:    make(chan []api.Discovered, 8),
		deletes: make(chan string, 2),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /admin/v1/agent/pair", func(w http.ResponseWriter, r *http.Request) {
		c.pairCalls.Add(1)
		writeJSON(w, 200, api.PairResponse{DeviceCode: "dev-1", UserCode: "K7QD-4MXA", ApproveURL: c.srv.URL + "/admin/impressoras/parear?code=K7QD-4MXA", ExpiresIn: 600, Interval: 3})
	})
	mux.HandleFunc("POST /admin/v1/agent/pair/poll", func(w http.ResponseWriter, r *http.Request) {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.pendingPolls > 0 {
			c.pendingPolls--
			writeJSON(w, 200, map[string]string{"status": "pending"})
			return
		}
		c.tokens["tok-1"] = true
		writeJSON(w, 200, map[string]any{"status": "approved", "token": "tok-1", "store": map[string]string{"name": "Quero Pudim"}})
	})
	mux.HandleFunc("GET /admin/v1/agent/stream", c.stream)
	mux.HandleFunc("POST /admin/v1/agent/jobs/{id}/result", func(w http.ResponseWriter, r *http.Request) {
		if !c.authorized(w, r) {
			return
		}
		var body struct {
			OK    bool   `json:"ok"`
			Error string `json:"error"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		c.results <- result{ID: r.PathValue("id"), Key: r.Header.Get("Idempotency-Key"), OK: body.OK, Error: body.Error}
		writeJSON(w, 200, map[string]any{})
	})
	mux.HandleFunc("PUT /admin/v1/agent/printers", func(w http.ResponseWriter, r *http.Request) {
		if !c.authorized(w, r) {
			return
		}
		var body struct {
			Printers []api.Discovered `json:"printers"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		c.puts <- body.Printers
		c.mu.Lock()
		defer c.mu.Unlock()
		writeJSON(w, 200, map[string]any{"printers": c.printers})
	})
	mux.HandleFunc("DELETE /admin/v1/agent/self", func(w http.ResponseWriter, r *http.Request) {
		if !c.authorized(w, r) {
			return
		}
		c.deletes <- r.Header.Get("Idempotency-Key")
		writeJSON(w, 200, map[string]any{})
	})
	mux.HandleFunc("GET /admin/impressoras/parear", func(w http.ResponseWriter, r *http.Request) {})
	c.srv = httptest.NewServer(mux)
	t.Cleanup(c.srv.Close)
	return c
}

func (c *fakeCore) authorized(w http.ResponseWriter, r *http.Request) bool {
	c.mu.Lock()
	ok := c.tokens[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")]
	c.mu.Unlock()
	if !ok {
		writeJSON(w, 401, map[string]any{"error": map[string]string{"code": "UNAUTHENTICATED", "message": "no"}})
	}
	return ok
}

func (c *fakeCore) stream(w http.ResponseWriter, r *http.Request) {
	if !c.authorized(w, r) {
		return
	}
	c.mu.Lock()
	fail := c.streamFailures > 0
	if fail {
		c.streamFailures--
	}
	printers := c.printers
	c.mu.Unlock()
	if fail {
		writeJSON(w, 503, map[string]any{"error": map[string]string{"code": "UNAVAILABLE", "message": "down"}})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.WriteHeader(200)
	fl := w.(http.Flusher)
	sc := &streamConn{frames: make(chan string, 16), close: make(chan struct{})}
	sc.send("hello", map[string]any{"device": map[string]string{"id": "d1", "name": "CAIXA-PC"}, "store": map[string]string{"name": "Quero Pudim"}, "printers": printers})
	c.streams <- sc
	for {
		select {
		case f := <-sc.frames:
			_, _ = io.WriteString(w, f)
			fl.Flush()
		case <-sc.close:
			return
		case <-r.Context().Done():
			return
		}
	}
}

// resultFor skips results for other jobs (resends of earlier ones).
func (c *fakeCore) resultFor(t *testing.T, id string) result {
	t.Helper()
	for {
		if r := recv(t, c.results, "result "+id); r.ID == id {
			return r
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// fakePrinter is a raw TCP (JetDirect) printer that records each job.
type fakePrinter struct {
	ln    net.Listener
	jobs  chan []byte
	conns atomic.Int32
}

func newFakePrinter(t *testing.T) *fakePrinter {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	p := &fakePrinter{ln: ln, jobs: make(chan []byte, 8)}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			p.conns.Add(1)
			go func() {
				defer conn.Close()
				b, _ := io.ReadAll(conn)
				p.jobs <- b
			}()
		}
	}()
	return p
}

func closedPort(t *testing.T) string {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close()
	return addr
}

type harness struct {
	agent  *Agent
	store  *config.Store
	opened chan string
	cancel context.CancelFunc
	done   chan struct{}
}

func startAgent(t *testing.T, core *fakeCore, dataDir string, tweak func(*Options)) *harness {
	t.Helper()
	store := config.NewStore(filepath.Join(dataDir, "config.json"), secret.Plain{})
	fin, err := jobs.OpenFinished(filepath.Join(dataDir, "finished.json"), 200)
	if err != nil {
		t.Fatal(err)
	}
	h := &harness{store: store, opened: make(chan string, 4), done: make(chan struct{})}
	o := Options{
		Client:   api.NewClient(core.srv.URL, "0.1.0"),
		Store:    store,
		Finished: fin,
		Sender:   printer.NewSender(),
		Discoverer: &discovery.Discoverer{
			Log: slog.New(slog.DiscardHandler),
			Local: func(context.Context) ([]api.Discovered, error) {
				return []api.Discovered{discovery.SpoolerPrinter("EPSON TM-T20X"), discovery.SpoolerPrinter("Microsoft Print to PDF")}, nil
			},
			Addrs: func() ([]netip.Addr, error) { return nil, nil },
		},
		Name:           "CAIXA-PC",
		Version:        "0.1.0",
		OpenURL:        func(u string) error { h.opened <- u; return nil },
		Log:            slog.New(slog.NewTextHandler(testWriter{t}, &slog.HandlerOptions{Level: slog.LevelDebug})),
		ScanOnStart:    true,
		PollInterval:   5 * time.Millisecond,
		BackoffMin:     10 * time.Millisecond,
		BackoffMax:     40 * time.Millisecond,
		JobRetryDelays: []time.Duration{10 * time.Millisecond, 20 * time.Millisecond},
		ReportMinDelay: 10 * time.Millisecond,
	}
	if tweak != nil {
		tweak(&o)
	}
	h.agent = New(o)
	ctx, cancel := context.WithCancel(context.Background())
	h.cancel = cancel
	go func() { defer close(h.done); h.agent.Run(ctx) }()
	t.Cleanup(h.stop)
	return h
}

func (h *harness) stop() {
	h.cancel()
	<-h.done
}

type testWriter struct{ t *testing.T }

func (w testWriter) Write(p []byte) (int, error) {
	w.t.Log(strings.TrimRight(string(p), "\n"))
	return len(p), nil
}

func recv[T any](t *testing.T, ch <-chan T, what string) T {
	t.Helper()
	select {
	case v := <-ch:
		return v
	case <-time.After(wait):
		t.Fatalf("timed out waiting for %s", what)
		panic("unreachable")
	}
}

func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(wait)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestEndToEnd(t *testing.T) {
	core := newFakeCore(t)
	prn := newFakePrinter(t)
	dead := closedPort(t)
	core.pendingPolls = 2
	core.printers = []api.Printer{
		{ID: "p1", Key: "tcp:" + prn.ln.Addr().String(), Kind: "tcp", Name: "Cozinha", Address: prn.ln.Addr().String()},
		{ID: "p2", Key: "tcp:" + dead, Kind: "tcp", Name: "Balcão", Address: dead},
	}
	dataDir := t.TempDir()
	h := startAgent(t, core, dataDir, nil)

	// First launch: pairs on its own and opens the approval page once.
	if u := recv(t, h.opened, "browser open"); !strings.HasSuffix(u, "code=K7QD-4MXA") {
		t.Fatalf("opened %q", u)
	}
	sc := recv(t, core.streams, "stream after pairing")
	eventually(t, "online", func() bool { return h.agent.Status().State == Online })
	if got := h.agent.Status().Text(); got != "Conectado a Quero Pudim" {
		t.Fatalf("status = %q", got)
	}
	cfg, _, _ := h.store.Load(core.srv.URL)
	if cfg.Token != "tok-1" {
		t.Fatalf("stored token = %q", cfg.Token)
	}

	// hello triggers a printer report, without virtual queues.
	put := recv(t, core.puts, "PUT /printers")
	if len(put) != 1 || put[0].Key != "spooler:EPSON TM-T20X" {
		t.Fatalf("reported %+v", put)
	}

	payload := []byte{0x1b, 0x40, 'P', 'e', 'd', 'i', 'd', 'o', ' ', '#', '4', '2', '\n', 0x00, 0xff, 0x1d, 'V', 0x41, 0x03}
	sc.job("j1", "p1", payload)
	if got := recv(t, prn.jobs, "printed bytes"); !bytes.Equal(got, payload) {
		t.Fatalf("printer got %x, want %x", got, payload)
	}
	if r := recv(t, core.results, "result j1"); r != (result{ID: "j1", Key: "job-result-j1", OK: true}) {
		t.Fatalf("result = %+v", r)
	}

	// Redelivery is acknowledged again, never printed again (checked below).
	sc.job("j1", "p1", payload)
	sc.job("j2", "nope", payload)
	if r := core.resultFor(t, "j2"); r != (result{ID: "j2", Key: "job-result-j2", Error: "Impressora não configurada neste aparelho"}) {
		t.Fatalf("result = %+v", r)
	}

	sc.job("j3", "p2", payload)
	if r := recv(t, core.results, "result j3"); r.OK || r.Error != "Sem resposta da impressora ("+dead+")" {
		t.Fatalf("result = %+v", r)
	}
	eventually(t, "printer status line", func() bool {
		for _, p := range h.agent.Status().Printers {
			if p.ID == "p2" {
				return p.Last != nil && strings.HasPrefix(p.Line(), "Balcão — Sem resposta da impressora")
			}
		}
		return false
	})

	sc.send("job", map[string]string{"id": "j4", "printerId": "p1", "data": "%%%"})
	if r := recv(t, core.results, "result j4"); r.OK || r.Error != "Dados de impressão inválidos" {
		t.Fatalf("result = %+v", r)
	}

	// The server ends the stream (its 30 min rotation): reconnect at once.
	close(sc.close)
	sc = recv(t, core.streams, "reconnected stream")
	recv(t, core.puts, "PUT after second hello")
	sc.job("j1", "p1", payload)
	if r := core.resultFor(t, "j1"); !r.OK {
		t.Fatalf("resent result = %+v", r)
	}
	if n := prn.conns.Load(); n != 1 {
		t.Fatalf("printer was contacted %d times, want 1", n)
	}

	// The merchant removes the device: token wiped, a new code requested
	// without opening the browser again.
	pairs := core.pairCalls.Load()
	sc.send("revoked", map[string]any{})
	eventually(t, "pairing again", func() bool { return core.pairCalls.Load() > pairs })
	cfg, _, _ = h.store.Load(core.srv.URL)
	if cfg.Token != "" {
		t.Fatal("token kept after revoke")
	}
	select {
	case u := <-h.opened:
		t.Fatalf("browser opened again: %s", u)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestUnauthorizedWipesToken(t *testing.T) {
	core := newFakeCore(t)
	core.pendingPolls = 1 << 30
	dataDir := t.TempDir()
	store := config.NewStore(filepath.Join(dataDir, "config.json"), secret.Plain{})
	if err := store.Save(config.Config{APIBase: core.srv.URL, Token: "stale", StoreName: "Quero Pudim"}); err != nil {
		t.Fatal(err)
	}
	h := startAgent(t, core, dataDir, nil)

	eventually(t, "pairing after 401", func() bool { return core.pairCalls.Load() > 0 })
	cfg, _, _ := h.store.Load(core.srv.URL)
	if cfg.Token != "" || cfg.StoreName != "" {
		t.Fatalf("config after 401 = %+v", cfg)
	}
	eventually(t, "code shown", func() bool { return h.agent.Status().Text() == "Código: K7QD-4MXA — aprove no painel" })
	if len(h.opened) != 0 {
		t.Fatal("opened the browser on a re-pair")
	}
}

func TestReconnectsWithBackoffAndIdleTimeout(t *testing.T) {
	core := newFakeCore(t)
	core.tokens["tok-1"] = true
	core.streamFailures = 2
	dataDir := t.TempDir()
	store := config.NewStore(filepath.Join(dataDir, "config.json"), secret.Plain{})
	if err := store.Save(config.Config{APIBase: core.srv.URL, Token: "tok-1"}); err != nil {
		t.Fatal(err)
	}
	h := startAgent(t, core, dataDir, func(o *Options) { o.IdleTimeout = 150 * time.Millisecond })

	recv(t, core.streams, "stream after two 503s")
	eventually(t, "online", func() bool { return h.agent.Status().State == Online })
	// The stream now goes silent: the agent must drop it and reconnect.
	recv(t, core.streams, "stream after idle timeout")
	if core.pairCalls.Load() != 0 {
		t.Fatal("re-paired on a network error")
	}
}

func TestDisconnect(t *testing.T) {
	core := newFakeCore(t)
	core.tokens["tok-1"] = true
	dataDir := t.TempDir()
	store := config.NewStore(filepath.Join(dataDir, "config.json"), secret.Plain{})
	if err := store.Save(config.Config{APIBase: core.srv.URL, Token: "tok-1"}); err != nil {
		t.Fatal(err)
	}
	h := startAgent(t, core, dataDir, func(o *Options) { o.ScanOnStart = false })
	recv(t, core.streams, "stream")
	eventually(t, "online", func() bool { return h.agent.Status().State == Online })

	if err := h.agent.Disconnect(context.Background()); err != nil {
		t.Fatal(err)
	}
	if key := recv(t, core.deletes, "DELETE /agent/self"); len(key) != 36 {
		t.Fatalf("idempotency key = %q", key)
	}
	eventually(t, "unpaired", func() bool { return h.agent.Status().State == Unpaired })
	time.Sleep(50 * time.Millisecond)
	if core.pairCalls.Load() != 0 {
		t.Fatal("paired again on its own after a deliberate disconnect")
	}
	h.agent.RequestPairing()
	recv(t, h.opened, "browser open on Conectar à loja")
	eventually(t, "paired again", func() bool { return h.agent.Status().State == Online })
}
