# Task 05: Deploy to Vercel

## Goal

Project lives at a public Vercel URL. Caching works in production. Project owner can send his mom a link.

## Pre-flight checks

```bash
# 1. Tasks 01-04 should be complete. Spot-check:
grep -q "opengraph-image" src/app/\[place\]/ 2>/dev/null && echo "ok: og image" || echo "FAIL: complete Task 04 first"

# 2. `npm run build` should succeed locally
npm run build 2>&1 | tail -20
# Expected: ✓ Compiled successfully

# 3. No uncommitted changes
git status --short
# Expected: empty (all committed)

# 4. Code is on a remote branch
git remote -v
# Expected: origin or similar — Vercel needs git access
```

## Acceptance criteria

- [ ] App is deployed to Vercel and accessible at a `*.vercel.app` URL.
- [ ] Vercel KV is provisioned and env vars auto-injected.
- [ ] Repeat requests for long-tail slugs (e.g. `/sahara-desert`) are fast (cache working).
- [ ] OG image renders correctly when URL is shared in iMessage / Discord / Twitter.
- [ ] All happy-path URLs from `docs/reference/TROUBLESHOOTING.md` work in production.
- [ ] Project owner has the URL and can send it to mom.

## Steps

### 1. Push to GitHub (if not already)

```bash
# Create a repo on github.com/<owner>/how-many-rhode-islands first
git remote add origin git@github.com:<owner>/how-many-rhode-islands.git
git push -u origin main
```

### 2. Connect to Vercel

**Web flow** (recommended for first-time):
1. Go to https://vercel.com/new
2. Import the GitHub repo
3. Framework: auto-detected as Next.js
4. Build command: `next build` (default)
5. Output directory: `.next` (default)
6. Install command: `npm install` (default)
7. **Root directory**: leave as `./`
8. Click Deploy

After first deploy, you'll have a URL like `how-many-rhode-islands-<hash>.vercel.app`.

**CLI flow** (if you prefer):
```bash
npm install -g vercel
vercel login
vercel link
vercel --prod
```

### 3. Provision Vercel KV

This is what makes Tasks 02 and 03 fast in production.

1. In Vercel dashboard → your project → Storage tab
2. Click "Create Database" → choose **KV** (or "Marketplace Database" → KV/Redis depending on the current UI).
3. Name it: `hmri-cache` or similar.
4. Region: pick closest to your primary deploy region (default is fine).
5. Connect to the project. Vercel auto-injects:
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
   - `KV_REST_API_READ_ONLY_TOKEN`

> The Vercel marketplace KV product has changed names a few times (KV → Marketplace KV → Upstash). The interface name varies but the env vars are stable.

### 4. Pull KV vars locally for dev

```bash
vercel env pull .env.local
```

