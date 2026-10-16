// Package btserial finds the virtual COM ports Windows makes for paired
// Bluetooth (SPP) printers, and the printer behind each one.
package btserial

import (
	"bytes"
	"strings"
	"unicode/utf8"
)

// Port is a Bluetooth COM port.
type Port struct {
	COM string
	// MAC is "AA:BB:CC:DD:EE:FF", the format the Android agent reports.
	MAC  string
	Name string
	// Incoming ports wait for a device to connect to the PC: nothing prints through them.
	Incoming bool
}

// parseInstance reads the remote address from a BTHENUM instance ID:
// `8&2a3b4c5d&0&001B35A0F2C1_C00000000`. Incoming ports carry all zeros.
func parseInstance(instance string) (mac string, incoming, ok bool) {
	last := instance[strings.LastIndex(instance, "&")+1:]
	addr, _, _ := strings.Cut(last, "_")
	mac = NormalizeMAC(addr)
	if mac == "" {
		return "", false, false
	}
	return mac, mac == "00:00:00:00:00:00", true
}

// NormalizeMAC accepts "001b35a0f2c1", "00:1B:35:A0:F2:C1" or "00-1b-…" and
// returns "00:1B:35:A0:F2:C1", or "" when s is not an address.
func NormalizeMAC(s string) string {
	hex := strings.Map(func(r rune) rune {
		switch {
		case r == ':' || r == '-':
			return -1
		case r >= '0' && r <= '9', r >= 'A' && r <= 'F':
			return r
		case r >= 'a' && r <= 'f':
			return r - 'a' + 'A'
		}
		return '!'
	}, strings.TrimSpace(s))
	if len(hex) != 12 || strings.Contains(hex, "!") {
		return ""
	}
	var b strings.Builder
	for i := 0; i < 12; i += 2 {
		if i > 0 {
			b.WriteByte(':')
		}
		b.WriteString(hex[i : i+2])
	}
	return b.String()
}

// deviceName decodes the paired device's name as BTHPORT stores it: UTF-8, NUL-terminated.
func deviceName(raw []byte) string {
	if i := bytes.IndexByte(raw, 0); i >= 0 {
		raw = raw[:i]
	}
	if !utf8.Valid(raw) {
		return ""
	}
	return strings.TrimSpace(string(raw))
}

// DisplayName is what the admin lists before the merchant labels it.
func (p Port) DisplayName() string {
	if p.Name != "" {
		return p.Name
	}
	return "Impressora Bluetooth " + p.MAC
}
