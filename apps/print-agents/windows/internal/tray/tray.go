//go:build windows || linux

// Package tray is the notification-area icon and its menu.
package tray

import (
	"context"
	"fmt"
	"image/color"
	"log/slog"
	"runtime"
	"sync/atomic"

	"fyne.io/systray"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/agent"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/platform"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/update"
)

const maxPrinterLines = 8

type Options struct {
	Agent    *agent.Agent
	AdminURL string
	// LogPath is the agent.log the "Abrir log" item opens.
	LogPath string
	Log     *slog.Logger
	// Quit, when it fires, closes the tray as if "Sair" was clicked.
	Quit <-chan struct{}
}

// Run shows the tray and blocks until "Sair". It must be called from main.
func Run(ctx context.Context, o Options) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	systray.Run(func() { onReady(ctx, o) }, cancel)
}

type menu struct {
	status, connect, test, scan, admin, log, update, disconnect, quit *systray.MenuItem
	printers                                                          []*systray.MenuItem
}

func onReady(ctx context.Context, o Options) {
	a := o.Agent
	systray.SetTitle("Venduá Impressora")
	m := menu{status: systray.AddMenuItem("", "")}
	m.status.Disable()
	for range maxPrinterLines {
		it := systray.AddMenuItem("", "")
		it.Disable()
		it.Hide()
		m.printers = append(m.printers, it)
	}
	systray.AddSeparator()
	m.connect = systray.AddMenuItem("Conectar à loja…", "Gerar um código e aprovar no painel")
	m.test = systray.AddMenuItem("Imprimir teste", "Imprime um ticket de teste em cada impressora")
	m.scan = systray.AddMenuItem("Procurar impressoras", "Procura impressoras neste computador e na rede")
	m.admin = systray.AddMenuItem("Abrir painel de impressoras", "")
	m.log = systray.AddMenuItem("Abrir log", "O registro do que o programa fez, para enviar ao suporte")
	if o.LogPath == "" {
		m.log.Hide()
	}
	m.update = systray.AddMenuItem("Baixar atualização", "")
	m.disconnect = systray.AddMenuItem("Desconectar este computador", "")
	systray.AddSeparator()
	m.quit = systray.AddMenuItem("Sair", "Fecha o Venduá Impressora até a próxima vez que o Windows iniciar")

	// One test at a time: a second click while the first is still asking Core would only stack alerts.
	var testBusy atomic.Bool
	changes := a.Subscribe()
	m.refresh(a.Status())
	for {
		select {
		case <-ctx.Done():
			return
		case <-o.Quit:
			systray.Quit()
			return
		case <-changes:
			m.refresh(a.Status())
		case <-m.connect.ClickedCh:
			a.RequestPairing()
		case <-m.test.ClickedCh:
			if testBusy.CompareAndSwap(false, true) {
				go func() {
					err := a.TestPrinters(ctx)
					testBusy.Store(false)
					if err == nil || ctx.Err() != nil {
						return
					}
					o.Log.Warn("test print request failed", "err", err)
					platform.Alert("Venduá Impressora", agent.TestFailure(err))
				}()
			}
		case <-m.scan.ClickedCh:
			a.Rescan()
		case <-m.admin.ClickedCh:
			open(o.Log, o.AdminURL)
		case <-m.log.ClickedCh:
			if err := platform.OpenFile(o.LogPath); err != nil {
				o.Log.Warn("opening log failed", "path", o.LogPath, "err", err)
				go platform.Alert("Venduá Impressora", "Não foi possível abrir o log. Ele fica em:\n"+o.LogPath)
			}
		case <-m.update.ClickedCh:
			open(o.Log, update.DownloadURL)
		case <-m.disconnect.ClickedCh:
			go func() {
				if !platform.Confirm("Venduá Impressora", "Desconectar este computador da loja? Ele vai parar de imprimir os pedidos até ser conectado de novo.") {
					return
				}
				if err := a.Disconnect(ctx); err != nil {
					o.Log.Warn("could not tell Core about the disconnect", "err", err)
				}
			}()
		case <-m.quit.ClickedCh:
			systray.Quit()
			return
		}
	}
}

func (m *menu) refresh(s agent.Status) {
	text := s.Text()
	systray.SetIcon(icon(s.State))
	systray.SetTooltip("Venduá Impressora — " + text)
	m.status.SetTitle(text)

	for i, it := range m.printers {
		switch {
		case !s.Paired || i >= len(s.Printers):
			it.Hide()
		case i == len(m.printers)-1 && len(s.Printers) > len(m.printers):
			it.SetTitle(fmt.Sprintf("… e mais %d impressoras", len(s.Printers)-i))
			it.Show()
		default:
			it.SetTitle(s.Printers[i].Line())
			it.Show()
		}
	}

	show(m.connect, !s.Paired)
	show(m.test, s.Paired)
	show(m.disconnect, s.Paired)
	enable(m.test, s.State == agent.Online && len(s.Printers) > 0)
	if s.Scanning {
		m.scan.SetTitle("Procurando impressoras…")
		m.scan.Disable()
	} else {
		m.scan.SetTitle("Procurar impressoras")
		m.scan.Enable()
	}
	if s.UpdateVersion != "" {
		m.update.SetTitle("Baixar atualização (" + s.UpdateVersion + ")")
	}
	show(m.update, s.UpdateVersion != "")
}

var icons = map[color.NRGBA][]byte{}

func icon(s agent.State) []byte {
	c := Amber
	switch s {
	case agent.Online:
		c = Green
	case agent.Offline:
		c = Red
	}
	b, ok := icons[c]
	if !ok {
		if runtime.GOOS == "windows" {
			b = ICO(c)
		} else {
			b = PNG(c, 32)
		}
		icons[c] = b
	}
	return b
}

func show(it *systray.MenuItem, v bool) {
	if v {
		it.Show()
	} else {
		it.Hide()
	}
}

func enable(it *systray.MenuItem, v bool) {
	if v {
		it.Enable()
	} else {
		it.Disable()
	}
}

func open(log *slog.Logger, u string) {
	if err := platform.OpenURL(u); err != nil {
		log.Warn("opening browser failed", "url", u, "err", err)
	}
}
