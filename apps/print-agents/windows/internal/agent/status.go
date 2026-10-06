package agent

import (
	"math/rand/v2"
	"slices"
	"time"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/api"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/jobs"
)

type State int

const (
	Unpaired State = iota
	Pairing
	PairingExpired
	Connecting
	Online
	Offline
)

func (s State) String() string {
	return [...]string{"unpaired", "pairing", "expired", "connecting", "online", "offline"}[s]
}

type PrinterStatus struct {
	api.Printer
	Last *jobs.Result
}

// Status is a snapshot for the tray (or the headless log).
type Status struct {
	State         State
	Paired        bool
	StoreName     string
	UserCode      string
	ApproveURL    string
	Scanning      bool
	UpdateVersion string
	// Reason is why the agent is Offline, in a few pt-BR words; empty otherwise.
	Reason   string
	Printers []PrinterStatus
}

// Text is the one-line pt-BR status shown to the merchant.
func (s Status) Text() string {
	switch s.State {
	case Unpaired:
		return "Não conectado a uma loja"
	case Pairing:
		if s.UserCode == "" {
			return "Gerando código…"
		}
		return "Código: " + s.UserCode + " — aprove no painel"
	case PairingExpired:
		return "Código expirou"
	case Connecting:
		return "Conectando…"
	case Online:
		if s.StoreName == "" {
			return "Conectado"
		}
		return "Conectado a " + s.StoreName
	default:
		if s.Reason != "" {
			return "Sem conexão: " + s.Reason + " — tentando de novo"
		}
		return "Sem conexão — tentando de novo"
	}
}

// Line is the per-printer menu line, e.g. "Cozinha — impresso às 14:32".
func (p PrinterStatus) Line() string {
	name := p.Name
	if name == "" {
		name = p.Address
	}
	if p.Last == nil {
		return name
	}
	at := p.Last.At.Local().Format("15:04")
	if p.Last.OK {
		return name + " — impresso às " + at
	}
	return name + " — " + p.Last.Error + " (" + at + ")"
}

func (a *Agent) Status() Status {
	a.mu.Lock()
	defer a.mu.Unlock()
	s := Status{
		State:         a.state,
		Paired:        a.cfg.Token != "",
		StoreName:     a.cfg.StoreName,
		UserCode:      a.userCode,
		ApproveURL:    a.approveURL,
		Scanning:      a.scanning,
		UpdateVersion: a.updateVersion,
	}
	if a.state == Offline {
		s.Reason = a.offlineWhy
	}
	for _, p := range a.cfg.Printers {
		ps := PrinterStatus{Printer: p}
		if r, ok := a.last[p.ID]; ok {
			ps.Last = &r
		}
		s.Printers = append(s.Printers, ps)
	}
	return s
}

// Subscribe returns a channel that receives (coalesced) after every change.
func (a *Agent) Subscribe() <-chan struct{} {
	ch := make(chan struct{}, 1)
	a.mu.Lock()
	a.subs = append(a.subs, ch)
	a.mu.Unlock()
	return ch
}

func (a *Agent) notify() {
	a.mu.Lock()
	subs := slices.Clone(a.subs)
	a.mu.Unlock()
	for _, ch := range subs {
		signal(ch)
	}
}

func (a *Agent) setState(s State) {
	a.mu.Lock()
	changed := a.state != s
	a.state = s
	a.mu.Unlock()
	if changed {
		a.notify()
	}
}

// setOffline also notifies when only the cause changed (DNS down, then a 503).
func (a *Agent) setOffline(err error) {
	why := Explain(err)
	a.mu.Lock()
	changed := a.state != Offline || a.offlineWhy != why
	a.state, a.offlineWhy = Offline, why
	a.mu.Unlock()
	if changed {
		a.notify()
	}
}

func (a *Agent) setPairing(code, url string) {
	a.mu.Lock()
	a.state, a.userCode, a.approveURL = Pairing, code, url
	a.mu.Unlock()
	a.notify()
}

func (a *Agent) setScanning(v bool) {
	a.mu.Lock()
	a.scanning = v
	a.mu.Unlock()
	a.notify()
}

// backoff doubles from min to max with ±20 % jitter.
type backoff struct {
	min, max, cur time.Duration
}

func newBackoff(lo, hi time.Duration) *backoff { return &backoff{min: lo, max: hi} }

func (b *backoff) Next() time.Duration {
	if b.cur == 0 {
		b.cur = b.min
	} else {
		b.cur = min(2*b.cur, b.max)
	}
	return time.Duration(float64(b.cur) * (0.8 + 0.4*rand.Float64()))
}

func (b *backoff) Reset() { b.cur = 0 }