Now your local `npm run dev` also benefits from cached lookups. (Add `.env.local` to `.gitignore` — it's already there from the scaffold.)

### 5. Trigger a redeploy after adding KV

The first deploy didn't have KV env vars. After provisioning KV, redeploy:
- Push any commit, or
- Vercel dashboard → Deployments → "..." → Redeploy

### 6. Smoke test in production

```bash
DEPLOY_URL=https://your-deploy.vercel.app

# Static path — fast
curl -s "$DEPLOY_URL/russia" | grep -q "5,447" && echo "ok: russia" || echo "FAIL"

# Long-tail — first hit slow, second fast
time curl -s -o /dev/null "$DEPLOY_URL/sahara-desert"
time curl -s -o /dev/null "$DEPLOY_URL/sahara-desert"
# First: ~1-2s. Second: ~100-300ms. (Cold start adds variance.)

# OG image
curl -sI "$DEPLOY_URL/russia/opengraph-image" | head -1
# Expected: HTTP/2 200, content-type: image/png

# Unfurl test: paste the URL into iMessage / Discord and visually confirm the rich preview
```

### 7. (Optional) Custom domain

If you want `howmanyrhodeislands.com`:

1. Check availability on Namecheap/Cloudflare/etc. (~$10/year if available).
2. Buy.
3. Vercel dashboard → Domains → Add → enter the domain.
4. Add the DNS records Vercel shows you to your registrar.
5. Wait for propagation (~5-30 min).

Skip this step for v1 unless mom is going to remember the URL more easily with a custom name.

### 8. (Optional) Vercel Analytics

Free tier covers basic page views. In Vercel dashboard → Analytics tab → Enable. Add to `layout.tsx`:

```tsx
import { Analytics } from "@vercel/analytics/react";

// inside <body>:
<Analytics />
```

```bash
npm install @vercel/analytics
```

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Build fails: "Failed to fetch font" | Sandbox/restricted network. | Vercel build environment has full internet — should work. If not, ensure `display: "swap"` is set on font definitions. |
| Production 500s on `/russia` | Function bundle too large. | Bundle includes all of `data/geo/*.json` (~1.7MB). Should be fine. If not, consider splitting per-feature files. |
| OG image returns 500 | Edge runtime can't import a server-only module. | The `opengraph-image.tsx` template only uses edge-safe imports. If you added `fs`-touching code, move to Node runtime: `export const runtime = "nodejs"`. |
| KV not working in production | Env vars missing. | Vercel dashboard → Settings → Environment Variables → confirm `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set for "Production" environment. |
| Long-tail slugs always slow | Cache not hitting. | Add a temporary `console.log` in `cacheGet` and `cacheSet`. Check Vercel logs. If `kv` calls throw, env vars are misnamed. |
| Unfurl preview doesn't show OG image | Cache on the unfurler side. | iMessage/Twitter cache OG images aggressively. Clear unfurl cache: Twitter has a Card Validator at https://cards-dev.twitter.com/validator. iMessage: send to a different chat. |

## Production sanity checklist

After every deploy, run these in order. Stop and diagnose at the first failure.

```bash
DEPLOY_URL=https://your-deploy.vercel.app

# 1. Home loads
curl -sI "$DEPLOY_URL/" | grep -q "200" && echo "✓ home" || echo "✗ home"

# 2. Static place loads with correct number
curl -s "$DEPLOY_URL/russia" | grep -q "5,447" && echo "✓ russia" || echo "✗ russia"

# 3. Texas matches t-shirt expectation
curl -s "$DEPLOY_URL/texas" | grep -q "221" && echo "✓ texas" || echo "✗ texas"

# 4. Flipped case works
curl -s "$DEPLOY_URL/luxembourg" | grep -q "bigger than" && echo "✓ luxembourg" || echo "✗ luxembourg"

# 5. Long-tail works (Wikidata)
curl -s "$DEPLOY_URL/sahara-desert" | grep -q "Rhode Islands fit inside" && echo "✓ sahara" || echo "✗ sahara"

# 6. OG image returns
curl -sI "$DEPLOY_URL/russia/opengraph-image" | grep -q "image/png" && echo "✓ og image" || echo "✗ og image"

# 7. 404 works
curl -s -o /dev/null -w "%{http_code}\n" "$DEPLOY_URL/asdkfjasdkf"
# Expected: 404
```

## When done

- [ ] All acceptance criteria check.
- [ ] All sanity checklist commands print `✓`.
- [ ] Update `docs/HANDOFF.md` Current State: flip `Deployed to Vercel` from 🟡 to ✅.
- [ ] Send the URL to your mom. 🎉
- [ ] Final commit: `feat(05-deploy): deploy to vercel with kv` (if any code changes were needed).

## Post-launch (out of scope for v1, listed for future you)

- Domain (`howmanyrhodeislands.com`)
- Vercel Analytics
- Sentry / error monitoring
- Pre-rendered ISR for the most popular static slugs (would gain ~50ms per request)
- A "random place" button on the home page
- A small footer crediting the original site
- Better search disambiguation (city vs country with the same name)
