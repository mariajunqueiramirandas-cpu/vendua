package discovery

import (
	"context"
	"errors"
	"slices"
	"strings"

	"golang.org/x/sys/windows/registry"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/api"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/btserial"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/usbprint"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/winspool"
)

// Local lists spooler queues, COM ports (Bluetooth printers among them) and
// printer-class USB devices.
func Local(_ context.Context, known func(key string) bool) ([]api.Discovered, error) {
	var out []api.Discovered
	queues, qerr := winspool.Queues()
	for _, q := range queues {
		out = append(out, SpoolerPrinter(q))
	}
	ports, perr := comPorts()
	bt, berr := btserial.Ports()
	out = append(out, SerialPrinters(ports, bt, known)...)
	devs, uerr := usbprint.List()
	var lerr error
	if len(devs) > 0 {
		var local []winspool.Queue
		local, lerr = winspool.LocalQueues()
		queued := map[string]bool{}
		for _, q := range local {
			for _, p := range q.Ports {
				queued[strings.ToUpper(p)] = true
			}
		}
		out = append(out, USBPrinters(devs, queued, known)...)
	}
	return out, errors.Join(qerr, perr, berr, uerr, lerr)
}

func comPorts() ([]string, error) {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `HARDWARE\DEVICEMAP\SERIALCOMM`, registry.QUERY_VALUE)
	if errors.Is(err, registry.ErrNotExist) {
		return nil, nil // no serial ports at all
	}
	if err != nil {
		return nil, err
	}
	defer k.Close()
	names, err := k.ReadValueNames(0)
	if err != nil {
		return nil, err
	}
	var ports []string
	for _, n := range names {
		if v, _, err := k.GetStringValue(n); err == nil && v != "" {
			ports = append(ports, v)
		}
	}
	slices.Sort(ports)
	return ports, nil
}
