package usbprint

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// GUID_DEVINTERFACE_USBPRINT: usbprint.sys registers it for every printer-class
// interface, whether or not a print driver (and queue) was ever installed.
var guidUSBPrint = windows.GUID{Data1: 0x28d78fad, Data2: 0x5a12, Data3: 0x11d1, Data4: [8]byte{0xae, 0x5b, 0x00, 0x00, 0xf8, 0x03, 0xa8, 0xc2}}

const deviceClassesKey = `SYSTEM\CurrentControlSet\Control\DeviceClasses\{28d78fad-5a12-11d1-ae5b-0000f803a8c2}\`

// usbprint.h; METHOD_BUFFERED, FILE_ANY_ACCESS
const (
	ioctlGetLPTStatus = 0x22<<16 | 12<<2
	ioctlGet1284ID    = 0x22<<16 | 13<<2
)

var (
	cfgmgr              = windows.NewLazySystemDLL("cfgmgr32.dll")
	procCMLocateDevNode = cfgmgr.NewProc("CM_Locate_DevNodeW")
	procCMGetParent     = cfgmgr.NewProc("CM_Get_Parent")
	procCMGetDeviceID   = cfgmgr.NewProc("CM_Get_Device_IDW")
	names               sync.Map // interface path → 1284 name, read once per attach
)

// List returns the printer-class USB devices attached now.
func List() ([]Device, error) {
	paths, err := windows.CM_Get_Device_Interface_List("", &guidUSBPrint, windows.CM_GET_DEVICE_INTERFACE_LIST_PRESENT)
	if errors.Is(err, windows.ERROR_NO_SUCH_DEVICE_INTERFACE) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []Device
	for _, path := range paths {
		w, ok := parseWinInterface(path)
		if !ok {
			continue
		}
		instance := w.Instance
		if w.Composite {
			// the serial belongs to the whole device, one level up
			if parent, err := parentInstance(w.Instance); err == nil {
				instance = parent
			}
		}
		d := Device{
			Path:     path,
			VID:      w.VID,
			PID:      w.PID,
			Serial:   instanceSerial(instance),
			Location: instanceLocation(w.Instance),
			Port:     portName(path),
		}
		d.Name = cachedName(path)
		out = append(out, d)
	}
	return out, nil
}

func cachedName(path string) string {
	if v, ok := names.Load(path); ok {
		return v.(string)
	}
	h, err := open(path)
	if err != nil {
		// busy printing: ask again on the next listing
		return ""
	}
	defer windows.CloseHandle(h)
	buf := make([]byte, 1024)
	n, err := ioctl(h, ioctlGet1284ID, buf, 2*time.Second)
	name := ""
	// two big-endian length bytes (counting themselves), then the ID
	if err == nil && n > 2 {
		if l := int(buf[0])<<8 | int(buf[1]); l > 2 && l < n {
			n = l
		}
		name = Name1284(string(buf[2:n]))
	}
	names.Store(path, name)
	return name
}

// portName is the spooler port usbmon made for the interface, "USB001".
func portName(path string) string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, deviceClassesKey+winRegistryKey(path)+`\#\Device Parameters`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	base, _, err := k.GetStringValue("Base Name")
	if err != nil {
		return ""
	}
	n, _, err := k.GetIntegerValue("Port Number")
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%s%03d", base, n)
}

func parentInstance(instance string) (string, error) {
	id, err := windows.UTF16PtrFromString(instance)
	if err != nil {
		return "", err
	}
	var node, parent uint32
	if r, _, _ := procCMLocateDevNode.Call(uintptr(unsafe.Pointer(&node)), uintptr(unsafe.Pointer(id)), 0); r != 0 {
		return "", fmt.Errorf("CM_Locate_DevNode: %d", r)
	}
	if r, _, _ := procCMGetParent.Call(uintptr(unsafe.Pointer(&parent)), uintptr(node), 0); r != 0 {
		return "", fmt.Errorf("CM_Get_Parent: %d", r)
	}
	buf := make([]uint16, 201) // MAX_DEVICE_ID_LEN + 1
	if r, _, _ := procCMGetDeviceID.Call(uintptr(parent), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)), 0); r != 0 {
		return "", fmt.Errorf("CM_Get_Device_ID: %d", r)
	}
	parentID := windows.UTF16ToString(buf)
	if !strings.HasPrefix(strings.ToUpper(parentID), `USB\VID_`) {
		return "", errors.New("parent is not a USB device")
	}
	return parentID, nil
}

