package usbprint

import (
	"strconv"
	"strings"
)

// winInterface is what a usbprint interface path says about its device:
// `\\?\USB#VID_0519&PID_0001#SERIAL#{guid}`, or `…&MI_01#7&1a2b&0&0001#…`
// for one interface of a composite device.
type winInterface struct {
	VID, PID uint16
	// Instance is the device instance ID (`USB\VID_0519&PID_0001\SERIAL`).
	Instance  string
	Composite bool
}

func parseWinInterface(path string) (winInterface, bool) {
	p := strings.TrimPrefix(strings.TrimPrefix(path, `\\?\`), `\\.\`)
	seg := strings.Split(p, "#")
	if len(seg) < 3 || !strings.EqualFold(seg[0], "USB") {
		return winInterface{}, false
	}
	var w winInterface
	var okV, okP bool
	for _, f := range strings.Split(strings.ToUpper(seg[1]), "&") {
		switch {
		case strings.HasPrefix(f, "VID_"):
			w.VID, okV = hex16(f[4:])
		case strings.HasPrefix(f, "PID_"):
			w.PID, okP = hex16(f[4:])
		case strings.HasPrefix(f, "MI_"):
			w.Composite = true
		}
	}
	if !okV || !okP {
		return winInterface{}, false
	}
	w.Instance = seg[0] + `\` + seg[1] + `\` + seg[2]
	return w, true
}

// instanceSerial is the serial in a USB device instance ID. Windows makes up
// an `&`-separated suffix for devices that report none.
func instanceSerial(instance string) string {
	i := strings.LastIndex(instance, `\`)
	s := instance[i+1:]
	if strings.Contains(s, "&") {
		return ""
	}
	return s
}

// instanceLocation is the made-up suffix of a serial-less device: it depends on the port.
func instanceLocation(instance string) string {
	return instance[strings.LastIndex(instance, `\`)+1:]
}

func hex16(s string) (uint16, bool) {
	v, err := strconv.ParseUint(s, 16, 16)
	return uint16(v), err == nil
}

// winRegistryKey is the interface's key under
// HKLM\SYSTEM\CurrentControlSet\Control\DeviceClasses\{guid}.
func winRegistryKey(path string) string {
	return "##?#" + strings.TrimPrefix(strings.TrimPrefix(path, `\\?\`), `\\.\`)
}
