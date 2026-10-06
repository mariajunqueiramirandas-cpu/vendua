package platform

import (
	"os"
	"os/exec"
	"path/filepath"

	"golang.org/x/sys/unix"
)

func DefaultDataDir() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "vendua-impressora"), nil
}

func HasDisplay() bool {
	return os.Getenv("DISPLAY") != "" || os.Getenv("WAYLAND_DISPLAY") != ""
}

func OpenURL(u string) error {
	if err := checkWebURL(u); err != nil {
		return err
	}
	cmd := exec.Command("xdg-open", u)
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}

// OpenFile shows a local file with the desktop's default program.
func OpenFile(path string) error {
	cmd := exec.Command("xdg-open", path)
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}

// SingleInstance holds an advisory lock in dataDir for the process lifetime.
func SingleInstance(dataDir string) (release func(), err error) {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(filepath.Join(dataDir, "agent.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		f.Close()
		if err == unix.EWOULDBLOCK {
			return nil, ErrAlreadyRunning
		}
		return nil, err
	}
	return func() { f.Close() }, nil
}

// Install is a no-op off Windows.
func Install([]string) (handedOff bool, err error) { return false, nil }

// QuitRequests never fires off Windows; signals stop the process instead.
func QuitRequests() <-chan struct{} { return nil }

func Confirm(title, message string) bool { return true }

func Alert(title, message string) {}
