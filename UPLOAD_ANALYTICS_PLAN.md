# Social Uploads + Analytics — build plan

Two capabilities for TikTok / YouTube / Instagram:

1. **Launchpad (upload)** — ✅ **shipped** in the CONTENT window. No backend.
2. **Analytics auto-pull** — needs a backend sync. This doc is the plan for it (and for phase‑2 real auto‑post).

---

## Why analytics needs a backend

YBOS2 is a static page on GitHub Pages. It cannot:
- hold API secrets (anything in the page source is public), or
- call the platform APIs from the browser (they block cross-origin browser calls).

So analytics works exactly like the **GAME HEALTH** heartbeat already does: a **scheduled job runs server-side, fetches the numbers, and writes them into `feed.json → meta.analytics`.** The dashboard just polls `feed.json` every 15s and renders — the ANALYTICS window is already built and waiting for that data.

```
[GitHub Actions cron]  --OAuth-->  TikTok / YouTube / Instagram APIs
        |  (secrets stored as encrypted GH repo secrets)
        v
   sync-analytics script  -->  writes feed.json meta.analytics  -->  git push
        v
   raw.githubusercontent.com/.../feed.json  -->  dashboard renders (ANALYTICS window)
```

Recommended cadence: every 6h (`cron: "0 */6 * * *"`). Cheap and well within every platform's rate limits.

---

## `meta.analytics` shape (what the sync writes)

```json
{
  "updated": "2026-07-05T12:00:00Z",
  "tiktok":    { "followers": 0, "views": 0, "likes": 0, "comments": 0, "shares": 0 },
  "youtube":   { "subscribers": 0, "views": 0, "likes": 0, "comments": 0 },
  "instagram": { "followers": 0, "views": 0, "likes": 0, "comments": 0 },
  "top":    [ { "t": "post title", "plat": "tiktok", "views": 0, "likes": 0, "url": "https://…" } ],
  "series": [ { "d": "07-05", "tiktok": 0, "youtube": 0, "instagram": 0 } ]
}
```
`series` = daily views per platform (the sync appends one entry per run/day, keep ~30). `top` = your best recent posts.

---

## Per-platform API notes (the honest version)

### TikTok
- **Developer app:** developers.tiktok.com → create app, add **Login Kit** + **Content Posting API**.
- **Analytics:** OAuth scopes `user.info.stats` (follower_count, likes_count) and `video.list` (per-video `view_count`, `like_count`, `comment_count`, `share_count`). One-time user authorization mints a token the job refreshes.
- **Auto-post (phase 2):** Content Posting API `/v2/post/publish/video/init/` with the `video.publish` scope. ⚠️ **App audit required** — until TikTok approves your app, posts are restricted to private/self-only. Approval can take weeks.

### YouTube
- **Developer app:** Google Cloud console → enable **YouTube Data API v3** (+ **YouTube Analytics API** for time-series) → OAuth client.
- **Analytics:** `channels.list?part=statistics` (subscriberCount, viewCount), `videos.list?part=statistics` per video. Public channel/video stats need only an API key; your private time-series needs OAuth.
- **Auto-post (phase 2):** `videos.insert` (resumable upload, OAuth). Costs ~1600 quota units/upload against a default 10k/day — fine for a few posts/day.

### Instagram
- **Requirement:** an Instagram **Business or Creator** account linked to a **Facebook Page** (personal accounts can't use the API).
- **Developer app:** Meta for Developers → app with **Instagram Graph API** → long-lived token.
- **Analytics:** `GET /{ig-user-id}?fields=followers_count,media_count`, and `/{ig-user-id}/media` + `/insights` for reach/impressions/likes/comments per post.
- **Auto-post (phase 2):** two-step — create a media container from a **publicly-hosted video URL**, then `/{ig-user}/media_publish`. Reels supported. (You must host the file somewhere public first.)

---

## What you do vs. what I do

**You (once, ~30–60 min each, can't be automated or done by me — they need your login):**
1. Register the 3 developer apps above.
2. Run the one-time OAuth grant for each to mint tokens (I'll give you the exact URLs/commands).
3. Paste the resulting tokens/IDs into **GitHub → repo Settings → Secrets and variables → Actions** (e.g. `TIKTOK_TOKEN`, `YT_OAUTH_JSON`, `IG_TOKEN`, `IG_USER_ID`). Secrets are encrypted and never exposed to the page.

**Me (once you've done the above):**
1. Scaffold `tools/sync-analytics.mjs` with a per-platform fetch function (reads tokens from `process.env`, builds the `meta.analytics` object, `git pull` → merge → write `feed.json` → commit).
2. Add `.github/workflows/analytics.yml` (cron + `workflow_dispatch` so you can trigger a run manually).
3. Dry-run it, confirm the ANALYTICS window lights up.

Phase 2 (real auto-post) is a bigger lift and gated on the TikTok/IG approvals above — I'd tackle it after analytics is flowing. The **Launchpad already covers posting today** (builds the caption + hashtags, opens each uploader, marks the card POSTED).

---

## Status
- [x] Launchpad (upload) — live in CONTENT window
- [x] ANALYTICS window + `meta.analytics` schema — live, showing "awaiting first sync"
- [x] Me: `tools/sync-analytics.mjs` + `.github/workflows/analytics.yml` (all 3 platforms, cron every 6h)
- [ ] **You: register apps + authorize + add GitHub secrets** (steps below) ← we're here
- [ ] First `workflow_dispatch` dry-run to validate against your real API responses
- [ ] Phase 2: real auto-post via APIs (after TikTok/IG app approval)

---

## Setup — do these, then the sync goes live

All tokens go in **GitHub → repo Settings → Secrets and variables → Actions → New repository secret**. Secret names must match exactly (see `tools/.env.example`). Each platform is independent — do them in any order; the window fills in per platform as you go. **Start with YouTube — it's ~5 minutes and needs no OAuth.**

### 1. YouTube (easiest, no OAuth)
1. Google Cloud Console → new project → **APIs & Services → Enable APIs → YouTube Data API v3**.
2. **Credentials → Create credentials → API key.** → secret `YT_API_KEY`.
3. Get your channel id (starts `UC…`) from YouTube Studio → Settings → Channel → Advanced, or your channel URL. → secret `YT_CHANNEL_ID`.

### 2. TikTok (OAuth)
1. developers.tiktok.com → create an app → add **Login Kit**; request scopes `user.info.stats` and `video.list`.
2. Note the **Client key** / **Client secret** → secrets `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`.
3. Run the one-time OAuth grant to get a **refresh token** → secret `TIKTOK_REFRESH_TOKEN`. (Ping me when you reach this step — I'll give you the exact authorize URL + token-exchange command for your app.)
4. ⚠️ Those scopes may need app review before they return data; the sync logs a clear error until then and leaves the other platforms working.

### 3. Instagram (Graph API)
1. Convert the IG account to **Business or Creator** and link it to a **Facebook Page**.
2. Meta for Developers → create an app → add **Instagram Graph API**.
3. Generate a **long-lived access token** and get the **IG user id** (the numeric business-account id, not your @handle). → secrets `IG_TOKEN`, `IG_USER_ID`. (This one's fiddly — ping me and I'll walk the token exchange with you.)

### 4. Run it
GitHub → **Actions → analytics-sync → Run workflow**, tick **dry_run** for the first run and read the logs to confirm the numbers look right. Then run it again without dry_run (or just wait for the 6-hour cron) — it commits `meta.analytics` into `feed.json` and the ANALYTICS window lights up within a couple minutes.
