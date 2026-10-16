//go:build !windows

package btserial

// Ports is Windows-only: elsewhere a Bluetooth printer is a plain serial device.
func Ports() ([]Port, error) { return nil, nil }
