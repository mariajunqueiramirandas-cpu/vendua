# status.vendua.com.br

The public status page. It runs on GitHub, not on the VPS, so it stays up during the outages it
reports ([16](../architecture/16-operations-and-incidents.md)).

## How it works

`.github/workflows/status.yml` runs every 5 minutes as a chain: each run ends by queuing the next
one (`gh workflow run`, allowed with the workflow's own token) about 5 minutes after it started.
GitHub's own cron is best-effort (a `*/5` schedule went hours without firing), so the schedule
(:07 and :37) only restarts the chain if a run dies without queuing the next. The concurrency
group keeps it to one run plus one waiting, so a chain run and a cron run collapse into one.
Each run:

1. reads the published `history.json` (the page's memory: 90 days of results per part, and the
   last incidents);
2. checks production from the runner, retrying a failure twice before believing it:
   - **Lojas**: a store page answers 200 with the edge's `vendua-state`;
   - **Pedidos**: that store's `/storefront/v1/state` answers from Core (an edge
     `x-vendua-edge-stale` answer counts as down);

     The stores come from Core's feed (`stores`: the 3 oldest active tenants), so the probe
     follows the fleet and no tenant is hardcoded. One answering is enough; none to probe
     (or Core silent with no stored list) is "sem verificação", never "fora do ar". The last
     list is kept in `history.json`. `STATUS_STORE_HOST` pins a single store instead;

   - **Painel**: `painel.vendua.com.br/admin/` and the public `/admin/v1/signup/plans` (Core and
     the database behind the admin's proxy);
   - **Site da Venduá**: `vendua.com.br`;
3. reads the incidents staff post in the CRM (Lojas → Incidentes) from Core's public
   `GET /admin/v1/status`: the open ones and the last 30 days' resolved ones, with the same text
   merchants read in Ajuda. When Core doesn't answer, the last ones fetched stay on the page;
4. writes `apps/status/build/` (`index.html`, `history.json`, fonts, icons) and deploys it to
   GitHub Pages.

An answer slower than 5 s is "com lentidão". A Cloudflare challenge on the runner is "sem
verificação", not "fora do ar". If the page hasn't been republished for 30 minutes, it says so
at the top.

Code: `apps/status` (Bun, no dependencies, so the workflow needs no install). Tests run in CI
with the other unit tests: `cd apps/status && bun test`. To see the page locally against
production: `cd apps/status && STATUS_HISTORY_FILE=/tmp/none.json bun src/main.ts`, then open
`build/index.html`.

## Setup (once)

1. **GitHub → Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions → Variables → New repository variable:**
   `STATUS_PAGE` = `on`. The workflow does nothing until this is set, and setting it to anything
   else stops it.
3. **Actions → status → Run workflow** (branch `main`). The page is live at
   `https://<owner>.github.io/vendua/`.
4. **DNS (Cloudflare):** add `CNAME status → <owner>.github.io`, proxy status **DNS only** (grey
   cloud) so GitHub can issue the certificate. This record takes precedence over the
   `*.vendua.com.br` wildcard, which would otherwise send `status` to the edge. `status` is
   already a reserved store slug.
5. **Settings → Pages → Custom domain:** `status.vendua.com.br` → Save. When the DNS check passes,
   tick **Enforce HTTPS**.

Optional repository variables `STATUS_STORE_HOST` (pins the probe store; leave unset), `STATUS_ADMIN_ORIGIN` and
`STATUS_SITE_ORIGIN` point the checks elsewhere (defaults in `apps/status/src/config.ts`).

## Operating it

- Posting, editing or resolving an incident in the CRM reaches the page on the next run.
- A failed run leaves the last published page up. The history is never reset by an error: a run
  that can't read `history.json` (anything but a 404) fails instead of starting over.
- To stop it: set `STATUS_PAGE` to anything but `on` (the next run is skipped and queues
  nothing), or disable the workflow in **Actions → status → ⋯ → Disable workflow**.
- If the page says it hasn't been updated, check **Actions → status**: a run killed by its
  timeout doesn't queue the next, and the chain restarts at the next :07 or :37 the cron fires.
  GitHub also disables scheduled workflows in a repository with no activity for 60 days; the
  chain keeps running, but it has no restarter then.
