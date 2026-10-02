package printer

import (
	"context"
	"errors"
	"fmt"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/winspool"
)

func sendSpooler(_ context.Context, queue string, data []byte) error {
	err := winspool.PrintRaw(queue, "Venduá", data)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, winspool.ErrNotFound):
		return &Error{Msg: "Impressora não encontrada (" + queue + ")", Err: err}
	default:
		return &Error{Msg: "Falha ao enviar para a impressora (" + queue + ")", Err: err}
	}
}

// DCB fields (winbase.h; Flags bits in bitfield order).
const (
	noParity   = 0
	oneStopBit = 0

	dcbBinary         = 1 << 0
	dcbParity         = 1 << 1
	dcbOutxCtsFlow    = 1 << 2
	dcbOutxDsrFlow    = 1 << 3
	dcbDtrControlMask = 3 << 4
	dcbDtrEnable      = 1 << 4
	dcbDsrSensitivity = 1 << 6
	dcbOutX           = 1 << 8
	dcbInX            = 1 << 9
	dcbRtsControlMask = 3 << 12
	dcbRtsEnable      = 1 << 12
)

func sendSerial(_ context.Context, port string, baud int, writeTimeout time.Duration, data []byte) error {
	unavailable := "Porta serial " + port + " indisponível"
	path, err := windows.UTF16PtrFromString(`\\.\` + port)
	if err != nil {
		return &Error{Msg: unavailable, Err: err, Permanent: true}
	}
	h, err := windows.CreateFile(path, windows.GENERIC_WRITE, 0, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		return &Error{Msg: unavailable, Err: err}
	}
	defer windows.CloseHandle(h)

	var dcb windows.DCB
	dcb.DCBlength = uint32(unsafe.Sizeof(dcb))
	if err := windows.GetCommState(h, &dcb); err != nil {
		return &Error{Msg: unavailable, Err: err}
	}
	dcb.BaudRate = uint32(baud)
	dcb.ByteSize = 8
	dcb.Parity = noParity
	dcb.StopBits = oneStopBit
	dcb.Flags &^= dcbParity | dcbOutxCtsFlow | dcbOutxDsrFlow | dcbDtrControlMask | dcbDsrSensitivity | dcbOutX | dcbInX | dcbRtsControlMask
	dcb.Flags |= dcbBinary | dcbDtrEnable | dcbRtsEnable
	if err := windows.SetCommState(h, &dcb); err != nil {
		return &Error{Msg: fmt.Sprintf("Velocidade inválida para %s", port), Err: err, Permanent: true}
	}
	budget := serialBudget(writeTimeout, baud, len(data))
	timeouts := windows.CommTimeouts{WriteTotalTimeoutConstant: uint32(budget / time.Millisecond)}
	if err := windows.SetCommTimeouts(h, &timeouts); err != nil {
		return &Error{Msg: unavailable, Err: err}
	}
	var n uint32
	if err := windows.WriteFile(h, data, &n, nil); err != nil {
		return &Error{Msg: "Falha ao enviar para a impressora (" + port + ")", Err: err}
	}
	if int(n) != len(data) {
		return &Error{Msg: "Sem resposta da impressora (" + port + ")", Err: fmt.Errorf("wrote %d of %d bytes", n, len(data))}
	}
	return nil
}
