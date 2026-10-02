package jobs

import (
	"context"
	"errors"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"sync"
	"time"
	"unicode/utf16"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/api"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/printer"
)

const MsgUnknownPrinter = "Impressora não configurada neste aparelho"

var ErrDrop = errors.New("jobs: result dropped")

type Job struct {
	ID        string
	PrinterID string
	Data      []byte
}

type Sender interface {
	Send(ctx context.Context, p api.Printer, data []byte) error
}

// Reporter posts a job result to Core. Wrapping ErrDrop stops retries.
type Reporter func(ctx context.Context, jobID string, ok bool, errMsg string) error

type Options struct {
	Lookup   func(printerID string) (api.Printer, bool)
	Sender   Sender
	Report   Reporter
	Finished *Finished
	// OnResult is told about every printed or failed job (not about resends).
	OnResult func(printerID string, r Result)
	Log      *slog.Logger

	// Zero values take the spec defaults.
	RetryDelays     []time.Duration // between print attempts: 3 s, 10 s
	AttemptTimeout  time.Duration   // 2 min
	ReportMinDelay  time.Duration   // 1 s
	ReportMaxDelay  time.Duration   // 1 min
	ReportGiveUpAge time.Duration   // 10 min
}

// Dispatcher prints jobs in order per printer and in parallel across printers.
type Dispatcher struct {
	o   Options
	ctx context.Context
	wg  sync.WaitGroup

	mu        sync.Mutex
	queues    map[string][]Job
	running   map[string]bool
	pending   map[string]bool
	reporting map[string]chan struct{} // job id → retry-now signal
}

// New returns a dispatcher whose workers stop when ctx is done.
func New(ctx context.Context, o Options) *Dispatcher {
	if o.RetryDelays == nil {
		o.RetryDelays = []time.Duration{3 * time.Second, 10 * time.Second}
	}
	if o.AttemptTimeout == 0 {
		o.AttemptTimeout = 2 * time.Minute
	}
	if o.ReportMinDelay == 0 {
		o.ReportMinDelay = time.Second
	}
	if o.ReportMaxDelay == 0 {
		o.ReportMaxDelay = time.Minute
	}
	if o.ReportGiveUpAge == 0 {
		o.ReportGiveUpAge = 10 * time.Minute
	}
	if o.Log == nil {
		o.Log = slog.New(slog.DiscardHandler)
	}
	return &Dispatcher{
		o:         o,
		ctx:       ctx,
		queues:    map[string][]Job{},
		running:   map[string]bool{},
		pending:   map[string]bool{},
		reporting: map[string]chan struct{}{},
	}
}

// Submit accepts a job from the stream. It never blocks.
func (d *Dispatcher) Submit(j Job) {
	if r, ok := d.o.Finished.Get(j.ID); ok {
		d.o.Log.Info("job already finished, resending result", "job", j.ID)
		d.report(r)
		return
	}
	if _, ok := d.o.Lookup(j.PrinterID); !ok {
		d.finish(j.PrinterID, Result{ID: j.ID, Error: MsgUnknownPrinter})
		return
	}

	d.mu.Lock()
	defer d.mu.Unlock()
	if d.pending[j.ID] {
		return
	}
	d.pending[j.ID] = true
	d.queues[j.PrinterID] = append(d.queues[j.PrinterID], j)
	if !d.running[j.PrinterID] {
		d.running[j.PrinterID] = true
		d.wg.Add(1)
		go d.work(j.PrinterID)
	}
}

// Reject fails a job that cannot be printed at all (a malformed payload).
func (d *Dispatcher) Reject(j Job, msg string) {
	if r, ok := d.o.Finished.Get(j.ID); ok {
		d.report(r)
		return
	}
	d.finish(j.PrinterID, Result{ID: j.ID, Error: msg})
}

// Wait blocks until every queued job is printed and its report settled.
func (d *Dispatcher) Wait() { d.wg.Wait() }

func (d *Dispatcher) work(printerID string) {
	defer d.wg.Done()
	for {
		d.mu.Lock()
		q := d.queues[printerID]
		if len(q) == 0 || d.ctx.Err() != nil {
			delete(d.queues, printerID)
			delete(d.running, printerID)
			for _, j := range q {
				delete(d.pending, j.ID)
			}
			d.mu.Unlock()
			return
		}
		j := q[0]
		d.queues[printerID] = q[1:]
		d.mu.Unlock()

		r := d.print(j)
		if d.ctx.Err() != nil && !r.OK {
			// Shutting down mid-retry: leave it unfinished so a redelivery prints it.
			d.mu.Lock()
			delete(d.pending, j.ID)
			d.mu.Unlock()
			continue
		}
		d.finish(printerID, r)
		d.mu.Lock()
		delete(d.pending, j.ID)
		d.mu.Unlock()
	}
}

