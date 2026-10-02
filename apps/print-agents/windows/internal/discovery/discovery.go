// Package discovery finds printers this computer can reach.
package discovery

import (
	"context"
	"log/slog"
	"net"
	"net/netip"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/api"
)

// Core accepts at most this many entries of at most MaxField chars each.
const (
	MaxReported = 50
	MaxField    = 200
)

// Discoverer combines the quick local inventory (queues, serial ports), done
// on every report, with the network scan, which only runs when asked.
type Discoverer struct {
	Local func(ctx context.Context) ([]api.Discovered, error)
	Addrs func() ([]netip.Addr, error)
	Probe Probe
	Log   *slog.Logger

	mu      sync.Mutex
	network []api.Discovered
}

func New(log *slog.Logger) *Discoverer {
	return &Discoverer{Local: Local, Addrs: LocalAddrs, Probe: Probe{}, Log: log}
}

// ScanNetwork probes the local /24s and remembers what answered.
func (d *Discoverer) ScanNetwork(ctx context.Context) error {
	own, err := d.Addrs()
	if err != nil {
		return err
	}
	found := d.Probe.Scan(ctx, own)
	if ctx.Err() != nil {
		return ctx.Err()
	}
	d.Log.Info("network scan done", "subnets", len(subnets(own)), "printers", len(found))
	d.mu.Lock()
	d.network = found
	d.mu.Unlock()
	return nil
}

// Collect is the set to PUT: local printers plus the last network scan.
func (d *Discoverer) Collect(ctx context.Context) []api.Discovered {
	local, err := d.Local(ctx)
	if err != nil {
		d.Log.Warn("local printer discovery failed", "err", err)
	}
	d.mu.Lock()
	all := append(slices.Clip(local), d.network...)
	d.mu.Unlock()
	return Normalize(all)
}

// Normalize drops virtual queues and duplicates and applies Core's limits.
func Normalize(in []api.Discovered) []api.Discovered {
	out := make([]api.Discovered, 0, min(len(in), MaxReported))
	seen := map[string]bool{}
	for _, p := range in {
		if p.Kind == "spooler" && IsVirtualQueue(p.Name) {
			continue
		}
		p = api.Discovered{Key: clip(p.Key), Kind: clip(p.Kind), Name: clip(p.Name), Address: clip(p.Address)}
		if seen[p.Key] {
			continue
		}
		seen[p.Key] = true
		out = append(out, p)
		if len(out) == MaxReported {
			break
		}
	}
	return out
}

var virtualMarkers = []string{"pdf", "xps", "onenote", "fax"}

// IsVirtualQueue reports queues that print to files or apps, not paper.
func IsVirtualQueue(name string) bool {
	n := strings.ToLower(name)
	for _, m := range virtualMarkers {
		if strings.Contains(n, m) {
			return true
		}
	}
	return false
}

func SpoolerPrinter(queue string) api.Discovered {
	return api.Discovered{Key: "spooler:" + queue, Kind: "spooler", Name: queue, Address: queue}
}

func SerialPrinter(port string) api.Discovered {
	return api.Discovered{Key: "serial:" + port, Kind: "serial", Name: "Porta serial " + port, Address: port}
}

func clip(s string) string {
	if r := []rune(s); len(r) > MaxField {
		return string(r[:MaxField])
	}
	return s
}

// Probe finds raw-printing (JetDirect) listeners on the local networks.
type Probe struct {
	Dial        func(ctx context.Context, network, addr string) (net.Conn, error)
	Timeout     time.Duration // per host, default 300 ms
	Concurrency int           // default 64
	Port        uint16        // default 9100
}

// Scan dials every host of the /24 around each own address, except the
// own addresses themselves, and returns the ones that accepted, by address.
func (p Probe) Scan(ctx context.Context, own []netip.Addr) []api.Discovered {
	dial := p.Dial
	if dial == nil {
		var d net.Dialer
		dial = d.DialContext
	}
	timeout := orDefault(p.Timeout, 300*time.Millisecond)
	workers := orDefault(p.Concurrency, 64)
	port := orDefault(p.Port, 9100)

	targets := make(chan netip.Addr)
	var mu sync.Mutex
	var hits []netip.Addr
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for ip := range targets {
				dctx, cancel := context.WithTimeout(ctx, timeout)
				conn, err := dial(dctx, "tcp", netip.AddrPortFrom(ip, port).String())
				cancel()
				if err != nil {
					continue
				}
				conn.Close()
				mu.Lock()
				hits = append(hits, ip)
				mu.Unlock()
			}
		}()
	}
	go func() {
		defer close(targets)
		for _, ip := range Candidates(own) {
			select {
			case targets <- ip:
			case <-ctx.Done():
				return
			}
		}
	}()
	wg.Wait()

	slices.SortFunc(hits, func(a, b netip.Addr) int { return a.Compare(b) })
	out := make([]api.Discovered, 0, len(hits))
	for _, ip := range hits {
		addr := netip.AddrPortFrom(ip, port).String()
		out = append(out, api.Discovered{Key: "tcp:" + addr, Kind: "tcp", Name: "Impressora de rede " + ip.String(), Address: addr})
	}
	return out
}

// Candidates lists .1–.254 of each own /24, without the own addresses.
func Candidates(own []netip.Addr) []netip.Addr {
	self := map[netip.Addr]bool{}
	for _, a := range own {
		self[a] = true
	}
	var out []netip.Addr
	for _, base := range subnets(own) {
		b := base.As4()
		for host := 1; host <= 254; host++ {
			b[3] = byte(host)
			if ip := netip.AddrFrom4(b); !self[ip] {
				out = append(out, ip)
			}
		}
	}
	return out
}

func subnets(own []netip.Addr) []netip.Addr {
	var out []netip.Addr
	for _, a := range own {
		if !a.Is4() {
			continue
		}
		p, _ := a.Prefix(24)
		if !slices.Contains(out, p.Addr()) {
			out = append(out, p.Addr())
		}
	}
	return out
}

// LocalAddrs returns the IPv4 addresses of up, non-loopback interfaces.
func LocalAddrs() ([]netip.Addr, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	var out []netip.Addr
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := ifc.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip, ok := netip.AddrFromSlice(ipn.IP)
			if !ok {
				continue
			}
			ip = ip.Unmap()
			if ip.Is4() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() {
				out = append(out, ip)
			}
		}
	}
	return out, nil
}

func orDefault[T comparable](v, def T) T {
	var zero T
	if v == zero {
		return def
	}
	return v
}
