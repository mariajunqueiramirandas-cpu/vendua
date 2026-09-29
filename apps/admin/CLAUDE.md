# apps/admin (merchant admin)

`apps/admin/README.md` holds the rules. Highlights:

- Merchant identity is phone OTP over WhatsApp with per-tenant sessions and
  owner/manager/attendant roles (ADR 0020). Every admin mutation writes `audit_log` in
  its own tx, and live updates are `emitAdminTx` → SSE.
- To run it, start Core with `VENDUA_ADMIN_DEV_OTP=1` (the sign-in code comes back in
  the response), then `cd apps/admin && bun run dev` (:5196). Sign in as the seed owner,
  phone 22981795040.
- Gates: `bun run build` (bundle budgets) and
  `CHROMIUM=/opt/pw-browsers/chromium AXE=1 bun scripts/shots.ts` (375/820/1440 ×
  Creme/Noite; overflow, console and axe).
- Style: `theme.css` tokens only, and `depth-*` for shadows (they compose with `ring-*`).
- Visual and UI design work here is done by Opus 5.5: yourself if this session runs on Opus
  5.5, otherwise the `frontend-designer` agent — never a Sonnet subagent.
