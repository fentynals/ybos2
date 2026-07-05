# YBOS2 — yungsbruh's dispatch feed

This repo powers YUNGSBRUH.OS, a live dashboard at https://fentynals.github.io/ybos2/
It has exactly two files that matter:

- `index.html` — the OS webpage. **NEVER edit this file. Ever.** It is generated elsewhere.
  Hand-editing it has broken the site before. If a task seems to require changing it, stop and say so instead.
- `feed.json` — the live data the OS polls every 15s. This is the ONLY file you edit.

## feed.json schema
- `meta.updated` — ISO-8601 UTC timestamp. Always set to now when committing.
- `radio[]` — dispatch lines shown in the AGENT RADIO window. PREPEND new entries (newest first).
  Shape: { "who": "PRIME"|"STUDIO"|"QA"|"CRON", "cls": "okx"|"fx"|"shipx"|"out", "msg": "...", "ts": ISO }
  - okx = green (verified/fix), fx = red (bug/exploit/problem), shipx = blue (shipped), out = gray (routine)
- `tasks[]` — kanban cards: { "t": "...", "col": 0-3 (0=backlog,1=in progress,2=testing,3=shipped), "pr": "high|med|low", "tags": [...] }
- `ship[]` — shiplog: { "d": "YYYY-MM-DD", "k": "feat"|"fix", "t": "title", "s": "one-line summary" } — prepend newest.

## Daily scheduled task ("heartbeat")
When run as the daily update:
1. git pull first — other agents also push here; never clobber their entries.
2. Append ONE radio line from who:"CRON", cls:"out": a short status — date, repo commit count in last 24h,
   and if reachable, HEADTAP's public Roblox stats (playing/visits). If stats can't be fetched, skip them silently.
