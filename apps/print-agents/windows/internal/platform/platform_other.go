//go:build !windows && !linux

package platform

import (
	"errors"
	"os"
	"path/filepath"
)

var errUnsupported = errors.New("not supported on this OS")

func DefaultDataDir() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "vendua-impressora"), nil
}

func HasDisplay() bool                      { return false }
func OpenURL(u string) error                { return errUnsupported }
func OpenFile(path string) error            { return errUnsupported }
func SingleInstance(string) (func(), error) { return func() {}, nil }
func Install([]string) (bool, error)        { return false, nil }
func QuitRequests() <-chan struct{}         { return nil }
func Confirm(title, message string) bool    { return true }
func Alert(title, message string)           {}
