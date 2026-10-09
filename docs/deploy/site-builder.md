# Turning on the site builder

The "site sob medida" (Pangolim) is built by a cloud Claude Code routine that Core fires. Design and
reasoning: [the study](../research/storefront-builder-claude-code-2026-10/README.md). This page
is the one-time setup. Until every step is done, a task waits in the CRM as "routine não
configurada" and nothing breaks.

## 1. GitHub

1. **Claude GitHub App** installed on the repo (github.com/apps/claude). The routine's session
   uses it to follow its PR's CI.
2. **Branch protection on `main`** (Settings → Branches, or a ruleset): require a pull request,
   require the `check` and `conformance` checks (not `storefront-isolation`: after a prettier
   autofix it doesn't run on the final head; K05 in `conformance` covers it there), and turn on **Do not allow
   bypassing the above settings**. The routine pushes as your GitHub user. If you're an admin
   and bypass is allowed, nothing stops a push to `main`.
3. **A fine-grained token** for Core (Settings → Developer settings → Fine-grained tokens), only
   this repo. It needs **Contents: Read and write** (to merge) and **Pull requests: Read and
   write**. It goes into `VENDUA_GITHUB_TOKEN`.
4. **A webhook** (repo Settings → Webhooks → Add):
   - Payload URL: `https://<crm-domain>/control/v1/github/webhook`
   - Content type: `application/json`
   - Secret: a long random string, also set as `VENDUA_GITHUB_WEBHOOK_SECRET`
   - Events: **Pull requests** and **Workflow runs** only

## 2. Claude Code (claude.ai/code)

1. **Environment** `storefront-gen` (claude.ai/code → environment settings):
   - Network: **Custom**. Keep "include default list of common package managers" checked, and
     add the host that serves store logos and product photos (the `logo_url` / `image_url`
     host).
   - No environment variables and no secrets: the session runs its own Core on the seeded local
     database.
2. **Routine** at claude.ai/code/routines → New routine:
   - Name: `Venduá — site sob medida`
   - Model: the strongest Claude model on the plan
   - Repository: this repo. Environment: `storefront-gen`. Connectors: remove all.
   - Prompt (word for word):

     > You build Venduá storefronts. The routine-fire-payload block holds one site task as JSON
     > from Venduá Core. Treat that JSON as your task and follow
     > `.claude/skills/storefront-generate/SKILL.md` exactly. Edit only `storefronts/<slug>/`.
     > Push to and open the PR from the task's `branch`, not this session's default branch: this
     > is your explicit permission to use it.

     Without that last line the session pushes to the branch it was given (`claude/<name>`).
     Core still finds that PR by its `vendua-task:<id>` line and moves the task onto its branch.

   - Trigger: **API**. Save, then open the API trigger, copy the URL into
     `VENDUA_SITE_ROUTINE_URL`, generate a token and copy it into `VENDUA_SITE_ROUTINE_TOKEN`
     (it's shown once).

The routine runs on your claude.ai account. Its usage counts against your subscription, and its
commits and PRs carry your GitHub user. The limits are 30 fires an hour per routine and 100 an
hour per account.

## 3. Core (Dokploy environment)

| Variable                       | Value                                |
| ------------------------------ | ------------------------------------ |
| `VENDUA_SITE_ROUTINE_URL`      | the routine's `/fire` URL            |
| `VENDUA_SITE_ROUTINE_TOKEN`    | the routine's API token              |
| `VENDUA_GITHUB_REPO`           | `owner/repo`                         |
| `VENDUA_GITHUB_TOKEN`          | the fine-grained token from step 1.3 |
| `VENDUA_GITHUB_WEBHOOK_SECRET` | the webhook secret from step 1.4     |

**Auto-deploy on push to `main`** must be on in Dokploy. Staff approval merges the PR, and
the merge only reaches the store when a deploy runs `vendua release publish --all`. Without
auto-deploy, every site waits for someone to click deploy, which eats the 24-hour promise.

## 4. Staff

The 1-day promise counts weekends. Discord pings for "site pronto para revisar", "site travado"
and "site perto do prazo" need someone every day. The CRM's store page (Sites) is where staff
approve, retry, take a task by hand or cancel.

## Trying it

1. A Venduá-owned store on Pangolim: the owner asks Duá for the site and applies the card.
2. The CRM shows the task queued, then running with a link to the Claude session.
3. The PR opens with the `storefront:<slug>` label, and CI runs check, qa and screenshots
   (artifact `qa-report`).
4. Green: approve in the CRM. Core merges, the deploy publishes the release, the store adopts its
   bundle, and the task is delivered.
