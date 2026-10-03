# Deploying Skrim

Everything runs on free tiers with no card: three Vercel projects from this repo, and the
extension zip on GitHub Releases.

| What | Where | How it updates |
|---|---|---|
| Landing page | Vercel, root `apps/web`: `https://skrim-hackspire.vercel.app` | every push to main |
| Dashboard | Vercel, root `apps/dashboard`: `https://skrim-dashboard.vercel.app` | every push to main |
| Planning server | Vercel, root `apps/server` (one function): `https://skrim-server.vercel.app` | every push to main |
| Extension zip | GitHub Releases, `releases/latest/download/skrim-chrome.zip` | pushing a `v*` tag (`release-extension.yml`) |

The demo itself still runs on a laptop (`pnpm dev:server`, `pnpm dev:dashboard`, the extension
built locally): nothing on stage depends on a free host. The hosted copies are for judges and
anyone who wants to try it.

## Why Vercel, and why the server is safe there

- The two sites are static. The dashboard's data comes from the extension in the same browser,
  never from a server.
- The planning server is the easy case for serverless: it keeps nothing between requests (no
  session, no user identity, by design), opens no long-lived connection, writes no file, and does
  no work after it answers. One request in, one action out.
- Time: a step can wait out Groq's per-minute limit for up to 30 s, then call the model. The
  function is allowed 60 s (`maxDuration` in `apps/server/scripts/build-vercel.mjs`, the Hobby
  plan's ceiling without Fluid compute; with it, 300 s).
- Cold starts are about a second. Render's free tier sleeps after 15 minutes and takes 30 to 60 s
  to wake, and Docker on Hugging Face Spaces is paid.
- The usual way a monorepo breaks on Vercel is the build: resolving workspace packages that are
  TypeScript source. So the server is bundled by us, not by Vercel: `build-vercel.mjs` makes one
  file with every dependency in Vercel's Build Output format, and Vercel deploys it as it is. The
  bundle was run locally the way Vercel runs it, against a fake model: `GET /` answers, a bad
  request is refused, a step is planned.

Each app's `vercel.json` holds its install and build commands (pnpm 11 through npx, installing
only that app and the workspace packages it uses). Nothing needs setting in Vercel's build
settings except the root directory.

## One-time setup

### 1. The three Vercel projects

For each of `apps/web`, `apps/dashboard` and `apps/server`: vercel.com → Add New → Project →
import `letsbecool9792/skrim-hackspire` → Root Directory: that folder → Deploy.

The server project also needs, under Settings → Environment Variables (Production), then a
redeploy:
- `GROQ_API_KEY`: your key.
- Optional, for when Groq's day runs out: `NVIDIA_API_KEY` and `FALLBACK_PROVIDER` = `nvidia`.

Opening the server's URL answers `{"status":"ok", ..., "model":"qwen/qwen3.8-27b"}`.

**Anyone with the server's URL can use our Groq quota.** It cannot cost money (the tier has no
card), but it can use up the day's requests. The server keeps no user identity on purpose, so it
has no per-user limit. If that becomes a problem, change the key in Vercel and redeploy.

### 2. The extension release

Tag and push: `git tag v0.3.1`, then `git push origin v0.3.1`. The workflow builds against
`https://skrim-server.vercel.app` and `https://skrim-dashboard.vercel.app`, stamps the version
from the tag, and publishes the release with `skrim-chrome.zip`. It leaves out the icon
detector (nothing calls it yet). To build a release against other hosts, set the repository
variables `SKRIM_SERVER_URL` and `WXT_DASHBOARD_URL` (Settings → Secrets and variables →
Actions → Variables, no trailing slash); they override the defaults.

## Local builds stay local

`pnpm --filter @skrim/extension build` with nothing set still talks to `localhost:3000` and looks
for the dashboard at `localhost:5173`. Only the release workflow sets `SKRIM_SERVER_URL` and
`WXT_DASHBOARD_URL`. To try a hosted build by hand:

```powershell
$env:SKRIM_SERVER_URL = "https://skrim-server.vercel.app"
$env:WXT_DASHBOARD_URL = "https://skrim-dashboard.vercel.app"
$env:SKRIM_SKIP_ICON = "1"
pnpm --filter @skrim/extension build
```

Clear the three afterwards (`Remove-Item Env:SKRIM_SERVER_URL, Env:WXT_DASHBOARD_URL,
Env:SKRIM_SKIP_ICON`) and rebuild, or the next local build talks to the hosted server.

To check the server's bundle without deploying: `node apps/server/scripts/build-vercel.mjs`
writes `apps/server/.vercel/output/` (gitignored).
