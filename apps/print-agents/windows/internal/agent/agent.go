// Package agent ties pairing, the job stream, printing and discovery together.
package agent

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"sync"
	"time"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/api"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/config"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/discovery"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/jobs"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/update"
)

type Options struct {
	Client     *api.Client
	Store      *config.Store
	Finished   *jobs.Finished
	Sender     jobs.Sender
	Discoverer *discovery.Discoverer
	// Name is how the device shows in the admin (the computer name).
	Name    string
	Version string
	OpenURL func(url string) error
	Log     *slog.Logger
	// Headless renews expired pairing codes by itself: nobody can click.
	Headless bool
	// ScanOnStart probes the LAN for network printers once at startup.
	ScanOnStart bool
	// UpdateURL is the version.json to poll; empty disables update checks.
	UpdateURL string

	// Zero values take production timings.
	IdleTimeout    time.Duration // 60 s
	BackoffMin     time.Duration // 1 s
	BackoffMax     time.Duration // 30 s
	RateLimitWait  time.Duration // 60 s
	PollInterval   time.Duration // the interval Core sends
	JobRetryDelays []time.Duration
	ReportMinDelay time.Duration
}

var errRevoked = errors.New("device revoked by the store")

type Agent struct {
	o        Options
	log      *slog.Logger
	firstRun bool

	mu               sync.Mutex
	cfg              config.Config
	state            State
	userCode         string
	approveURL       string
	scanning         bool
	updateVersion    string
	last             map[string]jobs.Result
	connCancel       context.CancelFunc
	userDisconnected bool
	subs             []chan struct{}

	pairNow   chan struct{}
	scanNow   chan struct{}
	reportNow chan struct{}
	disp      *jobs.Dispatcher
}

func New(o Options) *Agent {
	if o.IdleTimeout == 0 {
		o.IdleTimeout = 60 * time.Second
	}
	if o.BackoffMin == 0 {
		o.BackoffMin = time.Second
	}
	if o.BackoffMax == 0 {
		o.BackoffMax = 30 * time.Second
	}
	if o.RateLimitWait == 0 {
		o.RateLimitWait = 60 * time.Second
	}
	if o.Log == nil {
		o.Log = slog.New(slog.DiscardHandler)
	}
	if o.OpenURL == nil {
		o.OpenURL = func(string) error { return nil }
	}
	a := &Agent{
		o:         o,
		log:       o.Log,
		last:      map[string]jobs.Result{},
		pairNow:   make(chan struct{}, 1),
		scanNow:   make(chan struct{}, 1),
		reportNow: make(chan struct{}, 1),
	}
	cfg, exists, err := o.Store.Load(o.Client.Base())
	if err != nil {
		a.log.Error("reading config, starting unpaired", "err", err)
	}
	cfg.APIBase = o.Client.Base()
	a.cfg, a.firstRun = cfg, !exists
	if a.firstRun {
		// Written now so only this very first launch opens the browser.
		a.saveLocked()
	}
	if cfg.Token == "" {
		a.state = Unpaired
	} else {
		a.state = Connecting
	}
	return a
}

// Run blocks until ctx is done.
func (a *Agent) Run(ctx context.Context) {
	a.disp = jobs.New(ctx, jobs.Options{
		Lookup:         a.printer,
		Sender:         a.o.Sender,
		Report:         a.reportResult,
		Finished:       a.o.Finished,
		OnResult:       a.onResult,
		Log:            a.log,
		RetryDelays:    a.o.JobRetryDelays,
		ReportMinDelay: a.o.ReportMinDelay,
	})
	var wg sync.WaitGroup
	for _, loop := range []func(context.Context){a.scanLoop, a.reportPrintersLoop, a.updateLoop} {
		wg.Add(1)
		go func() { defer wg.Done(); loop(ctx) }()
	}
	if a.o.ScanOnStart {
		signal(a.scanNow)
	}

	autoPair, openBrowser := true, a.firstRun
	for ctx.Err() == nil {
		if tok := a.token(); tok != "" {
			a.connect(ctx, tok)
			a.mu.Lock()
			autoPair, a.userDisconnected = !a.userDisconnected, false
			a.mu.Unlock()
			continue
		}
		a.pair(ctx, autoPair, openBrowser)
		autoPair, openBrowser = true, false
	}
	wg.Wait()
	a.disp.Wait()
}

