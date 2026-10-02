// Package platform holds the OS-specific pieces around the agent: where its
// files live, the single-instance lock, opening the browser and (on Windows)
// installing itself.
package platform

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"unicode/utf8"
)

var ErrAlreadyRunning = errors.New("another instance is already running")

// Hostname is the device name shown in the admin (≤ 60 chars).
func Hostname() string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		return "Computador"
	}
	for utf8.RuneCountInString(h) > 60 {
		_, size := utf8.DecodeLastRuneInString(h)
		h = h[:len(h)-size]
	}
	return h
}

// checkWebURL keeps a URL that came from the network from launching
// anything but a web page.
func checkWebURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return err
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return fmt.Errorf("refusing to open %q: not a web URL", raw)
	}
	return nil
}
