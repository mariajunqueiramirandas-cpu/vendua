// Package usbprint writes to USB printer-class devices directly, through the
// OS's own class driver (usbprint.sys on Windows, usblp on Linux): a thermal
// printer prints with no vendor driver and no print queue.
package usbprint

import (
	"errors"
	"fmt"
	"strings"
	"unicode"
)

// Device is one attached printer-class USB interface.
type Device struct {
	// Path is what the OS opens to write to it.
	Path     string
	VID, PID uint16
	// Serial is the iSerialNumber string, empty when the printer has none.
	Serial string
	// Location identifies the USB port; it tells identical serial-less printers apart.
	Location string
	// Name comes from the printer's IEEE 1284 device ID, when it reports one.
	Name string
	// Port is the spooler port name for it ("USB001"), Windows only.
	Port string
}

var (
	ErrNotFound = errors.New("usbprint: printer not attached")
	ErrBusy     = errors.New("usbprint: printer in use")
	ErrTimeout  = errors.New("usbprint: write timed out")
	// ErrPaperOut is reported with a failed write when the printer's status says so.
	ErrPaperOut = errors.New("usbprint: out of paper")
)

func (d Device) model() string { return fmt.Sprintf("%04x:%04x", d.VID, d.PID) }

// DisplayName is what the admin lists before the merchant labels it.
func (d Device) DisplayName() string {
	if d.Name != "" {
		return d.Name
	}
	return "Impressora USB " + d.model()
}

// Addresses gives each device the address the Android agent uses: `vid:pid`,
// plus `:serial` when it has one, so the key survives replugging. Identical
// serial-less printers would share it, so those (and only those) also get
// `:p<location>`.
func Addresses(devs []Device) []string {
	base := make([]string, len(devs))
	count := map[string]int{}
	for i, d := range devs {
		base[i] = d.model()
		if s := clean(d.Serial, 64); s != "" {
			base[i] += ":" + s
		}
		count[base[i]]++
	}
	for i, d := range devs {
		if count[base[i]] > 1 {
			base[i] += ":p" + clean(d.Location, 16)
		}
	}
	return base
}

// Find picks the device an address names. A serial-less printer moved to
// another port keeps printing when it's the only one of its model attached.
func Find(devs []Device, address string) (Device, bool) {
	want := strings.ToLower(strings.TrimSpace(address))
	addrs := Addresses(devs)
	for i, a := range addrs {
		if a == want {
			return devs[i], true
		}
	}
	parts := strings.SplitN(want, ":", 3)
	if len(parts) < 2 {
		return Device{}, false
	}
	model := parts[0] + ":" + parts[1]
	var hit []Device
	for _, d := range devs {
		if d.model() == model {
			hit = append(hit, d)
		}
	}
	if len(hit) == 1 && clean(hit[0].Serial, 64) == "" {
		return hit[0], true
	}
	return Device{}, false
}

// Name1284 turns an IEEE 1284 device ID ("MFG:EPSON;MDL:TM-T20II;CMD:ESC/POS;")
// into "EPSON TM-T20II".
func Name1284(id string) string {
	var mfg, mdl string
	for _, field := range strings.Split(id, ";") {
		k, v, ok := strings.Cut(field, ":")
		if !ok {
			continue
		}
		v = strings.TrimSpace(v)
		switch strings.ToUpper(strings.TrimSpace(k)) {
		case "MFG", "MANUFACTURER":
			mfg = v
		case "MDL", "MODEL":
			mdl = v
		}
	}
	if mdl != "" && mfg != "" && strings.HasPrefix(strings.ToLower(mdl), strings.ToLower(mfg)) {
		mfg = ""
	}
	name := strings.TrimSpace(mfg + " " + mdl)
	return strings.Map(func(r rune) rune {
		if unicode.IsPrint(r) {
			return r
		}
		return -1
	}, name)
}

// clean keeps the lowercase letters and digits of s, at most n of them, from the end.
func clean(s string, n int) string {
	var b []rune
	for _, r := range strings.ToLower(s) {
		if r < 0x80 && (unicode.IsLetter(r) || unicode.IsDigit(r)) {
			b = append(b, r)
		}
	}
	if len(b) > n {
		b = b[len(b)-n:]
	}
	return string(b)
}

// PaperOut reads the LPT status byte usbprint and usblp report: bit 5 is
// paper empty. All ones is a printer that doesn't implement it.
func PaperOut(status byte) bool { return status&0x20 != 0 && status != 0xff }
