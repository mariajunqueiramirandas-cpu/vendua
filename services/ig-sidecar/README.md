# ig-sidecar

Instagram DM transport for Venduá Core — the Instagram counterpart of the in-process
Baileys WhatsApp socket. It's a small Go service on
[mautrix-meta](https://github.com/mautrix/meta)'s `instameow` client (Instagram's web
messaging protocol), run without Matrix. It can DM accounts that never wrote first,
which Meta's official Messaging API doesn't allow.

**License: AGPL-3.0** (`LICENSE`), because it links mautrix-meta. Keep it a separate
service. Core only talks to it over HTTP.

## How it fits

```
Core ──bearer──▶ ig-sidecar ──▶ instagram.com (web session, optional IG_PROXY)
Core ◀─HMAC events── ig-sidecar   (inbound DMs, connection state, rotated cookies)
```

- The sidecar keeps nothing on disk. Core stores the session in `ig_auth_state` and
  `PUT`s it back when `/v1/status` reports `off` (checked on boot and every minute).
- Events go to `CORE_EVENTS_URL` (`/control/v1/ig/events`), signed with
  `x-ig-signature: hex(HMAC-SHA256(secret, "<x-ig-timestamp>.<body>"))`. Core rejects
  timestamps more than 5 minutes off.
- Only 1:1 text DMs from other people are forwarded: no own echoes, groups, or
  media-only messages. After a restart, DMs newer than Core's floor (its newest
  recorded Instagram message either way, else the login time) are replayed, up to 25
  threads. Core dedupes by message id.
- Sends are paced account-wide: `IG_MIN_SEND_GAP_SECONDS` (default 20) plus up to 50%
  jitter. A cold DM (no thread yet) goes to the recipient's Instagram user ID, looked up from
  their messaging id (the messaging id itself fails with "Query Error").
- Follows (`/v1/follow`) are paced the same way but on their own gap,
  `IG_MIN_FOLLOW_GAP_SECONDS` (default 60). An exact username can resolve through its Instagram
  profile ID. The sidecar verifies a target found on the public page with the connected session
  before following. An existing follow or pending request returns `already: true`. Instameow has
  no follow call, so the sidecar posts the web profile's Follow button (`/api/v1/friendships/create/<id>/`).
  Instagram's Action Blocked comes back as `429 action_blocked`. Core's queue, daily cap and
  pause live in `packages/core/src/crm/ig-follows.ts`.
- Profile lookups (`/v1/profile`) use the connected session to find an exact username and read its
  Instagram profile ID. If the signed-in lookup cannot load it, the sidecar checks the public
  profile page. A search miss plus a missing public page returns `404 user_not_found`. Inconclusive
  responses return `502 profile_unavailable`. Rate limits and session challenges stop the lookup.

## API (all under `Authorization: Bearer $IG_SIDECAR_SECRET`)

| Route                    | Body                        | Returns                                                                                                        |
| ------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GET /v1/status`         |                             | `{state, error?, account?, login?}`                                                                            |
| `PUT /v1/session`        | `{session, sinceMs}`        | status — resumes a stored session                                                                              |
| `DELETE /v1/session`     |                             | status — forget the session                                                                                    |
| `POST /v1/login/start`   | `{device?}`                 | step                                                                                                           |
| `POST /v1/login/submit`  | `{input: {fieldId: value}}` | step (`complete` carries `session`)                                                                            |
| `POST /v1/login/cookies` | `{cookies, device?}`        | step — JSON, cookie export, cURL or header                                                                     |
| `POST /v1/login/cancel`  |                             | `{ok}`                                                                                                         |
| `POST /v1/resolve`       | `{username}`                | `{fbid, igid, username, name}`                                                                                 |
| `POST /v1/send`          | `{fbid? , username?, text}` | `{messageId, threadId?, fbid}`                                                                                 |
| `POST /v1/follow`        | `{fbid?, username?}`        | `{fbid, igid, username?, following, requested, already}`                                                       |
| `POST /v1/profile`       | `{username}`                | `{username, fullName?, biography, externalUrl?, externalUrls?, followersCount?, postsCount?, latestPosts?, …}` |

`state` is one of `off`, `connecting`, `open`, or `error`. `error` means Instagram
wants a human (`logged_out`, `challenge`, `checkpoint`, `consent`, `suspended`,
`unauthorized`), and the sidecar won't retry on its own. Login steps are
`input` (render `fields`), `wait` (approve in the app, then submit `{}`), or
`complete`.

## Env

| Var                          | Default | Notes                                                |
| ---------------------------- | ------- | ---------------------------------------------------- |
| `IG_SIDECAR_SECRET`          | —       | unset = every call gets 503 (idle)                   |
| `CORE_EVENTS_URL`            | —       | unset = events are only logged                       |
| `IG_PROXY`                   | —       | `http://`/`socks5://`; datacenter IPs get challenged |
| `IG_MIN_SEND_GAP_SECONDS`    | `20`    | account-wide pacing between DMs                      |
| `IG_MIN_FOLLOW_GAP_SECONDS`  | `60`    | account-wide pacing between follows                  |
| `IG_MIN_PROFILE_GAP_SECONDS` | `4`     | account-wide pacing between live profile lookups     |
| `IG_MAX_PROFILES_PER_HOUR`   | `60`    | rolling 1-hour cap on live profile lookups (0 = off) |
| `IG_SIDECAR_ADDR`            | `:8790` |                                                      |
| `LOG_LEVEL`                  | `info`  |                                                      |

## Dev

```sh
cd services/ig-sidecar
go test -race ./...     # go.mod needs Go ≥1.26 (GOTOOLCHAIN=auto fetches it)
IG_SIDECAR_SECRET=devig IG_SIDECAR_ADDR=127.0.0.1:8790 \
  CORE_EVENTS_URL=http://127.0.0.1:8787/control/v1/ig/events go run .
# core: IG_SIDECAR_URL=http://127.0.0.1:8790 IG_SIDECAR_SECRET=devig bun src/index.ts
```

`go.mod` repeats mautrix-meta's `replace` for `imroc/req` because replace directives
aren't inherited from dependencies. When bumping mautrix-meta, check its `go.mod` for
changes to it.
