# apps/admin — the merchant admin

The store owner's product: a phone-first PWA served at `/admin/`. It talks to
Core's `/admin/v1` API. The plan is in [docs/merchant-admin.md](../../docs/merchant-admin.md),
the design spec in [docs/merchant-admin-design.md](../../docs/merchant-admin-design.md),
and identity in [ADR 0020](../../docs/adr/0020-merchant-identity.md). Copy is pt-BR.

## Run it

```sh
# Core with dev sign-in codes (the code comes back in the /auth/otp/start response)
cd packages/core && (CONTROL_SECRET=dev SESSION_SECRET=devsecret VENDUA_WEBHOOK_SECRET=devhook \
  VENDUA_ADMIN_DEV_OTP=1 nohup bun src/index.ts > /tmp/core.log 2>&1 & echo $! > /tmp/core.pid)
cd apps/admin && bun run dev          # :5196/admin/, proxies /admin/v1 and /v1 to :8787
# the Aparência preview frames the real storefront: run it too
cd storefronts/quero-pudim && bun run dev
```

The seed's demo owner is Maria, phone `(22) 99999-0000`, at Quero Pudim.
`bun scripts/demo-orders.ts` places a few live orders.

## Gates (CI job `admin-gate`)

- `bun run check`: typecheck.
- `bun run build`: Vite build plus `scripts/budget.ts`. The limits are shell
  ≤120 KB gzip, each lazy route ≤60 KB, and latin fonts ≤90 KB. A new
  dependency that pushes the shell over budget belongs in a lazy route.
- `CHROMIUM=/opt/pw-browsers/chromium AXE=1 bun scripts/shots.ts [routes]`
  shoots 375/820/1440 in Creme and Noite into `shots/`. It fails on horizontal
  overflow, console errors or serious/critical axe violations. It signs in once
  and reuses `/tmp/vendua-admin-auth.json`. Set `BASE=http://localhost:8787/admin/`
  to check the production build that Core serves.

## Rules

- **Tokens only.** Colours, radii, type and motion live in `src/ui/theme.css`
  (Creme + Noite; `noite:` is the dark variant). No hex values in features,
  except the onboarding mock, which imitates a storefront.
- **Shadows are `depth-1/2/3`.** They compose with `ring-*`. Don't hand-write
  `box-shadow`.
- **Components** live in `src/ui/`, with one folder per area in `src/features/`.
  `/_ui` is the living reference; add new components there.
- **Data:** keys come from `qk` in `src/lib/query.ts`. The cache stores the raw
  API response and screens unwrap it with `select`. `src/lib/live.ts` maps SSE
  topics to invalidations. Mutations pause while offline.
- **Money** is integer cents from Core. The client formats (`lib/format.ts`) and
  never totals.
- **Mutations** go through `lib/api.ts`, which adds the `x-vendua-admin` header
  and an `Idempotency-Key`.
- **Phones first.** Every screen works at 375px with thumb-reachable actions.
  Check 375 in the shots before anything else.
- Keep the shell small: sheets and rarely used screens are `lazy()`.
