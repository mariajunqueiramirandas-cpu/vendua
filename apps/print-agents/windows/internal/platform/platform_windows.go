package platform

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const (
	exeName     = "vendua-impressora.exe"
	runValue    = "VenduaImpressora"
	runKey      = `Software\Microsoft\Windows\CurrentVersion\Run`
	mutexName   = `Local\VenduaImpressora`
	quitEvent   = `Local\VenduaImpressora.Quit`
	idYes       = 6
	stopTimeout = 15 * time.Second
)

// DefaultDataDir is %LOCALAPPDATA%\Vendua\Impressora, which is also where
// the exe installs itself.
func DefaultDataDir() (string, error) {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		var err error
		if base, err = os.UserCacheDir(); err != nil {
			return "", err
		}
	}
	return filepath.Join(base, "Vendua", "Impressora"), nil
}

func HasDisplay() bool { return true }

func OpenURL(u string) error {
	if err := checkWebURL(u); err != nil {
		return err
	}
	cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}

// SingleInstance holds a named mutex for the process lifetime. The mutex is
// only used for its existence: ownership is per OS thread, which Go does
// not pin.
func SingleInstance(string) (release func(), err error) {
	name, _ := windows.UTF16PtrFromString(mutexName)
	h, err := windows.CreateMutex(nil, false, name)
	if errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		windows.CloseHandle(h)
		return nil, ErrAlreadyRunning
	}
	if err != nil {
		return nil, err
	}
	return func() { windows.CloseHandle(h) }, nil
}

// QuitRequests fires when a newer copy being installed asks this one to
// exit so it can replace the exe.
func QuitRequests() <-chan struct{} {
	name, _ := windows.UTF16PtrFromString(quitEvent)
	h, err := windows.CreateEvent(nil, 0, 0, name)
	if err != nil && !errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		return nil
	}
	ch := make(chan struct{})
	go func() {
		if ev, _ := windows.WaitForSingleObject(h, windows.INFINITE); ev == windows.WAIT_OBJECT_0 {
			close(ch)
		}
	}()
	return ch
}

// Install copies the running exe to %LOCALAPPDATA%\Vendua\Impressora,
// registers it to start with Windows and launches it. handedOff is true
// when the caller should exit and let the installed copy run.
func Install(args []string) (handedOff bool, err error) {
	self, err := os.Executable()
	if err != nil {
		return false, err
	}
	dir, err := DefaultDataDir()
	if err != nil {
		return false, err
	}
	target := filepath.Join(dir, exeName)
	if strings.EqualFold(filepath.Clean(self), filepath.Clean(target)) {
		return false, nil
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return false, err
	}
	stopInstalled()
	if err := copyExe(self, target); err != nil {
		return false, fmt.Errorf("install: %w", err)
	}
	// io.Copy never carries the mark of the web, but a copy made by other
	// means would make SmartScreen prompt at every boot.
	zone, _ := windows.UTF16PtrFromString(target + ":Zone.Identifier")
	_ = windows.DeleteFile(zone)

	k, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		return false, fmt.Errorf("install: autostart: %w", err)
	}
	err = k.SetStringValue(runValue, `"`+target+`"`)
	k.Close()
	if err != nil {
		return false, fmt.Errorf("install: autostart: %w", err)
	}

	cmd := exec.Command(target, args...)
	cmd.Dir = dir
	if err := cmd.Start(); err != nil {
		return false, fmt.Errorf("install: start: %w", err)
	}
	_ = cmd.Process.Release()
	return true, nil
}

// stopInstalled asks a running instance to quit and waits until its mutex
// is gone, i.e. the process has exited and released the exe.
func stopInstalled() {
	name, _ := windows.UTF16PtrFromString(quitEvent)
	if ev, err := windows.OpenEvent(windows.EVENT_MODIFY_STATE, false, name); err == nil {
		_ = windows.SetEvent(ev)
		windows.CloseHandle(ev)
	}
	mname, _ := windows.UTF16PtrFromString(mutexName)
	deadline := time.Now().Add(stopTimeout)
	for time.Now().Before(deadline) {
		h, err := windows.CreateMutex(nil, false, mname)
		if h != 0 {
			windows.CloseHandle(h)
		}
		if !errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
}

func copyExe(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".new"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	// Antivirus scanners briefly lock freshly written executables.
	for i := 0; ; i++ {
		err = os.Rename(tmp, dst)
		if err == nil || i == 20 {
			break
		}
		time.Sleep(250 * time.Millisecond)
	}
	if err != nil {
		os.Remove(tmp)
	}
	return err
}

func Confirm(title, message string) bool {
	t, _ := windows.UTF16PtrFromString(title)
	m, _ := windows.UTF16PtrFromString(message)
	r, _ := windows.MessageBox(0, m, t, windows.MB_YESNO|windows.MB_ICONQUESTION|windows.MB_SETFOREGROUND|windows.MB_TOPMOST)
	return r == idYes
}

func Alert(title, message string) {
	t, _ := windows.UTF16PtrFromString(title)
	m, _ := windows.UTF16PtrFromString(message)
	_, _ = windows.MessageBox(0, m, t, windows.MB_OK|windows.MB_ICONERROR|windows.MB_SETFOREGROUND)
}