// RequestPairing is the "Conectar à loja…" action: a new code when there is
// none (or it expired), or the approval page again for the current one.
func (a *Agent) RequestPairing() {
	a.mu.Lock()
	paired := a.cfg.Token != ""
	a.mu.Unlock()
	if !paired {
		signal(a.pairNow)
	}
}

// Rescan is "Procurar impressoras".
func (a *Agent) Rescan() { signal(a.scanNow) }

// TestPrinters asks Core for a test ticket on every configured printer.
func (a *Agent) TestPrinters(ctx context.Context) error {
	tok := a.token()
	if tok == "" {
		return errors.New("not paired")
	}
	a.mu.Lock()
	printers := slices.Clone(a.cfg.Printers)
	a.mu.Unlock()
	var errs []error
	for _, p := range printers {
		if _, err := a.o.Client.TestPrinter(ctx, tok, p.ID); err != nil {
			if api.IsUnauthorized(err) {
				a.invalidate(tok)
				return err
			}
			errs = append(errs, fmt.Errorf("%s: %w", p.Name, err))
		}
	}
	return errors.Join(errs...)
}

// Disconnect is "Desconectar este computador". The local token is wiped even
// if Core cannot be told, so the computer stops printing either way.
func (a *Agent) Disconnect(ctx context.Context) error {
	tok := a.token()
	if tok == "" {
		return nil
	}
	err := a.o.Client.DeleteSelf(ctx, tok)
	if api.IsUnauthorized(err) || api.HasStatus(err, http.StatusNotFound) {
		err = nil
	}
	a.mu.Lock()
	a.userDisconnected = true
	a.mu.Unlock()
	a.invalidate(tok)
	return err
}

func (a *Agent) pair(ctx context.Context, auto, openBrowser bool) {
	if !auto {
		a.setState(Unpaired)
		if !a.waitPairRequest(ctx) {
			return
		}
		openBrowser = true
	}
	bo := newBackoff(a.o.BackoffMin, a.o.BackoffMax)
	failing := false
	for ctx.Err() == nil {
		if !failing {
			a.setPairing("", "")
		}
		pr, err := a.o.Client.Pair(ctx, a.o.Name)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			failing = true
			wait := bo.Next()
			if api.HasStatus(err, http.StatusTooManyRequests) {
				wait = a.o.RateLimitWait
			}
			a.log.Warn("requesting pairing code failed", "err", err, "retry_in", wait.Round(time.Millisecond))
			a.setState(Offline)
			if a.sleepOrPairRequest(ctx, wait) {
				openBrowser = true
			}
			continue
		}
		bo.Reset()
		failing = false
		a.setPairing(pr.UserCode, pr.ApproveURL)
		a.log.Info("pairing code ready: approve it in the store admin", "code", pr.UserCode, "url", pr.ApproveURL)
		if openBrowser {
			a.openURL(pr.ApproveURL)
			openBrowser = false
		}
		if a.poll(ctx, pr) {
			return
		}
		if ctx.Err() != nil {
			return
		}
		a.log.Info("pairing code expired", "code", pr.UserCode)
		a.setState(PairingExpired)
		if !a.o.Headless {
			if !a.waitPairRequest(ctx) {
				return
			}
			openBrowser = true
		}
	}
}

// poll returns true once approved, false when the code expired or ctx ended.
func (a *Agent) poll(ctx context.Context, pr *api.PairResponse) bool {
	interval := time.Duration(max(pr.Interval, 1)) * time.Second
	if a.o.PollInterval > 0 {
		interval = a.o.PollInterval
	}
	expiresIn := time.Duration(pr.ExpiresIn) * time.Second
	if expiresIn <= 0 {
		expiresIn = 10 * time.Minute
	}
	deadline := time.Now().Add(expiresIn)
	for {
		t := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			t.Stop()
			return false
		case <-a.pairNow:
			t.Stop()
			a.openURL(pr.ApproveURL)
			continue
		case <-t.C:
		}
		if time.Now().After(deadline) {
			return false
		}
		res, err := a.o.Client.PollPair(ctx, pr.DeviceCode)
		switch {
		case api.HasStatus(err, http.StatusGone), api.HasStatus(err, http.StatusNotFound):
			return false
		case api.HasStatus(err, http.StatusTooManyRequests):
			interval += 5 * time.Second
			continue
		case err != nil:
			a.log.Warn("pairing poll failed", "err", err)
			continue
		case res.Status != "approved":
			continue
		}
		a.mu.Lock()
		a.cfg.Token = res.Token
		a.cfg.StoreName = res.Store.Name
		a.cfg.Printers = nil
		a.userCode, a.approveURL = "", ""
		a.state = Connecting
		a.saveLocked()
		a.mu.Unlock()
		a.notify()
		a.log.Info("paired", "store", res.Store.Name)
		return true
	}
}

