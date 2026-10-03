# Deploying Skrim

Three things are hosted, all on free tiers with no card:

| What | Where | How it updates |
|---|---|---|
| Landing page | GitHub Pages: `https://letsbecool9792.github.io/skrim-hackspire/` | on every push to main that touches it (`deploy-pages.yml`) |
| Dashboard | GitHub Pages: `https://letsbecool9792.github.io/skrim-hackspire/dashboard/` | the same workflow |
| Planning server | A Hugging Face Space (Docker, free CPU) | "Factory rebuild" in the Space's settings |
| Extension zip | GitHub Releases, `releases/latest/download/skrim-chrome.zip` | pushing a `v*` tag (`release-extension.yml`) |

The demo itself still runs on a laptop (`pnpm dev:server`, `pnpm dev:dashboard`, the extension
built locally): nothing on stage depends on a free host being awake. The hosted copies are for
judges and anyone who wants to try it.

## Why these hosts

- **GitHub Pages** for the two static sites: no new account, and the repo is already public.
  The dashboard is static too: its data comes from the extension in the same browser, never from
  a server.
- **A Hugging Face Space** for the server: free, no card, 2 vCPU and 16 GB, and it sleeps only
  after 48 hours without traffic. Render's free tier sleeps after 15 minutes (a 30 to 60 s cold
  start on the first step), and Cloudflare Workers' free plan allows 10 ms of CPU a request,
  which a big page's request can exceed.

## One-time setup

### 1. GitHub Pages

Settings → Pages → Build and deployment → Source: **GitHub Actions**. Then Actions →
deploy-pages → Run workflow (or push anything under `apps/web/`).

### 2. The planning server (Hugging Face Space)

1. On huggingface.co: New Space → name `skrim-planner` → SDK **Docker** → blank → **Public**
   (the extension calls it without a login) → CPU basic (free).
2. In the Space's Files tab, upload [`deploy/huggingface/Dockerfile`](../deploy/huggingface/Dockerfile)
   and [`deploy/huggingface/README.md`](../deploy/huggingface/README.md), replacing its README.
   The Dockerfile clones this repo's main branch at build time.
3. Settings → Variables and secrets → New **secret** `GROQ_API_KEY`. For when Groq's day runs
   out, also add secret `NVIDIA_API_KEY` and variable `FALLBACK_PROVIDER` = `nvidia`.
4. Wait for "Running", then open `https://<your-hf-username>-skrim-planner.hf.space/`. It answers
   `{"status":"ok", ..., "model":"qwen/qwen3.8-27b"}`.

To ship a server change: merge it to main, then Settings → **Factory rebuild**.

**Anyone with the URL can use our Groq quota.** It cannot cost money (the tier has no card), but
it can use up the day's requests. The server keeps no user identity on purpose, so it has no
per-user limit. If that becomes a problem: restart the Space with a new key, or make the Space
private before the demo.

### 3. The extension release

1. Settings → Secrets and variables → Actions → **Variables** → New variable
   `SKRIM_SERVER_URL` = the Space's URL from step 2.4, no trailing slash. Without it the release
   workflow stops instead of shipping a zip that talks to `localhost`.
2. Tag and push: `git tag v0.3.0`, then `git push origin v0.3.0`. The workflow builds with the
   hosted server and dashboard URLs, stamps the version from the tag, and publishes the release
   with `skrim-chrome.zip`. It leaves out the icon detector (nothing calls it yet).

## Local builds stay local

`pnpm --filter @skrim/extension build` with nothing set still talks to `localhost:3000` and looks
for the dashboard at `localhost:5173`. Only the release workflow sets `SKRIM_SERVER_URL` and
`WXT_DASHBOARD_URL`. To try a hosted build by hand:

```powershell
$env:SKRIM_SERVER_URL = "https://<user>-skrim-planner.hf.space"
$env:WXT_DASHBOARD_URL = "https://letsbecool9792.github.io/skrim-hackspire/dashboard/"
$env:SKRIM_SKIP_ICON = "1"
pnpm --filter @skrim/extension build
```

Clear the three afterwards (`Remove-Item Env:SKRIM_SERVER_URL, Env:WXT_DASHBOARD_URL,
Env:SKRIM_SKIP_ICON`) and rebuild, or the next local build talks to the hosted server.
