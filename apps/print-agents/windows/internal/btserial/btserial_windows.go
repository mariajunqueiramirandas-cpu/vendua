package btserial

import (
	"errors"
	"slices"
	"strings"

	"golang.org/x/sys/windows/registry"
)

const (
	enumKey    = `SYSTEM\CurrentControlSet\Enum\BTHENUM`
	devicesKey = `SYSTEM\CurrentControlSet\Services\BTHPORT\Parameters\Devices\`
)

// Ports lists the Bluetooth COM ports Windows has made, present or not:
// SERIALCOMM says which are present.
func Ports() ([]Port, error) {
	root, err := registry.OpenKey(registry.LOCAL_MACHINE, enumKey, registry.ENUMERATE_SUB_KEYS)
	if errors.Is(err, registry.ErrNotExist) {
		return nil, nil // no Bluetooth on this PC
	}
	if err != nil {
		return nil, err
	}
	defer root.Close()
	services, err := root.ReadSubKeyNames(0)
	if err != nil {
		return nil, err
	}
	var out []Port
	for _, svc := range services {
		k, err := registry.OpenKey(root, svc, registry.ENUMERATE_SUB_KEYS)
		if err != nil {
			continue
		}
		instances, _ := k.ReadSubKeyNames(0)
		k.Close()
		for _, inst := range instances {
			com := portName(svc + `\` + inst)
			if com == "" {
				continue // not a serial port service
			}
			mac, incoming, ok := parseInstance(inst)
			if !ok {
				continue
			}
			p := Port{COM: com, MAC: mac, Incoming: incoming}
			if !incoming {
				p.Name = name(mac)
			}
			out = append(out, p)
		}
	}
	slices.SortFunc(out, func(a, b Port) int { return strings.Compare(a.COM, b.COM) })
	return out, nil
}

func portName(instance string) string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, enumKey+`\`+instance+`\Device Parameters`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	v, _, err := k.GetStringValue("PortName")
	if err != nil {
		return ""
	}
	return strings.ToUpper(strings.TrimSpace(v))
}

func name(mac string) string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, devicesKey+strings.ToLower(strings.ReplaceAll(mac, ":", "")), registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	raw, _, err := k.GetBinaryValue("Name")
	if err != nil {
		return ""
	}
	return deviceName(raw)
}
