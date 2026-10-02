package discovery

import (
	"context"
	"errors"
	"slices"

	"golang.org/x/sys/windows/registry"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/api"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/winspool"
)

// Local lists spooler queues and COM ports.
func Local(context.Context) ([]api.Discovered, error) {
	var out []api.Discovered
	queues, qerr := winspool.Queues()
	for _, q := range queues {
		out = append(out, SpoolerPrinter(q))
	}
	ports, perr := comPorts()
	for _, p := range ports {
		out = append(out, SerialPrinter(p))
	}
	return out, errors.Join(qerr, perr)
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
