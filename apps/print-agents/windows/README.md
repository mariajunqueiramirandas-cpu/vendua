# Venduá Impressora (Windows)

The store PC's print agent. It pairs with a store (device-code flow, approved in the admin),
keeps an SSE stream open to Core, and writes the already-encoded ESC/POS bytes of each job to
the right local printer: a Windows print queue (winspool, RAW), a network printer (raw TCP 9100)
or a COM port. It never builds ticket content. The contract with Core is the shared print-agent
spec (`/admin/v1/agent/*`). The same code builds on Linux for development (CUPS `lp -o raw`
instead of winspool).

## Build

```sh
# Windows exe (no cgo; what CI publishes)
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath \
  -ldflags "-H windowsgui -s -w -X main.version=$(cat ../VERSION)" -o vendua-impressora.exe .

# Linux dev binary
go build -o vendua-impressora .

# Checks
gofmt -l . && go vet ./... && GOOS=windows go vet ./... && go test -race ./...
```

## Flags

| flag          | meaning                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `-api URL`    | Core base URL. Default `$VENDUA_API`, else `https://painel.vendua.com.br`.                               |
| `-data DIR`   | Config, finished-jobs store and log. Setting it also skips the Windows self-install.                     |
| `-headless`   | No tray; status and the pairing code go to stdout. Default on Linux with no `DISPLAY`/`WAYLAND_DISPLAY`. |
| `-no-install` | Windows: run where it is, without installing or enabling autostart.                                      |
| `-debug`      | Debug logging.                                                                                           |
| `-version`    | Print the version and exit.                                                                              |

Local end-to-end run against a dev Core:
`go run . -headless -api http://localhost:8787 -data /tmp/vendua-agent`, then approve the code it logs.

## Where things live

- Windows: the first run copies the exe to `%LOCALAPPDATA%\Vendua\Impressora\vendua-impressora.exe`,
  strips its `Zone.Identifier` stream, sets `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
  `VenduaImpressora`, starts the installed copy and exits. Running a newer download asks the
  running copy to quit, replaces the exe and starts it. "Sair" in the tray only exits;
  autostart stays.
- Data dir (Windows: the install dir above; Linux: `~/.config/vendua-impressora`):
  `config.json` (Core URL, store name, last printer set, token: DPAPI-sealed on Windows,
  plain in a 0600 file on Linux), `finished.json` (last 200 job results, so redelivered jobs
  are not printed twice), `agent.log` (rotated at 1 MB, one `agent.log.1` kept).
  The tray's "Abrir log" opens `agent.log` (Notepad on Windows), and a failed "Imprimir teste"
  shows an alert with the cause. The status line says why it is offline (no internet, Core down,
  certificate refused because of the PC's clock, …).

## Layout

`main.go` wires things up. `internal/agent` is the state machine (pairing → stream → jobs,
discovery reports, update checks); `internal/api` the HTTP + SSE client; `internal/jobs` the
per-printer FIFO workers and finished store; `internal/printer` the transports;
`internal/discovery` queues, COM ports and the /24 port-9100 probe; `internal/tray` the tray
menu and generated icons. OS-specific code sits in `_windows.go` / `_linux.go` files.

## SmartScreen and Smart App Control

The exe is not code-signed yet, and that is what merchants run into:

- **SmartScreen** (every Windows): the downloaded exe shows "O Windows protegeu o computador".
  The merchant clicks **Mais informações → Executar assim mesmo** once. The installed copy has
  no mark of the web, so it is not asked again at boot.
- **Smart App Control** (Windows 11 clean installs where it is on): unsigned apps are blocked
  outright, with no override short of turning Smart App Control off for good. Those stores
  cannot use the agent until releases are signed (Authenticode, ideally EV or Azure Trusted
  Signing).

Until then, support should expect the SmartScreen step and should not tell merchants to turn
off Smart App Control.
