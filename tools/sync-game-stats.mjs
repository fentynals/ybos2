#!/usr/bin/env node
/**
 * sync-game-stats.mjs -- refresh feed.json -> meta.stats (the GAME HEALTH window).
 *
 * WHY THIS EXISTS
 * ---------------
 * Since 2026-07-31 index.html pulls these numbers itself on every page open and
 * every 60s, through a CORS relay -- so GAME HEALTH is normally LIVE without
 * anyone writing feed.json. `meta.stats` is the FALLBACK: it is what renders on
 * first paint, and what the window shows (labelled "CACHED · Nd ago") whenever
 * the relay is unreachable.
 *
 * The problem this fixes: no scheduled job had ever refreshed that fallback, so
 * it only moved when an agent happened to do it by hand. On 2026-08-04 it was
 * 3.7 days stale and nearly 13,000 visits behind reality -- meaning any relay
 * outage showed numbers that were badly wrong rather than merely old.
 *
 * Server-side there is NO CORS and NO relay needed: plain fetch works. The relay
 * in index.html exists only because browsers enforce CORS and Roblox sends no
 * headers.
 *
 * Cadence is deliberately 6h, not hourly like analytics.yml: the browser already
 * keeps the live view current, so this only has to keep the fallback honest, and
 * every run costs a bot commit.
 */
import { readFileSync, writeFileSync } from "node:fs";

const PLACE_ID = 124673719670870;
const FEED = new URL("../feed.json", import.meta.url);
const DRY = !!process.env.DRY_RUN;

const j = async (url) => {
  const r = await fetch(url, { headers: { "User-Agent": "ybos2-game-stats" } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.json();
};

async function main() {
  // place -> universe. Resolved rather than hardcoded so a republish to a new
  // place can't silently leave this reporting a dead universe.
  const uni = await j(`https://apis.roblox.com/universes/v1/places/${PLACE_ID}/universe`);
  const universeId = uni.universeId;
  if (!universeId) throw new Error("could not resolve universeId");

  const games = await j(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
  const g = games?.data?.[0];
  if (!g) throw new Error("games endpoint returned no data");

  // votes are a separate endpoint; a failure here must not lose the rest
  let likes = null, dislikes = null;
  try {
    const v = await j(`https://games.roblox.com/v1/games/votes?universeIds=${universeId}`);
    likes = v?.data?.[0]?.upVotes ?? null;
    dislikes = v?.data?.[0]?.downVotes ?? null;
  } catch (e) {
    console.warn("votes fetch failed, keeping previous:", e.message);
  }

  const feed = JSON.parse(readFileSync(FEED, "utf8"));
  feed.meta = feed.meta || {};
  const prev = feed.meta.stats || {};

  const stats = {
    placeId: PLACE_ID,
    universeId,
    name: g.name ?? prev.name ?? null,
    playing: g.playing ?? 0,
    visits: g.visits ?? 0,
    favorites: g.favoritedCount ?? 0,
    maxPlayers: g.maxPlayers ?? prev.maxPlayers ?? null,
    // null from a failed votes call must not overwrite a good previous value
    likes: likes ?? prev.likes ?? 0,
    dislikes: dislikes ?? prev.dislikes ?? 0,
    fetched: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  };

  console.log("playing=%d visits=%d favorites=%d likes=%d dislikes=%d",
    stats.playing, stats.visits, stats.favorites, stats.likes, stats.dislikes);
  if (prev.visits != null) {
    console.log("delta since last write: visits %+d, favorites %+d",
      stats.visits - prev.visits, stats.favorites - (prev.favorites ?? 0));
  }

  if (DRY) { console.log("DRY_RUN -- not writing"); return; }

  feed.meta.stats = stats;
  feed.meta.updated = new Date().toISOString();
  // 2-space indent + trailing newline matches how the rest of the repo writes
  // this file, so the diff stays to the lines that actually changed
  writeFileSync(FEED, JSON.stringify(feed, null, 2) + "\n");
  console.log("feed.json updated");
}

main().catch((e) => { console.error("sync-game-stats failed:", e.message); process.exit(1); });
