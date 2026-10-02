package discovery

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/api"
)

func TestCandidates(t *testing.T) {
	own := []netip.Addr{
		netip.MustParseAddr("192.168.0.10"),
		netip.MustParseAddr("192.168.0.11"), // second NIC, same /24
		netip.MustParseAddr("10.1.2.3"),     // a /16 is still probed as its /24
		netip.MustParseAddr("fe80::1"),
	}
	c := Candidates(own)
	if len(c) != 252+253 {
		t.Fatalf("got %d candidates", len(c))
	}
	set := map[string]bool{}
	for _, a := range c {
		if set[a.String()] {
			t.Fatalf("duplicate %s", a)
		}
		set[a.String()] = true
	}
	for _, want := range []string{"192.168.0.1", "192.168.0.254", "10.1.2.1", "10.1.2.254"} {
		if !set[want] {
			t.Errorf("missing %s", want)
		}
	}
	for _, not := range []string{"192.168.0.10", "192.168.0.11", "10.1.2.3", "192.168.0.0", "192.168.0.255", "10.1.3.1"} {
		if set[not] {
			t.Errorf("unexpected %s", not)
		}
	}
}

type conn struct{ net.Conn }

func (conn) Close() error { return nil }

func TestScanWithInjectedDialer(t *testing.T) {
	var inFlight, peak, dials atomic.Int32
	var mu sync.Mutex
	dialed := map[string]bool{}
	p := Probe{
		Timeout:     time.Second,
		Concurrency: 64,
		Dial: func(ctx context.Context, network, addr string) (net.Conn, error) {
			n := inFlight.Add(1)
			defer inFlight.Add(-1)
			for {
				old := peak.Load()
				if n <= old || peak.CompareAndSwap(old, n) {
					break
				}
			}
			dials.Add(1)
			if _, ok := ctx.Deadline(); !ok {
				t.Error("dial without a deadline")
			}
			mu.Lock()
			dialed[addr] = true
			mu.Unlock()
			time.Sleep(time.Millisecond) // let workers overlap
			if network == "tcp" && (addr == "192.168.0.50:9100" || addr == "192.168.0.7:9100") {
				return conn{}, nil
			}
			return nil, errors.New("refused")
		},
	}
	got := p.Scan(context.Background(), []netip.Addr{netip.MustParseAddr("192.168.0.10")})

	if dials.Load() != 253 {
		t.Fatalf("dials = %d, want 253", dials.Load())
	}
	if peak.Load() > 64 {
		t.Fatalf("peak concurrency %d > 64", peak.Load())
	}
	if dialed["192.168.0.10:9100"] {
		t.Fatal("dialed own address")
	}
	want := []api.Discovered{
		{Key: "tcp:192.168.0.7:9100", Kind: "tcp", Name: "Impressora de rede 192.168.0.7", Address: "192.168.0.7:9100"},
		{Key: "tcp:192.168.0.50:9100", Kind: "tcp", Name: "Impressora de rede 192.168.0.50", Address: "192.168.0.50:9100"},
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("got %+v", got)
	}
}

func TestScanStopsOnCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var dials atomic.Int32
	p := Probe{Concurrency: 2, Dial: func(context.Context, string, string) (net.Conn, error) {
		if dials.Add(1) == 4 {
			cancel()
		}
		return nil, errors.New("refused")
	}}
	p.Scan(ctx, []netip.Addr{netip.MustParseAddr("10.0.0.1")})
	if n := dials.Load(); n > 10 {
		t.Fatalf("kept dialing after cancel: %d", n)
	}
}

func TestCollectMergesFiltersAndCaps(t *testing.T) {
	d := &Discoverer{
		Log: slog.New(slog.DiscardHandler),
		Local: func(context.Context) ([]api.Discovered, error) {
			out := []api.Discovered{
				SpoolerPrinter("Microsoft Print to PDF"),
				SpoolerPrinter("Microsoft XPS Document Writer"),
				SpoolerPrinter("OneNote (Desktop)"),
				SpoolerPrinter("Fax"),
				SpoolerPrinter("EPSON TM-T20X"),
				SpoolerPrinter("EPSON TM-T20X"),
				SerialPrinter("COM3"),
				SpoolerPrinter(strings.Repeat("é", 300)),
			}
			for i := range 60 {
				out = append(out, SpoolerPrinter(fmt.Sprintf("Fila %d", i)))
			}
			return out, nil
		},
		Addrs: func() ([]netip.Addr, error) { return []netip.Addr{netip.MustParseAddr("192.168.0.10")}, nil },
		Probe: Probe{Dial: func(_ context.Context, _, addr string) (net.Conn, error) {
			if addr == "192.168.0.50:9100" {
				return conn{}, nil
			}
			return nil, errors.New("refused")
		}},
	}
	if err := d.ScanNetwork(context.Background()); err != nil {
		t.Fatal(err)
	}
	got := d.Collect(context.Background())
	if len(got) != MaxReported {
		t.Fatalf("len = %d", len(got))
	}
	if got[0].Name != "EPSON TM-T20X" || got[1].Key != "serial:COM3" {
		t.Fatalf("head = %+v", got[:2])
	}
	if n := len([]rune(got[2].Name)); n != MaxField {
		t.Fatalf("long name has %d runes", n)
	}
	for _, p := range got {
		if IsVirtualQueue(p.Name) {
			t.Fatalf("virtual queue reported: %s", p.Name)
		}
	}
}
