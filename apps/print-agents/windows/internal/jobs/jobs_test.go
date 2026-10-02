package jobs

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/api"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/printer"
)

type fakeSender struct {
	mu       sync.Mutex
	fail     map[string]error // by printer id
	attempts map[string]int   // by printer id
	printed  []string         // job payloads, in order
	block    chan struct{}
}

func (f *fakeSender) Send(_ context.Context, p api.Printer, data []byte) error {
	if f.block != nil {
		<-f.block
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.attempts[p.ID]++
	if err := f.fail[p.ID]; err != nil {
		return err
	}
	f.printed = append(f.printed, string(data))
	return nil
}

type report struct {
	id  string
	ok  bool
	msg string
}

type fakeCore struct {
	mu      sync.Mutex
	reports []report
	errs    []error // returned in order before succeeding
}

func (c *fakeCore) Report(_ context.Context, id string, ok bool, msg string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.reports = append(c.reports, report{id, ok, msg})
	if len(c.errs) > 0 {
		err := c.errs[0]
		c.errs = c.errs[1:]
		return err
	}
	return nil
}

func newTestDispatcher(t *testing.T, s *fakeSender, c *fakeCore) (*Dispatcher, *Finished) {
	t.Helper()
	fin, err := OpenFinished(filepath.Join(t.TempDir(), "finished.json"), 200)
	if err != nil {
		t.Fatal(err)
	}
	printers := map[string]api.Printer{
		"p1": {ID: "p1", Kind: "tcp", Name: "Cozinha"},
		"p2": {ID: "p2", Kind: "tcp", Name: "Caixa"},
	}
	d := New(context.Background(), Options{
		Lookup:         func(id string) (api.Printer, bool) { p, ok := printers[id]; return p, ok },
		Sender:         s,
		Report:         c.Report,
		Finished:       fin,
		RetryDelays:    []time.Duration{time.Millisecond, 2 * time.Millisecond},
		ReportMinDelay: time.Millisecond,
		ReportMaxDelay: 4 * time.Millisecond,
	})
	return d, fin
}

func newFakeSender() *fakeSender {
	return &fakeSender{fail: map[string]error{}, attempts: map[string]int{}}
}

func TestFIFOPerPrinterAndResults(t *testing.T) {
	s, c := newFakeSender(), &fakeCore{}
	d, fin := newTestDispatcher(t, s, c)
	for i := range 5 {
		d.Submit(Job{ID: fmt.Sprintf("j%d", i), PrinterID: "p1", Data: []byte(fmt.Sprint(i))})
	}
	d.Wait()
	if got := strings.Join(s.printed, ""); got != "01234" {
		t.Fatalf("printed order = %q", got)
	}
	if len(c.reports) != 5 {
		t.Fatalf("reports = %+v", c.reports)
	}
	if r, ok := fin.Get("j3"); !ok || !r.OK {
		t.Fatalf("finished j3 = %+v, %v", r, ok)
	}
}

func TestDuplicateJobIsNotPrintedTwice(t *testing.T) {
	s, c := newFakeSender(), &fakeCore{}
	s.block = make(chan struct{})
	d, _ := newTestDispatcher(t, s, c)

	d.Submit(Job{ID: "j1", PrinterID: "p1", Data: []byte("x")})
	d.Submit(Job{ID: "j1", PrinterID: "p1", Data: []byte("x")}) // while printing
	close(s.block)
	d.Wait()
	d.Submit(Job{ID: "j1", PrinterID: "p1", Data: []byte("x")}) // after finishing
	d.Wait()

	if s.attempts["p1"] != 1 {
		t.Fatalf("printed %d times", s.attempts["p1"])
	}
	if len(c.reports) != 2 || !c.reports[0].ok || !c.reports[1].ok {
		t.Fatalf("reports = %+v, want the result sent twice", c.reports)
	}
}

func TestUnknownPrinter(t *testing.T) {
	s, c := newFakeSender(), &fakeCore{}
	d, _ := newTestDispatcher(t, s, c)
	d.Submit(Job{ID: "j1", PrinterID: "nope", Data: []byte("x")})
	d.Wait()
	want := report{"j1", false, "Impressora não configurada neste aparelho"}
	if len(c.reports) != 1 || c.reports[0] != want {
		t.Fatalf("reports = %+v", c.reports)
	}
}

func TestRetriesThenReportsFailure(t *testing.T) {
	s, c := newFakeSender(), &fakeCore{}
	s.fail["p1"] = &printer.Error{Msg: "Sem resposta da impressora (10.0.0.9:9100)", Err: errors.New("i/o timeout")}
	s.fail["p2"] = &printer.Error{Msg: "Tipo de impressora não suportado neste computador", Permanent: true}
	var mu sync.Mutex
	last := map[string]Result{}
	d, _ := newTestDispatcher(t, s, c)
	d.o.OnResult = func(pid string, r Result) { mu.Lock(); last[pid] = r; mu.Unlock() }

	d.Submit(Job{ID: "j1", PrinterID: "p1", Data: []byte("x")})
	d.Submit(Job{ID: "j2", PrinterID: "p2", Data: []byte("x")})
	d.Wait()

	if s.attempts["p1"] != 3 {
		t.Fatalf("p1 attempts = %d, want 3", s.attempts["p1"])
	}
	if s.attempts["p2"] != 1 {
		t.Fatalf("permanent error retried: %d attempts", s.attempts["p2"])
	}
	if r := last["p1"]; r.OK || r.Error != "Sem resposta da impressora (10.0.0.9:9100)" {
		t.Fatalf("p1 result = %+v", r)
	}
}

func TestReportRetriesUntilDeliveredOrGone(t *testing.T) {
	s := newFakeSender()
	c := &fakeCore{errs: []error{errors.New("connection refused"), &api.Error{Status: 503}}}
	d, _ := newTestDispatcher(t, s, c)
	d.Submit(Job{ID: "j1", PrinterID: "p1", Data: []byte("x")})
	d.Wait()
	if len(c.reports) != 3 {
		t.Fatalf("report attempts = %d, want 3", len(c.reports))
	}

	c2 := &fakeCore{errs: []error{&api.Error{Status: 404, Code: "JOB_NOT_FOUND"}}}
	d2, _ := newTestDispatcher(t, newFakeSender(), c2)
	d2.Submit(Job{ID: "j1", PrinterID: "p1", Data: []byte("x")})
	d2.Wait()
	if len(c2.reports) != 1 {
		t.Fatalf("404 retried: %d attempts", len(c2.reports))
	}
}

func TestFinishedStoreKeepsLastN(t *testing.T) {
	path := filepath.Join(t.TempDir(), "finished.json")
	f, err := OpenFinished(path, 3)
	if err != nil {
		t.Fatal(err)
	}
	for i := range 5 {
		if err := f.Add(Result{ID: fmt.Sprint(i), OK: true}); err != nil {
			t.Fatal(err)
		}
	}
	g, err := OpenFinished(path, 3)
	if err != nil {
		t.Fatal(err)
	}
	for i, want := range []bool{false, false, true, true, true} {
		if _, ok := g.Get(fmt.Sprint(i)); ok != want {
			t.Fatalf("Get(%d) = %v, want %v", i, ok, want)
		}
	}
}

func TestTruncateUTF16(t *testing.T) {
	if got := truncateUTF16("ação", 3); got != "açã" {
		t.Fatalf("got %q", got)
	}
	if got := truncateUTF16("a😀b", 2); got != "a" {
		t.Fatalf("surrogate pair split: %q", got)
	}
}
