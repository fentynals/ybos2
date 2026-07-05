# YBOS2 — yungsbruh's dispatch feed

This repo powers YUNGSBRUH.OS, a live dashboard at https://fentynals.github.io/ybos2/
It has exactly two files that matter:

- `index.html` — the OS webpage. You MAY edit it, with mandatory validation:
  1. Before committing, extract every <script> block and syntax-check each one
     (e.g. write to a temp .js file and run `node --check`). ALL must pass.
  2. Verify the page still contains: `const FEED_URL = "https://raw.githubusercontent.com/fentynals/ybos2/main/feed.json"` — never change or remove the feed wiring.
  3. Never commit index.html if any check fails. A broken index.html takes the whole site down with a blank screen and no error.
  4. UI changes should preserve the existing design system (CSS variables, fonts, window manager) unless explicitly asked to redesign.
- `feed.json` — the live data the OS polls (~15s; GitHub's raw CDN caches it, so updates land within a few minutes).

## feed.json schema
`meta`:
- `updated` — ISO-8601 UTC. Set to now on every commit.
- `version` — dashboard version string shown in the topbar.
- `stats` — live Roblox stats for HEADTAP, shown in the GAME HEALTH window. `null` until first fetched.
  Shape: { "placeId":124673719670870, "universeId":10194619622, "name":"HEAD TAP", "playing":N, "visits":N,
  "favorites":N, "maxPlayers":N, "likes":N, "dislikes":N, "fetched":ISO }
- `contentAgent` — status of the content-creator agent, shown live in the CONTENT studio bar.
  Shape: { "status":"idle"|"working", "note":"short status", "updated":ISO }
- `analytics` — social stats shown in the ANALYTICS window. `null` until the analytics sync first runs.
  Auto-pulled server-side (OAuth per platform) and written here — the browser can't call these APIs (CORS + secrets).
  Full setup + API details in `UPLOAD_ANALYTICS_PLAN.md`. Shape:
  { "updated":ISO,
    "tiktok":{ "followers":N,"views":N,"likes":N,"comments":N,"shares":N },
    "youtube":{ "subscribers":N,"views":N,"likes":N,"comments":N },
    "instagram":{ "followers":N,"views":N,"likes":N,"comments":N },
    "top":[ { "t":"post title","plat":"tiktok|youtube|instagram","views":N,"likes":N,"url":"..." } ],
    "series":[ { "d":"MM-DD","tiktok":N,"youtube":N,"instagram":N } ] }  // series = daily views per platform

Top-level arrays:
- `radio[]` — dispatch lines in the DISPATCH LOG window. PREPEND newest first.
  Shape: { "who":"PRIME"|"STUDIO"|"QA"|"CRON"|"CONTENT", "cls":"okx"|"fx"|"shipx"|"out", "msg":"...", "ts":ISO }
  - okx = green (verified/fix), fx = red (bug/exploit), shipx = blue (shipped), out = gray (routine)
- `bugs[]` — the BUGS tracker (sorted open→killed): { "id":"slug", "sev":"high|med|low", "status":"open|watch|killed", "t":"title", "note":"...", "ts":ISO }
- `ship[]` — shiplog: { "d":"YYYY-MM-DD", "k":"feat"|"fix", "t":"title", "s":"one-line summary" } — prepend newest.
- `tasks[]` — the shared task board (agents write here). NOTE: the human's board lives in browser localStorage
  and only imports these on demand. Shape: { "t":"...", "col":0-3 (0=backlog…3=shipped), "pr":"high|med|low", "tags":[...] }
- `content[]` — video-idea pool for the CONTENT studio; the content-creator agent appends here.
  Shape: { "t":"title", "hook":"exact first line / on-screen text", "fmt":"short|long|teaser|trend", "plat":"tiktok|shorts|yt|ig", "col":0-3 }
- `rejections[]` — the user's "why I passed" taste log, so content-creator learns what to avoid.
  Shape: { "t":"idea title", "plat":"…", "fmt":"…", "reason":"generic|offbrand|overdone|unfilmable|platform|hook|meh|custom", "note":"free-text (filled when reason=custom, else empty)", "ts":ISO }

## Daily scheduled task ("heartbeat")
When run as the daily update:
1. git pull first — other agents also push here; never clobber their entries.
2. Refresh `meta.stats`: resolve HEADTAP place 124673719670870 → universe 10194619622
   (`GET apis.roblox.com/universes/v1/places/124673719670870/universe`), then
   `GET games.roblox.com/v1/games?universeIds=10194619622` (playing/visits/favorites) and
   `/v1/games/votes?universeIds=10194619622` (likes/dislikes). Write into `meta.stats` with `fetched`=now.
   These calls work server-side only (no CORS) — the browser can't make them. Skip silently if unreachable.
3. Append ONE radio line from who:"CRON", cls:"out": a short status — date, commit count in last 24h,
   and the refreshed playing/visits.