// connect keeps the job stream open until the token is no longer valid.
func (a *Agent) connect(ctx context.Context, tok string) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	a.mu.Lock()
	if a.cfg.Token != tok {
		a.mu.Unlock()
		return
	}
	a.connCancel = cancel
	if a.state != Online {
		a.state = Connecting
	}
	a.mu.Unlock()
	a.notify()
	defer func() {
		a.mu.Lock()
		a.connCancel = nil
		a.mu.Unlock()
	}()

	bo := newBackoff(a.o.BackoffMin, a.o.BackoffMax)
	for ctx.Err() == nil {
		hello, err := a.stream(ctx, tok)
		if ctx.Err() != nil {
			return
		}
		if errors.Is(err, errRevoked) || api.IsUnauthorized(err) {
			a.log.Warn("device no longer authorized, pairing again", "err", err)
			a.invalidate(tok)
			return
		}
		if hello {
			bo.Reset()
			if err == nil {
				a.log.Info("stream closed by server, reconnecting")
				continue
			}
		}
		if err == nil {
			err = errors.New("stream ended before hello")
		}
		wait := bo.Next()
		a.log.Warn("stream down", "err", err, "retry_in", wait.Round(time.Millisecond))
		a.setState(Offline)
		if !sleep(ctx, wait) {
			return
		}
	}
}

// stream reads one SSE connection. hello reports whether the server greeted
// us; a clean close (err == nil) after that is the server's normal rotation.
func (a *Agent) stream(ctx context.Context, tok string) (hello bool, err error) {
	body, err := a.o.Client.OpenStream(ctx, tok)
	if err != nil {
		return false, err
	}
	ir := api.NewIdleReader(body, a.o.IdleTimeout)
	defer ir.Close()
	r := api.NewSSEReader(ir)
	for {
		ev, err := r.Next()
		if errors.Is(err, io.EOF) {
			return hello, nil
		}
		if err != nil {
			return hello, err
		}
		switch ev.Name {
		case "hello":
			var m struct {
				Device struct {
					ID   string `json:"id"`
					Name string `json:"name"`
				} `json:"device"`
				Store struct {
					Name string `json:"name"`
				} `json:"store"`
				Printers []api.Printer `json:"printers"`
			}
			if !a.decode(ev, &m) {
				continue
			}
			hello = true
			a.mu.Lock()
			a.cfg.StoreName = m.Store.Name
			a.cfg.Printers = m.Printers
			a.state = Online
			a.saveLocked()
			a.mu.Unlock()
			a.notify()
			a.log.Info("online", "store", m.Store.Name, "device", m.Device.ID, "printers", len(m.Printers))
			signal(a.reportNow)
		case "config":
			var m struct {
				Printers []api.Printer `json:"printers"`
			}
			if a.decode(ev, &m) {
				a.setPrinters(m.Printers)
			}
		case "job":
			var m struct {
				ID        string `json:"id"`
				PrinterID string `json:"printerId"`
				Data      string `json:"data"`
			}
			if !a.decode(ev, &m) || m.ID == "" {
				continue
			}
			a.log.Info("job received", "job", m.ID, "printer", m.PrinterID)
			j := jobs.Job{ID: m.ID, PrinterID: m.PrinterID}
			if j.Data, err = base64.StdEncoding.DecodeString(m.Data); err != nil {
				a.log.Error("job payload is not base64", "job", m.ID, "err", err)
				a.disp.Reject(j, "Dados de impressão inválidos")
				continue
			}
			a.disp.Submit(j)
		case "revoked":
			return hello, errRevoked
		case "ping":
		default:
			a.log.Debug("ignoring stream event", "event", ev.Name)
		}
	}
}

func (a *Agent) decode(ev api.Event, v any) bool {
	if err := json.Unmarshal([]byte(ev.Data), v); err != nil {
		a.log.Error("malformed stream event", "event", ev.Name, "err", err)
		return false
	}
	return true
}

