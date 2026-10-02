# ADR 0027: Kitchen printing through a store-side print agent

- Status: Accepted (implemented 2026-10-02, Core migration 0077)
- Date: 2026-10-02

## Context

Orders reached the kitchen only through the admin's "imprimir comanda" button, which opened the
browser's print dialog on an 80 mm HTML page ([`competitor-parity.md`](../competitor-parity.md),
P-016: "partial: browser-print ticket only"). Food competitors print automatically, to a thermal
printer per station, from a small agent on the store's PC (Domínio Printer, paired with a token
from the panel).

A browser can't do this alone. WebUSB can't claim a printer whose Windows driver holds it,
browsers can't open the raw TCP socket a network printer needs, and nothing prints with no tab
open. Many of the stores run the admin on an Android tablet with a Bluetooth or USB printer, so a
Windows-only agent isn't enough either.

The user decided (2026-10-02): build our own agents rather than buy (PrintNode, QZ Tray); a
Windows agent and a separate Android agent; no Smart POS terminals and no NFC-e in this scope;
no code signing for the Windows agent and no Play Store for now.

## Decision

**Core renders every ticket and encodes it to ESC/POS.** The agents are pipes: they receive
finished bytes, write them to a local printer and say how it went. Layout, code pages and copies
change with a Core deploy, never an agent release, and both agents stay small enough to write
twice. The encoder (`modules/printing/escpos.ts`) uses only the commands every ESC/POS printer
takes (init, code page, align, bold, size, feed, partial cut) and prints Portuguese through CP850
by default (CP860 or folded ASCII per printer).

**One agent per platform, same wire protocol.**

- Windows: Go (`apps/print-agents/windows`), one unsigned `.exe` with a tray icon. On first run
  it installs itself per user under `%LOCALAPPDATA%`, drops the downloaded-file mark and starts
  with Windows. It prints RAW through the Windows spooler (any USB printer with its driver
  installed), to network printers on TCP 9100 and to COM ports.
- Android: Kotlin (`apps/print-agents/android`), a foreground service of type `connectedDevice`
  that prints over USB host, Bluetooth Classic (SPP) and TCP 9100, restarted at boot and by a
  WorkManager watchdog.

**Pairing is a device-code flow.** The agent asks Core for a code (`POST /admin/v1/agent/pair`)
and opens or shows `…/admin/impressoras/parear?code=XXXX-XXXX`. A manager approves it in the
admin. The agent's next poll collects a credential `<tenant>.<device>.<secret>`; Core keeps only
sha256(secret). The pending code lives in `print_pairings`, a pre-tenant table behind its own GUC
like `merchant_login_codes`. The agent API rides the admin host under `/admin/v1/agent`, mounted
before the session gate, so no proxy changes.

**Jobs are rows, delivered over SSE.** `enqueueOrderPrintTx` queues one `print_jobs` row per
automatic printer in the order's own transaction (savepoint, never throws), at the step the
store chose (`store_settings.print_on`: on accept by default, or as soon as the order arrives);
`(printer, order, step)` is unique so a replayed step never prints twice. A NOTIFY wakes the
device's stream (`GET /admin/v1/agent/stream`), which renders due jobs, marks them sent and
pushes them. Delivery is at least once: an unanswered job is resent after a minute, agents
dedupe by job id, and a job not printed within two hours expires. A ticket printed more than ten
minutes after it was queued says so at the top.

**Releases come from GitHub.** CI builds both agents and publishes them on a GitHub Release when
`apps/print-agents/VERSION` changes; the admin links to `releases/latest/download/…`. Agents
check `version.json` there and offer the update; the Android APK is signed with our own key
(GitHub secrets), the Windows `.exe` is not signed.

## Consequences

- Printing works with any ESC/POS thermal printer (Epson, Elgin, Bematech in ESC/POS mode,
  Daruma, the generic 58/80 mm ones). Printers without ESC/POS (A4 lasers) aren't supported;
  a "driver mode" that draws the ticket through the OS driver is the next step if stores ask.
- Unsigned, the Windows agent shows SmartScreen's "O Windows protegeu o computador" once, and
  antivirus heuristics may flag it. On Windows 11 PCs with Smart App Control on, it is blocked
  outright with no override; those stores can't use it until we sign it.
- The APK is installed from our site. Google's developer verification, already live in Brazil
  for installs from participating stores, reaches direct APK installs on certified devices in
  2027; we must register as a verified developer and our package name before then, or merchants
  hit Android's 24-hour "advanced flow". Deferred by the user (2026-10-02).
- Losing the Android signing key means every merchant uninstalls and reinstalls; it lives in
  GitHub secrets with an offline copy.
- Station routing (kitchen gets food, bar gets drinks) is not built: every automatic printer gets
  the whole ticket. Per-category routing is a later change to `enqueueOrderPrintTx` only.
