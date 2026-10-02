package winspool

import (
	"errors"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	dll                  = windows.NewLazySystemDLL("winspool.drv")
	procOpenPrinterW     = dll.NewProc("OpenPrinterW")
	procClosePrinter     = dll.NewProc("ClosePrinter")
	procStartDocPrinterW = dll.NewProc("StartDocPrinterW")
	procEndDocPrinter    = dll.NewProc("EndDocPrinter")
	procStartPagePrinter = dll.NewProc("StartPagePrinter")
	procEndPagePrinter   = dll.NewProc("EndPagePrinter")
	procWritePrinter     = dll.NewProc("WritePrinter")
	procEnumPrintersW    = dll.NewProc("EnumPrintersW")
)

const (
	PRINTER_ENUM_LOCAL       = 0x00000002
	PRINTER_ENUM_CONNECTIONS = 0x00000004
)

// docInfo1 is DOC_INFO_1W.
type docInfo1 struct {
	DocName    *uint16
	OutputFile *uint16
	Datatype   *uint16
}

// printerInfo4 is PRINTER_INFO_4W; Go pads it like the C struct (24 bytes on amd64).
type printerInfo4 struct {
	PrinterName *uint16
	ServerName  *uint16
	Attributes  uint32
}

// ErrNotFound means the queue does not exist (or is not reachable).
var ErrNotFound = errors.New("winspool: printer not found")

// PrintRaw sends data to queue as one RAW document, bypassing the driver.
func PrintRaw(queue, docName string, data []byte) error {
	name, err := windows.UTF16PtrFromString(queue)
	if err != nil {
		return err
	}
	var h windows.Handle
	if r, _, e := procOpenPrinterW.Call(uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(&h)), 0); r == 0 {
		if errors.Is(e, windows.ERROR_INVALID_PRINTER_NAME) {
			return ErrNotFound
		}
		return e
	}
	defer procClosePrinter.Call(uintptr(h))

	doc := docInfo1{
		DocName:  windows.StringToUTF16Ptr(docName),
		Datatype: windows.StringToUTF16Ptr("RAW"),
	}
	r, _, e := procStartDocPrinterW.Call(uintptr(h), 1, uintptr(unsafe.Pointer(&doc)))
	runtime.KeepAlive(doc)
	if r == 0 {
		return e
	}
	if r, _, e := procStartPagePrinter.Call(uintptr(h)); r == 0 {
		procEndDocPrinter.Call(uintptr(h))
		return e
	}
	werr := writeAll(h, data)
	procEndPagePrinter.Call(uintptr(h))
	if r, _, e := procEndDocPrinter.Call(uintptr(h)); r == 0 && werr == nil {
		werr = e
	}
	return werr
}

func writeAll(h windows.Handle, data []byte) error {
	for len(data) > 0 {
		var n uint32
		r, _, e := procWritePrinter.Call(uintptr(h), uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)), uintptr(unsafe.Pointer(&n)))
		if r == 0 {
			return e
		}
		if n == 0 {
			return errors.New("winspool: WritePrinter wrote 0 bytes")
		}
		data = data[n:]
	}
	return nil
}

// Queues lists local and connected print queues.
func Queues() ([]string, error) {
	flags := uintptr(PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS)
	var needed, returned uint32
	r, _, e := procEnumPrintersW.Call(flags, 0, 4, 0, 0, uintptr(unsafe.Pointer(&needed)), uintptr(unsafe.Pointer(&returned)))
	if r == 0 && !errors.Is(e, windows.ERROR_INSUFFICIENT_BUFFER) {
		return nil, e
	}
	if needed == 0 {
		return nil, nil
	}
	// The strings the entries point to live in the same buffer, after the
	// array; a []uint64 keeps it 8-byte aligned for the structs.
	buf := make([]uint64, (needed+7)/8)
	r, _, e = procEnumPrintersW.Call(flags, 0, 4, uintptr(unsafe.Pointer(&buf[0])), uintptr(needed), uintptr(unsafe.Pointer(&needed)), uintptr(unsafe.Pointer(&returned)))
	if r == 0 {
		return nil, e
	}
	infos := unsafe.Slice((*printerInfo4)(unsafe.Pointer(&buf[0])), returned)
	names := make([]string, 0, returned)
	for _, info := range infos {
		if info.PrinterName != nil {
			names = append(names, windows.UTF16PtrToString(info.PrinterName))
		}
	}
	runtime.KeepAlive(buf)
	return names, nil
}
