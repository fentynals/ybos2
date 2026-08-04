#!/usr/bin/env node
/**
 * sync-economy.mjs -- pull HEADTAP's economy into feed.json -> meta.economy.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * The game logs every money movement to Roblox's Analytics -> Economy dashboard
 * via LogEconomyEvent. Roblox has NO read API for analytics, so none of that can
 * ever reach ybos2. TelemetryServer therefore keeps a SECOND copy: daily
 * counters in the EconomyDaily_v1 DataStore, which Open Cloud CAN read.
 *
 * KEY SHAPE (written by TelemetryServer, merged across servers via UpdateAsync):
 *   key   "d_YYYY-MM-DD"                (UTC -- server timezones differ)
 *   field "<currency>|<SOURCE|SINK>|<REASON>" -> total amount
 *         "<currency>|<SOURCE|SINK>|_n"       -> transaction COUNT
 *
 * Currencies: DirtyCash (crime money) / Money (clean wallet) / Bank (safe).
 * The interesting read is DirtyCash SOURCE vs SINK -- how much crime money is
 * being created versus actually laundered.
 */
import { readFileSync, writeFileSync } from "node:fs";

const UNIVERSE = "10194619622";
const STORE = "EconomyDaily_v1";
const DAYS = 14;
const KEY = process.env.ROBLOX_DATASTORE_KEY;
const DRY = !!process.env.DRY_RUN;
const BASE = `https://apis.roblox.com/datastores/v1/universes/${UNIVERSE}/standard-datastores`;
const FEED = new URL("../feed.json", import.meta.url);

if (!KEY) { console.error("ROBLOX_DATASTORE_KEY is not set"); process.exit(1); }

async function entry(entryKey) {
  const q = new URLSearchParams({ datastoreName: STORE, entryKey });
  const r = await fetch(`${BASE}/datastore/entries/entry?${q}`, { headers: { "x-api-key": KEY } });
  if (r.status === 404) return null;
  if (r.status === 403) throw new Error("403 INSUFFICIENT_SCOPE -- key lacks universe-datastores Read");
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} reading ${entryKey}`);
  return r.json();
}

const dayKey = (d) => "d_" + d.toISOString().slice(0, 10);

async function main() {
  // Walk back day by day rather than listing: keys are date-derived, so they can
  // be constructed. Listing would page the whole store forever as it grows.
  const days = [];
  const totals = {};
  const now = new Date();
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const k = dayKey(d);
    let rec;
    try { rec = await entry(k); } catch (e) { console.warn(k, e.message); continue; }
    if (!rec || typeof rec !== "object") continue;

    const day = { d: k.slice(2), dirtyIn: 0, dirtyOut: 0, cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0, tx: 0 };
    for (const [field, val] of Object.entries(rec)) {
      const n = Number(val) || 0;
      const [cur, dir, reason] = field.split("|");
      if (reason === "_n") { day.tx += n; continue; }
      totals[`${cur}|${dir}|${reason}`] = (totals[`${cur}|${dir}|${reason}`] || 0) + n;
      const src = dir === "SOURCE";
      if (cur === "DirtyCash") src ? (day.dirtyIn += n) : (day.dirtyOut += n);
      else if (cur === "Money") src ? (day.cashIn += n) : (day.cashOut += n);
      else if (cur === "Bank") src ? (day.bankIn += n) : (day.bankOut += n);
    }
    days.push(day);
  }
  days.reverse(); // oldest -> newest, so the dashboard can plot it directly

  if (!days.length) { console.log("no economy data yet"); if (DRY) return; }

  // biggest sources and sinks across the window -- what actually drives the economy
  const rank = (dir) => Object.entries(totals)
    .filter(([k]) => k.split("|")[1] === dir)
    .map(([k, v]) => ({ cur: k.split("|")[0], reason: k.split("|")[2], v }))
    .sort((a, b) => b.v - a.v).slice(0, 8);

  const payload = {
    updated: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    days,
    sources: rank("SOURCE"),
    sinks: rank("SINK"),
  };

  console.log(`${days.length} days`);
  days.slice(-3).forEach(d => console.log(`   ${d.d} dirty +${d.dirtyIn}/-${d.dirtyOut}  cash +${d.cashIn}/-${d.cashOut}  tx ${d.tx}`));
  console.log("top sources:", payload.sources.map(s => `${s.reason}=${s.v}`).join(" "));
  if (DRY) { console.log("DRY_RUN -- not writing"); return; }

  const feed = JSON.parse(readFileSync(FEED, "utf8"));
  feed.meta = feed.meta || {};
  feed.meta.economy = payload;
  feed.meta.updated = new Date().toISOString();
  writeFileSync(FEED, JSON.stringify(feed, null, 2) + "\n");
  console.log("feed.json updated");
}

main().catch((e) => { console.error("sync-economy failed:", e.message); process.exit(1); });