// invalidate forgets tok if it is still the current token and drops its
// connection. Comparing first keeps a late 401 for an old token from wiping
// a fresh pairing.
func (a *Agent) invalidate(tok string) {
	a.mu.Lock()
	if a.cfg.Token != tok {
		a.mu.Unlock()
		return
	}
	a.cfg.Token, a.cfg.StoreName, a.cfg.Printers = "", "", nil
	a.state = Unpaired
	a.saveLocked()
	cancel := a.connCancel
	a.mu.Unlock()
	a.notify()
	if cancel != nil {
		cancel()
	}
}

func (a *Agent) reportResult(ctx context.Context, jobID string, ok bool, msg string) error {
	tok := a.token()
	if tok == "" {
		return fmt.Errorf("%w: not paired", jobs.ErrDrop)
	}
	err := a.o.Client.ReportResult(ctx, tok, jobID, ok, msg)
	if api.IsUnauthorized(err) {
		a.invalidate(tok)
	}
	return err
}

func (a *Agent) onResult(printerID string, r jobs.Result) {
	a.mu.Lock()
	a.last[printerID] = r
	a.mu.Unlock()
	a.notify()
}

func (a *Agent) printer(id string) (api.Printer, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	i := slices.IndexFunc(a.cfg.Printers, func(p api.Printer) bool { return p.ID == id })
	if i < 0 {
		return api.Printer{}, false
	}
	return a.cfg.Printers[i], true
}

func (a *Agent) setPrinters(ps []api.Printer) {
	a.mu.Lock()
	a.cfg.Printers = ps
	a.saveLocked()
	a.mu.Unlock()
	a.notify()
}

func (a *Agent) scanLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-a.scanNow:
		}
		a.setScanning(true)
		if err := a.o.Discoverer.ScanNetwork(ctx); err != nil && ctx.Err() == nil {
			a.log.Warn("network scan failed", "err", err)
		}
		a.setScanning(false)
		signal(a.reportNow)
	}
}

func (a *Agent) reportPrintersLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-a.reportNow:
		}
		tok := a.token()
		if tok == "" {
			continue
		}
		found := a.o.Discoverer.Collect(ctx)
		key := api.NewUUID()
		for attempt := 1; ; attempt++ {
			printers, err := a.o.Client.PutPrinters(ctx, tok, key, found)
			if err == nil {
				a.log.Info("reported printers", "found", len(found), "configured", len(printers))
				a.setPrinters(printers)
				break
			}
			if api.IsUnauthorized(err) {
				a.invalidate(tok)
				break
			}
			a.log.Warn("reporting printers failed", "attempt", attempt, "err", err)
			var ae *api.Error
			if attempt == 3 || (errors.As(err, &ae) && ae.Status < 500 && ae.Status != http.StatusTooManyRequests) {
				break
			}
			if !sleep(ctx, time.Duration(attempt)*2*time.Second) {
				return
			}
		}
	}
}

func (a *Agent) updateLoop(ctx context.Context) {
	if a.o.UpdateURL == "" {
		return
	}
	client := &http.Client{}
	for {
		v, err := update.Latest(ctx, client, a.o.UpdateURL)
		switch {
		case err != nil:
			a.log.Debug("update check failed", "err", err)
		case update.Newer(v, a.o.Version):
			a.mu.Lock()
			changed := a.updateVersion != v
			a.updateVersion = v
			a.mu.Unlock()
			if changed {
				a.log.Info("update available", "version", v)
				a.notify()
			}
		}
		if !sleep(ctx, update.CheckInterval) {
			return
		}
	}
}

func (a *Agent) waitPairRequest(ctx context.Context) bool {
	select {
	case <-ctx.Done():
		return false
	case <-a.pairNow:
		return true
	}
}

// sleepOrPairRequest waits d, cut short (returning true) by "Conectar à loja…".
func (a *Agent) sleepOrPairRequest(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	case <-a.pairNow:
		return true
	}
	return false
}

func (a *Agent) openURL(u string) {
	if err := a.o.OpenURL(u); err != nil {
		a.log.Warn("opening browser failed", "url", u, "err", err)
	}
}

func (a *Agent) token() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cfg.Token
}

func (a *Agent) saveLocked() {
	if err := a.o.Store.Save(a.cfg); err != nil {
		a.log.Error("saving config", "err", err)
	}
}

func signal(ch chan struct{}) {
	select {
	case ch <- struct{}{}:
	default:
	}
}

func sleep(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-ctx.Done():
		return false
	}
}
