// Command vendua-impressora is the Venduá print agent for Windows: it pairs
// with a store, keeps a job stream open to Core and writes the ESC/POS bytes
// it receives to the store's printers. It also runs on Linux for development.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/agent"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/api"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/config"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/discovery"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/jobs"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/logx"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/platform"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/printer"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/secret"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/tray"
	"github.com/mariajunqueiramirandas-cpu/vendua/apps/print-agents/windows/internal/update"
)

// version is set at build time with -ldflags "-X main.version=…".
var version = "0.0.0-dev"

const defaultAPI = "https://painel.vendua.com.br"

func main() {
	apiFlag := flag.String("api", "", "Core base URL (default $VENDUA_API, else "+defaultAPI+")")
	dataFlag := flag.String("data", "", "directory for config, finished jobs and agent.log (default: per-user app data)")
	headless := flag.Bool("headless", false, "run without the tray icon and log to stdout (default on Linux without a display)")
	noInstall := flag.Bool("no-install", false, "Windows: run from the current location without installing or enabling autostart")
	debug := flag.Bool("debug", false, "log debug messages")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println(version)
		return
	}
	if !*headless && !platform.HasDisplay() {
		*headless = true
	}
	if err := run(*apiFlag, *dataFlag, *headless, *noInstall, *debug); err != nil {
		if !*headless {
			platform.Alert("Venduá Impressora", "Não foi possível iniciar: "+err.Error())
		}
		fmt.Fprintln(os.Stderr, "vendua-impressora:", err)
		os.Exit(1)
	}
}

func run(apiFlag, dataFlag string, headless, noInstall, debug bool) error {
	base, err := apiBase(apiFlag)
	if err != nil {
		return err
	}
	dataDir := dataFlag
	if dataDir == "" {
		if dataDir, err = platform.DefaultDataDir(); err != nil {
			return err
		}
	}
	logFile, err := logx.Open(filepath.Join(dataDir, "agent.log"), 1<<20)
	if err != nil {
		return err
	}
	defer logFile.Close()
	var out io.Writer = logFile
	if headless || runtime.GOOS != "windows" {
		out = io.MultiWriter(os.Stdout, logFile)
	}
	level := slog.LevelInfo
	if debug {
		level = slog.LevelDebug
	}
	log := slog.New(slog.NewTextHandler(out, &slog.HandlerOptions{Level: level}))

	// A custom -data is a dev or test setup: never install over the real agent.
	if runtime.GOOS == "windows" && !noInstall && dataFlag == "" {
		handedOff, err := platform.Install(os.Args[1:])
		if handedOff {
			log.Info("installed, handing off to the installed copy", "version", version)
			return nil
		}
		if err != nil {
			log.Error("self-install failed, running from here", "err", err)
		}
	}

	release, err := platform.SingleInstance(dataDir)
	if errors.Is(err, platform.ErrAlreadyRunning) {
		log.Info("already running, exiting")
		return nil
	}
	if err != nil {
		return err
	}
	defer release()

	finished, err := jobs.OpenFinished(filepath.Join(dataDir, "finished.json"), 200)
	if err != nil {
		log.Warn("finished-jobs store unreadable, starting empty", "err", err)
	}
	openURL := platform.OpenURL
	if headless {
		openURL = func(u string) error {
			log.Info("open this page to approve", "url", u)
			return nil
		}
	}
	a := agent.New(agent.Options{
		Client:      api.NewClient(base, version),
		Store:       config.NewStore(filepath.Join(dataDir, "config.json"), secret.Default()),
		Finished:    finished,
		Sender:      printer.NewSender(),
		Discoverer:  discovery.New(log),
		Name:        platform.Hostname(),
		Version:     version,
		OpenURL:     openURL,
		Log:         log,
		Headless:    headless,
		ScanOnStart: true,
		UpdateURL:   update.VersionURL,
	})
	log.Info("starting", "version", version, "api", base, "data", dataDir, "headless", headless)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	quit := platform.QuitRequests()
	done := make(chan struct{})
	go func() { defer close(done); a.Run(ctx) }()

	if headless {
		go logStatus(ctx, a, log)
		select {
		case <-ctx.Done():
		case <-quit:
		}
	} else {
		tray.Run(ctx, tray.Options{Agent: a, AdminURL: base + "/admin/impressoras", Log: log, Quit: quit})
	}
	stop()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		log.Warn("shutdown timed out")
	}
	log.Info("stopped")
	return nil
}

func apiBase(flagValue string) (string, error) {
	base := flagValue
	if base == "" {
		base = os.Getenv("VENDUA_API")
	}
	if base == "" {
		base = defaultAPI
	}
	base = strings.TrimRight(base, "/")
	u, err := url.Parse(base)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return "", fmt.Errorf("invalid API base URL %q", base)
	}
	return base, nil
}

// logStatus is the headless stand-in for the tray: one line per change.
func logStatus(ctx context.Context, a *agent.Agent, log *slog.Logger) {
	changes := a.Subscribe()
	last := ""
	for {
		s := a.Status()
		if text := s.Text(); text != last {
			log.Info("status: "+text, "state", s.State.String(), "printers", len(s.Printers))
			last = text
		}
		select {
		case <-ctx.Done():
			return
		case <-changes:
		}
	}
}
