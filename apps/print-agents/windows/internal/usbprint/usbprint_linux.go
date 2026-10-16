package usbprint

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

const lpGetStatus = 0x060b // linux/lp.h

// List returns the printer-class USB devices usblp exposes as /dev/usb/lp*.
func List() ([]Device, error) {
	nodes, err := filepath.Glob("/sys/class/usbmisc/lp*")
	if err != nil {
		return nil, err
	}
	slices.Sort(nodes)
	var out []Device
	for _, node := range nodes {
		iface, err := filepath.EvalSymlinks(filepath.Join(node, "device"))
		if err != nil {
			continue
		}
		dev := filepath.Dir(iface)
		vid, okV := hex16(sysfs(dev, "idVendor"))
		pid, okP := hex16(sysfs(dev, "idProduct"))
		if !okV || !okP {
			continue
		}
		out = append(out, Device{
			Path:     "/dev/usb/" + filepath.Base(node),
			VID:      vid,
			PID:      pid,
			Serial:   sysfs(dev, "serial"),
			Location: filepath.Base(dev),
			Name:     Name1284(sysfs(iface, "ieee1284_id")),
		})
	}
	return out, nil
}

func sysfs(dir, name string) string {
	b, _ := os.ReadFile(filepath.Join(dir, name))
	return strings.TrimSpace(string(b))
}

const chunk = 16 << 10

// Write sends data, giving up when a chunk sits unaccepted for timeout.
func Write(ctx context.Context, d Device, timeout time.Duration, data []byte) error {
	// O_NONBLOCK lets the runtime poller enforce the deadline
	f, err := os.OpenFile(d.Path, os.O_WRONLY|syscall.O_NONBLOCK, 0)
	switch {
	case errors.Is(err, os.ErrNotExist), errors.Is(err, syscall.ENODEV):
		return fmt.Errorf("%w: %v", ErrNotFound, err)
	case errors.Is(err, syscall.EBUSY):
		return fmt.Errorf("%w: %v", ErrBusy, err)
	case err != nil:
		return err
	}
	defer f.Close()
	stop := context.AfterFunc(ctx, func() { _ = f.SetWriteDeadline(time.Now()) })
	defer stop()
	for len(data) > 0 {
		n := min(len(data), chunk)
		_ = f.SetWriteDeadline(time.Now().Add(timeout))
		w, err := f.Write(data[:n])
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if errors.Is(err, os.ErrDeadlineExceeded) {
				err = ErrTimeout
			}
			return withStatus(f, err)
		}
		data = data[w:]
	}
	return nil
}

func withStatus(f *os.File, err error) error {
	rc, cerr := f.SyscallConn()
	if cerr != nil {
		return err
	}
	var status int
	var serr error
	_ = rc.Control(func(fd uintptr) { status, serr = unix.IoctlGetInt(int(fd), lpGetStatus) })
	if serr == nil && PaperOut(byte(status)) {
		return fmt.Errorf("%w: %v", ErrPaperOut, err)
	}
	return err
}
