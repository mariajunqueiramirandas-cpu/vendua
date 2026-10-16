package printer

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/btserial"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/winspool"
)

func sendSpooler(_ context.Context, queue string, data []byte) error {
	err := winspool.PrintRaw(queue, "Venduá", data)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, winspool.ErrNotFound):
		return &Error{Msg: "Impressora não encontrada (" + queue + ")", Err: err}
	case errors.Is(err, winspool.ErrPaused):
		return &Error{Msg: "Fila de impressão pausada no Windows (" + queue + ")", Err: err}
	case errors.Is(err, winspool.ErrOffline):
		return &Error{Msg: "Impressora marcada como \"Usar impressora offline\" no Windows (" + queue + ")", Err: err}
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
	return writeCOM(port, baud, writeTimeout, data, false)
}

// sendBluetooth prints through the outgoing COM port Windows made when the
// printer was paired; opening it is what connects.
func sendBluetooth(_ context.Context, addr string, writeTimeout time.Duration, data []byte) error {
	mac := btserial.NormalizeMAC(addr)
	if mac == "" {
		return &Error{Msg: "Endereço Bluetooth inválido (" + addr + ")", Permanent: true}
	}
	ports, err := btserial.Ports()
	if err != nil {
		return &Error{Msg: "Falha ao listar as impressoras Bluetooth", Err: err}
	}
	i := slices.IndexFunc(ports, func(p btserial.Port) bool { return p.MAC == mac && !p.Incoming })
	if i < 0 {
		return &Error{Msg: "Impressora Bluetooth não pareada neste computador"}
	}
	return writeCOM(ports[i].COM, DefaultBaudRate, writeTimeout, data, true)
}

func writeCOM(port string, baud int, writeTimeout time.Duration, data []byte, bluetooth bool) error {
	unavailable := "Porta serial " + port + " indisponível"
	if bluetooth {
		unavailable = "Sem resposta da impressora Bluetooth (desligada, fora de alcance ou conectada a outro aparelho?)"
	}
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
	if err := windows.GetCommState(h, &dcb); err != nil && !bluetooth {
		return &Error{Msg: unavailable, Err: err}
	}
	dcb.BaudRate = uint32(baud)
	dcb.ByteSize = 8
	dcb.Parity = noParity
	dcb.StopBits = oneStopBit
	dcb.Flags &^= dcbParity | dcbOutxCtsFlow | dcbOutxDsrFlow | dcbDtrControlMask | dcbDsrSensitivity | dcbOutX | dcbInX | dcbRtsControlMask
	dcb.Flags |= dcbBinary | dcbDtrEnable | dcbRtsEnable
	// a Bluetooth link has no line settings; a stack that refuses them still prints
	if err := windows.SetCommState(h, &dcb); err != nil && !bluetooth {
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
	if bluetooth {
		// many cheap printers drop the end of the ticket if the link closes right after the write
		_ = windows.FlushFileBuffers(h)
		time.Sleep(400 * time.Millisecond)
	}
	return nil
}