func open(path string) (windows.Handle, error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	h, err := windows.CreateFile(p, windows.GENERIC_READ|windows.GENERIC_WRITE,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OVERLAPPED, 0)
	switch {
	case err == nil:
		return h, nil
	case errors.Is(err, windows.ERROR_FILE_NOT_FOUND), errors.Is(err, windows.ERROR_PATH_NOT_FOUND),
		errors.Is(err, windows.ERROR_DEVICE_NOT_CONNECTED), errors.Is(err, windows.ERROR_NO_SUCH_DEVICE):
		return 0, fmt.Errorf("%w: %v", ErrNotFound, err)
	case errors.Is(err, windows.ERROR_SHARING_VIOLATION), errors.Is(err, windows.ERROR_ACCESS_DENIED), errors.Is(err, windows.ERROR_BUSY):
		// the spooler holds the port while one of its own jobs prints
		return 0, fmt.Errorf("%w: %v", ErrBusy, err)
	default:
		return 0, err
	}
}

// chunk keeps the timeout about progress: a printer that is slowly taking a
// long logo ticket is not one that stopped.
const chunk = 16 << 10

// Write sends data, giving up when a chunk sits unaccepted for timeout (cover
// open, out of paper, printer off).
func Write(ctx context.Context, d Device, timeout time.Duration, data []byte) error {
	h, err := open(d.Path)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(h)
	for len(data) > 0 {
		n := min(len(data), chunk)
		done, err := overlapped(ctx, h, timeout, func(ov *windows.Overlapped, done *uint32) error {
			return windows.WriteFile(h, data[:n], done, ov)
		})
		if err != nil {
			return withStatus(h, err)
		}
		if done == 0 {
			return withStatus(h, ErrTimeout)
		}
		data = data[done:]
	}
	return nil
}

func withStatus(h windows.Handle, err error) error {
	buf := make([]byte, 1)
	if n, serr := ioctl(h, ioctlGetLPTStatus, buf, time.Second); serr == nil && n == 1 && PaperOut(buf[0]) {
		return fmt.Errorf("%w: %v", ErrPaperOut, err)
	}
	return err
}

func ioctl(h windows.Handle, code uint32, out []byte, timeout time.Duration) (int, error) {
	n, err := overlapped(context.Background(), h, timeout, func(ov *windows.Overlapped, done *uint32) error {
		return windows.DeviceIoControl(h, code, nil, 0, &out[0], uint32(len(out)), done, ov)
	})
	return int(n), err
}

// overlapped runs one async call and waits for it, cancelling it on timeout
// or ctx; the handle was opened overlapped so a stuck printer can't hang us.
func overlapped(ctx context.Context, h windows.Handle, timeout time.Duration, call func(*windows.Overlapped, *uint32) error) (uint32, error) {
	ev, err := windows.CreateEvent(nil, 1, 0, nil)
	if err != nil {
		return 0, err
	}
	defer windows.CloseHandle(ev)
	ov := new(windows.Overlapped)
	ov.HEvent = ev
	var done uint32
	err = call(ov, &done)
	if err != nil && !errors.Is(err, windows.ERROR_IO_PENDING) {
		return 0, err
	}
	deadline := time.Now().Add(timeout)
	for {
		wait := min(time.Until(deadline), 250*time.Millisecond)
		if wait < 0 {
			wait = 0
		}
		r, werr := windows.WaitForSingleObject(ev, uint32(wait/time.Millisecond))
		if r == windows.WAIT_OBJECT_0 && werr == nil {
			break
		}
		if werr != nil || ctx.Err() != nil || !time.Now().Before(deadline) {
			// the kernel must be done with ov before it can go
			_ = windows.CancelIoEx(h, ov)
			_ = windows.GetOverlappedResult(h, ov, &done, true)
			runtime.KeepAlive(ov)
			switch {
			case werr != nil:
				return done, werr
			case ctx.Err() != nil:
				return done, ctx.Err()
			}
			return done, ErrTimeout
		}
	}
	err = windows.GetOverlappedResult(h, ov, &done, true)
	runtime.KeepAlive(ov)
	return done, err
}
