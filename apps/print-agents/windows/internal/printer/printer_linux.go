package printer

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

func sendSpooler(ctx context.Context, queue string, data []byte) error {
	cmd := exec.CommandContext(ctx, "lp", "-d", queue, "-o", "raw")
	cmd.Stdin = bytes.NewReader(data)
	cmd.Env = append(os.Environ(), "LC_ALL=C")
	out, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}
	if errors.Is(err, exec.ErrNotFound) {
		return &Error{Msg: "Fila de impressão indisponível (CUPS não instalado)", Err: err, Permanent: true}
	}
	err = fmt.Errorf("%w: %s", err, bytes.TrimSpace(out))
	if s := string(out); strings.Contains(s, "does not exist") || strings.Contains(s, "Unknown destination") {
		return &Error{Msg: "Impressora não encontrada (" + queue + ")", Err: err, Permanent: true}
	}
	return &Error{Msg: "Falha ao enviar para a impressora (" + queue + ")", Err: err}
}

var baudRates = map[int]uint32{
	1200: unix.B1200, 2400: unix.B2400, 4800: unix.B4800, 9600: unix.B9600,
	19200: unix.B19200, 38400: unix.B38400, 57600: unix.B57600,
	115200: unix.B115200, 230400: unix.B230400,
}

func sendSerial(ctx context.Context, port string, baud int, writeTimeout time.Duration, data []byte) error {
	speed, ok := baudRates[baud]
	if !ok {
		return &Error{Msg: fmt.Sprintf("Velocidade inválida para %s", port), Permanent: true}
	}
	path := port
	if !strings.HasPrefix(path, "/") {
		path = "/dev/" + path
	}
	// O_NONBLOCK keeps open from waiting on carrier detect and lets the
	// runtime poller enforce the write deadline.
	f, err := os.OpenFile(path, os.O_WRONLY|syscall.O_NOCTTY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return &Error{Msg: "Porta serial " + port + " indisponível", Err: err}
	}
	defer f.Close()
	if err := setRaw(f, speed); err != nil {
		return &Error{Msg: "Porta serial " + port + " indisponível", Err: err}
	}
	stop := context.AfterFunc(ctx, func() { _ = f.SetWriteDeadline(time.Now()) })
	defer stop()
	_ = f.SetWriteDeadline(time.Now().Add(serialBudget(writeTimeout, baud, len(data))))
	if _, err := f.Write(data); err != nil {
		return &Error{Msg: "Falha ao enviar para a impressora (" + port + ")", Err: err}
	}
	return nil
}

func setRaw(f *os.File, speed uint32) error {
	rc, err := f.SyscallConn()
	if err != nil {
		return err
	}
	var terr error
	err = rc.Control(func(fd uintptr) {
		t, err := unix.IoctlGetTermios(int(fd), unix.TCGETS)
		if err != nil {
			terr = err
			return
		}
		t.Iflag &^= unix.IGNBRK | unix.BRKINT | unix.PARMRK | unix.ISTRIP | unix.INLCR | unix.IGNCR | unix.ICRNL | unix.IXON | unix.IXOFF
		t.Oflag &^= unix.OPOST
		t.Lflag &^= unix.ECHO | unix.ECHONL | unix.ICANON | unix.ISIG | unix.IEXTEN
		t.Cflag &^= unix.CSIZE | unix.PARENB | unix.CSTOPB | unix.CRTSCTS | unix.CBAUD
		t.Cflag |= unix.CS8 | unix.CLOCAL | unix.CREAD | speed
		t.Ispeed, t.Ospeed = speed, speed
		terr = unix.IoctlSetTermios(int(fd), unix.TCSETS, t)
	})
	if err != nil {
		return err
	}
	return terr
}
