#!/usr/bin/env node
/**
 * sync-feedback.mjs -- pull in-game player feedback into feed.json -> meta.feedback.
 *
 * PIPELINE
 *   MENU tray (speaking head) -> FeedbackClient panel -> FeedbackServer
 *   -> DataStore "Feedback_v1", one key per entry ("e_0000001", counter-allocated)
 *   -> this job (Open Cloud) -> feed.meta.feedback -> PLAYER FEEDBACK window
 *
 * WHY IT READS THE COUNTER INSTEAD OF LISTING KEYS
 * ------------------------------------------------
 * FeedbackServer allocates ids with IncrementAsync on "_counter" and pads them
 * to e_%07d -- so lexical order IS numeric order, and the newest id is simply
 * the counter value. Reading the counter and walking backwards costs N+1
 * requests no matter how much feedback exists, whereas ListKeys pages through
 * the entire store every run and gets slower forever. At 10k entries the
 * listing approach would burn the Open Cloud quota for no benefit.
 *
 * KEY SCOPE: this only ever READS. Give the CI key `universe-datastores` with
 * Read + List and nothing else -- ybos2 is a PUBLIC repo, so the key used here
 * should not be the one that can also create paid products.
 */
import { readFileSync, writeFileSync } from "node:fs";

const UNIVERSE = "10194619622";
const STORE = "Feedback_v1";
const KEEP = 50;                    // newest N embedded in feed.json
const KEY = process.env.ROBLOX_DATASTORE_KEY;
const DRY = !!process.env.DRY_RUN;
const BASE = `https://apis.roblox.com/datastores/v1/universes/${UNIVERSE}/standard-datastores`;
const FEED = new URL("../feed.json", import.meta.url);

if (!KEY) {
  console.error("ROBLOX_DATASTORE_KEY is not set -- add it as a repo secret");
  process.exit(1);
}

async function entry(entryKey) {
  const q = new URLSearchParams({ datastoreName: STORE, entryKey });
  const r = await fetch(`${BASE}/datastore/entries/entry?${q}`, { headers: { "x-api-key": KEY } });
  if (r.status === 404) return null;              // deleted / never existed
  if (r.status === 403) throw new Error("403 INSUFFICIENT_SCOPE -- the key lacks universe-datastores Read");
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} reading ${entryKey}`);
  return r.json();
}

async function main() {
  const counter = await entry("_counter");
  const maxId = Number(counter);
  if (!Number.isFinite(maxId) || maxId <= 0) {
    console.log("no feedback yet (counter absent or zero)");
    return;
  }

  const items = [];
  // walk backwards from newest; tolerate gaps rather than stopping at the first
  // miss, so one removed entry can't truncate the whole list
  for (let id = maxId; id > 0 && items.length < KEEP; id--) {
    const key = "e_" + String(id).padStart(7, "0");
    let e;
    try { e = await entry(key); } catch (err) { console.warn(key, err.message); continue; }
    if (!e || typeof e.text !== "string") continue;
    items.push({
      t: e.text,
      who: e.display || e.name || null,
      name: e.name || null,
      uid: e.userId ?? null,
      at: e.at ? new Date(e.at * 1000).toISOString().replace(/\.\d+Z$/, "Z") : null,
      v: e.version ?? null,
    });
  }

  console.log(`counter=${maxId}, embedded ${items.length} newest`);
  items.slice(0, 3).forEach((x) => console.log(`   ${x.at} ${x.who}: ${String(x.t).slice(0, 60)}`));
  if (DRY) { console.log("DRY_RUN -- not writing"); return; }

  const feed = JSON.parse(readFileSync(FEED, "utf8"));
  feed.meta = feed.meta || {};
  feed.meta.feedback = {
    updated: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    count: maxId,
    items,
  };
  feed.meta.updated = new Date().toISOString();
  writeFileSync(FEED, JSON.stringify(feed, null, 2) + "\n");
  console.log("feed.json updated");
}

main().catch((e) => { console.error("sync-feedback failed:", e.message); process.exit(1); });
