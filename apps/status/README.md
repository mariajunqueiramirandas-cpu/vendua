# status.vendua.com.br

The public status page: a static page rebuilt every 5 minutes by `.github/workflows/status.yml`
and served by GitHub Pages, off the VPS. How it works and the one-time setup:
[docs/deploy/status-page.md](../../docs/deploy/status-page.md).

- `src/config.ts`: the four parts it shows and what each check fetches.
- `src/check.ts`: one check (timeout, retries, Cloudflare challenge = unknown).
- `src/history.ts`: the 90-day history kept in the published `history.json`.
- `src/render.ts`: the page (pt-BR, the site's tokens, works without JavaScript).
- `src/main.ts`: one run: previous history → checks + Core's incidents → `build/`.
- `static/`: favicon and the two fonts (Figtree, Space Grotesk; OFL, licenses alongside).

```sh
bun test
bun run check
STATUS_HISTORY_FILE=/tmp/none.json bun run start   # real checks → build/index.html
```