func (d *Dispatcher) print(j Job) Result {
	var err error
	for attempt := 0; ; attempt++ {
		p, ok := d.o.Lookup(j.PrinterID)
		if !ok {
			return Result{ID: j.ID, Error: MsgUnknownPrinter}
		}
		ctx, cancel := context.WithTimeout(d.ctx, d.o.AttemptTimeout)
		err = d.o.Sender.Send(ctx, p, j.Data)
		cancel()
		if err == nil {
			d.o.Log.Info("job printed", "job", j.ID, "printer", p.Name, "bytes", len(j.Data))
			return Result{ID: j.ID, OK: true}
		}
		d.o.Log.Warn("print attempt failed", "job", j.ID, "printer", p.Name, "attempt", attempt+1, "err", err)
		if attempt >= len(d.o.RetryDelays) || printer.IsPermanent(err) {
			break
		}
		if !sleep(d.ctx, d.o.RetryDelays[attempt]) {
			break
		}
	}
	return Result{ID: j.ID, Error: printer.Message(err)}
}

// finish records the result before reporting it, so a redelivery that races
// the report is answered from the store instead of printing again.
func (d *Dispatcher) finish(printerID string, r Result) {
	r.Error = truncateUTF16(r.Error, 200)
	r.At = time.Now()
	if err := d.o.Finished.Add(r); err != nil {
		d.o.Log.Error("saving finished job", "job", r.ID, "err", err)
	}
	if d.o.OnResult != nil {
		d.o.OnResult(printerID, r)
	}
	d.report(r)
}

func (d *Dispatcher) report(r Result) {
	d.mu.Lock()
	if retryNow, ok := d.reporting[r.ID]; ok {
		d.mu.Unlock()
		// A redelivery means Core is reachable again: skip the backoff.
		select {
		case retryNow <- struct{}{}:
		default:
		}
		return
	}
	retryNow := make(chan struct{}, 1)
	d.reporting[r.ID] = retryNow
	d.wg.Add(1)
	d.mu.Unlock()

	go func() {
		defer d.wg.Done()
		defer func() {
			d.mu.Lock()
			delete(d.reporting, r.ID)
			d.mu.Unlock()
		}()
		start := time.Now()
		delay := d.o.ReportMinDelay
		for {
			ctx, cancel := context.WithTimeout(d.ctx, 30*time.Second)
			err := d.o.Report(ctx, r.ID, r.OK, r.Error)
			cancel()
			if err == nil {
				return
			}
			if !retryable(err) {
				d.o.Log.Warn("job result dropped", "job", r.ID, "err", err)
				return
			}
			if time.Since(start)+delay > d.o.ReportGiveUpAge {
				d.o.Log.Error("job result not delivered, giving up", "job", r.ID, "err", err)
				return
			}
			d.o.Log.Warn("job result not delivered, retrying", "job", r.ID, "in", delay, "err", err)
			t := time.NewTimer(jitter(delay))
			select {
			case <-d.ctx.Done():
				t.Stop()
				return
			case <-retryNow:
				t.Stop()
			case <-t.C:
			}
			delay = min(2*delay, d.o.ReportMaxDelay)
		}
	}()
}

// retryable is false when Core has answered for good: the job is gone (404),
// the token is (401, handled by the agent) or the request is wrong (4xx).
func retryable(err error) bool {
	if errors.Is(err, ErrDrop) {
		return false
	}
	var e *api.Error
	if !errors.As(err, &e) {
		return true
	}
	switch {
	case e.Status == http.StatusTooManyRequests, e.Status == http.StatusRequestTimeout:
		return true
	case e.Status >= 400 && e.Status < 500:
		return false
	}
	return true
}

func sleep(ctx context.Context, d time.Duration) bool {
	if d <= 0 {
		return ctx.Err() == nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-ctx.Done():
		return false
	}
}

func jitter(d time.Duration) time.Duration {
	return time.Duration(float64(d) * (0.8 + 0.4*rand.Float64()))
}

// truncateUTF16 caps s at n UTF-16 code units, the unit Core's limit counts.
func truncateUTF16(s string, n int) string {
	units := 0
	for i, r := range s {
		w := utf16.RuneLen(r)
		if w < 0 {
			w = 1
		}
		if units+w > n {
			return s[:i]
		}
		units += w
	}
	return s
}
