# apps/control (CRM)

`apps/control/README.md` holds the binding UI/data rules. Highlights:

- Tailwind v4 tokens only (light + dark), shared components in `src/components/`,
  one folder per area in `src/features/`, live style reference at `/#/_ui`.
- TanStack Query keys come from `qk` in `src/lib/query.ts`; the cache stores the raw API
  response (unwrap with `select`) because screens share keys; SSE invalidation lives in
  `src/lib/live.ts`.
- Every list gets a real phone layout (`DataList` `mobileRow`); check 375px for overflow.
- Prod: Core's Docker image builds `apps/control` and serves `dist/` at `/control/`
  (Dokploy compose; `crm` nginx proxies `/control` to core).
